import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@betel/db";
import { salesReportQuerySchema } from "@betel/contracts";
import {
  average,
  billedOnly,
  foldByMonth,
  percentChange,
  previousPeriod,
  resolvePeriod,
  salesWhere,
  todayIn,
  toDailyBuckets,
} from "../src/reports.js";

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const D = (value: string) => new Prisma.Decimal(value);

test("usa la fecha de Colombia, no la UTC, para 'hoy'", () => {
  // 3 nov 2026 02:00 UTC = 2 nov 2026 21:00 en Bogotá.
  assert.equal(todayIn("America/Bogota", new Date("2026-11-03T02:00:00Z")).toISOString(), "2026-11-02T00:00:00.000Z");
});

test("el período por defecto va del día 1 del mes a hoy", () => {
  const period = resolvePeriod({}, new Date("2026-11-20T15:00:00Z"));
  assert.equal(period.from.toISOString().slice(0, 10), "2026-11-01");
  assert.equal(period.to.toISOString().slice(0, 10), "2026-11-20");
});

test("el período anterior tiene la misma duración y termina el día antes", () => {
  const previous = previousPeriod({ from: day("2026-11-01"), to: day("2026-11-30") });
  assert.equal(previous.from.toISOString().slice(0, 10), "2026-10-02");
  assert.equal(previous.to.toISOString().slice(0, 10), "2026-10-31");
});

test("variación porcentual y promedio con precisión decimal", () => {
  assert.equal(percentChange(D("150"), D("100")), "50.0");
  assert.equal(percentChange(D("100"), D("0")), null);
  assert.equal(average(D("100.00"), 3), "33.33");
  assert.equal(average(D("0"), 0), "0.00");
  // 0,1 + 0,2 con Number da 0,30000000000000004; con Decimal es exacto.
  assert.equal(
    foldByMonth([
      { period: "2026-11-01", total: "0.10", count: 1 },
      { period: "2026-11-02", total: "0.20", count: 1 },
    ])[0]!.total,
    "0.30"
  );
});

test("agrupa totales diarios por mes sin duplicar facturas", () => {
  const days = toDailyBuckets([
    { issueDate: day("2026-11-02"), _sum: { total: D("200.50") }, _count: { _all: 2 } },
    { issueDate: day("2026-10-31"), _sum: { total: D("100.25") }, _count: { _all: 1 } },
    { issueDate: day("2026-11-05"), _sum: { total: null }, _count: { _all: 0 } },
  ]);
  assert.deepEqual(
    days.map(d => d.period),
    ["2026-10-31", "2026-11-02", "2026-11-05"]
  );
  assert.deepEqual(foldByMonth(days), [
    { period: "2026-10", total: "100.25", count: 1 },
    { period: "2026-11", total: "200.50", count: 2 },
  ]);
});

test("sin filtro de estado se excluyen borradores; los indicadores solo cuentan facturas vigentes", () => {
  const period = { from: day("2026-11-01"), to: day("2026-11-30") };
  const query = salesReportQuerySchema.parse({});
  assert.deepEqual(salesWhere(query, period).status, { not: "DRAFT" });
  const withVoid = salesWhere(salesReportQuerySchema.parse({ status: "VOID" }), period);
  assert.deepEqual(billedOnly(withVoid), {
    AND: [withVoid, { status: { in: ["ISSUED", "ACCEPTED", "OVERDUE"] } }],
  });
});

test("valida los filtros del reporte", () => {
  assert.equal(salesReportQuerySchema.safeParse({ from: "2026-11-30", to: "2026-11-01" }).success, false);
  assert.equal(salesReportQuerySchema.safeParse({ status: "PAGADA" }).success, false);
  assert.equal(salesReportQuerySchema.safeParse({ pageSize: "500" }).success, false);
  assert.equal(salesReportQuerySchema.parse({ customer: "   " }).customer, undefined);
});
