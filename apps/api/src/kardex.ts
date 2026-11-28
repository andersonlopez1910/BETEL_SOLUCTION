/**
 * Costeo automático (kárdex permanente) y kárdex por producto. El cálculo puro está en kardex-engine.ts.
 *
 * Rutas:
 *   GET  /v1/costing/settings ............... modo de costeo (MONTHLY | AUTOMATIC) y fecha desde la que es automático
 *   PUT  /v1/costing/settings ............... cambiar el modo. Body: { mode }
 *   POST /v1/costing/kardex/recalculate ...... "Recalcular kárdex": todos los productos (solo en modo automático)
 *   GET  /v1/products/:id/kardex ............. kárdex valorizado del producto (en cualquier modo, calculado al vuelo)
 *
 * MODO AUTOMÁTICO (docs/costeo-automatico.md):
 *   - Cada compra (CG), saldo inicial (SI), ajuste (AJ), venta (FE/POS) o anulación vuelve a calcular el kárdex de los
 *     productos que mueve, en la misma transacción: no hay que entrar a «Costeo mensual».
 *   - Método por producto: Promedio ponderado (por defecto) o PEPS, según Inventario › Método de valoración.
 *   - Costo de una entrada por compra: precio unitario con descuento, sin IVA (igual que el costeo mensual y que el
 *     asiento de la compra, que lleva el IVA a 240810).
 *   - Cada venta guarda su costo en el renglón (InvoiceLine.unitAccountingCost y costTotal) y contabiliza
 *     Débito 613505 Costo de ventas / Crédito 143505 Inventario (referencia CMV-<documento>-1). Si después llega un
 *     documento con fecha anterior que cambia ese costo, se registra solo la diferencia (CMV-<documento>-2, -3…).
 *   - Solo se contabilizan las ventas desde costingAutomaticFrom (el día 1 del mes en que se activó); los meses
 *     anteriores siguen con «Costeo mensual».
 *   - Sin existencias suficientes no se emite la venta, salvo que el producto permita inventario negativo.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma, withOrganizationScope } from "@betel/db";
import { allowPermission } from "./auth.js";
import { assertBalanced, ensureDefaultAccounts } from "./accounting.js";
import { computeKardex, type KardexEntry, type KardexMethod, type KardexMovement } from "./kardex-engine.js";
import { BILLED_STATUSES, todayIn } from "./reports.js";

type Tx = Prisma.TransactionClient;
export type CostingMode = "MONTHLY" | "AUTOMATIC";

const KIND_RANK: Record<KardexMovement["kind"], number> = {
  INITIAL: 0,
  PURCHASE: 1,
  ADJUST_IN: 2,
  SALE: 3,
  ADJUST_OUT: 4,
};
/** Mismo día: saldo inicial, compras y ajustes de entrada antes que las salidas; luego por hora de registro. */
const orderOf = (kind: KardexMovement["kind"], createdAt: Date) => KIND_RANK[kind] * 1e13 + createdAt.getTime();
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const m2 = (value: number) => Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const methodOf = (value: string | null | undefined): KardexMethod => (value === "FIFO" ? "FIFO" : "WEIGHTED_AVERAGE");
export const methodLabels: Record<KardexMethod, string> = {
  WEIGHTED_AVERAGE: "Promedio ponderado",
  FIFO: "PEPS",
  SPECIFIC_IDENTIFICATION: "Promedio ponderado",
};
const saleDocument = (invoice: { prefix: string | null; number: string | null }) =>
  `${invoice.prefix ?? ""}${invoice.number ?? "sin número"}`;

// ─── Cálculo puro de los ajustes contables (probado en test/kardex.test.ts) ──

/** Diferencia por contabilizar en cada venta: costo según el kárdex − costo ya contabilizado (redondeado a 2). */
export function costAdjustments(costs: Map<string, number>, posted: Map<string, number>) {
  const result: { invoiceId: string; amount: number }[] = [];
  for (const id of new Set([...costs.keys(), ...posted.keys()])) {
    const amount = m2((costs.get(id) ?? 0) - (posted.get(id) ?? 0));
    if (Math.abs(amount) >= 0.01) result.push({ invoiceId: id, amount });
  }
  return result;
}

// ─── Consultas ────────────────────────────────────────────────────────────────

/** Movimientos vigentes de los productos (compras, saldo inicial, ajustes y ventas facturadas). */
export async function loadKardexMovements(tx: Tx, productIds: string[]) {
  const [purchases, inventory, sales] = await Promise.all([
    tx.purchaseLine.findMany({
      where: { productId: { in: productIds }, purchaseDocument: { status: "ACTIVE", type: "PURCHASE" } },
      select: {
        id: true,
        productId: true,
        quantity: true,
        unitPrice: true,
        discountRate: true,
        purchaseDocument: { select: { id: true, number: true, issueDate: true, createdAt: true } },
      },
    }),
    tx.inventoryLine.findMany({
      where: { productId: { in: productIds }, document: { status: "ACTIVE" } },
      select: {
        id: true,
        productId: true,
        direction: true,
        quantity: true,
        unitCost: true,
        document: { select: { id: true, type: true, number: true, date: true, createdAt: true } },
      },
    }),
    tx.invoiceLine.findMany({
      where: { productId: { in: productIds }, invoice: { status: { in: [...BILLED_STATUSES] } } },
      select: {
        id: true,
        productId: true,
        quantity: true,
        costTotal: true,
        unitAccountingCost: true,
        invoice: { select: { id: true, prefix: true, number: true, issueDate: true, createdAt: true } },
      },
    }),
  ]);
  const byProduct = new Map<string, KardexMovement[]>();
  const push = (productId: string, movement: KardexMovement) =>
    byProduct.set(productId, [...(byProduct.get(productId) ?? []), movement]);
  for (const line of purchases) {
    const document = line.purchaseDocument;
    push(line.productId!, {
      date: dateOnly(document.issueDate),
      order: orderOf("PURCHASE", document.createdAt),
      kind: "PURCHASE",
      document: `CG-${document.number}`,
      sourceType: "PurchaseDocument",
      sourceId: document.id,
      sourceLineId: line.id,
      quantity: line.quantity.toNumber(),
      unitCost: line.unitPrice.times(new Prisma.Decimal(1).minus(line.discountRate.dividedBy(100))).toNumber(),
    });
  }
  for (const line of inventory) {
    const document = line.document;
    const kind = document.type === "INITIAL" ? "INITIAL" : line.direction === "IN" ? "ADJUST_IN" : "ADJUST_OUT";
    push(line.productId, {
      date: dateOnly(document.date),
      order: orderOf(kind, document.createdAt),
      kind,
      document: `${document.type === "INITIAL" ? "SI" : "AJ"}-${document.number}`,
      sourceType: "InventoryDocument",
      sourceId: document.id,
      sourceLineId: line.id,
      quantity: line.quantity.toNumber(),
      unitCost: line.unitCost.toNumber(),
    });
  }
  const currentCost = new Map<string, number | null>();
  for (const line of sales) {
    currentCost.set(line.id, line.costTotal ? line.costTotal.toNumber() : null);
    push(line.productId!, {
      date: dateOnly(line.invoice.issueDate),
      order: orderOf("SALE", line.invoice.createdAt),
      kind: "SALE",
      document: saleDocument(line.invoice),
      sourceType: "Invoice",
      sourceId: line.invoice.id,
      sourceLineId: line.id,
      quantity: line.quantity.toNumber(),
    });
  }
  return { byProduct, currentCost };
}

export async function costingSettings(tx: Tx, organizationId: string) {
  const organization = await tx.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { costingMode: true, costingAutomaticFrom: true },
  });
  return {
    mode: (organization.costingMode === "AUTOMATIC" ? "AUTOMATIC" : "MONTHLY") as CostingMode,
    automaticFrom: organization.costingAutomaticFrom,
  };
}

/** Costo de ventas ya contabilizado por venta (neto de las entradas CMV de cada documento). */
async function postedCosts(tx: Tx, accountId: string, invoiceIds?: string[]) {
  const lines = await tx.journalLine.findMany({
    where: {
      accountId,
      journalEntry: { sourceType: "InvoiceCost", ...(invoiceIds ? { sourceId: { in: invoiceIds } } : {}) },
    },
    select: { debit: true, credit: true, journalEntry: { select: { sourceId: true } } },
  });
  const posted = new Map<string, number>();
  for (const line of lines) {
    const id = line.journalEntry.sourceId!;
    posted.set(id, m2((posted.get(id) ?? 0) + line.debit.toNumber() - line.credit.toNumber()));
  }
  return posted;
}

/** Contabiliza la diferencia de costo de cada venta (CMV-<documento>-n), fechada el día de la venta. */
async function postCostAdjustments(
  tx: Tx,
  organizationId: string,
  adjustments: { invoiceId: string; amount: number }[],
  reason?: string
) {
  if (!adjustments.length) return 0;
  const accounts = await ensureDefaultAccounts(tx, organizationId);
  const invoices = await tx.invoice.findMany({
    where: { id: { in: adjustments.map(item => item.invoiceId) } },
    select: { id: true, prefix: true, number: true, issueDate: true },
  });
  const byId = new Map(invoices.map(invoice => [invoice.id, invoice]));
  const counts = await tx.journalEntry.groupBy({
    by: ["sourceId"],
    where: { sourceType: "InvoiceCost", sourceId: { in: [...byId.keys()] } },
    _count: { _all: true },
  });
  const countById = new Map(counts.map(row => [row.sourceId!, row._count._all]));
  for (const { invoiceId, amount } of adjustments) {
    const invoice = byId.get(invoiceId);
    if (!invoice) continue;
    const sequence = (countById.get(invoiceId) ?? 0) + 1;
    const value = Math.abs(amount);
    const cost = accounts["613505"]!.id;
    const stock = accounts["143505"]!.id;
    const lines =
      amount > 0
        ? [
            { accountId: cost, debit: value, credit: 0, memo: "Costo de ventas" },
            { accountId: stock, debit: 0, credit: value, memo: "Salida de inventario vendido" },
          ]
        : [
            { accountId: stock, debit: value, credit: 0, memo: "Menor costo de ventas" },
            { accountId: cost, debit: 0, credit: value, memo: "Menor costo de ventas" },
          ];
    assertBalanced(lines);
    const document = saleDocument(invoice);
    await tx.journalEntry.create({
      data: {
        organizationId,
        reference: `CMV-${document}-${sequence}`,
        date: invoice.issueDate,
        description:
          reason ??
          (sequence === 1 ? `Costo de ventas de ${document}` : `Ajuste del costo de ventas de ${document} (kárdex)`),
        status: "POSTED",
        postedAt: new Date(),
        sourceType: "InvoiceCost",
        sourceId: invoiceId,
        lines: { create: lines },
      },
    });
  }
  return m2(adjustments.reduce((sum, item) => sum + item.amount, 0));
}

export type KardexRun = {
  products: number;
  invoices: number;
  adjustment: number;
  entries: Map<string, KardexEntry[]>;
  info: Map<string, { name: string; allowNegative: boolean }>;
};

/**
 * Recalcula el kárdex de los productos (todos si no se indican): costo vigente del producto, costo de cada renglón
 * vendido y asiento de la diferencia en las ventas desde `automaticFrom`.
 */
export async function recalculateKardex(
  tx: Tx,
  organizationId: string,
  automaticFrom: Date,
  productIds?: string[]
): Promise<KardexRun> {
  const products = await tx.product.findMany({
    where: { kind: "PRODUCT", ...(productIds ? { id: { in: productIds } } : {}) },
    select: {
      id: true,
      name: true,
      averageCost: true,
      inventoryConfig: { select: { valuationMethod: true, allowNegativeStock: true } },
    },
  });
  const info = new Map(
    products.map(product => [
      product.id,
      { name: product.name, allowNegative: product.inventoryConfig?.allowNegativeStock ?? false },
    ])
  );
  const entries = new Map<string, KardexEntry[]>();
  if (!products.length) return { products: 0, invoices: 0, adjustment: 0, entries, info };
  const { byProduct, currentCost } = await loadKardexMovements(
    tx,
    products.map(product => product.id)
  );
  const invoiceCosts = new Map<string, number>();
  const touched = new Set<string>();
  const from = dateOnly(automaticFrom);
  for (const product of products) {
    const rows = computeKardex(byProduct.get(product.id) ?? [], methodOf(product.inventoryConfig?.valuationMethod));
    entries.set(product.id, rows);
    const last = rows.at(-1);
    if (last && !product.averageCost.equals(last.averageCost))
      await tx.product.update({ where: { id: product.id }, data: { averageCost: last.averageCost } });
    for (const row of rows) {
      if (row.kind !== "SALE") continue;
      if (currentCost.get(row.sourceLineId!) !== row.totalCost)
        await tx.invoiceLine.update({
          where: { id: row.sourceLineId! },
          data: { costTotal: row.totalCost, unitAccountingCost: m2(row.unitCost) },
        });
      if (row.date >= from) touched.add(row.sourceId);
    }
  }
  if (!touched.size) return { products: products.length, invoices: 0, adjustment: 0, entries, info };
  // El costo de una venta suma todos sus renglones de producto (también los de productos que no se recalcularon).
  const lines = await tx.invoiceLine.findMany({
    where: { invoiceId: { in: [...touched] }, costTotal: { not: null }, product: { kind: "PRODUCT" } },
    select: { invoiceId: true, costTotal: true },
  });
  for (const line of lines)
    invoiceCosts.set(line.invoiceId, m2((invoiceCosts.get(line.invoiceId) ?? 0) + line.costTotal!.toNumber()));
  const accounts = await ensureDefaultAccounts(tx, organizationId);
  const posted = await postedCosts(tx, accounts["613505"]!.id, [...touched]);
  const adjustments = costAdjustments(invoiceCosts, posted);
  const adjustment = await postCostAdjustments(tx, organizationId, adjustments);
  return { products: products.length, invoices: adjustments.length, adjustment, entries, info };
}

/** Lo llaman compras, inventario y ventas: en modo automático recalcula los productos que movió el documento. */
export async function syncKardex(tx: Tx, organizationId: string, productIds: (string | null | undefined)[]) {
  const ids = [...new Set(productIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return null;
  const settings = await costingSettings(tx, organizationId);
  if (settings.mode !== "AUTOMATIC" || !settings.automaticFrom) return null;
  return recalculateKardex(tx, organizationId, settings.automaticFrom, ids);
}

/** Renglones de la venta que salen sin existencias en productos que no permiten inventario negativo. */
export function kardexShortages(run: KardexRun, invoiceId: string) {
  const result: { name: string; missing: number }[] = [];
  for (const [productId, rows] of run.entries) {
    const product = run.info.get(productId);
    if (!product || product.allowNegative) continue;
    const missing = rows
      .filter(row => row.sourceId === invoiceId && row.shortage > 0)
      .reduce((sum, row) => sum + row.shortage, 0);
    if (missing > 0) result.push({ name: product.name, missing });
  }
  return result;
}

const monthStartOf = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

/**
 * Cambia el modo de costeo.
 *   → AUTOMATIC: desde el día 1 del mes en curso. Si ese mes ya tenía «Costeo mensual», se reversa su asiento y se
 *     borra la ejecución (ahora lo cubre cada venta). Luego recalcula todo el kárdex.
 *   → MONTHLY: reversa el costo de ventas contabilizado venta por venta y vuelve al cálculo mensual a mano.
 */
export async function changeCostingMode(tx: Tx, organizationId: string, mode: CostingMode, now = new Date()) {
  const current = await costingSettings(tx, organizationId);
  if (current.mode === mode) return { changed: false, reversed: 0, run: null as KardexRun | null };
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`costing-mode:${organizationId}`}))`;
  const today = todayIn("America/Bogota", now);
  const accounts = await ensureDefaultAccounts(tx, organizationId);
  if (mode === "AUTOMATIC") {
    const from = monthStartOf(today);
    const runs = await tx.costingRun.findMany({
      where: {
        OR: [
          { year: { gt: from.getUTCFullYear() } },
          { year: from.getUTCFullYear(), month: { gte: from.getUTCMonth() + 1 } },
        ],
      },
    });
    let reversed = 0;
    for (const run of runs) {
      if (run.costOfSales.greaterThan(0)) {
        const amount = run.costOfSales.toNumber();
        const lines = [
          { accountId: accounts["143505"]!.id, debit: amount, credit: 0, memo: "Reversión de costo de ventas" },
          { accountId: accounts["613505"]!.id, debit: 0, credit: amount, memo: "Reversión de costo de ventas" },
        ];
        assertBalanced(lines);
        await tx.journalEntry.create({
          data: {
            organizationId,
            reference: `CV-${run.year}-${String(run.month).padStart(2, "0")}-v${run.version}-A`, // costingReference (costing.ts)
            date: today,
            description: `Reversión del costeo mensual de ${run.year}-${String(run.month).padStart(2, "0")}: pasa a costeo automático`,
            status: "POSTED",
            postedAt: new Date(),
            sourceType: "CostingRun",
            sourceId: run.id,
            lines: { create: lines },
          },
        });
        reversed = m2(reversed + amount);
      }
      await tx.costingRun.delete({ where: { id: run.id } });
    }
    await tx.organization.update({
      where: { id: organizationId },
      data: { costingMode: "AUTOMATIC", costingAutomaticFrom: from },
    });
    const run = await recalculateKardex(tx, organizationId, from);
    return { changed: true, reversed, run };
  }
  const posted = await postedCosts(tx, accounts["613505"]!.id);
  const reversals = [...posted]
    .filter(([, amount]) => Math.abs(amount) >= 0.01)
    .map(([invoiceId, amount]) => ({ invoiceId, amount: -amount }));
  const reversed = await postCostAdjustments(
    tx,
    organizationId,
    reversals,
    "Reversión del costo de ventas automático: pasa a costeo mensual"
  );
  await tx.organization.update({
    where: { id: organizationId },
    data: { costingMode: "MONTHLY", costingAutomaticFrom: null },
  });
  return { changed: true, reversed: -reversed, run: null };
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

const modeSchema = z.object({ mode: z.enum(["MONTHLY", "AUTOMATIC"]) });
const kardexQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export function registerKardexRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowPermission("reports.view") };
  const canManage = { preHandler: allowPermission("inventory.manage") };

  /** GET /v1/costing/settings — modo de costeo vigente. */
  app.get("/v1/costing/settings", canView, async request =>
    withOrganizationScope(request.actor!.organizationId, async tx => {
      const settings = await costingSettings(tx, request.actor!.organizationId);
      return {
        data: { mode: settings.mode, automaticFrom: settings.automaticFrom && dateOnly(settings.automaticFrom) },
      };
    })
  );

  /** PUT /v1/costing/settings — Body: { mode: "MONTHLY" | "AUTOMATIC" }. */
  app.put("/v1/costing/settings", canManage, async (request, reply) => {
    const parsed = modeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Modo de costeo inválido." });
    const actor = request.actor!;
    const result = await withOrganizationScope(actor.organizationId, async tx => {
      const changed = await changeCostingMode(tx, actor.organizationId, parsed.data.mode);
      const settings = await costingSettings(tx, actor.organizationId);
      if (changed.changed)
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.sub,
            entity: "Organization",
            entityId: actor.organizationId,
            action: "COSTING_MODE",
            after: {
              mode: settings.mode,
              automaticFrom: settings.automaticFrom && dateOnly(settings.automaticFrom),
              reversed: changed.reversed.toFixed(2),
              invoices: changed.run?.invoices ?? 0,
            },
            ipHash: options.auditIp(request.ip),
          },
        });
      return {
        mode: settings.mode,
        automaticFrom: settings.automaticFrom && dateOnly(settings.automaticFrom),
        reversed: changed.reversed.toFixed(2),
        products: changed.run?.products ?? 0,
        invoices: changed.run?.invoices ?? 0,
        adjustment: (changed.run?.adjustment ?? 0).toFixed(2),
      };
    });
    return { data: result };
  });

  /** POST /v1/costing/kardex/recalculate — recalcula el kárdex de todos los productos (modo automático). */
  app.post("/v1/costing/kardex/recalculate", canManage, async (request, reply) => {
    const actor = request.actor!;
    const result = await withOrganizationScope(actor.organizationId, async tx => {
      const settings = await costingSettings(tx, actor.organizationId);
      if (settings.mode !== "AUTOMATIC" || !settings.automaticFrom)
        throw httpError(409, "El costeo está en modo mensual: actívalo como automático o usa «Calcular costeo».");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`costing-mode:${actor.organizationId}`}))`;
      const run = await recalculateKardex(tx, actor.organizationId, settings.automaticFrom);
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.sub,
          entity: "Organization",
          entityId: actor.organizationId,
          action: "KARDEX_RECALCULATE",
          after: { products: run.products, invoices: run.invoices, adjustment: run.adjustment.toFixed(2) },
          ipHash: options.auditIp(request.ip),
        },
      });
      return { products: run.products, invoices: run.invoices, adjustment: run.adjustment.toFixed(2) };
    });
    return reply.code(201).send({ data: result });
  });

  /** GET /v1/products/:id/kardex?from=&to= — kárdex valorizado con saldo anterior al período. */
  app.get<{ Params: { id: string } }>("/v1/products/:id/kardex", canView, async (request, reply) => {
    const parsed = kardexQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Fechas inválidas (AAAA-MM-DD)." });
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(404).send({ error: "Producto no encontrado." });
    const result = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const product = await tx.product.findFirst({
        where: { id: request.params.id },
        select: {
          id: true,
          name: true,
          sku: true,
          unit: true,
          kind: true,
          averageCost: true,
          accountingCost: true,
          inventoryConfig: { select: { valuationMethod: true, allowNegativeStock: true } },
        },
      });
      if (!product) return null;
      const method = methodOf(product.inventoryConfig?.valuationMethod);
      const settings = await costingSettings(tx, request.actor!.organizationId);
      const { byProduct } = await loadKardexMovements(tx, [product.id]);
      const rows = product.kind === "PRODUCT" ? computeKardex(byProduct.get(product.id) ?? [], method) : [];
      const { from, to } = parsed.data;
      const before = from ? rows.filter(row => row.date < from).at(-1) : undefined;
      const visible = rows.filter(row => (!from || row.date >= from) && (!to || row.date <= to));
      const last = rows.at(-1);
      const fixed = (value: number, decimals = 2) => value.toFixed(decimals);
      return {
        product: {
          id: product.id,
          name: product.name,
          sku: product.sku,
          unit: product.unit,
          kind: product.kind,
          method,
          methodLabel: methodLabels[method],
          allowNegativeStock: product.inventoryConfig?.allowNegativeStock ?? false,
          masterCost: product.accountingCost.toFixed(2),
        },
        mode: settings.mode,
        automaticFrom: settings.automaticFrom && dateOnly(settings.automaticFrom),
        opening: before
          ? {
              quantity: fixed(before.balanceQty, 4),
              value: fixed(before.balanceValue),
              averageCost: fixed(before.averageCost, 4),
            }
          : { quantity: "0.0000", value: "0.00", averageCost: "0.0000" },
        closing: last
          ? {
              quantity: fixed(last.balanceQty, 4),
              value: fixed(last.balanceValue),
              averageCost: fixed(last.averageCost, 4),
            }
          : { quantity: "0.0000", value: "0.00", averageCost: "0.0000" },
        data: visible.map(row => ({
          date: row.date,
          kind: row.kind,
          document: row.document,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          qtyIn: fixed(row.qtyIn, 4),
          qtyOut: fixed(row.qtyOut, 4),
          unitCost: fixed(row.unitCost, 4),
          totalCost: fixed(row.totalCost),
          balanceQty: fixed(row.balanceQty, 4),
          balanceValue: fixed(row.balanceValue),
          averageCost: fixed(row.averageCost, 4),
          shortage: fixed(row.shortage, 4),
        })),
      };
    });
    if (!result) return reply.code(404).send({ error: "Producto no encontrado." });
    return result;
  });
}
