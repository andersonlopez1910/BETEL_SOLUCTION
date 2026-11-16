/**
 * Impresión y envío masivo de comprobantes (pestaña "Envío masivo").
 *
 * Ruta:
 *   GET /v1/reports/billing/mass-send — comprobantes de varios tipos en una sola lista paginada.
 *
 * Tipos: facturas de venta (no borradores), recibos de caja, cotizaciones y remisiones. La impresión y el
 * envío usan las rutas que ya existen de cada documento (el frontend las llama por cada seleccionado):
 *   factura y recibo → POST /v1/documents/email y GET /v1/collections/document
 *   cotización → POST /v1/quotes/:id/email y GET /v1/quotes/:id
 *   remisión → POST /v1/deliveries/:id/email y GET /v1/deliveries/:id
 *
 * DEFINICIONES:
 *   - Envío a la DIAN: estado DIAN de la factura (PENDING se muestra como "No enviado"). Los demás
 *     documentos no se transmiten a la DIAN: "No aplica".
 *   - Envío por email: "Enviado" si hay al menos un envío exitoso registrado en DocumentEmail.
 *   - ¿Se puede enviar?: una factura electrónica solo cuando la DIAN la aprobó (con el proveedor DIAN de
 *     pruebas se permite; ver invoiceEmailBlocked en src/dian.ts); un documento anulado no se envía.
 *   - Paginación: cada tipo aporta como máximo página × tamaño filas ordenadas por fecha y se mezclan.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import { massSendQuerySchema, type MassSendQuery } from "@betel/contracts";
import { allowRoles } from "./auth.js";
import { invoiceNumber, receiptNumber } from "./collections.js";
import { deliveryNumber } from "./deliveries.js";
import { dianIsSandbox, invoiceEmailBlocked } from "./dian.js";
import { quoteNumber } from "./quotes.js";
import { REPORT_VIEW_ROLES, resolvePeriod } from "./reports.js";

type Tx = Prisma.TransactionClient;
type DocumentType = "Invoice" | "CashReceipt" | "Quote" | "Delivery";

const ALL_TYPES: DocumentType[] = ["Invoice", "CashReceipt", "Quote", "Delivery"];
/** Estado DIAN guardado ↔ filtro. */
const DIAN_FILTER: Record<string, string> = {
  NOT_SENT: "PENDING",
  QUEUED: "QUEUED",
  SENT: "SENT",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  ERROR: "ERROR",
};

// ─── Cálculos puros (probados en test/mass-send.test.ts) ─────────────────────

/**
 * Qué tipos consultar y con qué estados DIAN de factura, según los filtros.
 * Sin filtro DIAN: todos. Si el filtro no incluye "No aplica", se excluyen los documentos que no van a la
 * DIAN; si solo pide "No aplica", se excluyen las facturas.
 */
export function plan(query: Pick<MassSendQuery, "types" | "dian">) {
  const types = new Set<DocumentType>(query.types ?? ALL_TYPES);
  let invoiceDian: string[] | undefined;
  if (query.dian) {
    invoiceDian = query.dian.filter(status => status !== "NOT_APPLICABLE").map(status => DIAN_FILTER[status]!);
    if (!query.dian.includes("NOT_APPLICABLE"))
      for (const type of ["CashReceipt", "Quote", "Delivery"] as const) types.delete(type);
    if (!invoiceDian.length) types.delete("Invoice");
  }
  return { types, invoiceDian };
}

/** Estado DIAN visible de una factura. */
export const dianLabel = (status: string) => (status === "PENDING" ? "NOT_SENT" : status);

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

// ─── Consulta ─────────────────────────────────────────────────────────────────

type Row = {
  type: DocumentType;
  id: string;
  number: string;
  transaction: string;
  date: string;
  createdAt: string;
  customer: {
    id: string;
    legalName: string;
    identificationType: string;
    identificationNumber: string;
    email: string | null;
  };
  total: string;
  currency: string;
  status: string;
  dian: string;
  emailBlocked: string | null;
};

const customerSelect = {
  id: true,
  legalName: true,
  identificationType: true,
  identificationNumber: true,
  email: true,
} satisfies Prisma.PartySelect;

async function loadMassSend(tx: Tx, query: MassSendQuery, rows: { skip: number; take: number }) {
  const period = resolvePeriod(query);
  const { types, invoiceDian } = plan(query);
  const range = { gte: period.from, lte: period.to };
  const customer: Prisma.PartyWhereInput | undefined = query.customer
    ? {
        OR: [
          { legalName: { contains: query.customer, mode: "insensitive" } },
          { tradeName: { contains: query.customer, mode: "insensitive" } },
          { identificationNumber: { contains: query.customer, mode: "insensitive" } },
        ],
      }
    : undefined;

  // Ids con correo enviado, por tipo (solo si se filtra por correo).
  const sentIds = async (documentType: DocumentType) =>
    (
      await tx.documentEmail.findMany({
        where: { documentType, status: "SENT" },
        select: { documentId: true },
        distinct: ["documentId"],
      })
    ).map(row => row.documentId);
  const emailWhere = async (type: DocumentType) => {
    if (!query.email) return {};
    const ids = await sentIds(type);
    return query.email === "SENT" ? { id: { in: ids } } : { id: { notIn: ids } };
  };

  const window = rows.skip + rows.take;
  let count = 0;
  const all: Row[] = [];

  if (types.has("Invoice")) {
    const where: Prisma.InvoiceWhereInput = {
      status: { not: "DRAFT" },
      issueDate: range,
      ...(invoiceDian && { dianStatus: { in: invoiceDian as never } }),
      ...(customer && { customer }),
      ...(await emailWhere("Invoice")),
    };
    count += await tx.invoice.count({ where });
    const invoices = await tx.invoice.findMany({
      where,
      include: { customer: { select: customerSelect } },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      take: window,
    });
    all.push(
      ...invoices.map(invoice => ({
        type: "Invoice" as const,
        id: invoice.id,
        number: invoiceNumber(invoice),
        transaction: invoice.paymentTerm === "CASH" ? "Factura de venta (contado)" : "Factura de venta (crédito)",
        date: dateOnly(invoice.issueDate),
        createdAt: invoice.createdAt.toISOString(),
        customer: invoice.customer,
        total: invoice.total.toFixed(2),
        currency: invoice.currency,
        status: invoice.status as string,
        dian: dianLabel(invoice.dianStatus),
        emailBlocked: invoiceEmailBlocked(invoice),
      }))
    );
  }
  if (types.has("CashReceipt")) {
    const where: Prisma.CashReceiptWhereInput = {
      date: range,
      ...(customer && { customer }),
      ...(await emailWhere("CashReceipt")),
    };
    count += await tx.cashReceipt.count({ where });
    const receipts = await tx.cashReceipt.findMany({
      where,
      include: { customer: { select: customerSelect } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: window,
    });
    all.push(
      ...receipts.map(receipt => ({
        type: "CashReceipt" as const,
        id: receipt.id,
        number: receiptNumber(receipt.number),
        transaction: "Recibo de caja",
        date: dateOnly(receipt.date),
        createdAt: receipt.createdAt.toISOString(),
        customer: receipt.customer,
        total: receipt.total.toFixed(2),
        currency: "COP",
        status: receipt.status as string,
        dian: "NOT_APPLICABLE",
        emailBlocked: null,
      }))
    );
  }
  if (types.has("Quote")) {
    const where: Prisma.QuoteWhereInput = {
      issueDate: range,
      ...(customer && { customer }),
      ...(await emailWhere("Quote")),
    };
    count += await tx.quote.count({ where });
    const quotes = await tx.quote.findMany({
      where,
      include: { customer: { select: customerSelect } },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      take: window,
    });
    all.push(
      ...quotes.map(quote => ({
        type: "Quote" as const,
        id: quote.id,
        number: quoteNumber(quote.number),
        transaction: "Cotización",
        date: dateOnly(quote.issueDate),
        createdAt: quote.createdAt.toISOString(),
        customer: quote.customer,
        total: quote.total.toFixed(2),
        currency: quote.currency,
        status: quote.status as string,
        dian: "NOT_APPLICABLE",
        emailBlocked: quote.status === "VOID" ? "La cotización está anulada." : null,
      }))
    );
  }
  if (types.has("Delivery")) {
    const where: Prisma.DeliveryWhereInput = {
      issueDate: range,
      ...(customer && { customer }),
      ...(await emailWhere("Delivery")),
    };
    count += await tx.delivery.count({ where });
    const deliveries = await tx.delivery.findMany({
      where,
      include: { customer: { select: customerSelect } },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      take: window,
    });
    all.push(
      ...deliveries.map(delivery => ({
        type: "Delivery" as const,
        id: delivery.id,
        number: deliveryNumber(delivery.number),
        transaction: "Remisión",
        date: dateOnly(delivery.issueDate),
        createdAt: delivery.createdAt.toISOString(),
        customer: delivery.customer,
        total: delivery.total.toFixed(2),
        currency: delivery.currency,
        status: delivery.status as string,
        dian: "NOT_APPLICABLE",
        emailBlocked: delivery.status === "VOID" ? "La remisión está anulada." : null,
      }))
    );
  }

  const page = all
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(rows.skip, rows.skip + rows.take);

  // Último envío exitoso de cada documento de la página.
  const emails = await tx.documentEmail.findMany({
    where: { status: "SENT", documentId: { in: page.map(row => row.id) } },
    select: { documentType: true, documentId: true, recipient: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const sent = new Map<string, { recipient: string; sentAt: string }>();
  for (const email of emails) {
    const key = `${email.documentType}:${email.documentId}`;
    if (!sent.has(key)) sent.set(key, { recipient: email.recipient, sentAt: email.createdAt.toISOString() });
  }

  return {
    period: { from: dateOnly(period.from), to: dateOnly(period.to) },
    count,
    dianSandbox: dianIsSandbox(),
    rows: page.map(({ createdAt: _createdAt, ...row }) => ({
      ...row,
      branch: null,
      email: sent.get(`${row.type}:${row.id}`) ?? null,
    })),
  };
}

export function registerMassSendRoutes(app: FastifyInstance) {
  /** GET /v1/reports/billing/mass-send — Query: massSendQuerySchema. */
  app.get("/v1/reports/billing/mass-send", { preHandler: allowRoles(...REPORT_VIEW_ROLES) }, async (request, reply) => {
    const parsed = massSendQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const { page, pageSize } = parsed.data;
    const { rows, count, ...rest } = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadMassSend(tx, parsed.data, { skip: (page - 1) * pageSize, take: pageSize })
    );
    return { data: rows, pagination: { page, pageSize, total: count }, ...rest };
  });
}
