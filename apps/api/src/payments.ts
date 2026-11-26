/**
 * Gestión de cobro cartera Betel: pagos en línea de facturas a crédito por pasarela.
 *
 * Rutas:
 *   GET  /v1/reports/billing/online-payments ........ pestaña: filas paginadas + indicadores
 *   GET  /v1/reports/billing/online-payments/export . todas las filas filtradas (máx. EXPORT_LIMIT)
 *   GET  /v1/online-payments/payable-invoices ....... facturas a crédito con saldo para generar link
 *   POST /v1/online-payments ........................ generar link de pago
 *   POST /v1/online-payments/:id/email .............. enviar el link al cliente por correo
 *   POST /v1/online-payments/:id/cancel ............. anular un link pendiente
 *   POST /v1/online-payments/:id/disburse ........... registrar el desembolso de la pasarela
 *   GET  /v1/public/payments/:token ................. PÚBLICA: datos del link para la página de pago
 *   POST /v1/public/payments/:token/sandbox ......... PÚBLICA, solo pasarela de pruebas: simular resultado
 *
 * CICLO: link PENDING → la pasarela informa APPROVED o REJECTED. Al aprobarse, en la misma transacción:
 *   - se valida otra vez el saldo de la factura (si cambió, el pago queda rechazado y no se aplica);
 *   - se crea el recibo de caja (método ONLINE) que abona la factura y aparece en Recaudos;
 *   - asiento: Débito 138095 Pasarela por desembolsar (neto) + Débito 530515 Comisiones (comisión)
 *              / Crédito 130505 Clientes (total pagado);
 *   - el desembolso queda PENDING. Al registrarlo: Débito 111005 Bancos / Crédito 138095 (neto).
 *
 * INDICADORES (período por fecha de creación del link y buscador de cliente; los filtros de estado solo
 * afectan la tabla, como los "Filtrar" de cada indicador):
 *   - Total documentos: Σ valor de los links no anulados.
 *   - Total neto recibido: Σ neto de los pagos aprobados.
 *   - Por desembolsar: Σ neto de los aprobados con desembolso pendiente.
 *   - Pagos rechazados: cantidad de pagos rechazados.
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import {
  createPaymentLinkSchema,
  onlinePaymentQuerySchema,
  sandboxPaymentResultSchema,
  type OnlinePaymentQuery,
} from "@betel/contracts";
import { z } from "zod";
import { allowPermission, type MembershipRole } from "./auth.js";
import { assertBalanced, ensureDefaultAccounts } from "./accounting.js";
import { invoiceNumber, nextReceiptNumber, pendingInvoices, RECEIPT_ROLES } from "./collections.js";
import { mailerConfigured, sendMail } from "./mailer.js";
import { getPaymentProvider, type PaymentProvider } from "./payment-provider.js";
import { EXPORT_LIMIT, REPORT_EXPORT_ROLES, REPORT_VIEW_ROLES, resolvePeriod } from "./reports.js";

/** Pueden generar, enviar y anular links de pago. */
export const LINK_ROLES: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT", "SALES"];

const ZERO = new Prisma.Decimal(0);
type Tx = Prisma.TransactionClient;

export const methodLabels: Record<string, string> = { CARD: "Tarjeta", PSE: "PSE", NEQUI: "Nequi" };

// ─── Cálculos puros (probados en test/payments.test.ts) ──────────────────────

/** Número visible de un pago en línea. */
export const paymentNumber = (number: number) => `PL-${number}`;

/** Token del link público: organización + secreto aleatorio (la organización permite aplicar RLS). */
export const newToken = (organizationId: string) => `${organizationId}.${randomBytes(24).toString("hex")}`;
export function parseToken(token: string) {
  const match = /^([0-9a-f-]{36})\.([0-9a-f]{48})$/i.exec(token);
  return match ? { organizationId: match[1]! } : null;
}

/** Comisión y neto de un pago; error si la comisión se come todo el valor. */
export function settlement(
  amount: Prisma.Decimal,
  provider: Pick<PaymentProvider, "fee">
): { fee: Prisma.Decimal; net: Prisma.Decimal } | { error: string } {
  const fee = provider.fee(amount);
  const net = amount.minus(fee);
  if (!net.greaterThan(0)) return { error: "El valor es demasiado bajo para cubrir la comisión de la pasarela." };
  return { fee, net };
}

/** Colombia está en UTC−5 todo el año. */
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

function where(query: OnlinePaymentQuery, withStatusFilters: boolean): Prisma.OnlinePaymentWhereInput {
  const period = resolvePeriod(query);
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  return {
    // createdAt es fecha y hora (UTC): los días del período son días de Colombia (UTC−5, sin horario de verano),
    // así que van de las 05:00 UTC a las 05:00 UTC del día siguiente. Incluye todo el día final.
    createdAt: {
      gte: new Date(period.from.getTime() + BOGOTA_OFFSET_MS),
      lt: new Date(period.to.getTime() + 86_400_000 + BOGOTA_OFFSET_MS),
    },
    ...(query.search && {
      customer: {
        OR: [
          { legalName: contains(query.search) },
          { tradeName: contains(query.search) },
          { identificationNumber: contains(query.search) },
        ],
      },
    }),
    ...(withStatusFilters && query.status && { status: query.status }),
    ...(withStatusFilters && query.disbursement && { disbursementStatus: query.disbursement }),
  };
}

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

// ─── Consultas ────────────────────────────────────────────────────────────────

async function loadPayments(tx: Tx, query: OnlinePaymentQuery, rows: { skip: number; take: number }) {
  const period = resolvePeriod(query);
  const filtered = where(query, true);
  const base = where(query, false);
  const count = await tx.onlinePayment.count({ where: filtered });
  const payments = await tx.onlinePayment.findMany({
    where: filtered,
    include: {
      customer: {
        select: { id: true, legalName: true, identificationType: true, identificationNumber: true, email: true },
      },
      invoice: { select: { id: true, prefix: true, number: true, total: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    skip: rows.skip,
    take: rows.take,
  });
  const documents = await tx.onlinePayment.aggregate({
    where: { AND: [base, { status: { not: "CANCELLED" } }] },
    _sum: { amount: true },
  });
  const received = await tx.onlinePayment.aggregate({
    where: { AND: [base, { status: "APPROVED" }] },
    _sum: { net: true },
  });
  const toDisburse = await tx.onlinePayment.aggregate({
    where: { AND: [base, { status: "APPROVED", disbursementStatus: "PENDING" }] },
    _sum: { net: true },
  });
  const rejected = await tx.onlinePayment.count({ where: { AND: [base, { status: "REJECTED" }] } });
  const provider = getPaymentProvider();
  return {
    period: { from: dateOnly(period.from), to: dateOnly(period.to) },
    count,
    provider: provider ? { name: provider.name, mode: provider.mode } : null,
    rows: payments.map(payment => ({
      id: payment.id,
      number: paymentNumber(payment.number),
      createdAt: payment.createdAt.toISOString(),
      invoice: {
        id: payment.invoice.id,
        number: invoiceNumber(payment.invoice),
        total: payment.invoice.total.toFixed(2),
      },
      customer: payment.customer,
      amount: payment.amount.toFixed(2),
      fee: payment.fee?.toFixed(2) ?? null,
      net: payment.net?.toFixed(2) ?? null,
      paidAt: payment.paidAt?.toISOString() ?? null,
      status: payment.status,
      method: payment.method,
      rejectionReason: payment.rejectionReason,
      disbursementStatus: payment.disbursementStatus,
      disbursedAt: payment.disbursedAt?.toISOString() ?? null,
      cashReceiptId: payment.cashReceiptId,
      checkoutUrl: payment.status === "PENDING" && provider ? provider.checkoutUrl(payment.token) : null,
    })),
    summary: {
      totalDocuments: (documents._sum.amount ?? ZERO).toFixed(2),
      totalNet: (received._sum.net ?? ZERO).toFixed(2),
      pendingDisbursement: (toDisburse._sum.net ?? ZERO).toFixed(2),
      rejectedCount: rejected,
    },
  };
}

/**
 * Aplica el resultado informado por la pasarela a un pago PENDING (aprobado o rechazado).
 * Se ejecuta dentro de la transacción de la organización del pago.
 */
async function applyResult(
  tx: Tx,
  payment: {
    id: string;
    organizationId: string;
    invoiceId: string;
    customerId: string;
    number: number;
    amount: Prisma.Decimal;
    status: string;
  },
  result: { result: "APPROVED" | "REJECTED"; method: string },
  provider: PaymentProvider
) {
  if (payment.status !== "PENDING") throw httpError(409, "Este link de pago ya no está pendiente.");
  const reject = (reason: string) =>
    tx.onlinePayment.update({
      where: { id: payment.id },
      data: { status: "REJECTED", method: result.method, rejectionReason: reason, paidAt: new Date() },
    });

  let updated;
  if (result.result === "REJECTED") {
    updated = await reject(
      provider.mode === "sandbox" ? "Rechazado por la entidad (simulación de pruebas)." : "Rechazado por la entidad."
    );
  } else {
    // El saldo pudo cambiar desde que se generó el link (otro recibo u otro pago).
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${payment.invoiceId} FOR UPDATE`;
    const [invoice] = await pendingInvoices(tx, { invoiceIds: [payment.invoiceId] });
    const settled = settlement(payment.amount, provider);
    if (!invoice || payment.amount.greaterThan(invoice.balance)) {
      updated = await reject("El saldo de la factura cambió antes del pago; no se aplicó.");
    } else if ("error" in settled) {
      updated = await reject(settled.error);
    } else {
      const reference = paymentNumber(payment.number);
      const receiptNumber = await nextReceiptNumber(tx);
      const receipt = await tx.cashReceipt.create({
        data: {
          organizationId: payment.organizationId,
          customerId: payment.customerId,
          number: receiptNumber,
          date: new Date(
            `${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date())}T00:00:00Z`
          ),
          method: "ONLINE",
          reference,
          notes: `Pago en línea ${reference} (${methodLabels[result.method] ?? result.method})`,
          total: payment.amount,
          applications: { create: [{ invoiceId: payment.invoiceId, amount: payment.amount }] },
        },
      });
      const accounts = await ensureDefaultAccounts(tx, payment.organizationId);
      const lines = [
        {
          accountId: accounts["138095"].id,
          debit: settled.net.toNumber(),
          credit: 0,
          memo: "Pasarela por desembolsar",
        },
        { accountId: accounts["530515"].id, debit: settled.fee.toNumber(), credit: 0, memo: "Comisión de la pasarela" },
        { accountId: accounts["130505"].id, debit: 0, credit: payment.amount.toNumber(), memo: "Abono a cartera" },
      ];
      assertBalanced(lines);
      await tx.journalEntry.create({
        data: {
          organizationId: payment.organizationId,
          reference,
          date: receipt.date,
          description: `Pago en línea ${reference}`,
          status: "POSTED",
          postedAt: new Date(),
          sourceType: "OnlinePayment",
          sourceId: payment.id,
          lines: { create: lines },
        },
      });
      updated = await tx.onlinePayment.update({
        where: { id: payment.id },
        data: {
          status: "APPROVED",
          method: result.method,
          fee: settled.fee,
          net: settled.net,
          paidAt: new Date(),
          disbursementStatus: "PENDING",
          cashReceiptId: receipt.id,
        },
      });
      await tx.notification.create({
        data: {
          organizationId: payment.organizationId,
          kind: "PAYMENT",
          title: "Pago en línea aprobado",
          body: `Se recibió el pago ${reference} y se abonó a la factura.`,
          actionUrl: "/reportes/facturacion?tab=gestion-cobro",
        },
      });
    }
  }
  await tx.auditLog.create({
    data: {
      organizationId: payment.organizationId,
      entity: "OnlinePayment",
      entityId: payment.id,
      action: updated.status === "APPROVED" ? "APPROVED" : "REJECTED",
      after: {
        status: updated.status,
        method: result.method,
        provider: provider.name,
        reason: updated.rejectionReason,
      },
    },
  });
  return updated;
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerPaymentRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowPermission("reports.view") };
  const canExport = { preHandler: allowPermission("reports.export") };
  const canLink = { preHandler: allowPermission("sales.send") };
  const canDisburse = { preHandler: allowPermission("receipts.manage") };
  const audit = (
    tx: Tx,
    request: { ip: string; actor?: { organizationId: string; sub: string } },
    entityId: string,
    action: string,
    after: Prisma.InputJsonValue
  ) =>
    tx.auditLog.create({
      data: {
        organizationId: request.actor!.organizationId,
        userId: request.actor!.sub,
        entity: "OnlinePayment",
        entityId,
        action,
        after,
        ipHash: options.auditIp(request.ip),
      },
    });

  /** GET /v1/reports/billing/online-payments — pestaña Gestión de cobro. Query: onlinePaymentQuerySchema. */
  app.get("/v1/reports/billing/online-payments", canView, async (request, reply) => {
    const parsed = onlinePaymentQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const { page, pageSize } = parsed.data;
    const { rows, count, ...rest } = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadPayments(tx, parsed.data, { skip: (page - 1) * pageSize, take: pageSize })
    );
    return { data: rows, pagination: { page, pageSize, total: count }, ...rest };
  });

  /** GET /v1/reports/billing/online-payments/export — todas las filas filtradas (auditado). */
  app.get("/v1/reports/billing/online-payments/export", canExport, async (request, reply) => {
    const parsed = onlinePaymentQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const report = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await loadPayments(tx, parsed.data, { skip: 0, take: EXPORT_LIMIT + 1 });
      if (result.count <= EXPORT_LIMIT)
        await tx.auditLog.create({
          data: {
            organizationId: request.actor!.organizationId,
            userId: request.actor!.sub,
            entity: "BillingReport",
            entityId: "online-payments",
            action: "EXPORT",
            after: { filters: request.query, rows: result.count } as Prisma.InputJsonValue,
            ipHash: options.auditIp(request.ip),
          },
        });
      return result;
    });
    if (report.count > EXPORT_LIMIT)
      return reply
        .code(413)
        .send({ error: `La consulta supera ${EXPORT_LIMIT} filas. Acota el período o los filtros.` });
    const { rows, count, ...rest } = report;
    return { data: rows, total: count, ...rest };
  });

  /** GET /v1/online-payments/payable-invoices?search= — facturas a crédito con saldo (máx. 50). */
  app.get<{ Querystring: { search?: string } }>("/v1/online-payments/payable-invoices", canLink, async request => {
    const search = request.query.search?.trim().slice(0, 120) || undefined;
    const data = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const invoices = (await pendingInvoices(tx, { search })).slice(0, 50);
      const customers = await tx.party.findMany({
        where: { id: { in: [...new Set(invoices.map(invoice => invoice.customerId))] } },
        select: { id: true, legalName: true, identificationNumber: true, email: true },
      });
      const byId = new Map(customers.map(customer => [customer.id, customer]));
      return invoices.map(invoice => ({
        id: invoice.id,
        number: invoiceNumber(invoice),
        issueDate: dateOnly(invoice.issueDate),
        total: invoice.total.toFixed(2),
        balance: invoice.balance.toFixed(2),
        customer: byId.get(invoice.customerId)!,
      }));
    });
    return { data };
  });

  /** POST /v1/online-payments — genera un link de pago. Body: createPaymentLinkSchema. */
  app.post("/v1/online-payments", canLink, async (request, reply) => {
    const parsed = createPaymentLinkSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: "Datos del link inválidos", details: parsed.error.flatten() });
    const provider = getPaymentProvider();
    if (!provider)
      return reply
        .code(503)
        .send({ error: "No hay pasarela de pagos configurada (PAYMENT_PROVIDER) para este entorno." });
    const actor = request.actor!;
    try {
      const payment = await withOrganizationScope(actor.organizationId, async tx => {
        const [invoice] = await pendingInvoices(tx, { invoiceIds: [parsed.data.invoiceId] });
        if (!invoice) throw httpError(422, "La factura no es a crédito o no tiene saldo pendiente.");
        const amount = parsed.data.amount !== undefined ? new Prisma.Decimal(parsed.data.amount) : invoice.balance;
        if (amount.greaterThan(invoice.balance))
          throw httpError(422, `El valor supera el saldo de la factura (${invoice.balance.toFixed(2)}).`);
        const settled = settlement(amount, provider);
        if ("error" in settled) throw httpError(422, settled.error);
        const last = await tx.onlinePayment.aggregate({ _max: { number: true } });
        const created = await tx.onlinePayment.create({
          data: {
            organizationId: actor.organizationId,
            invoiceId: invoice.id,
            customerId: invoice.customerId,
            number: (last._max.number ?? 0) + 1,
            amount,
            provider: provider.name,
            token: newToken(actor.organizationId),
            createdById: actor.sub,
          },
        });
        await audit(tx, request, created.id, "CREATE_LINK", { amount: amount.toFixed(2), invoiceId: invoice.id });
        return created;
      });
      return reply.code(201).send({
        data: {
          id: payment.id,
          number: paymentNumber(payment.number),
          amount: payment.amount.toFixed(2),
          checkoutUrl: provider.checkoutUrl(payment.token),
          mode: provider.mode,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: "Otro link tomó el mismo consecutivo. Intenta de nuevo." });
      throw error;
    }
  });

  /** POST /v1/online-payments/:id/email — envía el link pendiente al cliente. Body: { to? }. */
  app.post<{ Params: { id: string } }>("/v1/online-payments/:id/email", canLink, async (request, reply) => {
    const parsed = z
      .object({ to: z.string().trim().email("Correo inválido.").optional() })
      .safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(422).send({ error: "Correo inválido.", details: parsed.error.flatten() });
    if (!mailerConfigured())
      return reply
        .code(503)
        .send({ error: "El envío de correos no está configurado (SMTP_HOST en el .env de la API)." });
    const provider = getPaymentProvider();
    if (!provider) return reply.code(503).send({ error: "No hay pasarela de pagos configurada para este entorno." });
    const actor = request.actor!;
    const loaded = await withOrganizationScope(actor.organizationId, async tx => {
      const payment = await tx.onlinePayment.findFirst({
        where: { id: request.params.id, status: "PENDING" },
        include: { customer: true, invoice: { select: { prefix: true, number: true } } },
      });
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: actor.organizationId },
        select: { legalName: true },
      });
      return payment && { payment, company: organization.legalName };
    });
    if (!loaded) return reply.code(404).send({ error: "Link de pago pendiente no encontrado." });
    const { payment, company } = loaded;
    const recipient = parsed.data.to ?? payment.customer.email;
    if (!recipient)
      return reply.code(422).send({ error: "El cliente no tiene correo registrado. Escribe un correo de destino." });
    const url = provider.checkoutUrl(payment.token);
    const amount = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP" }).format(
      payment.amount.toNumber()
    );
    const invoice = invoiceNumber(payment.invoice);
    let failure: string | null = null;
    try {
      await sendMail({
        to: recipient,
        subject: `Link de pago de la factura ${invoice} — ${company}`,
        text: `${company} te envía el link para pagar la factura ${invoice} por ${amount}: ${url}`,
        html: `<div style="font-family:Arial,sans-serif;color:#173b63"><p>${company.replace(/</g, "&lt;")} te envía el link para pagar la factura <b>${invoice}</b> por <b>${amount}</b>.</p><p><a href="${url}" style="background:#0797ed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Pagar ahora</a></p>${provider.mode === "sandbox" ? '<p style="color:#b86a00">Entorno de pruebas: no se cobra dinero real.</p>' : ""}</div>`,
      });
    } catch (error) {
      failure = (error as Error).message.slice(0, 500);
    }
    await withOrganizationScope(actor.organizationId, async tx => {
      await tx.documentEmail.create({
        data: {
          organizationId: actor.organizationId,
          documentType: "OnlinePayment",
          documentId: payment.id,
          recipient,
          status: failure ? "FAILED" : "SENT",
          error: failure,
          sentById: actor.sub,
        },
      });
      await audit(tx, request, payment.id, failure ? "EMAIL_FAILED" : "EMAIL_SENT", { recipient });
    });
    if (failure) return reply.code(502).send({ error: `El servidor de correo rechazó el envío: ${failure}` });
    return reply.code(201).send({ data: { recipient } });
  });

  /** POST /v1/online-payments/:id/cancel — anula un link que aún no se ha pagado. */
  app.post<{ Params: { id: string } }>("/v1/online-payments/:id/cancel", canLink, async (request, reply) => {
    const cancelled = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await tx.onlinePayment.updateMany({
        where: { id: request.params.id, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      if (result.count) await audit(tx, request, request.params.id, "CANCEL", { status: "CANCELLED" });
      return result.count;
    });
    if (!cancelled) return reply.code(404).send({ error: "Link de pago pendiente no encontrado." });
    return { data: { id: request.params.id, status: "CANCELLED" } };
  });

  /** POST /v1/online-payments/:id/disburse — registra que la pasarela desembolsó el neto al banco. */
  app.post<{ Params: { id: string } }>("/v1/online-payments/:id/disburse", canDisburse, async (request, reply) => {
    const actor = request.actor!;
    const disbursed = await withOrganizationScope(actor.organizationId, async tx => {
      const payment = await tx.onlinePayment.findFirst({
        where: { id: request.params.id, status: "APPROVED", disbursementStatus: "PENDING" },
      });
      if (!payment) return null;
      const accounts = await ensureDefaultAccounts(tx, actor.organizationId);
      const net = payment.net!.toNumber();
      const lines = [
        { accountId: accounts["111005"].id, debit: net, credit: 0, memo: "Desembolso de la pasarela" },
        { accountId: accounts["138095"].id, debit: 0, credit: net, memo: "Pasarela por desembolsar" },
      ];
      assertBalanced(lines);
      await tx.journalEntry.create({
        data: {
          organizationId: actor.organizationId,
          reference: `${paymentNumber(payment.number)}-D`,
          date: new Date(
            `${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date())}T00:00:00Z`
          ),
          description: `Desembolso del pago en línea ${paymentNumber(payment.number)}`,
          status: "POSTED",
          postedAt: new Date(),
          sourceType: "OnlinePayment",
          sourceId: payment.id,
          lines: { create: lines },
        },
      });
      const updated = await tx.onlinePayment.update({
        where: { id: payment.id },
        data: { disbursementStatus: "DISBURSED", disbursedAt: new Date() },
      });
      await audit(tx, request, payment.id, "DISBURSE", { net: payment.net!.toFixed(2) });
      return updated;
    });
    if (!disbursed) return reply.code(404).send({ error: "Pago aprobado con desembolso pendiente no encontrado." });
    return { data: { id: disbursed.id, disbursementStatus: disbursed.disbursementStatus } };
  });

  // ─── Página pública de pago ───

  /** GET /v1/public/payments/:token — datos mínimos del link para la página /pago (sin sesión). */
  app.get<{ Params: { token: string } }>("/v1/public/payments/:token", async (request, reply) => {
    const parsed = parseToken(request.params.token);
    if (!parsed) return reply.code(404).send({ error: "Link de pago no válido." });
    const provider = getPaymentProvider();
    const data = await withOrganizationScope(parsed.organizationId, async tx => {
      const payment = await tx.onlinePayment.findUnique({
        where: { token: request.params.token },
        include: {
          organization: { select: { legalName: true } },
          customer: { select: { legalName: true } },
          invoice: { select: { prefix: true, number: true } },
        },
      });
      if (!payment) return null;
      return {
        company: payment.organization.legalName,
        customer: payment.customer.legalName,
        invoice: invoiceNumber(payment.invoice),
        reference: paymentNumber(payment.number),
        amount: payment.amount.toFixed(2),
        status: payment.status,
        mode: provider?.mode ?? null,
      };
    });
    if (!data) return reply.code(404).send({ error: "Link de pago no válido." });
    return { data };
  });

  /**
   * POST /v1/public/payments/:token/sandbox — SOLO pasarela de pruebas: simula la respuesta de la entidad.
   * Con un proveedor real esta ruta no aplica: el resultado llega por su webhook firmado.
   */
  app.post<{ Params: { token: string } }>("/v1/public/payments/:token/sandbox", async (request, reply) => {
    const provider = getPaymentProvider();
    if (provider?.mode !== "sandbox") return reply.code(404).send({ error: "Ruta no disponible." });
    const parsedToken = parseToken(request.params.token);
    if (!parsedToken) return reply.code(404).send({ error: "Link de pago no válido." });
    const parsed = sandboxPaymentResultSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Resultado inválido", details: parsed.error.flatten() });
    const updated = await withOrganizationScope(parsedToken.organizationId, async tx => {
      const payment = await tx.onlinePayment.findUnique({ where: { token: request.params.token } });
      if (!payment) return null;
      return applyResult(tx, payment, parsed.data, provider);
    });
    if (!updated) return reply.code(404).send({ error: "Link de pago no válido." });
    return { data: { status: updated.status, rejectionReason: updated.rejectionReason } };
  });
}
