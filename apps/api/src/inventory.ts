/**
 * Productos y servicios › Documentos de productos / servicios: saldo inicial y ajustes de inventario.
 *
 * Rutas:
 *   GET  /v1/reports/inventory-documents ............ lista paginada (search, type, status, from, to)
 *   GET  /v1/reports/inventory-documents/export ..... todas las filas filtradas (Descargar)
 *   GET  /v1/inventory-documents/:id ................ detalle con renglones
 *   POST /v1/inventory-documents .................... "Nuevo documento" (se contabiliza al crearse)
 *   POST /v1/inventory-documents/import ............. "Importar" desde filas de Excel o CSV (todo o nada)
 *   POST /v1/inventory-documents/:id/void ........... anular con motivo y asiento inverso
 *
 * DEFINICIONES (también en docs/productos-y-servicios.md):
 *   - Saldo inicial (SI-n): cantidades y costo con que cada producto empieza; solo entradas y una sola vez por
 *     producto (mientras esté vigente). Asiento: Débito 143505 Inventario / Crédito 370505 Utilidades acumuladas.
 *   - Ajuste de inventario (AJ-n): entradas (sobrantes) Débito 143505 / Crédito 429595 Otros ingresos diversos;
 *     salidas (faltantes, mermas) Débito 519595 Gastos / Crédito 143505.
 *   - Solo productos (los servicios no manejan stock). Valor del renglón = cantidad × costo unitario.
 *   - Total del documento = valor de las entradas − valor de las salidas.
 *   - Los documentos vigentes mueven el stock de Gestión de productos (products.ts, stockByProduct).
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import {
  createInventoryDocumentSchema,
  importInventoryDocumentSchema,
  inventoryDocumentQuerySchema,
  voidCashReceiptSchema,
  type CreateInventoryDocumentInput,
  type InventoryDocumentQuery,
} from "@betel/contracts";
import { allowRoles, type MembershipRole } from "./auth.js";
import { assertBalanced, ensureDefaultAccounts } from "./accounting.js";
import { EXPORT_LIMIT, REPORT_EXPORT_ROLES, REPORT_VIEW_ROLES, todayIn } from "./reports.js";

type Tx = Prisma.TransactionClient;
type DocumentType = "INITIAL" | "ADJUSTMENT";
const ZERO = new Prisma.Decimal(0);

/** Afectan el inventario y la contabilidad: administración y contabilidad. */
export const INVENTORY_ROLES: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT"];

export const inventoryTypeLabels: Record<DocumentType, string> = {
  INITIAL: "Saldo inicial",
  ADJUSTMENT: "Ajuste de inventario",
};

// ─── Cálculos puros (probados en test/inventory.test.ts) ─────────────────────

export const inventoryNumber = (type: DocumentType, number: number) => `${type === "INITIAL" ? "SI" : "AJ"}-${number}`;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Valor de entradas y salidas de un documento (cada renglón = cantidad × costo, a 2 decimales). */
export function inventoryValues<T extends { direction: "IN" | "OUT"; quantity: number; unitCost: number }>(lines: T[]) {
  let inflow = 0;
  let outflow = 0;
  const valued = lines.map(line => {
    const total = round2(line.quantity * line.unitCost);
    if (line.direction === "IN") inflow = round2(inflow + total);
    else outflow = round2(outflow + total);
    return { ...line, total };
  });
  return { lines: valued, inflow, outflow, total: round2(inflow - outflow) };
}

/** Asiento del documento (ver DEFINICIONES). Sin valores (costo 0) no hay renglones contables. */
export function inventoryJournalLines(
  type: DocumentType,
  values: { inflow: number; outflow: number },
  accounts: Record<string, { id: string }>
) {
  const lines: { accountId: string; debit: number; credit: number; memo: string }[] = [];
  if (values.inflow > 0) {
    lines.push({ accountId: accounts["143505"]!.id, debit: values.inflow, credit: 0, memo: "Entrada de inventario" });
    lines.push(
      type === "INITIAL"
        ? { accountId: accounts["370505"]!.id, debit: 0, credit: values.inflow, memo: "Saldo inicial de inventario" }
        : { accountId: accounts["429595"]!.id, debit: 0, credit: values.inflow, memo: "Sobrante de inventario" }
    );
  }
  if (values.outflow > 0) {
    lines.push({
      accountId: accounts["519595"]!.id,
      debit: values.outflow,
      credit: 0,
      memo: "Faltante o merma de inventario",
    });
    lines.push({ accountId: accounts["143505"]!.id, debit: 0, credit: values.outflow, memo: "Salida de inventario" });
  }
  return lines;
}

const normalize = (key: string) => key.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const pick = (row: Record<string, unknown>, ...keys: string[]) => {
  for (const key of Object.keys(row))
    if (keys.includes(normalize(key))) {
      const value = row[key];
      return value === null || value === undefined ? "" : String(value).trim();
    }
  return "";
};
/** Número escrito en Colombia (1.234,56) o en inglés (1,234.56). */
export function parseAmount(value: string) {
  const clean = value.replace(/[^\d.,-]/g, "");
  if (!clean) return NaN;
  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  if (lastComma > lastDot) return Number(clean.replace(/\./g, "").replace(",", "."));
  if (lastComma >= 0) return Number(clean.replace(/,/g, ""));
  // Solo puntos: "5.500" (un punto y 3 decimales) se lee como miles.
  const parts = clean.split(".");
  if (parts.length === 2 && parts[1]!.length === 3) return Number(parts.join(""));
  if (parts.length > 2) return Number(parts.join(""));
  return Number(clean);
}

/**
 * Convierte una fila de Excel/CSV en renglón: Código (del producto), Cantidad, Costo unitario y, en ajustes,
 * Movimiento (Entrada/Salida; también acepta cantidades negativas como salida).
 */
export function inventoryLineFromRow(
  row: Record<string, unknown>,
  type: DocumentType,
  products: Map<string, { id: string; kind: string; active: boolean; name: string }>
) {
  const code = pick(row, "codigo", "code", "sku", "referencia");
  if (!code) return { error: "Falta el código del producto." };
  const product = products.get(code.toLowerCase());
  if (!product) return { error: `No existe un producto con el código ${code}.` };
  if (product.kind !== "PRODUCT") return { error: `${product.name} es un servicio: no maneja inventario.` };
  if (!product.active) return { error: `${product.name} está inactivo.` };
  let quantity = parseAmount(pick(row, "cantidad", "quantity", "unidades"));
  if (!Number.isFinite(quantity) || quantity === 0) return { error: "Cantidad inválida o en cero." };
  const unitCost = parseAmount(pick(row, "costo", "costo unitario", "cost", "unitcost", "valor unitario"));
  if (!Number.isFinite(unitCost) || unitCost < 0) return { error: "Costo unitario inválido o vacío." };
  const movement = normalize(pick(row, "movimiento", "tipo", "direction", "entrada/salida"));
  let direction: "IN" | "OUT" = movement.startsWith("s") || movement === "out" ? "OUT" : "IN";
  if (quantity < 0) {
    direction = "OUT";
    quantity = -quantity;
  }
  if (type === "INITIAL" && direction === "OUT") return { error: "El saldo inicial solo tiene entradas." };
  return { line: { productId: product.id, direction, quantity, unitCost: round2(unitCost) } };
}

// ─── Consultas ────────────────────────────────────────────────────────────────

function where(query: InventoryDocumentQuery): Prisma.InventoryDocumentWhereInput {
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  const numberMatch = query.search?.match(/^(SI|AJ)-?(\d+)$/i);
  return {
    ...(query.type && { type: query.type }),
    ...(query.status && { status: query.status }),
    ...((query.from || query.to) && {
      date: {
        ...(query.from && { gte: query.from }),
        ...(query.to && { lte: query.to }),
      },
    }),
    ...(query.search &&
      (numberMatch
        ? { type: numberMatch[1]!.toUpperCase() === "SI" ? "INITIAL" : "ADJUSTMENT", number: Number(numberMatch[2]) }
        : {
            party: {
              OR: [{ legalName: contains(query.search) }, { identificationNumber: { contains: query.search } }],
            },
          })),
  };
}

const rowInclude = {
  party: { select: { id: true, legalName: true, identificationType: true, identificationNumber: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.InventoryDocumentInclude;

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

function present(document: Prisma.InventoryDocumentGetPayload<{ include: typeof rowInclude }>, currency: string) {
  return {
    id: document.id,
    type: document.type,
    typeLabel: inventoryTypeLabels[document.type],
    number: inventoryNumber(document.type, document.number),
    date: dateOnly(document.date),
    party: document.party,
    branch: null,
    total: document.total.toFixed(2),
    currency,
    status: document.status,
    lineCount: document._count.lines,
  };
}

async function loadDocuments(
  tx: Tx,
  organizationId: string,
  query: InventoryDocumentQuery,
  rows: { skip: number; take: number }
) {
  const filter = where(query);
  const [count, documents, organization] = await Promise.all([
    tx.inventoryDocument.count({ where: filter }),
    tx.inventoryDocument.findMany({
      where: filter,
      include: rowInclude,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: rows.skip,
      take: rows.take,
    }),
    tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { currency: true } }),
  ]);
  return { count, rows: documents.map(document => present(document, organization.currency)) };
}

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

/** Crea el documento con su asiento. Valida productos, tercero y que el saldo inicial no se repita. */
async function createDocument(
  tx: Tx,
  actor: { organizationId: string; sub: string },
  body: CreateInventoryDocumentInput
) {
  if (body.date > todayIn("America/Bogota")) throw httpError(422, "La fecha de elaboración no puede ser futura.");
  const products = await tx.product.findMany({
    where: { id: { in: body.lines.map(line => line.productId) } },
    select: { id: true, name: true, kind: true, active: true },
  });
  const byId = new Map(products.map(product => [product.id, product]));
  for (const line of body.lines) {
    const product = byId.get(line.productId);
    if (!product) throw httpError(404, "Uno de los productos no existe en esta organización.");
    if (product.kind !== "PRODUCT") throw httpError(422, `${product.name} es un servicio: no maneja inventario.`);
    if (!product.active) throw httpError(422, `${product.name} está inactivo.`);
  }
  if (body.type === "INITIAL") {
    const repeated = await tx.inventoryLine.findFirst({
      where: { productId: { in: [...byId.keys()] }, document: { type: "INITIAL", status: "ACTIVE" } },
      select: { product: { select: { name: true } }, document: { select: { number: true } } },
    });
    if (repeated)
      throw httpError(
        409,
        `${repeated.product.name} ya tiene saldo inicial (${inventoryNumber("INITIAL", repeated.document.number)}). Usa un ajuste de inventario.`
      );
  }
  if (body.partyId && !(await tx.party.findFirst({ where: { id: body.partyId }, select: { id: true } })))
    throw httpError(404, "El tercero no existe en esta organización.");

  const values = inventoryValues(body.lines);
  const last = await tx.inventoryDocument.aggregate({ where: { type: body.type }, _max: { number: true } });
  const number = (last._max.number ?? 0) + 1;
  const created = await tx.inventoryDocument.create({
    data: {
      organizationId: actor.organizationId,
      type: body.type,
      number,
      date: body.date,
      partyId: body.partyId ?? null,
      notes: body.notes || null,
      total: values.total,
      createdById: actor.sub,
      lines: {
        create: values.lines.map(line => ({
          productId: line.productId,
          direction: line.direction,
          quantity: line.quantity,
          unitCost: line.unitCost,
          total: line.total,
        })),
      },
    },
  });
  const accounts = await ensureDefaultAccounts(tx, actor.organizationId);
  const journal = inventoryJournalLines(body.type, values, accounts);
  if (journal.length) {
    assertBalanced(journal);
    await tx.journalEntry.create({
      data: {
        organizationId: actor.organizationId,
        reference: inventoryNumber(body.type, number),
        date: body.date,
        description: `${inventoryTypeLabels[body.type]} ${inventoryNumber(body.type, number)}`,
        status: "POSTED",
        postedAt: new Date(),
        sourceType: "InventoryDocument",
        sourceId: created.id,
        lines: { create: journal },
      },
    });
  }
  return { ...created, display: inventoryNumber(body.type, number), values };
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerInventoryRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowRoles(...REPORT_VIEW_ROLES) };
  const canExport = { preHandler: allowRoles(...REPORT_EXPORT_ROLES) };
  const canEdit = { preHandler: allowRoles(...INVENTORY_ROLES) };
  const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
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
        entity: "InventoryDocument",
        entityId,
        action,
        after,
        ipHash: options.auditIp(request.ip),
      },
    });
  const conflict = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

  /** GET /v1/reports/inventory-documents — Query: inventoryDocumentQuerySchema. */
  app.get("/v1/reports/inventory-documents", canView, async (request, reply) => {
    const parsed = inventoryDocumentQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const { page, pageSize } = parsed.data;
    const { rows, count } = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadDocuments(tx, request.actor!.organizationId, parsed.data, { skip: (page - 1) * pageSize, take: pageSize })
    );
    return { data: rows, pagination: { page, pageSize, total: count } };
  });

  /** GET /v1/reports/inventory-documents/export — todas las filas filtradas (auditado). */
  app.get("/v1/reports/inventory-documents/export", canExport, async (request, reply) => {
    const parsed = inventoryDocumentQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const report = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await loadDocuments(tx, request.actor!.organizationId, parsed.data, {
        skip: 0,
        take: EXPORT_LIMIT + 1,
      });
      if (result.count <= EXPORT_LIMIT)
        await audit(tx, request, "list", "EXPORT", {
          filters: request.query,
          rows: result.count,
        } as Prisma.InputJsonValue);
      return result;
    });
    if (report.count > EXPORT_LIMIT)
      return reply.code(413).send({ error: `La consulta supera ${EXPORT_LIMIT} filas. Acota los filtros.` });
    return { data: report.rows, total: report.count };
  });

  /** GET /v1/inventory-documents/:id — detalle con renglones. */
  app.get<{ Params: { id: string } }>("/v1/inventory-documents/:id", canView, async (request, reply) => {
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Documento no encontrado." });
    const found = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const document = await tx.inventoryDocument.findFirst({
        where: { id: request.params.id },
        include: {
          ...rowInclude,
          createdBy: { select: { displayName: true, email: true } },
          lines: {
            include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
            orderBy: { product: { name: "asc" } },
          },
        },
      });
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: request.actor!.organizationId },
        select: { currency: true },
      });
      return document && { document, currency: organization.currency };
    });
    if (!found) return reply.code(404).send({ error: "Documento no encontrado." });
    const { document } = found;
    const inflow = document.lines
      .filter(line => line.direction === "IN")
      .reduce((sum, line) => sum.plus(line.total), ZERO);
    const outflow = document.lines
      .filter(line => line.direction === "OUT")
      .reduce((sum, line) => sum.plus(line.total), ZERO);
    return {
      data: {
        ...present(document, found.currency),
        notes: document.notes,
        voidReason: document.voidReason,
        createdBy: document.createdBy?.displayName ?? document.createdBy?.email ?? null,
        lines: document.lines.map(line => ({
          id: line.id,
          product: line.product,
          direction: line.direction,
          quantity: line.quantity.toFixed(2),
          unitCost: line.unitCost.toFixed(2),
          total: line.total.toFixed(2),
        })),
        inflow: inflow.toFixed(2),
        outflow: outflow.toFixed(2),
      },
    };
  });

  /** POST /v1/inventory-documents — Body: createInventoryDocumentSchema. */
  app.post("/v1/inventory-documents", { ...canEdit, bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    const parsed = createInventoryDocumentSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(422)
        .send({ error: parsed.error.issues[0]?.message ?? "Documento inválido", details: parsed.error.flatten() });
    try {
      const created = await withOrganizationScope(request.actor!.organizationId, async tx => {
        const document = await createDocument(tx, request.actor!, parsed.data);
        await audit(tx, request, document.id, "CREATE", {
          number: document.display,
          lines: parsed.data.lines.length,
          total: document.values.total.toFixed(2),
        });
        return document;
      });
      return reply.code(201).send({ data: { id: created.id, number: created.display } });
    } catch (error) {
      if (conflict(error))
        return reply.code(409).send({ error: "Otro documento tomó el mismo consecutivo. Intenta de nuevo." });
      throw error;
    }
  });

  /**
   * POST /v1/inventory-documents/import — Body: importInventoryDocumentSchema. Todo o nada: si alguna fila tiene
   * error se informan todas (con su número de fila) y no se crea el documento.
   */
  app.post("/v1/inventory-documents/import", { ...canEdit, bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
    const parsed = importInventoryDocumentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: parsed.error.issues[0]?.message ?? "Archivo inválido." });
    const body = parsed.data;
    try {
      const result = await withOrganizationScope(request.actor!.organizationId, async tx => {
        const products = await tx.product.findMany({
          where: { sku: { not: null } },
          select: { id: true, sku: true, name: true, kind: true, active: true },
        });
        const bySku = new Map(products.map(product => [product.sku!.toLowerCase(), product]));
        const errors: { row: number; message: string }[] = [];
        const lines: CreateInventoryDocumentInput["lines"] = [];
        const seen = new Set<string>();
        body.rows.forEach((row, index) => {
          const item = inventoryLineFromRow(row, body.type, bySku);
          if ("error" in item) return errors.push({ row: index + 2, message: item.error! });
          if (seen.has(item.line!.productId))
            return errors.push({ row: index + 2, message: "El producto se repite en el archivo." });
          seen.add(item.line!.productId);
          lines.push(item.line!);
        });
        if (errors.length) return { errors: errors.slice(0, 200), errorCount: errors.length };
        const document = await createDocument(tx, request.actor!, {
          type: body.type,
          date: body.date,
          notes: body.notes,
          lines,
        });
        await audit(tx, request, document.id, "IMPORT", { number: document.display, lines: lines.length });
        return { id: document.id, number: document.display, lines: lines.length };
      });
      if ("errors" in result)
        return reply
          .code(422)
          .send({ error: `${result.errorCount} fila(s) con error: no se creó el documento.`, ...result });
      return reply.code(201).send({ data: result });
    } catch (error) {
      if (conflict(error))
        return reply.code(409).send({ error: "Otro documento tomó el mismo consecutivo. Intenta de nuevo." });
      throw error;
    }
  });

  /** POST /v1/inventory-documents/:id/void — Body: { reason }. Asiento inverso con referencia <n>-A. */
  app.post<{ Params: { id: string } }>("/v1/inventory-documents/:id/void", canEdit, async (request, reply) => {
    const parsed = voidCashReceiptSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: "Indica el motivo de la anulación (mínimo 3 caracteres)." });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Documento vigente no encontrado." });
    const voided = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const document = await tx.inventoryDocument.findFirst({
        where: { id: request.params.id, status: "ACTIVE" },
        include: { lines: { select: { direction: true, total: true } } },
      });
      if (!document) return null;
      const values = {
        inflow: document.lines
          .filter(line => line.direction === "IN")
          .reduce((sum, line) => sum + line.total.toNumber(), 0),
        outflow: document.lines
          .filter(line => line.direction === "OUT")
          .reduce((sum, line) => sum + line.total.toNumber(), 0),
      };
      const accounts = await ensureDefaultAccounts(tx, request.actor!.organizationId);
      const reversed = inventoryJournalLines(document.type, values, accounts).map(line => ({
        ...line,
        debit: line.credit,
        credit: line.debit,
        memo: `Anulación: ${line.memo}`,
      }));
      const display = inventoryNumber(document.type, document.number);
      if (reversed.length) {
        assertBalanced(reversed);
        await tx.journalEntry.create({
          data: {
            organizationId: request.actor!.organizationId,
            reference: `${display}-A`,
            date: document.date,
            description: `Anulación de ${inventoryTypeLabels[document.type].toLowerCase()} ${display}`,
            status: "POSTED",
            postedAt: new Date(),
            sourceType: "InventoryDocument",
            sourceId: document.id,
            lines: { create: reversed },
          },
        });
      }
      await tx.inventoryDocument.update({
        where: { id: document.id },
        data: { status: "VOID", voidReason: parsed.data.reason },
      });
      await audit(tx, request, document.id, "VOID", { reason: parsed.data.reason });
      return display;
    });
    if (!voided) return reply.code(404).send({ error: "Documento vigente no encontrado." });
    return { data: { id: request.params.id, number: voided, status: "VOID" } };
  });
}
