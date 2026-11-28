import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@betel/db";
import { taxDetailSummary } from "../src/billing-tax-report.js";

const d = (value: number) => new Prisma.Decimal(value);

test("KPI del detalle tributario: utilidad = base − costo y margen sobre la base", () => {
  const summary = taxDetailSummary([
    { base: d(4621.85), vat: d(878.15), inc: d(0), discount: d(0), total: d(5500), costTotal: d(2521.01) },
    { base: d(20000), vat: d(0), inc: d(1600), discount: d(0), total: d(21600), costTotal: d(0) },
  ]);
  assert.deepEqual(summary, {
    salesBeforeTaxes: "24621.85",
    vat: "878.15",
    inc: "1600.00",
    discounts: "0.00",
    totalSales: "27100.00",
    cost: "2521.01",
    grossProfit: "22100.84",
    grossMargin: "89.76",
  });
  assert.equal(taxDetailSummary([]).grossMargin, "0.00");
});
