/**
 * Compras y gastos: documentos de compra y gasto con factura del proveedor, más los documentos soporte.
 *
 * Rutas:
 *   GET  /v1/reports/purchases/documents ......... "Documentos de compras y gastos": lista paginada
 *   GET  /v1/reports/purchases/documents/export .. todas las filas filtradas (Descargar)
 *   GET  /v1/purchases/suppliers ................. proveedores activos para el formulario (máx. 50)
 *   GET  /v1/purchases/document?kind=&id= ........ detalle de una compra/gasto o de un documento soporte
 *   POST /v1/purchases ........................... registrar compra o gasto (se contabiliza al crearse)
 *   POST /v1/purchases/:id/void .................. anular (con motivo) y reversar el asiento
 * El documento soporte se crea y contabiliza con las rutas existentes POST /v1/support-documents y /issue.
 *
 * DEFINICIONES (también en docs/compras-y-gastos.md):
 *   - Compra: mercancía o activos → Débito 143505 Inventario. Gasto: servicios, arriendos… → Débito 519595.
 *     En ambos: Débito 240810 IVA descontable y Crédito 220505 Proveedores (crédito) o 110505 Caja (contado).
 *   - La factura del proveedor no se repite: proveedor + número de factura es único.
 *   - Envío a la DIAN: las compras y gastos los emite el proveedor, así que "No aplica"; el documento
 *     soporte sí se transmite y muestra su estado DIAN.
 *   - Paginación: cada fuente aporta como máximo página × tamaño filas ordenadas por fecha y se mezclan.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import {
  createPurchaseSchema,
  purchaseQuerySchema,
  voidCashReceiptSchema,
  type CreatePurchaseInput,
  type PurchaseQuery,
} from "@betel/contracts";
import { allowPermission } from "./auth.js";
import { assertBalanced, calculateDocumentTotals, ensureDefaultAccounts } from "./accounting.js";
import { RECEIPT_ROLES } from "./collections.js";
import { EXPORT_LIMIT, REPORT_EXPORT_ROLES, REPORT_VIEW_ROLES, resolvePeriod } from "./reports.js";

type Tx = Prisma.TransactionClient;

export const purchaseTypeLabels: Record<string, string> = {
  PURCHASE: "Compra",
  EXPENSE: "Gasto",
  SUPPORT: "Documento soporte",
};

// ─── Cálculos puros (probados en test/purchases.test.ts) ─────────────────────

export const purchaseNumber = (number: number) => `CG-${number}`;
export const supportNumber = (number: string | null) => (number ? `DS-${number}` : "Sin numerar");

/** Asiento de una compra o gasto (montos ya redondeados a 2 decimales). */
export function purchaseJournalLines(
  document: { type: "PURCHASE" | "EXPENSE"; paymentTerm: "CASH" | "CREDIT"; total: number; taxTotal: number },
  accounts: Record<string, { id: string }>
) {
  const net = Math.round((document.total - document.taxTotal) * 100) / 100;
  return [
    {
      accountId: accounts[document.type === "PURCHASE" ? "143505" : "519595"]!.id,
      debit: net,
      credit: 0,
      memo: document.type === "PURCHASE" ? "Compra de mercancía" : "Gasto",
    },
    ...(document.taxTotal > 0
      ? [{ accountId: accounts["240810"]!.id, debit: document.taxTotal, credit: 0, memo: "IVA descontable" }]
      : []),
    {
      accountId: accounts[document.paymentTerm === "CASH" ? "110505" : "220505"]!.id,
      debit: 0,
      credit: document.total,
      memo: document.paymentTerm === "CASH" ? "Pago de contado" : "Cuenta por pagar al proveedor",
    },
  ];
}

/** Qué fuentes consultar según el tipo de transacción del filtro. */
export function sources(query: Pick<PurchaseQuery, "type" | "supplierInvoice">) {
  const purchaseTypes = query.type === "SUPPORT" ? [] : query.type ? [query.type] : ["PURCHASE", "EXPENSE"];
  // El documento soporte no tiene factura del proveedor: si se busca por ese número, no aplica.
  const support = (!query.type || query.type === "SUPPORT") && !query.supplierInvoice;
  return { purchaseTypes: purchaseTypes as ("PURCHASE" | "EXPENSE")[], support };
}

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

/**
 * Crea una compra o gasto (CG-n) con su asiento contable. La usan POST /v1/purchases y la legalización de
 * soportes importados (purchase-imports.ts). Lanza 404 si el proveedor no existe o está inactivo y 409 si la
 * factura del proveedor ya está registrada.
 */
export async function createPurchaseDocument(
  tx: Tx,
  actor: { organizationId: string; sub: string },
  body: CreatePurchaseInput
) {
  const supplier = await tx.party.findFirst({
    where: { id: body.supplierId, isSupplier: true, active: true },
    select: { id: true, legalName: true },
  });
  if (!supplier) throw httpError(404, "Proveedor no encontrado o inactivo en esta organización.");
  const duplicate = await tx.purchaseDocument.findFirst({
    where: { supplierId: supplier.id, supplierInvoiceNumber: body.supplierInvoiceNumber },
    select: { number: true },
  });
  if (duplicate)
    throw httpError(
      409,
      `La factura ${body.supplierInvoiceNumber} de este proveedor ya está registrada (${purchaseNumber(duplicate.number)}).`
    );
  const totals = calculateDocumentTotals(body.lines);
  const organization = await tx.organization.findUniqueOrThrow({
    where: { id: actor.organizationId },
    select: { currency: true },
  });
  const last = await tx.purchaseDocument.aggregate({ _max: { number: true } });
  const created = await tx.purchaseDocument.create({
    data: {
      organizationId: actor.organizationId,
      supplierId: supplier.id,
      number: (last._max.number ?? 0) + 1,
      type: body.type,
      supplierInvoiceNumber: body.supplierInvoiceNumber,
      issueDate: body.issueDate,
      dueDate: body.paymentMethod === "CREDIT" ? body.dueDate : null,
      paymentTerm: body.paymentMethod,
      currency: organization.currency,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      notes: body.notes || undefined,
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
  const accounts = await ensureDefaultAccounts(tx, actor.organizationId);
  const lines = purchaseJournalLines(
    { type: body.type, paymentTerm: body.paymentMethod, total: totals.total, taxTotal: totals.taxTotal },
    accounts
  );
  assertBalanced(lines);
  await tx.journalEntry.create({
    data: {
      organizationId: actor.organizationId,
      reference: purchaseNumber(created.number),
      date: body.issueDate,
      description: `${purchaseTypeLabels[body.type]} ${body.supplierInvoiceNumber} de ${supplier.legalName}`,
      status: "POSTED",
      postedAt: new Date(),
      sourceType: "PurchaseDocument",
      sourceId: created.id,
      lines: { create: lines },
    },
  });
  return created;
}

// ─── Consultas ────────────────────────────────────────────────────────────────

const supplierSelect = {
  id: true,
  legalName: true,
  identificationType: true,
  identificationNumber: true,
  email: true,
} satisfies Prisma.PartySelect;

async function loadDocuments(tx: Tx, query: PurchaseQuery, rows: { skip: number; take: number }) {
  const period = resolvePeriod(query);
  const { purchaseTypes, support } = sources(query);
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  const supplier: Prisma.PartyWhereInput | undefined = query.supplier
    ? {
        OR: [
          { legalName: contains(query.supplier) },
          { tradeName: contains(query.supplier) },
          { identificationNumber: contains(query.supplier) },
        ],
      }
    : undefined;
  const window = rows.skip + rows.take;
  let count = 0;
  const all: {
    kind: "Purchase" | "Support";
    id: string;
    type: string;
    number: string;
    supplierInvoiceNumber: string | null;
    date: string;
    createdAt: string;
    supplier: Prisma.PartyGetPayload<{ select: typeof supplierSelect }>;
    total: string;
    currency: string;
    status: string;
    dian: string;
  }[] = [];

  if (purchaseTypes.length) {
    const where: Prisma.PurchaseDocumentWhereInput = {
      type: { in: purchaseTypes },
      issueDate: { gte: period.from, lte: period.to },
      ...(supplier && { supplier }),
      ...(query.supplierInvoice && { supplierInvoiceNumber: contains(query.supplierInvoice) }),
    };
    count += await tx.purchaseDocument.count({ where });
    const documents = await tx.purchaseDocument.findMany({
      where,
      include: { supplier: { select: supplierSelect } },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      take: window,
    });
    all.push(
      ...documents.map(document => ({
        kind: "Purchase" as const,
        id: document.id,
        type: document.type as string,
        number: purchaseNumber(document.number),
        supplierInvoiceNumber: document.supplierInvoiceNumber,
        date: dateOnly(document.issueDate),
        createdAt: document.createdAt.toISOString(),
        supplier: document.supplier,
        total: document.total.toFixed(2),
        currency: document.currency,
        status: document.status as string,
        dian: "NOT_APPLICABLE",
      }))
    );
  }
  if (support) {
    const where: Prisma.SupportDocumentWhereInput = {
      issueDate: { gte: period.from, lte: period.to },
      ...(supplier && { supplier }),
    };
    count += await tx.supportDocument.count({ where });
    const documents = await tx.supportDocument.findMany({
      where,
      include: { supplier: { select: supplierSelect } },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      take: window,
    });
    all.push(
      ...documents.map(document => ({
        kind: "Support" as const,
        id: document.id,
        type: "SUPPORT",
        number: supportNumber(document.number),
        supplierInvoiceNumber: null,
        date: dateOnly(document.issueDate),
        createdAt: document.createdAt.toISOString(),
        supplier: document.supplier,
        total: document.total.toFixed(2),
        currency: "COP",
        status: document.status as string,
        dian: document.status === "DRAFT" ? "DRAFT" : (document.dianStatus as string),
      }))
    );
  }
  const page = all
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(rows.skip, rows.skip + rows.take);
  return {
    period: { from: dateOnly(period.from), to: dateOnly(period.to) },
    count,
    rows: page.map(({ createdAt: _createdAt, ...row }) => ({ ...row, branch: null })),
  };
}

async function loadDocument(tx: Tx, kind: string, id: string) {
  if (kind === "Support") {
    const document = await tx.supportDocument.findFirst({
      where: { id },
      include: { supplier: { select: supplierSelect }, lines: true },
    });
    if (!document) return null;
    return {
      kind,
      id: document.id,
      type: "SUPPORT",
      title: "Documento soporte",
      number: supportNumber(document.number),
      supplierInvoiceNumber: null,
      date: dateOnly(document.issueDate),
      dueDate: null,
      paymentTerm: null,
      status: document.status as string,
      dianStatus: document.dianStatus as string,
      supplier: document.supplier,
      notes: null,
      voidReason: null,
      createdBy: null,
      lines: document.lines.map(line => ({
        description: line.description,
        quantity: line.quantity.toString(),
        unitPrice: line.unitPrice.toFixed(2),
        discountRate: "0",
        taxRate: line.taxRate.toString(),
        total: line.lineTotal.toFixed(2),
      })),
      totals: [
        { label: "Subtotal", value: document.subtotal.toFixed(2) },
        { label: "IVA", value: document.taxTotal.toFixed(2) },
        { label: "Total", value: document.total.toFixed(2) },
      ],
    };
  }
  const document = await tx.purchaseDocument.findFirst({
    where: { id },
    include: { supplier: { select: supplierSelect }, lines: true, createdBy: { select: { displayName: true } } },
  });
  if (!document) return null;
  return {
    kind,
    id: document.id,
    type: document.type as string,
    title: purchaseTypeLabels[document.type]!,
    number: purchaseNumber(document.number),
    supplierInvoiceNumber: document.supplierInvoiceNumber,
    date: dateOnly(document.issueDate),
    dueDate: document.dueDate ? dateOnly(document.dueDate) : null,
    paymentTerm: document.paymentTerm as string,
    status: document.status as string,
    dianStatus: null,
    supplier: document.supplier,
    notes: document.notes,
    voidReason: document.voidReason,
    createdBy: document.createdBy?.displayName ?? null,
    lines: document.lines.map(line => ({
      description: line.description,
      quantity: line.quantity.toString(),
      unitPrice: line.unitPrice.toFixed(2),
      discountRate: line.discountRate.toString(),
      taxRate: line.taxRate.toString(),
      total: line.lineTotal.toFixed(2),
    })),
    totals: [
      { label: "Subtotal", value: document.subtotal.toFixed(2) },
      { label: "Descuentos", value: document.discountTotal.toFixed(2) },
      { label: "IVA", value: document.taxTotal.toFixed(2) },
      { label: "Total", value: document.total.toFixed(2) },
    ],
  };
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerPurchaseRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowPermission("reports.view") };
  const canExport = { preHandler: allowPermission("reports.export") };
  const canRegister = { preHandler: allowPermission("purchases.manage") };
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
        entity: "PurchaseDocument",
        entityId,
        action,
        after,
        ipHash: options.auditIp(request.ip),
      },
    });

  /** GET /v1/reports/purchases/documents — Query: purchaseQuerySchema. */
  app.get("/v1/reports/purchases/documents", canView, async (request, reply) => {
    const parsed = purchaseQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const { page, pageSize } = parsed.data;
    const { rows, count, ...rest } = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadDocuments(tx, parsed.data, { skip: (page - 1) * pageSize, take: pageSize })
    );
    return { data: rows, pagination: { page, pageSize, total: count }, ...rest };
  });

  /** GET /v1/reports/purchases/documents/export — todas las filas filtradas (auditado). */
  app.get("/v1/reports/purchases/documents/export", canExport, async (request, reply) => {
    const parsed = purchaseQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const report = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await loadDocuments(tx, parsed.data, { skip: 0, take: EXPORT_LIMIT + 1 });
      if (result.count <= EXPORT_LIMIT)
        await tx.auditLog.create({
          data: {
            organizationId: request.actor!.organizationId,
            userId: request.actor!.sub,
            entity: "PurchasesReport",
            entityId: "documents",
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

  /** GET /v1/purchases/suppliers?search= — proveedores activos (máx. 50). */
  app.get<{ Querystring: { search?: string } }>("/v1/purchases/suppliers", canRegister, async request => {
    const search = request.query.search?.trim().slice(0, 120);
    const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
    const data = await withOrganizationScope(request.actor!.organizationId, tx =>
      tx.party.findMany({
        where: {
          isSupplier: true,
          active: true,
          ...(search && {
            OR: [
              { legalName: contains(search) },
              { tradeName: contains(search) },
              { identificationNumber: contains(search) },
            ],
          }),
        },
        select: supplierSelect,
        orderBy: { legalName: "asc" },
        take: 50,
      })
    );
    return { data };
  });

  /** GET /v1/purchases/document?kind=Purchase|Support&id= — detalle. */
  app.get<{ Querystring: { kind?: string; id?: string } }>(
    "/v1/purchases/document",
    canView,
    async (request, reply) => {
      const { kind = "", id = "" } = request.query;
      if (!["Purchase", "Support"].includes(kind) || !/^[0-9a-f-]{36}$/i.test(id))
        return reply.code(404).send({ error: "Documento no encontrado." });
      const document = await withOrganizationScope(request.actor!.organizationId, tx => loadDocument(tx, kind, id));
      if (!document) return reply.code(404).send({ error: "Documento no encontrado." });
      return { data: document };
    }
  );

  /** POST /v1/purchases — registra y contabiliza una compra o gasto. Body: createPurchaseSchema. */
  app.post("/v1/purchases", canRegister, async (request, reply) => {
    const parsed = createPurchaseSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Documento inválido", details: parsed.error.flatten() });
    const actor = request.actor!;
    const body = parsed.data;
    try {
      const document = await withOrganizationScope(actor.organizationId, async tx => {
        const created = await createPurchaseDocument(tx, actor, body);
        await audit(tx, request, created.id, "CREATE", {
          number: created.number,
          type: body.type,
          total: created.total.toFixed(2),
        });
        return created;
      });
      return reply.code(201).send({ data: { id: document.id, number: purchaseNumber(document.number) } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply
          .code(409)
          .send({ error: "Ese documento ya está registrado o se tomó el mismo consecutivo. Intenta de nuevo." });
      throw error;
    }
  });

  /** POST /v1/purchases/:id/void — anula y registra el asiento inverso (CG-n-A). Body: { reason }. */
  app.post<{ Params: { id: string } }>("/v1/purchases/:id/void", canRegister, async (request, reply) => {
    const parsed = voidCashReceiptSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(422)
        .send({ error: "Indica el motivo de la anulación (mínimo 3 caracteres).", details: parsed.error.flatten() });
    const actor = request.actor!;
    const voided = await withOrganizationScope(actor.organizationId, async tx => {
      const document = await tx.purchaseDocument.findFirst({
        where: { id: request.params.id, status: "ACTIVE" },
        include: { supplier: { select: { legalName: true } } },
      });
      if (!document) return null;
      // Con pagos vigentes (comprobantes de egreso) el saldo quedaría negativo: primero se anulan los pagos.
      const paid = await tx.supplierPaymentApplication.count({
        where: { purchaseDocumentId: document.id, payment: { status: "ACTIVE" } },
      });
      if (paid)
        throw httpError(409, "Este documento tiene pagos registrados. Anula primero los comprobantes de egreso.");
      const accounts = await ensureDefaultAccounts(tx, actor.organizationId);
      const reversed = purchaseJournalLines(
        {
          type: document.type,
          paymentTerm: document.paymentTerm,
          total: document.total.toNumber(),
          taxTotal: document.taxTotal.toNumber(),
        },
        accounts
      ).map(line => ({ ...line, debit: line.credit, credit: line.debit, memo: `Reversión: ${line.memo}` }));
      assertBalanced(reversed);
      await tx.journalEntry.create({
        data: {
          organizationId: actor.organizationId,
          reference: `${purchaseNumber(document.number)}-A`,
          date: document.issueDate,
          description: `Anulación de ${purchaseNumber(document.number)} de ${document.supplier.legalName}`,
          status: "POSTED",
          postedAt: new Date(),
          sourceType: "PurchaseDocument",
          sourceId: document.id,
          lines: { create: reversed },
        },
      });
      const updated = await tx.purchaseDocument.update({
        where: { id: document.id },
        data: { status: "VOID", voidReason: parsed.data.reason },
      });
      await audit(tx, request, document.id, "VOID", { reason: parsed.data.reason });
      return updated;
    });
    if (!voided) return reply.code(404).send({ error: "Documento activo no encontrado." });
    return { data: { id: voided.id, status: voided.status } };
  });
}
