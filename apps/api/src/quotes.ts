/**
 * Cotizaciones: propuestas de venta que no son factura ni generan contabilidad.
 *
 * Rutas:
 *   GET  /v1/reports/billing/quotes ......... pestaña Cotizaciones: filas paginadas
 *   GET  /v1/reports/billing/quotes/export .. todas las filas filtradas (máx. EXPORT_LIMIT) para "Descargar"
 *   GET  /v1/quotes/customers ............... clientes para el formulario
 *   GET  /v1/quotes/:id ..................... detalle (Ver cotización) con historial de correos
 *   POST /v1/quotes ......................... crear cotización
 *   POST /v1/quotes/:id/email ............... enviar por correo
 *   POST /v1/quotes/:id/void ................ anular (con motivo)
 *   POST /v1/quotes/:id/invoice ............. convertir en factura en BORRADOR (no la emite)
 *
 * DEFINICIONES:
 *   - Totales: se calculan en el servidor con calculateDocumentTotals, igual que la factura, para que
 *     al convertirla la factura tenga exactamente los mismos valores.
 *   - Estado visible: Abierta (OPEN), Vencida (OPEN con validUntil anterior a hoy), Facturada (INVOICED)
 *     y Anulada (VOID). Solo una cotización abierta o vencida se puede convertir, enviar o anular.
 *   - Usuario: quien la elaboró (createdById).
 *   - Sucursal: Betel aún no maneja sucursales; la columna se muestra vacía.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import {
  convertQuoteSchema,
  createQuoteSchema,
  quoteQuerySchema,
  voidCashReceiptSchema,
  type QuoteQuery,
} from "@betel/contracts";
import { z } from "zod";
import { allowRoles, type MembershipRole } from "./auth.js";
import { calculateDocumentTotals } from "./accounting.js";
import { documentEmail } from "./collections.js";
import { createDraftInvoiceFrom } from "./draft-invoice.js";
import { mailerConfigured, sendMail } from "./mailer.js";
import { EXPORT_LIMIT, REPORT_EXPORT_ROLES, REPORT_VIEW_ROLES, resolvePeriod, todayIn } from "./reports.js";

/** Pueden crear, enviar, anular y convertir cotizaciones (mismos roles que crean facturas). */
export const QUOTE_ROLES: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT", "SALES"];

type Tx = Prisma.TransactionClient;

// ─── Cálculos puros (probados en test/quotes.test.ts) ────────────────────────

/** Número visible de una cotización. */
export const quoteNumber = (number: number) => `COT-${number}`;

/** Estado visible: una cotización abierta cuya validez ya pasó se muestra como vencida. */
export function visibleStatus(quote: { status: string; validUntil: Date | null }, today: Date) {
  if (quote.status === "OPEN" && quote.validUntil && quote.validUntil < today) return "EXPIRED";
  return quote.status;
}

/** Filtro de la lista. El estado EXPIRED se traduce a OPEN con validez anterior a hoy. */
export function quoteWhere(query: QuoteQuery, today: Date): Prisma.QuoteWhereInput {
  const period = resolvePeriod(query);
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  const byStatus: Record<string, Prisma.QuoteWhereInput> = {
    OPEN: { status: "OPEN", OR: [{ validUntil: null }, { validUntil: { gte: today } }] },
    EXPIRED: { status: "OPEN", validUntil: { lt: today } },
    INVOICED: { status: "INVOICED" },
    VOID: { status: "VOID" },
  };
  return {
    issueDate: { gte: period.from, lte: period.to },
    ...(query.userId && { createdById: query.userId }),
    ...(query.customer && {
      customer: {
        OR: [
          { legalName: contains(query.customer) },
          { tradeName: contains(query.customer) },
          { identificationNumber: contains(query.customer) },
        ],
      },
    }),
    ...(query.status && byStatus[query.status]),
  };
}

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const today = () => todayIn("America/Bogota");

// ─── Consultas ────────────────────────────────────────────────────────────────

async function loadQuotes(tx: Tx, query: QuoteQuery, rows: { skip: number; take: number }) {
  const period = resolvePeriod(query);
  const now = today();
  const where = quoteWhere(query, now);
  const count = await tx.quote.count({ where });
  const quotes = await tx.quote.findMany({
    where,
    include: {
      customer: {
        select: { id: true, legalName: true, identificationType: true, identificationNumber: true, email: true },
      },
      createdBy: { select: { displayName: true } },
    },
    orderBy: [{ issueDate: "desc" }, { number: "desc" }],
    skip: rows.skip,
    take: rows.take,
  });
  return {
    period: { from: dateOnly(period.from), to: dateOnly(period.to) },
    count,
    rows: quotes.map(quote => ({
      id: quote.id,
      number: quoteNumber(quote.number),
      issueDate: dateOnly(quote.issueDate),
      validUntil: quote.validUntil ? dateOnly(quote.validUntil) : null,
      customer: quote.customer,
      branch: null,
      total: quote.total.toFixed(2),
      currency: quote.currency,
      status: visibleStatus(quote, now),
      createdBy: quote.createdBy?.displayName ?? null,
      invoiceId: quote.invoiceId,
    })),
  };
}

async function loadQuote(tx: Tx, id: string) {
  const quote = await tx.quote.findFirst({
    where: { id },
    include: {
      customer: {
        select: { id: true, legalName: true, identificationType: true, identificationNumber: true, email: true },
      },
      createdBy: { select: { displayName: true } },
      lines: true,
      invoice: { select: { id: true, status: true } },
    },
  });
  if (!quote) return null;
  const emails = await tx.documentEmail.findMany({
    where: { documentType: "Quote", documentId: id },
    select: { recipient: true, status: true, error: true, createdAt: true, sentBy: { select: { displayName: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return {
    id: quote.id,
    number: quoteNumber(quote.number),
    title: "Cotización",
    date: dateOnly(quote.issueDate),
    validUntil: quote.validUntil ? dateOnly(quote.validUntil) : null,
    status: visibleStatus(quote, today()),
    currency: quote.currency,
    customer: quote.customer,
    notes: quote.notes,
    voidReason: quote.voidReason,
    createdBy: quote.createdBy?.displayName ?? null,
    invoice: quote.invoice,
    method: null,
    reference: null,
    lines: quote.lines.map(line => ({
      productId: line.productId,
      description: line.description,
      quantity: line.quantity.toString(),
      unitPrice: line.unitPrice.toFixed(2),
      discountRate: line.discountRate.toString(),
      taxRate: line.taxRate.toString(),
      total: line.lineTotal.toFixed(2),
    })),
    totals: [
      { label: "Subtotal", value: quote.subtotal.toFixed(2) },
      { label: "Descuentos", value: quote.discountTotal.toFixed(2) },
      { label: "Impuestos", value: quote.taxTotal.toFixed(2) },
      { label: "Total", value: quote.total.toFixed(2) },
    ],
    emails,
  };
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerQuoteRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowRoles(...REPORT_VIEW_ROLES) };
  const canExport = { preHandler: allowRoles(...REPORT_EXPORT_ROLES) };
  const canQuote = { preHandler: allowRoles(...QUOTE_ROLES) };
  const audit = (
    tx: Tx,
    request: { ip: string; actor?: { organizationId: string; sub: string } },
    entity: string,
    entityId: string,
    action: string,
    after: Prisma.InputJsonValue
  ) =>
    tx.auditLog.create({
      data: {
        organizationId: request.actor!.organizationId,
        userId: request.actor!.sub,
        entity,
        entityId,
        action,
        after,
        ipHash: options.auditIp(request.ip),
      },
    });

  /** GET /v1/reports/billing/quotes — pestaña Cotizaciones. Query: quoteQuerySchema. */
  app.get("/v1/reports/billing/quotes", canView, async (request, reply) => {
    const parsed = quoteQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const { page, pageSize } = parsed.data;
    const { rows, count, ...rest } = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadQuotes(tx, parsed.data, { skip: (page - 1) * pageSize, take: pageSize })
    );
    return { data: rows, pagination: { page, pageSize, total: count }, ...rest };
  });

  /** GET /v1/reports/billing/quotes/export — todas las filas filtradas (auditado). */
  app.get("/v1/reports/billing/quotes/export", canExport, async (request, reply) => {
    const parsed = quoteQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const report = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await loadQuotes(tx, parsed.data, { skip: 0, take: EXPORT_LIMIT + 1 });
      if (result.count <= EXPORT_LIMIT)
        await audit(tx, request, "BillingReport", "quotes", "EXPORT", {
          filters: request.query,
          rows: result.count,
        } as Prisma.InputJsonValue);
      return result;
    });
    if (report.count > EXPORT_LIMIT)
      return reply
        .code(413)
        .send({ error: `La consulta supera ${EXPORT_LIMIT} filas. Acota el período o los filtros.` });
    const { rows, count, ...rest } = report;
    return { data: rows, total: count, ...rest };
  });

  /** GET /v1/quotes/customers?search= — clientes para el formulario (máx. 50). */
  app.get<{ Querystring: { search?: string } }>("/v1/quotes/customers", canQuote, async request => {
    const search = request.query.search?.trim().slice(0, 120);
    const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
    const data = await withOrganizationScope(request.actor!.organizationId, tx =>
      tx.party.findMany({
        where: {
          isCustomer: true,
          ...(search && {
            OR: [
              { legalName: contains(search) },
              { tradeName: contains(search) },
              { identificationNumber: contains(search) },
            ],
          }),
        },
        select: { id: true, legalName: true, identificationType: true, identificationNumber: true, email: true },
        orderBy: { legalName: "asc" },
        take: 50,
      })
    );
    return { data };
  });

  /** GET /v1/quotes/:id — detalle de una cotización. */
  app.get<{ Params: { id: string } }>("/v1/quotes/:id", canView, async (request, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id))
      return reply.code(404).send({ error: "Cotización no encontrada." });
    const quote = await withOrganizationScope(request.actor!.organizationId, tx => loadQuote(tx, request.params.id));
    if (!quote) return reply.code(404).send({ error: "Cotización no encontrada." });
    return { data: quote };
  });

  /** POST /v1/quotes — crea una cotización abierta. Body: createQuoteSchema. */
  app.post("/v1/quotes", canQuote, async (request, reply) => {
    const parsed = createQuoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Cotización inválida", details: parsed.error.flatten() });
    const actor = request.actor!;
    try {
      const quote = await withOrganizationScope(actor.organizationId, async tx => {
        const customer = await tx.party.findFirst({
          where: { id: parsed.data.customerId, isCustomer: true },
          select: { id: true },
        });
        if (!customer) throw httpError(404, "Cliente no encontrado en esta organización.");
        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: actor.organizationId },
          select: { currency: true },
        });
        const totals = calculateDocumentTotals(parsed.data.lines);
        const last = await tx.quote.aggregate({ _max: { number: true } });
        const created = await tx.quote.create({
          data: {
            organizationId: actor.organizationId,
            customerId: customer.id,
            number: (last._max.number ?? 0) + 1,
            issueDate: parsed.data.issueDate,
            validUntil: parsed.data.validUntil,
            currency: organization.currency,
            notes: parsed.data.notes || undefined,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            taxTotal: totals.taxTotal,
            total: totals.total,
            createdById: actor.sub,
            lines: {
              create: totals.lines.map(line => ({
                productId: line.productId,
                description: line.description,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                discountRate: line.discountRate ?? 0,
                taxRate: line.taxRate,
                lineTotal: line.total,
              })),
            },
          },
        });
        await audit(tx, request, "Quote", created.id, "CREATE", {
          number: created.number,
          total: created.total.toFixed(2),
        });
        return created;
      });
      return reply
        .code(201)
        .send({ data: { id: quote.id, number: quoteNumber(quote.number), total: quote.total.toFixed(2) } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: "Otra cotización tomó el mismo consecutivo. Intenta de nuevo." });
      throw error;
    }
  });

  /** POST /v1/quotes/:id/email — envía la cotización. Body: { to? } (por defecto el correo del cliente). */
  app.post<{ Params: { id: string } }>("/v1/quotes/:id/email", canQuote, async (request, reply) => {
    const parsed = z
      .object({ to: z.string().trim().email("Correo inválido.").optional() })
      .safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(422).send({ error: "Correo inválido.", details: parsed.error.flatten() });
    if (!mailerConfigured())
      return reply
        .code(503)
        .send({ error: "El envío de correos no está configurado (SMTP_HOST en el .env de la API)." });
    const actor = request.actor!;
    const loaded = await withOrganizationScope(actor.organizationId, async tx => {
      const quote = await loadQuote(tx, request.params.id);
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: actor.organizationId },
        select: { legalName: true },
      });
      return quote && { quote, company: organization.legalName };
    });
    if (!loaded) return reply.code(404).send({ error: "Cotización no encontrada." });
    if (loaded.quote.status === "VOID") return reply.code(422).send({ error: "La cotización está anulada." });
    const recipient = parsed.data.to ?? loaded.quote.customer.email;
    if (!recipient)
      return reply.code(422).send({ error: "El cliente no tiene correo registrado. Escribe un correo de destino." });
    let failure: string | null = null;
    try {
      const email = documentEmail(loaded.quote, loaded.company);
      const validity = loaded.quote.validUntil
        ? `Válida hasta el ${loaded.quote.validUntil.split("-").reverse().join("/")}.`
        : "";
      await sendMail({
        to: recipient,
        subject: email.subject,
        html: validity ? email.html.replace("</div>", `<p>${validity}</p></div>`) : email.html,
        text: validity ? `${email.text}\n${validity}` : email.text,
      });
    } catch (error) {
      failure = (error as Error).message.slice(0, 500);
    }
    await withOrganizationScope(actor.organizationId, async tx => {
      await tx.documentEmail.create({
        data: {
          organizationId: actor.organizationId,
          documentType: "Quote",
          documentId: loaded.quote.id,
          recipient,
          status: failure ? "FAILED" : "SENT",
          error: failure,
          sentById: actor.sub,
        },
      });
      await audit(tx, request, "Quote", loaded.quote.id, failure ? "EMAIL_FAILED" : "EMAIL_SENT", { recipient });
    });
    if (failure) return reply.code(502).send({ error: `El servidor de correo rechazó el envío: ${failure}` });
    return reply.code(201).send({ data: { recipient } });
  });

  /** POST /v1/quotes/:id/void — anula una cotización abierta (o vencida). Body: { reason }. */
  app.post<{ Params: { id: string } }>("/v1/quotes/:id/void", canQuote, async (request, reply) => {
    const parsed = voidCashReceiptSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(422)
        .send({ error: "Indica el motivo de la anulación (mínimo 3 caracteres).", details: parsed.error.flatten() });
    const voided = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await tx.quote.updateMany({
        where: { id: request.params.id, status: "OPEN" },
        data: { status: "VOID", voidReason: parsed.data.reason },
      });
      if (result.count) await audit(tx, request, "Quote", request.params.id, "VOID", { reason: parsed.data.reason });
      return result.count;
    });
    if (!voided) return reply.code(404).send({ error: "Cotización abierta no encontrada." });
    return { data: { id: request.params.id, status: "VOID" } };
  });

  /**
   * POST /v1/quotes/:id/invoice — crea una FACTURA EN BORRADOR con las líneas de la cotización.
   * Body: convertQuoteSchema. La emisión (DIAN y contabilidad) sigue siendo un paso aparte del módulo Ventas.
   * Registra el AuditLog "Invoice CREATE_DRAFT" igual que POST /v1/invoices (responsable en el reporte).
   */
  app.post<{ Params: { id: string } }>("/v1/quotes/:id/invoice", canQuote, async (request, reply) => {
    const parsed = convertQuoteSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: "Datos de la factura inválidos", details: parsed.error.flatten() });
    const actor = request.actor!;
    const invoice = await withOrganizationScope(actor.organizationId, async tx => {
      await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${request.params.id} FOR UPDATE`;
      const quote = await tx.quote.findFirst({
        where: { id: request.params.id, status: "OPEN" },
        include: { lines: true },
      });
      if (!quote) return null;
      const created = await createDraftInvoiceFrom(
        tx,
        quote,
        parsed.data,
        `Generada desde la cotización ${quoteNumber(quote.number)}.`
      );
      await tx.quote.update({ where: { id: quote.id }, data: { status: "INVOICED", invoiceId: created.id } });
      await audit(tx, request, "Invoice", created.id, "CREATE_DRAFT", {
        total: created.total.toString(),
        lines: quote.lines.length,
        fromQuote: quoteNumber(quote.number),
      });
      await audit(tx, request, "Quote", quote.id, "INVOICE", { invoiceId: created.id });
      return created;
    });
    if (!invoice) return reply.code(404).send({ error: "Cotización abierta no encontrada." });
    return reply.code(201).send({
      data: { invoiceId: invoice.id, total: invoice.total.toFixed(2) },
      message: "Factura creada en borrador. La emisión DIAN y la contabilidad se hacen al emitirla.",
    });
  });
}
