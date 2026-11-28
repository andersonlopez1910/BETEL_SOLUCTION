import assert from "node:assert/strict";
import test from "node:test";
import { costAdjustments, kardexShortages, type KardexRun } from "../src/kardex.js";
import { computeKardex } from "../src/kardex-engine.js";

test("costAdjustments: contabiliza solo la diferencia por venta", () => {
  const costs = new Map([
    ["fe-1", 10722.69],
    ["fe-2", 5000],
    ["fe-3", 1200],
  ]);
  const posted = new Map([
    ["fe-1", 10722.69], // sin cambio
    ["fe-2", 5200], // una compra con fecha anterior bajó el costo
  ]);
  assert.deepEqual(costAdjustments(costs, posted), [
    { invoiceId: "fe-2", amount: -200 },
    { invoiceId: "fe-3", amount: 1200 },
  ]);
});

test("costAdjustments: una venta que ya no está en el kárdex se reversa completa", () => {
  assert.deepEqual(costAdjustments(new Map(), new Map([["fe-9", 800]])), [{ invoiceId: "fe-9", amount: -800 }]);
});

test("kardexShortages: bloquea solo productos que no permiten inventario negativo", () => {
  const sale = (sourceId: string) => ({
    date: "2026-11-10",
    order: 3,
    kind: "SALE" as const,
    document: sourceId,
    sourceType: "Invoice",
    sourceId,
    quantity: 5,
  });
  const purchase = {
    date: "2026-11-01",
    order: 1,
    kind: "PURCHASE" as const,
    document: "CG-1",
    sourceType: "PurchaseDocument",
    sourceId: "cg-1",
    quantity: 3,
    unitCost: 1000,
  };
  const run: KardexRun = {
    products: 2,
    invoices: 0,
    adjustment: 0,
    entries: new Map([
      ["tubo", computeKardex([purchase, sale("fe-1")], "WEIGHTED_AVERAGE")],
      ["codo", computeKardex([purchase, sale("fe-1")], "WEIGHTED_AVERAGE")],
    ]),
    info: new Map([
      ["tubo", { name: "Tubo PVC", allowNegative: false }],
      ["codo", { name: "Codo", allowNegative: true }],
    ]),
  };
  assert.deepEqual(kardexShortages(run, "fe-1"), [{ name: "Tubo PVC", missing: 2 }]);
  assert.deepEqual(kardexShortages(run, "fe-2"), []);
});
