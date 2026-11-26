/**
 * Remisiones: constancia de mercancía entregada a un cliente. No son factura ni generan contabilidad.
 *
 * Rutas:
 *   GET  /v1/reports/billing/deliveries ......... pestaña Remisiones: filas paginadas
 *   GET  /v1/reports/billing/deliveries/export .. todas las filas filtradas (máx. EXPORT_LIMIT) para "Descargar"
 *   GET  /v1/deliveries/:id ..................... detalle (Ver remisión) con historial de correos
 *   POST /v1/deliveries ......................... crear remisión
 *   POST /v1/deliveries/:id/email ............... enviar por correo
 *   POST /v1/deliveries/:id/void ................ anular (con motivo)
 *   POST /v1/deliveries/:id/invoice ............. convertir en factura en BORRADOR (no la emite)
 *
 * DEFINICIONES:
 *   - Tipo de transacción: Venta, Consignación o Muestra.
 *   - Totales: calculateDocumentTotals, igual que la factura (la factura convertida queda idéntica).
 *   - Estado envío de correo: "Enviado" si hay al menos un envío exitoso en DocumentEmail.
 *   - Sucursal: Betel aún no maneja sucursales; la columna se muestra vacía.
 *   - Los clientes del formulario salen de GET /v1/quotes/customers (mismos permisos).
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import {
  convertToInvoiceSchema,
  createDeliverySchema,
  deliveryQuerySchema,
  voidCashReceiptSchema,
  type DeliveryQuery,
} from "@betel/contracts";
import { z } from "zod";
import { allowPermission } from "./auth.js";
import { calculateDocumentTotals } from "./accounting.js";
import { documentEmail } from "./collections.js";
import { createDraftInvoiceFrom } from "./draft-invoice.js";
import { mailerConfigured, sendMail } from "./mailer.js";
import { QUOTE_ROLES } from "./quotes.js";
import { EXPORT_LIMIT, REPORT_EXPORT_ROLES, REPORT_VIEW_ROLES, resolvePeriod } from "./reports.js";

type Tx = Prisma.TransactionClient;

export const deliveryTypeLabels: Record<string, string> = {
  SALE: "Venta",
  CONSIGNMENT: "Consignación",
  SAMPLE: "Muestra",
};

// ─── Cálculos puros (probados en test/deliveries.test.ts) ────────────────────

/** Número visible de una remisión. */
export const deliveryNumber = (number: number) => `REM-${number}`;

/** Filtro de la lista. `sentIds`: remisiones con correo enviado (solo si se filtra por correo). */
export function deliveryWhere(query: DeliveryQuery, sentIds?: string[]): Prisma.DeliveryWhereInput {
  const period = resolvePeriod(query);
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  return {
    issueDate: { gte: period.from, lte: period.to },
    ...(query.userId && { createdById: query.userId }),
    ...(query.transactionType && { transactionType: query.transactionType }),
    ...(query.status && { status: query.status }),
    ...(query.customer && {
      customer: {
        OR: [
          { legalName: contains(query.customer) },
          { tradeName: contains(query.customer) },
          { identificationNumber: contains(query.customer) },
        ],
      },
    }),
    ...(query.email && sentIds && (query.email === "SENT" ? { id: { in: sentIds } } : { id: { notIn: sentIds } })),
  };
}

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

// ─── Consultas ────────────────────────────────────────────────────────────────

/** Último envío exitoso por remisión (todas o solo las indicadas). */
async function sentEmails(tx: Tx, ids?: string[]) {
  const rows = await tx.documentEmail.findMany({
    where: { documentType: "Delivery", status: "SENT", ...(ids && { documentId: { in: ids } }) },
    select: { documentId: true, recipient: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const latest = new Map<string, { recipient: string; sentAt: string }>();
  for (const row of rows)
    if (!latest.has(row.documentId))
      latest.set(row.documentId, { recipient: row.recipient, sentAt: row.createdAt.toISOString() });
  return latest;
}

async function loadDeliveries(tx: Tx, query: DeliveryQuery, rows: { skip: number; take: number }) {
  const period = resolvePeriod(query);
  const sentIds = query.email ? [...(await sentEmails(tx)).keys()] : undefined;
  const where = deliveryWhere(query, sentIds);
  const count = await tx.delivery.count({ where });
  const deliveries = await tx.delivery.findMany({
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
  const emails = await sentEmails(
    tx,
    deliveries.map(delivery => delivery.id)
  );
  return {
    period: { from: dateOnly(period.from), to: dateOnly(period.to) },
    count,
    rows: deliveries.map(delivery => ({
      id: delivery.id,
      number: deliveryNumber(delivery.number),
      transactionType: delivery.transactionType,
      issueDate: dateOnly(delivery.issueDate),
      customer: delivery.customer,
      branch: null,
      email: emails.get(delivery.id) ?? null,
      total: delivery.total.toFixed(2),
      currency: delivery.currency,
      status: delivery.status,
      createdBy: delivery.createdBy?.displayName ?? null,
      invoiceId: delivery.invoiceId,
    })),
  };
}

async function loadDelivery(tx: Tx, id: string) {
  const delivery = await tx.delivery.findFirst({
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
  if (!delivery) return null;
  const emails = await tx.documentEmail.findMany({
    where: { documentType: "Delivery", documentId: id },
    select: { recipient: true, status: true, error: true, createdAt: true, sentBy: { select: { displayName: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return {
    id: delivery.id,
    number: deliveryNumber(delivery.number),
    title: "Remisión",
    transactionType: delivery.transactionType,
    date: dateOnly(delivery.issueDate),
    validUntil: null,
    status: delivery.status as string,
    currency: delivery.currency,
    customer: delivery.customer,
    notes: delivery.notes,
    voidReason: delivery.voidReason,
    createdBy: delivery.createdBy?.displayName ?? null,
    invoice: delivery.invoice,
    method: `Tipo: ${deliveryTypeLabels[delivery.transactionType]}`,
    reference: null,
    lines: delivery.lines.map(line => ({
      productId: line.productId,
      description: line.description,
      quantity: line.quantity.toString(),
      unitPrice: line.unitPrice.toFixed(2),
      discountRate: line.discountRate.toString(),
      taxRate: line.taxRate.toString(),
      total: line.lineTotal.toFixed(2),
    })),
    totals: [
      { label: "Subtotal", value: delivery.subtotal.toFixed(2) },
      { label: "Descuentos", value: delivery.discountTotal.toFixed(2) },
      { label: "Impuestos", value: delivery.taxTotal.toFixed(2) },
      { label: "Total", value: delivery.total.toFixed(2) },
    ],
    emails,
  };
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerDeliveryRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowPermission("reports.view") };
  const canExport = { preHandler: allowPermission("reports.export") };
  const canEdit = { preHandler: allowPermission("sales.documents") };
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

  /** GET /v1/reports/billing/deliveries — pestaña Remisiones. Query: deliveryQuerySchema. */
  app.get("/v1/reports/billing/deliveries", canView, async (request, reply) => {
    const parsed = deliveryQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const { page, pageSize } = parsed.data;
    const { rows, count, ...rest } = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadDeliveries(tx, parsed.data, { skip: (page - 1) * pageSize, take: pageSize })
    );
    return { data: rows, pagination: { page, pageSize, total: count }, ...rest };
  });

  /** GET /v1/reports/billing/deliveries/export — todas las filas filtradas (auditado). */
  app.get("/v1/reports/billing/deliveries/export", canExport, async (request, reply) => {
    const parsed = deliveryQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const report = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await loadDeliveries(tx, parsed.data, { skip: 0, take: EXPORT_LIMIT + 1 });
      if (result.count <= EXPORT_LIMIT)
        await audit(tx, request, "BillingReport", "deliveries", "EXPORT", {
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

  /** GET /v1/deliveries/:id — detalle de una remisión. */
  app.get<{ Params: { id: string } }>("/v1/deliveries/:id", canView, async (request, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(404).send({ error: "Remisión no encontrada." });
    const delivery = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadDelivery(tx, request.params.id)
    );
    if (!delivery) return reply.code(404).send({ error: "Remisión no encontrada." });
    return { data: delivery };
  });

  /** POST /v1/deliveries — crea una remisión abierta. Body: createDeliverySchema. */
  app.post("/v1/deliveries", canEdit, async (request, reply) => {
    const parsed = createDeliverySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Remisión inválida", details: parsed.error.flatten() });
    const actor = request.actor!;
    try {
      const delivery = await withOrganizationScope(actor.organizationId, async tx => {
        const customer = await tx.party.findFirst({
          where: { id: parsed.data.customerId, isCustomer: true, active: true },
          select: { id: true },
        });
        if (!customer) throw httpError(404, "Cliente no encontrado o inactivo en esta organización.");
        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: actor.organizationId },
          select: { currency: true },
        });
        const totals = calculateDocumentTotals(parsed.data.lines);
        const last = await tx.delivery.aggregate({ _max: { number: true } });
        const created = await tx.delivery.create({
          data: {
            organizationId: actor.organizationId,
            customerId: customer.id,
            number: (last._max.number ?? 0) + 1,
            transactionType: parsed.data.transactionType,
            issueDate: parsed.data.issueDate,
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
        await audit(tx, request, "Delivery", created.id, "CREATE", {
          number: created.number,
          total: created.total.toFixed(2),
        });
        return created;
      });
      return reply
        .code(201)
        .send({ data: { id: delivery.id, number: deliveryNumber(delivery.number), total: delivery.total.toFixed(2) } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: "Otra remisión tomó el mismo consecutivo. Intenta de nuevo." });
      throw error;
    }
  });

  /** POST /v1/deliveries/:id/email — envía la remisión. Body: { to? } (por defecto el correo del cliente). */
  app.post<{ Params: { id: string } }>("/v1/deliveries/:id/email", canEdit, async (request, reply) => {
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
      const delivery = await loadDelivery(tx, request.params.id);
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: actor.organizationId },
        select: { legalName: true },
      });
      return delivery && { delivery, company: organization.legalName };
    });
    if (!loaded) return reply.code(404).send({ error: "Remisión no encontrada." });
    if (loaded.delivery.status === "VOID") return reply.code(422).send({ error: "La remisión está anulada." });
    const recipient = parsed.data.to ?? loaded.delivery.customer.email;
    if (!recipient)
      return reply.code(422).send({ error: "El cliente no tiene correo registrado. Escribe un correo de destino." });
    let failure: string | null = null;
    try {
      await sendMail({ to: recipient, ...documentEmail(loaded.delivery, loaded.company) });
    } catch (error) {
      failure = (error as Error).message.slice(0, 500);
    }
    await withOrganizationScope(actor.organizationId, async tx => {
      await tx.documentEmail.create({
        data: {
          organizationId: actor.organizationId,
          documentType: "Delivery",
          documentId: loaded.delivery.id,
          recipient,
          status: failure ? "FAILED" : "SENT",
          error: failure,
          sentById: actor.sub,
        },
      });
      await audit(tx, request, "Delivery", loaded.delivery.id, failure ? "EMAIL_FAILED" : "EMAIL_SENT", { recipient });
    });
    if (failure) return reply.code(502).send({ error: `El servidor de correo rechazó el envío: ${failure}` });
    return reply.code(201).send({ data: { recipient } });
  });

  /** POST /v1/deliveries/:id/void — anula una remisión abierta. Body: { reason }. */
  app.post<{ Params: { id: string } }>("/v1/deliveries/:id/void", canEdit, async (request, reply) => {
    const parsed = voidCashReceiptSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(422)
        .send({ error: "Indica el motivo de la anulación (mínimo 3 caracteres).", details: parsed.error.flatten() });
    const voided = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await tx.delivery.updateMany({
        where: { id: request.params.id, status: "OPEN" },
        data: { status: "VOID", voidReason: parsed.data.reason },
      });
      if (result.count) await audit(tx, request, "Delivery", request.params.id, "VOID", { reason: parsed.data.reason });
      return result.count;
    });
    if (!voided) return reply.code(404).send({ error: "Remisión abierta no encontrada." });
    return { data: { id: request.params.id, status: "VOID" } };
  });

  /** POST /v1/deliveries/:id/invoice — crea una factura en borrador con las líneas de la remisión. */
  app.post<{ Params: { id: string } }>("/v1/deliveries/:id/invoice", canEdit, async (request, reply) => {
    const parsed = convertToInvoiceSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: "Datos de la factura inválidos", details: parsed.error.flatten() });
    const invoice = await withOrganizationScope(request.actor!.organizationId, async tx => {
      await tx.$queryRaw`SELECT id FROM "Delivery" WHERE id = ${request.params.id} FOR UPDATE`;
      const delivery = await tx.delivery.findFirst({
        where: { id: request.params.id, status: "OPEN" },
        include: { lines: true },
      });
      if (!delivery) return null;
      const created = await createDraftInvoiceFrom(
        tx,
        delivery,
        parsed.data,
        `Generada desde la remisión ${deliveryNumber(delivery.number)}.`
      );
      await tx.delivery.update({ where: { id: delivery.id }, data: { status: "INVOICED", invoiceId: created.id } });
      await audit(tx, request, "Invoice", created.id, "CREATE_DRAFT", {
        total: created.total.toString(),
        lines: delivery.lines.length,
        fromDelivery: deliveryNumber(delivery.number),
      });
      await audit(tx, request, "Delivery", delivery.id, "INVOICE", { invoiceId: created.id });
      return created;
    });
    if (!invoice) return reply.code(404).send({ error: "Remisión abierta no encontrada." });
    return reply.code(201).send({
      data: { invoiceId: invoice.id, total: invoice.total.toFixed(2) },
      message: "Factura creada en borrador. La emisión DIAN y la contabilidad se hacen al emitirla.",
    });
  });
}
