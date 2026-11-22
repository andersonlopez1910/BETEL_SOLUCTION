/**
 * Productos y servicios › Costeo mensual: costo promedio ponderado por producto y costo de lo vendido.
 *
 * Rutas:
 *   GET  /v1/costing?year= ..................... los 12 meses del año con su última ejecución y estado
 *   POST /v1/costing/:year/:month/calculate .... "Calcular costeo" (o recalcular)
 *   GET  /v1/costing/:year/:month .............. detalle por producto
 *   GET  /v1/costing/:year/:month/export ....... detalle para descargar (auditado)
 *
 * MÉTODO (también en docs/productos-y-servicios.md): promedio ponderado mensual, solo productos (no servicios).
 *   Por producto y mes, en orden desde el primer movimiento:
 *     disponible = saldo inicial del mes + entradas del mes
 *       entradas: compras vigentes (cantidad × precio con descuento, sin IVA), saldo inicial y ajustes de entrada
 *                 (a su costo registrado);
 *     costo promedio = valor disponible ÷ cantidad disponible (si no hay disponible, el promedio anterior);
 *     costo de ventas = cantidad vendida en facturas emitidas, aceptadas o vencidas × costo promedio;
 *     ajustes de salida: a su costo registrado (ya contabilizados en inventory.ts);
 *     saldo final = disponible − vendido − ajustes de salida (si queda en 0, el valor residual de redondeo se
 *                   lleva al costo de ventas; si queda negativo se marca y se valora al promedio).
 *   Cada mes parte del saldo final del anterior, calculado de nuevo desde los documentos (no depende de que los
 *   meses anteriores estén costeados).
 *   Asiento del mes: Débito 613505 Costo de ventas / Crédito 143505 Inventario por el costo de ventas, fechado el
 *   último día del mes (o hoy, si es el mes en curso). Recalcular reversa el asiento anterior (<ref>-A).
 *   Estado: Sin costear · Costeado · Desactualizado (algún documento del mes o anterior cambió después de la
 *   última ejecución) · Mes futuro (no se puede calcular).
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import { costingMonthParamsSchema, costingYearQuerySchema } from "@betel/contracts";
import { allowRoles } from "./auth.js";
import { assertBalanced, ensureDefaultAccounts } from "./accounting.js";
import { INVENTORY_ROLES } from "./inventory.js";
import { BILLED_STATUSES, REPORT_EXPORT_ROLES, REPORT_VIEW_ROLES, todayIn } from "./reports.js";

type Tx = Prisma.TransactionClient;

// ─── Cálculo puro (probado en test/costing.test.ts) ──────────────────────────

/** Movimiento de inventario de un producto en un mes ("YYYY-MM"). `value` aplica a entradas y ajustes de salida. */
export type Movement = {
  productId: string;
  month: string;
  kind: "IN" | "SALE" | "ADJUST_OUT";
  quantity: number;
  value: number;
};
export type CostingResult = {
  productId: string;
  openingQty: number;
  openingValue: number;
  inQty: number;
  inValue: number;
  salesQty: number;
  salesCost: number;
  adjustOutQty: number;
  adjustOutValue: number;
  closingQty: number;
  closingValue: number;
  averageCost: number;
  negative: boolean;
};

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
const q4 = (value: number) => round(value, 4);
const m2 = (value: number) => round(value, 2);

/** Costeo del mes `target` ("YYYY-MM") para cada producto con saldo o movimientos. */
export function computeCosting(movements: Movement[], target: string): CostingResult[] {
  const byProduct = new Map<string, Movement[]>();
  for (const movement of movements) {
    if (movement.month > target) continue;
    const list = byProduct.get(movement.productId) ?? [];
    list.push(movement);
    byProduct.set(movement.productId, list);
  }
  const results: CostingResult[] = [];
  for (const [productId, list] of byProduct) {
    const months = [...new Set(list.map(movement => movement.month))].sort();
    let qty = 0;
    let value = 0;
    let average = 0;
    let result: CostingResult | null = null;
    for (const month of months) {
      const of = (kind: Movement["kind"]) =>
        list.filter(movement => movement.month === month && movement.kind === kind);
      const sum = (items: Movement[], field: "quantity" | "value") =>
        items.reduce((total, item) => total + item[field], 0);
      const inQty = q4(sum(of("IN"), "quantity"));
      const inValue = m2(sum(of("IN"), "value"));
      const salesQty = q4(sum(of("SALE"), "quantity"));
      const adjustOutQty = q4(sum(of("ADJUST_OUT"), "quantity"));
      const adjustOutValue = m2(sum(of("ADJUST_OUT"), "value"));
      const openingQty = qty;
      const openingValue = value;
      const availableQty = q4(qty + inQty);
      const availableValue = m2(value + inValue);
      if (availableQty > 0) average = availableValue / availableQty;
      else if (inQty > 0) average = inValue / inQty;
      let salesCost = m2(salesQty * average);
      const closingQty = q4(availableQty - salesQty - adjustOutQty);
      let closingValue = m2(availableValue - salesCost - adjustOutValue);
      if (closingQty === 0) {
        // Sin existencias no puede quedar valor: el residuo de redondeo va al costo de ventas.
        if (salesQty > 0) salesCost = m2(salesCost + closingValue);
        closingValue = 0;
      } else if (closingQty < 0) closingValue = m2(closingQty * average);
      qty = closingQty;
      value = closingValue;
      if (month === target)
        result = {
          productId,
          openingQty,
          openingValue,
          inQty,
          inValue,
          salesQty,
          salesCost,
          adjustOutQty,
          adjustOutValue,
          closingQty,
          closingValue,
          averageCost: q4(average),
          negative: closingQty < 0 || availableQty - salesQty < 0,
        };
    }
    // Sin movimientos en el mes: se arrastra el saldo del último mes con movimientos.
    result ??= {
      productId,
      openingQty: qty,
      openingValue: value,
      inQty: 0,
      inValue: 0,
      salesQty: 0,
      salesCost: 0,
      adjustOutQty: 0,
      adjustOutValue: 0,
      closingQty: qty,
      closingValue: value,
      averageCost: q4(average),
      negative: qty < 0,
    };
    if (result.openingQty !== 0 || result.inQty || result.salesQty || result.adjustOutQty || result.closingQty !== 0)
      results.push(result);
  }
  return results;
}

export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;
export const costingReference = (year: number, month: number, version: number) =>
  `CV-${monthKey(year, month)}-v${version}`;
const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month, 0));
const monthStart = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1));
const monthOf = (date: Date) => date.toISOString().slice(0, 7);

export type MonthStatus = "NONE" | "DONE" | "OUTDATED" | "FUTURE";
/** Estado de un mes según su ejecución y el último cambio de documentos hasta su cierre. */
export function monthStatus(run: { executedAt: Date } | null, lastChange: Date | null, isFuture: boolean): MonthStatus {
  if (isFuture) return "FUTURE";
  if (!run) return "NONE";
  return lastChange && lastChange > run.executedAt ? "OUTDATED" : "DONE";
}

// ─── Consultas ────────────────────────────────────────────────────────────────

/** Todos los movimientos de productos hasta el cierre del mes. */
async function loadMovements(tx: Tx, until: Date): Promise<Movement[]> {
  const [purchases, inventory, sales] = await Promise.all([
    tx.purchaseLine.findMany({
      where: {
        productId: { not: null },
        product: { kind: "PRODUCT" },
        purchaseDocument: { status: "ACTIVE", type: "PURCHASE", issueDate: { lte: until } },
      },
      select: {
        productId: true,
        quantity: true,
        unitPrice: true,
        discountRate: true,
        purchaseDocument: { select: { issueDate: true } },
      },
    }),
    tx.inventoryLine.findMany({
      where: { document: { status: "ACTIVE", date: { lte: until } } },
      select: { productId: true, direction: true, quantity: true, total: true, document: { select: { date: true } } },
    }),
    tx.invoiceLine.findMany({
      where: {
        productId: { not: null },
        product: { kind: "PRODUCT" },
        invoice: { status: { in: [...BILLED_STATUSES] }, issueDate: { lte: until } },
      },
      select: { productId: true, quantity: true, invoice: { select: { issueDate: true } } },
    }),
  ]);
  return [
    ...purchases.map(line => ({
      productId: line.productId!,
      month: monthOf(line.purchaseDocument.issueDate),
      kind: "IN" as const,
      quantity: line.quantity.toNumber(),
      value: line.quantity
        .times(line.unitPrice)
        .times(new Prisma.Decimal(1).minus(line.discountRate.dividedBy(100)))
        .toNumber(),
    })),
    ...inventory.map(line => ({
      productId: line.productId,
      month: monthOf(line.document.date),
      kind: line.direction === "IN" ? ("IN" as const) : ("ADJUST_OUT" as const),
      quantity: line.quantity.toNumber(),
      value: line.total.toNumber(),
    })),
    ...sales.map(line => ({
      productId: line.productId!,
      month: monthOf(line.invoice.issueDate),
      kind: "SALE" as const,
      quantity: line.quantity.toNumber(),
      value: 0,
    })),
  ];
}

/** Último cambio de un documento que afecta el costeo hasta el cierre del mes. */
async function lastChange(tx: Tx, until: Date) {
  const [invoices, purchases, inventory] = await Promise.all([
    tx.invoice.aggregate({
      where: { issueDate: { lte: until }, lines: { some: { productId: { not: null } } } },
      _max: { updatedAt: true },
    }),
    tx.purchaseDocument.aggregate({
      where: { issueDate: { lte: until }, type: "PURCHASE" },
      _max: { updatedAt: true },
    }),
    tx.inventoryDocument.aggregate({ where: { date: { lte: until } }, _max: { updatedAt: true } }),
  ]);
  const dates = [invoices._max.updatedAt, purchases._max.updatedAt, inventory._max.updatedAt].filter(
    (value): value is Date => value instanceof Date
  );
  return dates.length ? new Date(Math.max(...dates.map(date => date.getTime()))) : null;
}

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerCostingRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowRoles(...REPORT_VIEW_ROLES) };
  const canExport = { preHandler: allowRoles(...REPORT_EXPORT_ROLES) };
  const canCalculate = { preHandler: allowRoles(...INVENTORY_ROLES) };

  /** GET /v1/costing?year= — meses del año con estado. */
  app.get("/v1/costing", canView, async (request, reply) => {
    const parsed = costingYearQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Año inválido" });
    const today = todayIn("America/Bogota");
    const year = parsed.data.year ?? today.getUTCFullYear();
    return withOrganizationScope(request.actor!.organizationId, async tx => {
      const runs = await tx.costingRun.findMany({
        where: { year },
        include: { executedBy: { select: { displayName: true, email: true } } },
      });
      const byMonth = new Map(runs.map(run => [run.month, run]));
      const months = [];
      for (let month = 1; month <= 12; month++) {
        const run = byMonth.get(month) ?? null;
        const isFuture = monthStart(year, month) > today;
        const changed = run ? await lastChange(tx, monthEnd(year, month)) : null;
        months.push({
          month,
          status: monthStatus(run, changed, isFuture),
          current: monthOf(today) === monthKey(year, month),
          run: run && {
            executedAt: run.executedAt.toISOString(),
            executedBy: run.executedBy?.displayName ?? run.executedBy?.email ?? null,
            version: run.version,
            productCount: run.productCount,
            costOfSales: run.costOfSales.toFixed(2),
            closingValue: run.closingValue.toFixed(2),
            negativeCount: run.negativeCount,
          },
        });
      }
      // Años con información: desde el primer documento que mueve inventario (o el año consultado) hasta el actual.
      const [invoice, purchase, inventory] = await Promise.all([
        tx.invoice.aggregate({ where: { lines: { some: { productId: { not: null } } } }, _min: { issueDate: true } }),
        tx.purchaseDocument.aggregate({ where: { type: "PURCHASE" }, _min: { issueDate: true } }),
        tx.inventoryDocument.aggregate({ _min: { date: true } }),
      ]);
      const firstYear = Math.min(
        year,
        today.getUTCFullYear(),
        ...[invoice._min.issueDate, purchase._min.issueDate, inventory._min.date]
          .filter((value): value is Date => value instanceof Date)
          .map(value => value.getUTCFullYear())
      );
      const years = Array.from(
        { length: today.getUTCFullYear() - firstYear + 1 },
        (_, index) => today.getUTCFullYear() - index
      );
      return { data: { year, years: years.length ? years : [year], months } };
    });
  });

  /** POST /v1/costing/:year/:month/calculate — calcula (o recalcula) y contabiliza el costo de ventas. */
  app.post<{ Params: { year: string; month: string } }>(
    "/v1/costing/:year/:month/calculate",
    canCalculate,
    async (request, reply) => {
      const parsed = costingMonthParamsSchema.safeParse(request.params);
      if (!parsed.success) return reply.code(422).send({ error: "Mes inválido." });
      const { year, month } = parsed.data;
      const today = todayIn("America/Bogota");
      if (monthStart(year, month) > today) return reply.code(422).send({ error: "No se puede costear un mes futuro." });
      const actor = request.actor!;
      const result = await withOrganizationScope(actor.organizationId, async tx => {
        // Una sola ejecución a la vez por organización y mes.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`costing:${actor.organizationId}:${monthKey(year, month)}`}))`;
        const until = monthEnd(year, month);
        const lines = computeCosting(await loadMovements(tx, until), monthKey(year, month));
        const costOfSales = m2(lines.reduce((sum, line) => sum + line.salesCost, 0));
        const closingValue = m2(lines.reduce((sum, line) => sum + line.closingValue, 0));
        const previous = await tx.costingRun.findUnique({
          where: { organizationId_year_month: { organizationId: actor.organizationId, year, month } },
        });
        const accounts = await ensureDefaultAccounts(tx, actor.organizationId);
        const entryDate = until < today ? until : today;
        if (previous && previous.costOfSales.greaterThan(0)) {
          const amount = previous.costOfSales.toNumber();
          const reversal = [
            { accountId: accounts["143505"]!.id, debit: amount, credit: 0, memo: "Reversión de costo de ventas" },
            { accountId: accounts["613505"]!.id, debit: 0, credit: amount, memo: "Reversión de costo de ventas" },
          ];
          assertBalanced(reversal);
          await tx.journalEntry.create({
            data: {
              organizationId: actor.organizationId,
              reference: `${costingReference(year, month, previous.version)}-A`,
              date: entryDate,
              description: `Reversión del costeo de ${monthKey(year, month)} (versión ${previous.version})`,
              status: "POSTED",
              postedAt: new Date(),
              sourceType: "CostingRun",
              sourceId: previous.id,
              lines: { create: reversal },
            },
          });
          await tx.costingLine.deleteMany({ where: { runId: previous.id } });
        } else if (previous) await tx.costingLine.deleteMany({ where: { runId: previous.id } });
        const version = previous ? previous.version + 1 : 1;
        const data = {
          version,
          executedAt: new Date(),
          executedById: actor.sub,
          productCount: lines.length,
          costOfSales,
          closingValue,
          negativeCount: lines.filter(line => line.negative).length,
          lines: { create: lines.map(({ productId, ...line }) => ({ productId, ...line })) },
        };
        const run = previous
          ? await tx.costingRun.update({ where: { id: previous.id }, data })
          : await tx.costingRun.create({ data: { ...data, organizationId: actor.organizationId, year, month } });
        if (costOfSales > 0) {
          const journal = [
            { accountId: accounts["613505"]!.id, debit: costOfSales, credit: 0, memo: "Costo de ventas" },
            { accountId: accounts["143505"]!.id, debit: 0, credit: costOfSales, memo: "Salida de inventario vendido" },
          ];
          assertBalanced(journal);
          await tx.journalEntry.create({
            data: {
              organizationId: actor.organizationId,
              reference: costingReference(year, month, version),
              date: entryDate,
              description: `Costo de ventas de ${monthKey(year, month)}`,
              status: "POSTED",
              postedAt: new Date(),
              sourceType: "CostingRun",
              sourceId: run.id,
              lines: { create: journal },
            },
          });
        }
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.sub,
            entity: "CostingRun",
            entityId: run.id,
            action: previous ? "RECALCULATE" : "CALCULATE",
            after: {
              month: monthKey(year, month),
              version,
              costOfSales: costOfSales.toFixed(2),
              products: lines.length,
            },
            ipHash: options.auditIp(request.ip),
          },
        });
        return { version, costOfSales: costOfSales.toFixed(2), products: lines.length, negative: data.negativeCount };
      });
      return reply.code(201).send({ data: result });
    }
  );

  const detail = async (tx: Tx, organizationId: string, year: number, month: number) => {
    const run = await tx.costingRun.findUnique({
      where: { organizationId_year_month: { organizationId, year, month } },
      include: {
        executedBy: { select: { displayName: true, email: true } },
        lines: {
          include: { product: { select: { name: true, sku: true, unit: true } } },
          orderBy: { product: { name: "asc" } },
        },
      },
    });
    if (!run) throw httpError(404, "Ese mes aún no tiene costeo. Usa “Calcular costeo”.");
    return {
      data: run.lines.map(line => ({
        productId: line.productId,
        name: line.product.name,
        sku: line.product.sku,
        unit: line.product.unit,
        openingQty: line.openingQty.toFixed(2),
        openingValue: line.openingValue.toFixed(2),
        inQty: line.inQty.toFixed(2),
        inValue: line.inValue.toFixed(2),
        salesQty: line.salesQty.toFixed(2),
        salesCost: line.salesCost.toFixed(2),
        adjustOutQty: line.adjustOutQty.toFixed(2),
        adjustOutValue: line.adjustOutValue.toFixed(2),
        closingQty: line.closingQty.toFixed(2),
        closingValue: line.closingValue.toFixed(2),
        averageCost: line.averageCost.toFixed(2),
        negative: line.negative,
      })),
      run: {
        year,
        month,
        version: run.version,
        executedAt: run.executedAt.toISOString(),
        executedBy: run.executedBy?.displayName ?? run.executedBy?.email ?? null,
        costOfSales: run.costOfSales.toFixed(2),
        closingValue: run.closingValue.toFixed(2),
        negativeCount: run.negativeCount,
        status: monthStatus(run, await lastChange(tx, monthEnd(year, month)), false),
      },
    };
  };

  /** GET /v1/costing/:year/:month — detalle por producto. */
  app.get<{ Params: { year: string; month: string } }>("/v1/costing/:year/:month", canView, async (request, reply) => {
    const parsed = costingMonthParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(422).send({ error: "Mes inválido." });
    return withOrganizationScope(request.actor!.organizationId, tx =>
      detail(tx, request.actor!.organizationId, parsed.data.year, parsed.data.month)
    );
  });

  /** GET /v1/costing/:year/:month/export — mismo detalle, para descargar (auditado). */
  app.get<{ Params: { year: string; month: string } }>(
    "/v1/costing/:year/:month/export",
    canExport,
    async (request, reply) => {
      const parsed = costingMonthParamsSchema.safeParse(request.params);
      if (!parsed.success) return reply.code(422).send({ error: "Mes inválido." });
      return withOrganizationScope(request.actor!.organizationId, async tx => {
        const result = await detail(tx, request.actor!.organizationId, parsed.data.year, parsed.data.month);
        await tx.auditLog.create({
          data: {
            organizationId: request.actor!.organizationId,
            userId: request.actor!.sub,
            entity: "CostingRun",
            entityId: monthKey(parsed.data.year, parsed.data.month),
            action: "EXPORT",
            after: { rows: result.data.length },
            ipHash: options.auditIp(request.ip),
          },
        });
        return result;
      });
    }
  );
}
