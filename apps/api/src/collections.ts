/**
 * Recaudos: recibos de caja, consulta de recaudos y envío de documentos por correo.
 *
 * Rutas:
 *   GET  /v1/reports/billing/collections ......... pestaña Recaudos: filas paginadas + indicadores
 *   GET  /v1/reports/billing/collections/export .. todas las filas filtradas (máx. EXPORT_LIMIT)
 *   GET  /v1/collections/document ................ "Ver documento" (factura o recibo de caja)
 *   GET  /v1/collections/pending-customers ....... clientes con facturas a crédito por cobrar
 *   GET  /v1/collections/pending-invoices ........ facturas a crédito por cobrar de un cliente
 *   POST /v1/cash-receipts ....................... crear recibo de caja (abona a facturas a crédito)
 *   POST /v1/cash-receipts/:id/void .............. anular recibo de caja
 *   POST /v1/documents/email ..................... enviar factura o recibo por correo
 *
 * DEFINICIONES (también en docs/reporte-facturacion.md):
 *   - Recaudo = dinero recibido. Son recaudos: (a) las facturas de CONTADO vigentes (se pagan al
 *     emitirse) y (b) los recibos de caja ACTIVOS. Los recibos anulados se listan tachados y no suman.
 *   - Las facturas a CRÉDITO no son recaudo: generan cartera. Su saldo = total − valores aplicados
 *     por recibos activos. Un recibo no puede aplicar más que el saldo de cada factura.
 *   - Cartera por cobrar = suma de saldos de las facturas a crédito vigentes (a hoy, sin filtro de fecha).
 *   - Correo "Enviado": el documento tiene al menos un envío exitoso registrado en DocumentEmail.
 *   - Todas las sumas usan Decimal, nunca Number (salvo las líneas del asiento, ya redondeadas a 2 decimales).
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import {
  collectionDocumentQuerySchema,
  collectionReportQuerySchema,
  createCashReceiptSchema,
  sendDocumentEmailSchema,
  voidCashReceiptSchema,
  type CollectionReportQuery,
} from "@betel/contracts";
import { allowRoles, type MembershipRole } from "./auth.js";
import { assertBalanced, ensureDefaultAccounts } from "./accounting.js";
import { mailerConfigured, sendMail } from "./mailer.js";
import { BILLED_STATUSES, EXPORT_LIMIT, REPORT_EXPORT_ROLES, REPORT_VIEW_ROLES, resolvePeriod } from "./reports.js";

/** Registran o anulan dinero recibido (afecta la contabilidad). */
export const RECEIPT_ROLES: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT"];
/** Pueden enviar documentos por correo a los clientes. */
export const EMAIL_ROLES: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT", "SALES"];

const ZERO = new Prisma.Decimal(0);

type Tx = Prisma.TransactionClient;
type DocumentType = "Invoice" | "CashReceipt";

export const methodLabels: Record<string, string> = {
  CASH: "Efectivo",
  BANK_TRANSFER: "Transferencia",
  CARD: "Tarjeta",
  CHECK: "Cheque",
  OTHER: "Otro",
  ONLINE: "Pago en línea",
};

// ─── Cálculos puros (probados en test/collections.test.ts) ───────────────────

/** Número visible de un recibo de caja. */
export const receiptNumber = (number: number) => `RC-${number}`;

/** Número visible de una factura; la emisión actual aún no asigna consecutivo. */
export const invoiceNumber = (invoice: { prefix: string | null; number: string | null }) =>
  invoice.number ? `${invoice.prefix ?? ""}${invoice.number}` : "Sin numerar";

/** Cuenta que recibe el dinero: Caja si es efectivo, Bancos en los demás medios. */
export const methodAccount = (method: string) => (method === "CASH" ? "110505" : "111005");

/**
 * Valida los valores a aplicar contra los saldos pendientes. Devuelve el total del recibo o un error.
 * `balances`: saldo actual de cada factura a crédito del cliente que se puede abonar.
 */
export function applyToBalances(
  applications: { invoiceId: string; amount: number }[],
  balances: Map<string, Prisma.Decimal>
): { total: Prisma.Decimal } | { error: string } {
  let total = ZERO;
  for (const application of applications) {
    const balance = balances.get(application.invoiceId);
    if (!balance) return { error: "Una de las facturas no está pendiente de pago para este cliente." };
    const amount = new Prisma.Decimal(application.amount);
    if (amount.greaterThan(balance))
      return {
        error: `El valor aplicado (${amount.toFixed(2)}) supera el saldo de la factura (${balance.toFixed(2)}).`,
      };
    total = total.plus(amount);
  }
  return { total };
}

/** Mezcla dos listas ya ordenadas por fecha descendente y devuelve la ventana pedida. */
export function mergeByDateDesc<T extends { date: string; createdAt: string }>(
  a: T[],
  b: T[],
  skip: number,
  take: number
) {
  return [...a, ...b]
    .sort((x, y) => y.date.localeCompare(x.date) || y.createdAt.localeCompare(x.createdAt))
    .slice(skip, skip + take);
}

/** Filtro de cliente por nombre, nombre comercial o identificación. */
function customerSearch(search?: string): Prisma.PartyWhereInput | undefined {
  if (!search) return undefined;
  const contains = { contains: search, mode: "insensitive" as const };
  return { OR: [{ legalName: contains }, { tradeName: contains }, { identificationNumber: contains }] };
}

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

// ─── Consultas ────────────────────────────────────────────────────────────────

const customerSelect = {
  id: true,
  legalName: true,
  identificationType: true,
  identificationNumber: true,
  email: true,
} satisfies Prisma.PartySelect;

/** Ids de documentos de un tipo con al menos un correo enviado con éxito. */
async function sentDocumentIds(tx: Tx, documentType: DocumentType, ids?: string[]) {
  const rows = await tx.documentEmail.findMany({
    where: { documentType, status: "SENT", ...(ids && { documentId: { in: ids } }) },
    select: { documentId: true, createdAt: true, recipient: true },
    orderBy: { createdAt: "desc" },
  });
  const latest = new Map<string, { sentAt: string; recipient: string }>();
  for (const row of rows)
    if (!latest.has(row.documentId))
      latest.set(row.documentId, { sentAt: row.createdAt.toISOString(), recipient: row.recipient });
  return latest;
}

function filterBuilders(query: CollectionReportQuery, sent?: { invoices: string[]; receipts: string[] }) {
  const period = resolvePeriod(query);
  const customer = customerSearch(query.search);
  const emailFilter = (ids: string[] | undefined) =>
    !query.email || !ids ? {} : query.email === "SENT" ? { id: { in: ids } } : { id: { notIn: ids } };
  const invoices: Prisma.InvoiceWhereInput = {
    paymentTerm: "CASH",
    status: { in: [...BILLED_STATUSES] },
    issueDate: { gte: period.from, lte: period.to },
    ...(customer && { customer }),
    ...emailFilter(sent?.invoices),
  };
  const receipts: Prisma.CashReceiptWhereInput = {
    date: { gte: period.from, lte: period.to },
    ...(query.method && { method: query.method }),
    ...(customer && { customer }),
    ...emailFilter(sent?.receipts),
  };
  // El medio de pago solo existe en los recibos; con ese filtro no se listan facturas de contado.
  const includeInvoices = query.documentType !== "CashReceipt" && !query.method;
  const includeReceipts = query.documentType !== "Invoice";
  return { period, invoices, receipts, includeInvoices, includeReceipts };
}

/** Cartera por cobrar a hoy: saldo de las facturas a crédito vigentes (filtro opcional por cliente). */
async function receivable(tx: Tx, search?: string) {
  const customer = customerSearch(search);
  const where: Prisma.InvoiceWhereInput = {
    paymentTerm: "CREDIT",
    status: { in: [...BILLED_STATUSES] },
    ...(customer && { customer }),
  };
  const billed = await tx.invoice.aggregate({ where, _sum: { total: true }, _count: { _all: true } });
  const applied = await tx.cashReceiptApplication.aggregate({
    where: { invoice: where, receipt: { status: "ACTIVE" } },
    _sum: { amount: true },
  });
  return (billed._sum.total ?? ZERO).minus(applied._sum.amount ?? ZERO);
}

/** Fila de Recaudos antes de agregar el estado del correo. */
type CollectionRow = {
  type: DocumentType;
  id: string;
  date: string;
  createdAt: string;
  number: string;
  description: string;
  customer: Prisma.PartyGetPayload<{ select: typeof customerSelect }>;
  total: string;
  status: string;
};

async function loadCollections(tx: Tx, query: CollectionReportQuery, rows: { skip: number; take: number }) {
  // Para el filtro de correo se necesitan los ids enviados de cada tipo.
  const sent = query.email
    ? {
        invoices: [...(await sentDocumentIds(tx, "Invoice")).keys()],
        receipts: [...(await sentDocumentIds(tx, "CashReceipt")).keys()],
      }
    : undefined;
  const filters = filterBuilders(query, sent);
  const window = rows.skip + rows.take; // Cada fuente aporta como máximo la ventana completa.

  const invoiceCount = filters.includeInvoices ? await tx.invoice.count({ where: filters.invoices }) : 0;
  const receiptCount = filters.includeReceipts ? await tx.cashReceipt.count({ where: filters.receipts }) : 0;

  const invoices = filters.includeInvoices
    ? await tx.invoice.findMany({
        where: filters.invoices,
        select: {
          id: true,
          prefix: true,
          number: true,
          issueDate: true,
          total: true,
          status: true,
          createdAt: true,
          customer: { select: customerSelect },
        },
        orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
        take: window,
      })
    : [];
  const receipts = filters.includeReceipts
    ? await tx.cashReceipt.findMany({
        where: filters.receipts,
        select: {
          id: true,
          number: true,
          date: true,
          total: true,
          status: true,
          method: true,
          createdAt: true,
          customer: { select: customerSelect },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: window,
      })
    : [];

  const page = mergeByDateDesc<CollectionRow>(
    [
      ...invoices.map(invoice => ({
        type: "Invoice" as const,
        id: invoice.id,
        date: dateOnly(invoice.issueDate),
        createdAt: invoice.createdAt.toISOString(),
        number: invoiceNumber(invoice),
        description: "Factura de venta (contado)",
        customer: invoice.customer,
        total: invoice.total.toFixed(2),
        status: invoice.status as string,
      })),
    ],
    receipts.map(receipt => ({
      type: "CashReceipt" as const,
      id: receipt.id,
      date: dateOnly(receipt.date),
      createdAt: receipt.createdAt.toISOString(),
      number: receiptNumber(receipt.number),
      description: `Recibo de caja · ${methodLabels[receipt.method]}`,
      customer: receipt.customer,
      total: receipt.total.toFixed(2),
      status: receipt.status as string,
    })),
    rows.skip,
    rows.take
  );

  // Estado del correo solo de las filas de la página (una consulta por tipo).
  const sentInvoices = await sentDocumentIds(
    tx,
    "Invoice",
    page.filter(row => row.type === "Invoice").map(row => row.id)
  );
  const sentReceipts = await sentDocumentIds(
    tx,
    "CashReceipt",
    page.filter(row => row.type === "CashReceipt").map(row => row.id)
  );

  const cashInvoices = filters.includeInvoices
    ? await tx.invoice.aggregate({ where: filters.invoices, _sum: { total: true } })
    : { _sum: { total: ZERO } };
  const activeReceipts = filters.includeReceipts
    ? await tx.cashReceipt.aggregate({
        where: { AND: [filters.receipts, { status: "ACTIVE" }] },
        _sum: { total: true },
        _count: { _all: true },
      })
    : { _sum: { total: ZERO }, _count: { _all: 0 } };
  const cashTotal = cashInvoices._sum.total ?? ZERO;
  const receiptTotal = activeReceipts._sum.total ?? ZERO;

  return {
    period: { from: dateOnly(filters.period.from), to: dateOnly(filters.period.to) },
    count: invoiceCount + receiptCount,
    rows: page.map(({ createdAt: _createdAt, ...row }) => ({
      ...row,
      email: (row.type === "Invoice" ? sentInvoices : sentReceipts).get(row.id) ?? null,
    })),
    summary: {
      total: cashTotal.plus(receiptTotal).toFixed(2),
      cashInvoiceCount: invoiceCount,
      cashInvoiceTotal: cashTotal.toFixed(2),
      receiptCount: activeReceipts._count._all,
      receiptTotal: receiptTotal.toFixed(2),
      receivable: (await receivable(tx, query.search)).toFixed(2),
    },
  };
}

/** Facturas a crédito vigentes con saldo pendiente (opcionalmente de un cliente, de unas facturas o de una búsqueda). */
export async function pendingInvoices(
  tx: Tx,
  options: { customerId?: string; invoiceIds?: string[]; search?: string }
) {
  const customer = customerSearch(options.search);
  const invoices = await tx.invoice.findMany({
    where: {
      paymentTerm: "CREDIT",
      status: { in: [...BILLED_STATUSES] },
      ...(options.customerId && { customerId: options.customerId }),
      ...(options.invoiceIds && { id: { in: options.invoiceIds } }),
      ...(customer && { customer }),
    },
    select: {
      id: true,
      prefix: true,
      number: true,
      issueDate: true,
      dueDate: true,
      status: true,
      total: true,
      customerId: true,
      receiptApplications: { where: { receipt: { status: "ACTIVE" } }, select: { amount: true } },
    },
    orderBy: [{ issueDate: "asc" }, { createdAt: "asc" }],
  });
  return invoices
    .map(({ receiptApplications, ...invoice }) => {
      const applied = receiptApplications.reduce((sum, item) => sum.plus(item.amount), ZERO);
      return { ...invoice, applied, balance: invoice.total.minus(applied) };
    })
    .filter(invoice => invoice.balance.greaterThan(0));
}

/** Detalle de un documento para "Ver documento" y para el cuerpo del correo. */
async function loadDocument(tx: Tx, type: DocumentType, id: string) {
  if (type === "CashReceipt") {
    const receipt = await tx.cashReceipt.findFirst({
      where: { id },
      include: {
        customer: { select: customerSelect },
        createdBy: { select: { displayName: true } },
        applications: {
          include: { invoice: { select: { id: true, prefix: true, number: true, issueDate: true, total: true } } },
        },
      },
    });
    if (!receipt) return null;
    return {
      type,
      id: receipt.id,
      number: receiptNumber(receipt.number),
      title: "Recibo de caja",
      date: dateOnly(receipt.date),
      status: receipt.status as string,
      customer: receipt.customer,
      total: receipt.total.toFixed(2),
      method: methodLabels[receipt.method],
      reference: receipt.reference,
      notes: receipt.notes,
      voidReason: receipt.voidReason,
      createdBy: receipt.createdBy?.displayName ?? null,
      lines: receipt.applications.map(application => ({
        description: `Abono a factura ${invoiceNumber(application.invoice)} del ${dateOnly(application.invoice.issueDate).split("-").reverse().join("/")}`,
        quantity: null,
        unitPrice: null,
        taxRate: null,
        total: application.amount.toFixed(2),
      })),
      totals: [{ label: "Total recibido", value: receipt.total.toFixed(2) }],
    };
  }
  const invoice = await tx.invoice.findFirst({
    where: { id, status: { not: "DRAFT" } },
    include: { customer: { select: customerSelect }, lines: true },
  });
  if (!invoice) return null;
  return {
    type,
    id: invoice.id,
    number: invoiceNumber(invoice),
    title: invoice.paymentTerm === "CASH" ? "Factura de venta (contado)" : "Factura de venta (crédito)",
    date: dateOnly(invoice.issueDate),
    status: invoice.status as string,
    customer: invoice.customer,
    total: invoice.total.toFixed(2),
    method: null,
    reference: null,
    notes: invoice.notes,
    voidReason: null,
    createdBy: null,
    lines: invoice.lines.map(line => ({
      description: line.description,
      quantity: line.quantity.toString(),
      unitPrice: line.unitPrice.toFixed(2),
      taxRate: line.taxRate.toString(),
      total: line.lineTotal.toFixed(2),
    })),
    totals: [
      { label: "Subtotal", value: invoice.subtotal.toFixed(2) },
      { label: "Descuentos", value: invoice.discountTotal.toFixed(2) },
      { label: "Impuestos", value: invoice.taxTotal.toFixed(2) },
      { label: "Total", value: invoice.total.toFixed(2) },
    ],
  };
}

type LoadedDocument = NonNullable<Awaited<ReturnType<typeof loadDocument>>>;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const cop = (value: string) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 2 }).format(
    Number(value)
  );

/** Correo del documento: HTML con el detalle y una versión en texto plano. */
/** Datos que necesita el correo de un documento (factura, recibo o cotización). */
export type EmailDocument = Pick<
  LoadedDocument,
  "title" | "number" | "date" | "status" | "customer" | "method" | "reference" | "lines" | "totals"
>;

export function documentEmail(document: EmailDocument, company: string) {
  const subject = `${document.title} ${document.number} — ${company}`;
  const rows = document.lines
    .map(
      line =>
        `<tr><td style="padding:6px;border-bottom:1px solid #e3ebf3">${escapeHtml(line.description)}</td><td style="padding:6px;border-bottom:1px solid #e3ebf3;text-align:right">${cop(line.total)}</td></tr>`
    )
    .join("");
  const totals = document.totals
    .map(
      item =>
        `<tr><td style="padding:4px 6px;text-align:right">${item.label}</td><td style="padding:4px 6px;text-align:right"><b>${cop(item.value)}</b></td></tr>`
    )
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#173b63;max-width:640px">
<h2 style="margin:0 0 4px">${escapeHtml(document.title)} ${escapeHtml(document.number)}</h2>
<p style="margin:0 0 16px;color:#5b6f86">${escapeHtml(company)} · ${document.date}</p>
<p>Cliente: <b>${escapeHtml(document.customer.legalName)}</b> (${escapeHtml(document.customer.identificationType)} ${escapeHtml(document.customer.identificationNumber)})</p>
${document.method ? `<p>Medio de pago: ${escapeHtml(document.method)}${document.reference ? ` · Ref. ${escapeHtml(document.reference)}` : ""}</p>` : ""}
${document.status === "VOID" ? `<p style="color:#c0392b"><b>Documento anulado.</b></p>` : ""}
<table style="width:100%;border-collapse:collapse;margin:12px 0">${rows}</table>
<table style="margin-left:auto">${totals}</table>
<p style="color:#5b6f86;font-size:12px">Enviado desde Betel Solution.</p></div>`;
  const text = [
    `${document.title} ${document.number} — ${company}`,
    `Fecha: ${document.date}`,
    `Cliente: ${document.customer.legalName} (${document.customer.identificationType} ${document.customer.identificationNumber})`,
    ...document.lines.map(line => `- ${line.description}: ${cop(line.total)}`),
    ...document.totals.map(item => `${item.label}: ${cop(item.value)}`),
  ].join("\n");
  return { subject, html, text };
}

/** Siguiente consecutivo de recibo de caja (el índice único evita duplicados si dos se crean a la vez). */
export async function nextReceiptNumber(tx: Tx) {
  const last = await tx.cashReceipt.aggregate({ _max: { number: true } });
  return (last._max.number ?? 0) + 1;
}

/** Error con código HTTP: Fastify responde con ese código y la transacción se revierte. */
function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerCollectionRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowRoles(...REPORT_VIEW_ROLES) };
  const canExport = { preHandler: allowRoles(...REPORT_EXPORT_ROLES) };
  const canReceive = { preHandler: allowRoles(...RECEIPT_ROLES) };
  const canEmail = { preHandler: allowRoles(...EMAIL_ROLES) };
  const invalid = (reply: FastifyReply, error: string, details: unknown) => reply.code(422).send({ error, details });

  /** GET /v1/reports/billing/collections — Recaudos. Query: collectionReportQuerySchema. */
  app.get("/v1/reports/billing/collections", canView, async (request, reply) => {
    const parsed = collectionReportQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalid(reply, "Filtros del reporte inválidos", parsed.error.flatten());
    const { page, pageSize } = parsed.data;
    const { rows, count, ...rest } = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadCollections(tx, parsed.data, { skip: (page - 1) * pageSize, take: pageSize })
    );
    return { data: rows, pagination: { page, pageSize, total: count }, ...rest };
  });

  /** GET /v1/reports/billing/collections/export — Todas las filas filtradas + indicadores (auditado). */
  app.get("/v1/reports/billing/collections/export", canExport, async (request, reply) => {
    const parsed = collectionReportQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalid(reply, "Filtros del reporte inválidos", parsed.error.flatten());
    const actor = request.actor!;
    const report = await withOrganizationScope(actor.organizationId, async tx => {
      const result = await loadCollections(tx, parsed.data, { skip: 0, take: EXPORT_LIMIT + 1 });
      if (result.count <= EXPORT_LIMIT)
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.sub,
            entity: "BillingReport",
            entityId: "collections",
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
        .send({ error: `La consulta supera ${EXPORT_LIMIT} filas. Acota el período o los filtros para exportar.` });
    const { rows, count, ...rest } = report;
    return { data: rows, total: count, ...rest };
  });

  /** GET /v1/collections/document?type=&id= — Detalle de una factura (no borrador) o recibo de caja. */
  app.get("/v1/collections/document", canView, async (request, reply) => {
    const parsed = collectionDocumentQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalid(reply, "Documento inválido", parsed.error.flatten());
    const actor = request.actor!;
    const document = await withOrganizationScope(actor.organizationId, async tx => {
      const loaded = await loadDocument(tx, parsed.data.type, parsed.data.id);
      if (!loaded) return null;
      const emails = await tx.documentEmail.findMany({
        where: { documentType: parsed.data.type, documentId: parsed.data.id },
        select: {
          recipient: true,
          status: true,
          error: true,
          createdAt: true,
          sentBy: { select: { displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      return { ...loaded, emails };
    });
    if (!document) return reply.code(404).send({ error: "Documento no encontrado." });
    return { data: document };
  });

  /** GET /v1/collections/pending-customers — Clientes con facturas a crédito por cobrar y su saldo total. */
  app.get("/v1/collections/pending-customers", canReceive, async request => {
    const actor = request.actor!;
    const data = await withOrganizationScope(actor.organizationId, async tx => {
      const invoices = await pendingInvoices(tx, {});
      const byCustomer = new Map<string, { balance: Prisma.Decimal; invoiceCount: number }>();
      for (const invoice of invoices) {
        const current = byCustomer.get(invoice.customerId) ?? { balance: ZERO, invoiceCount: 0 };
        byCustomer.set(invoice.customerId, {
          balance: current.balance.plus(invoice.balance),
          invoiceCount: current.invoiceCount + 1,
        });
      }
      const customers = await tx.party.findMany({
        where: { id: { in: [...byCustomer.keys()] } },
        select: customerSelect,
        orderBy: { legalName: "asc" },
      });
      return customers.map(customer => ({
        ...customer,
        invoiceCount: byCustomer.get(customer.id)!.invoiceCount,
        balance: byCustomer.get(customer.id)!.balance.toFixed(2),
      }));
    });
    return { data };
  });

  /** GET /v1/collections/pending-invoices?customerId= — Facturas a crédito con saldo de un cliente. */
  app.get<{ Querystring: { customerId?: string } }>(
    "/v1/collections/pending-invoices",
    canReceive,
    async (request, reply) => {
      const customerId = request.query.customerId ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(customerId)) return reply.code(422).send({ error: "Cliente inválido." });
      const invoices = await withOrganizationScope(request.actor!.organizationId, tx =>
        pendingInvoices(tx, { customerId })
      );
      return {
        data: invoices.map(invoice => ({
          id: invoice.id,
          number: invoiceNumber(invoice),
          issueDate: dateOnly(invoice.issueDate),
          dueDate: invoice.dueDate ? dateOnly(invoice.dueDate) : null,
          status: invoice.status,
          total: invoice.total.toFixed(2),
          applied: invoice.applied.toFixed(2),
          balance: invoice.balance.toFixed(2),
        })),
      };
    }
  );

  /**
   * POST /v1/cash-receipts — Crea un recibo de caja. Body: createCashReceiptSchema.
   *
   * En una transacción: bloquea las facturas (FOR UPDATE) para que dos recibos simultáneos no abonen
   * más que el saldo, valida los valores, asigna el consecutivo y genera el asiento:
   *   Débito  110505 Caja (efectivo) o 111005 Bancos (otros medios) .... total
   *   Crédito 130505 Clientes ............................................ total
   */
  app.post("/v1/cash-receipts", canReceive, async (request, reply) => {
    const parsed = createCashReceiptSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, "Recibo de caja inválido", parsed.error.flatten());
    const actor = request.actor!;
    const body = parsed.data;
    const invoiceIds = body.applications.map(item => item.invoiceId);
    try {
      const receipt = await withOrganizationScope(actor.organizationId, async tx => {
        const customer = await tx.party.findFirst({
          where: { id: body.customerId, isCustomer: true },
          select: { id: true, legalName: true },
        });
        if (!customer) throw httpError(404, "Cliente no encontrado en esta organización.");
        await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ANY(${invoiceIds}::text[]) FOR UPDATE`;
        const pending = await pendingInvoices(tx, { customerId: customer.id, invoiceIds });
        const result = applyToBalances(
          body.applications,
          new Map(pending.map(invoice => [invoice.id, invoice.balance]))
        );
        if ("error" in result) throw httpError(422, result.error);

        const number = await nextReceiptNumber(tx);
        const created = await tx.cashReceipt.create({
          data: {
            organizationId: actor.organizationId,
            customerId: customer.id,
            number,
            date: body.date,
            method: body.method,
            reference: body.reference,
            notes: body.notes || undefined,
            total: result.total,
            createdById: actor.sub,
            applications: {
              create: body.applications.map(item => ({ invoiceId: item.invoiceId, amount: item.amount })),
            },
          },
        });
        const accounts = await ensureDefaultAccounts(tx, actor.organizationId);
        const amount = result.total.toNumber();
        const journalLines = [
          {
            accountId: accounts[methodAccount(body.method)].id,
            debit: amount,
            credit: 0,
            memo: `Recaudo ${methodLabels[body.method]}`,
          },
          { accountId: accounts["130505"].id, debit: 0, credit: amount, memo: "Abono a cartera" },
        ];
        assertBalanced(journalLines);
        await tx.journalEntry.create({
          data: {
            organizationId: actor.organizationId,
            reference: receiptNumber(number),
            date: body.date,
            description: `Recibo de caja de ${customer.legalName}`,
            status: "POSTED",
            postedAt: new Date(),
            sourceType: "CashReceipt",
            sourceId: created.id,
            lines: { create: journalLines },
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.sub,
            entity: "CashReceipt",
            entityId: created.id,
            action: "CREATE",
            after: { number, total: result.total.toFixed(2), applications: body.applications } as Prisma.InputJsonValue,
            ipHash: options.auditIp(request.ip),
          },
        });
        return created;
      });
      return reply.code(201).send({ data: { ...receipt, displayNumber: receiptNumber(receipt.number) } });
    } catch (error) {
      // Dos recibos creados al mismo tiempo pueden tomar el mismo consecutivo: el segundo debe reintentar.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: "Otro recibo tomó el mismo consecutivo. Intenta de nuevo." });
      throw error;
    }
  });

  /**
   * POST /v1/cash-receipts/:id/void — Anula un recibo activo. Body: { reason }.
   * El saldo vuelve a las facturas (las aplicaciones de un recibo anulado no cuentan) y se registra
   * el asiento inverso con referencia RC-<n>-A.
   */
  app.post<{ Params: { id: string } }>("/v1/cash-receipts/:id/void", canReceive, async (request, reply) => {
    const parsed = voidCashReceiptSchema.safeParse(request.body);
    if (!parsed.success)
      return invalid(reply, "Indica el motivo de la anulación (mínimo 3 caracteres).", parsed.error.flatten());
    const actor = request.actor!;
    const voided = await withOrganizationScope(actor.organizationId, async tx => {
      const receipt = await tx.cashReceipt.findFirst({
        where: { id: request.params.id, status: "ACTIVE" },
        include: { customer: { select: { legalName: true } }, onlinePayment: { select: { id: true } } },
      });
      if (!receipt) return null;
      // Un pago en línea ya fue cobrado por la pasarela: se reversa con un reembolso, no anulando el recibo.
      if (receipt.onlinePayment)
        throw httpError(422, "Este recibo corresponde a un pago en línea; no se puede anular desde Recaudos.");
      const accounts = await ensureDefaultAccounts(tx, actor.organizationId);
      const amount = receipt.total.toNumber();
      const journalLines = [
        { accountId: accounts["130505"].id, debit: amount, credit: 0, memo: "Reversión de abono a cartera" },
        {
          accountId: accounts[methodAccount(receipt.method)].id,
          debit: 0,
          credit: amount,
          memo: "Reversión de recaudo",
        },
      ];
      assertBalanced(journalLines);
      await tx.journalEntry.create({
        data: {
          organizationId: actor.organizationId,
          reference: `${receiptNumber(receipt.number)}-A`,
          date: receipt.date,
          description: `Anulación del recibo de caja ${receiptNumber(receipt.number)} de ${receipt.customer.legalName}`,
          status: "POSTED",
          postedAt: new Date(),
          sourceType: "CashReceipt",
          sourceId: receipt.id,
          lines: { create: journalLines },
        },
      });
      const updated = await tx.cashReceipt.update({
        where: { id: receipt.id },
        data: { status: "VOID", voidReason: parsed.data.reason, voidedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.sub,
          entity: "CashReceipt",
          entityId: receipt.id,
          action: "VOID",
          before: { status: "ACTIVE" },
          after: { status: "VOID", reason: parsed.data.reason },
          ipHash: options.auditIp(request.ip),
        },
      });
      return updated;
    });
    if (!voided) return reply.code(404).send({ error: "Recibo de caja activo no encontrado." });
    return { data: voided };
  });

  /**
   * POST /v1/documents/email — Envía una factura (no borrador) o un recibo de caja por correo.
   * Body: sendDocumentEmailSchema. Sin `to` se usa el correo del cliente. Cada intento queda en
   * DocumentEmail (SENT o FAILED) y en AuditLog. Sin SMTP configurado responde 503.
   */
  app.post("/v1/documents/email", canEmail, async (request, reply) => {
    const parsed = sendDocumentEmailSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, "Datos de envío inválidos", parsed.error.flatten());
    if (!mailerConfigured())
      return reply.code(503).send({
        error:
          "El envío de correos no está configurado. Define SMTP_HOST (y SMTP_USER/SMTP_PASS si aplica) en el .env de la API.",
      });
    const actor = request.actor!;
    const { documentType, documentId } = parsed.data;
    const loaded = await withOrganizationScope(actor.organizationId, async tx => {
      const document = await loadDocument(tx, documentType, documentId);
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: actor.organizationId },
        select: { legalName: true },
      });
      return document && { document, company: organization.legalName };
    });
    if (!loaded) return reply.code(404).send({ error: "Documento no encontrado." });
    const recipient = parsed.data.to ?? loaded.document.customer.email;
    if (!recipient)
      return reply.code(422).send({ error: "El cliente no tiene correo registrado. Escribe un correo de destino." });

    let failure: string | null = null;
    try {
      await sendMail({ to: recipient, ...documentEmail(loaded.document, loaded.company) });
    } catch (error) {
      failure = (error as Error).message.slice(0, 500);
    }
    const record = await withOrganizationScope(actor.organizationId, async tx => {
      const created = await tx.documentEmail.create({
        data: {
          organizationId: actor.organizationId,
          documentType,
          documentId,
          recipient,
          status: failure ? "FAILED" : "SENT",
          error: failure,
          sentById: actor.sub,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.sub,
          entity: documentType,
          entityId: documentId,
          action: failure ? "EMAIL_FAILED" : "EMAIL_SENT",
          after: { recipient, ...(failure && { error: failure }) },
          ipHash: options.auditIp(request.ip),
        },
      });
      return created;
    });
    if (failure) return reply.code(502).send({ error: `El servidor de correo rechazó el envío: ${failure}` });
    return reply.code(201).send({ data: { id: record.id, recipient, sentAt: record.createdAt } });
  });
}
