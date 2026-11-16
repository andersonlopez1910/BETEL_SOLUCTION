/**
 * Tablero principal (Resumen): indicadores financieros del mes, evolución de resultados y flujo de caja.
 *
 * Ruta:
 *   GET /v1/dashboard?granularity=month|quarter|year
 *
 * DEFINICIONES (también en docs/reporte-facturacion.md):
 *   - Ingresos: Σ (subtotal − descuentos) de las facturas vigentes (emitidas, aceptadas o vencidas), es decir
 *     el ingreso por ventas sin IVA, por fecha de emisión.
 *   - Gastos: Σ (total − IVA) de los documentos soporte contabilizados (ISSUED) por fecha. Betel aún no
 *     registra otros gastos (nómina, servicios, etc.), así que solo incluye compras con documento soporte.
 *   - Utilidad = ingresos − gastos. Margen = utilidad ÷ ingresos × 100 (1 decimal); null sin ingresos.
 *   - Variación: contra el mes anterior completo (el margen en puntos porcentuales).
 *   - Flujo de caja del mes: Entradas = recaudos (facturas de contado vigentes + recibos de caja activos,
 *     misma definición de la pestaña Recaudos); Salidas = total de los documentos soporte contabilizados
 *     (Betel aún no registra pagos a proveedores por separado); Flujo neto = entradas − salidas.
 *   - Evolución: utilidad de los últimos 10 meses, 8 trimestres o 5 años (incluye el actual).
 *   - Todas las sumas con Decimal.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import { z } from "zod";
import { allowRoles } from "./auth.js";
import { BILLED_STATUSES, REPORT_VIEW_ROLES, todayIn } from "./reports.js";

type Tx = Prisma.TransactionClient;
type Granularity = "month" | "quarter" | "year";
type Range = { from: Date; to: Date };

const ZERO = new Prisma.Decimal(0);
const querySchema = z.object({ granularity: z.enum(["month", "quarter", "year"]).default("month") });

// ─── Cálculos puros (probados en test/dashboard.test.ts) ─────────────────────

/** Mes calendario que contiene `day`, desplazado `offset` meses. */
export function monthRange(day: Date, offset = 0): Range {
  const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + offset, 1));
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
  return { from, to };
}

/** Clave del período de una fecha: "2026-11", "2026-T4" o "2026". */
export function bucketKey(day: Date, granularity: Granularity) {
  const year = day.getUTCFullYear();
  if (granularity === "year") return String(year);
  if (granularity === "quarter") return `${year}-T${Math.floor(day.getUTCMonth() / 3) + 1}`;
  return `${year}-${String(day.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Períodos de la evolución, del más antiguo al actual, con su rango de fechas. */
export function buckets(today: Date, granularity: Granularity) {
  const count = { month: 10, quarter: 8, year: 5 }[granularity];
  const result: { key: string; from: Date; to: Date }[] = [];
  for (let index = count - 1; index >= 0; index--) {
    let from: Date;
    let to: Date;
    if (granularity === "month") ({ from, to } = monthRange(today, -index));
    else if (granularity === "quarter") {
      const startMonth = Math.floor(today.getUTCMonth() / 3) * 3 - index * 3;
      from = new Date(Date.UTC(today.getUTCFullYear(), startMonth, 1));
      to = new Date(Date.UTC(today.getUTCFullYear(), startMonth + 3, 0));
    } else {
      from = new Date(Date.UTC(today.getUTCFullYear() - index, 0, 1));
      to = new Date(Date.UTC(today.getUTCFullYear() - index, 11, 31));
    }
    result.push({ key: bucketKey(from, granularity), from, to });
  }
  return result;
}

/** Variación porcentual con 1 decimal; null si la base es 0. */
export function change(current: Prisma.Decimal, previous: Prisma.Decimal) {
  if (previous.isZero()) return null;
  return current.minus(previous).dividedBy(previous.abs()).times(100).toDecimalPlaces(1).toFixed(1);
}

/** Margen (%) con 1 decimal; null sin ingresos. */
export function margin(income: Prisma.Decimal, profit: Prisma.Decimal) {
  return income.isZero() ? null : profit.dividedBy(income).times(100).toDecimalPlaces(1).toFixed(1);
}

// ─── Consultas ────────────────────────────────────────────────────────────────

const inRange = ({ from, to }: Range) => ({ gte: from, lte: to });

async function results(tx: Tx, range: Range) {
  const invoices = await tx.invoice.aggregate({
    where: { status: { in: [...BILLED_STATUSES] }, issueDate: inRange(range) },
    _sum: { subtotal: true, discountTotal: true },
  });
  const expenses = await tx.supportDocument.aggregate({
    where: { status: "ISSUED", issueDate: inRange(range) },
    _sum: { total: true, taxTotal: true },
  });
  const income = (invoices._sum.subtotal ?? ZERO).minus(invoices._sum.discountTotal ?? ZERO);
  const expense = (expenses._sum.total ?? ZERO).minus(expenses._sum.taxTotal ?? ZERO);
  return { income, expense, profit: income.minus(expense) };
}

async function cashFlow(tx: Tx, range: Range) {
  const cashInvoices = await tx.invoice.aggregate({
    where: { paymentTerm: "CASH", status: { in: [...BILLED_STATUSES] }, issueDate: inRange(range) },
    _sum: { total: true },
  });
  const receipts = await tx.cashReceipt.aggregate({
    where: { status: "ACTIVE", date: inRange(range) },
    _sum: { total: true },
  });
  const supportDocuments = await tx.supportDocument.aggregate({
    where: { status: "ISSUED", issueDate: inRange(range) },
    _sum: { total: true },
  });
  const inflows = (cashInvoices._sum.total ?? ZERO).plus(receipts._sum.total ?? ZERO);
  const outflows = supportDocuments._sum.total ?? ZERO;
  return { inflows: inflows.toFixed(2), outflows: outflows.toFixed(2), net: inflows.minus(outflows).toFixed(2) };
}

/** Sumas por día de ingresos y gastos en el rango, agrupadas luego por período. */
async function series(tx: Tx, today: Date, granularity: Granularity) {
  const periods = buckets(today, granularity);
  const range = { from: periods[0]!.from, to: periods.at(-1)!.to };
  const invoiceDays = await tx.invoice.groupBy({
    by: ["issueDate"],
    where: { status: { in: [...BILLED_STATUSES] }, issueDate: inRange(range) },
    _sum: { subtotal: true, discountTotal: true },
  });
  const expenseDays = await tx.supportDocument.groupBy({
    by: ["issueDate"],
    where: { status: "ISSUED", issueDate: inRange(range) },
    _sum: { total: true, taxTotal: true },
  });
  const totals = new Map(periods.map(period => [period.key, { income: ZERO, expense: ZERO }]));
  for (const day of invoiceDays) {
    const bucket = totals.get(bucketKey(day.issueDate, granularity));
    if (bucket) bucket.income = bucket.income.plus(day._sum.subtotal ?? ZERO).minus(day._sum.discountTotal ?? ZERO);
  }
  for (const day of expenseDays) {
    const bucket = totals.get(bucketKey(day.issueDate, granularity));
    if (bucket) bucket.expense = bucket.expense.plus(day._sum.total ?? ZERO).minus(day._sum.taxTotal ?? ZERO);
  }
  return periods.map(period => {
    const { income, expense } = totals.get(period.key)!;
    return {
      period: period.key,
      from: period.from.toISOString().slice(0, 10),
      income: income.toFixed(2),
      expense: expense.toFixed(2),
      profit: income.minus(expense).toFixed(2),
    };
  });
}

export function registerDashboardRoutes(app: FastifyInstance) {
  /** GET /v1/dashboard — indicadores del mes, evolución y flujo de caja. */
  app.get("/v1/dashboard", { preHandler: allowRoles(...REPORT_VIEW_ROLES) }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(422).send({ error: "Granularidad inválida", details: parsed.error.flatten() });
    const today = todayIn("America/Bogota");
    const month = monthRange(today);
    const previousMonth = monthRange(today, -1);
    return withOrganizationScope(request.actor!.organizationId, async tx => {
      const current = await results(tx, month);
      const previous = await results(tx, previousMonth);
      const currentMargin = margin(current.income, current.profit);
      const previousMargin = margin(previous.income, previous.profit);
      return {
        period: { from: month.from.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) },
        kpis: {
          income: { value: current.income.toFixed(2), change: change(current.income, previous.income) },
          expense: { value: current.expense.toFixed(2), change: change(current.expense, previous.expense) },
          profit: { value: current.profit.toFixed(2), change: change(current.profit, previous.profit) },
          margin: {
            value: currentMargin,
            change:
              currentMargin !== null && previousMargin !== null
                ? new Prisma.Decimal(currentMargin).minus(previousMargin).toFixed(1)
                : null,
          },
        },
        cashFlow: await cashFlow(tx, month),
        series: await series(tx, today, parsed.data.granularity),
      };
    });
  });
}
