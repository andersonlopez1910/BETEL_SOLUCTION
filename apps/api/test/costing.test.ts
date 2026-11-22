import assert from "node:assert/strict";
import test from "node:test";
import { computeCosting, costingReference, monthStatus, type Movement } from "../src/costing.js";

/**
 * Caso calculado a mano (producto A):
 *   Ene: entra 10 a $1.000 (saldo inicial) y se venden 4 → promedio 1.000; costo de ventas 4.000; queda 6 / 6.000.
 *   Feb: compra 10 por $13.000 → disponible 16 / 19.000, promedio 1.187,5; se venden 6 → 7.125; ajuste de salida
 *        2 a su costo registrado (2.000) → queda 8 / 9.875.
 *   Mar: sin movimientos → se arrastra 8 / 9.875.
 *   Abr: se venden 8 → promedio 9.875 / 8 = 1.234,375 → costo 9.875; queda 0 / 0.
 */
const movements: Movement[] = [
  { productId: "A", month: "2026-01", kind: "IN", quantity: 10, value: 10000 },
  { productId: "A", month: "2026-01", kind: "SALE", quantity: 4, value: 0 },
  { productId: "A", month: "2026-02", kind: "IN", quantity: 10, value: 13000 },
  { productId: "A", month: "2026-02", kind: "SALE", quantity: 6, value: 0 },
  { productId: "A", month: "2026-02", kind: "ADJUST_OUT", quantity: 2, value: 2000 },
  { productId: "A", month: "2026-04", kind: "SALE", quantity: 8, value: 0 },
  // B: se vende sin existencias en febrero (stock negativo).
  { productId: "B", month: "2026-02", kind: "SALE", quantity: 3, value: 0 },
  // C: solo se mueve después del mes consultado.
  { productId: "C", month: "2026-05", kind: "IN", quantity: 1, value: 50 },
];
const line = (month: string, product: string) =>
  computeCosting(movements, month).find(item => item.productId === product);

test("enero: promedio y costo de ventas", () => {
  assert.deepEqual(line("2026-01", "A"), {
    productId: "A",
    openingQty: 0,
    openingValue: 0,
    inQty: 10,
    inValue: 10000,
    salesQty: 4,
    salesCost: 4000,
    adjustOutQty: 0,
    adjustOutValue: 0,
    closingQty: 6,
    closingValue: 6000,
    averageCost: 1000,
    negative: false,
  });
});

test("febrero: promedio ponderado con el saldo anterior y ajuste de salida a su costo", () => {
  const february = line("2026-02", "A")!;
  assert.equal(february.openingQty, 6);
  assert.equal(february.openingValue, 6000);
  assert.equal(february.averageCost, 1187.5);
  assert.equal(february.salesCost, 7125);
  assert.equal(february.closingQty, 8);
  assert.equal(february.closingValue, 9875);
});

test("mes sin movimientos arrastra el saldo y el último que vacía el inventario", () => {
  const march = line("2026-03", "A")!;
  assert.deepEqual([march.openingQty, march.closingQty, march.closingValue, march.salesCost], [8, 8, 9875, 0]);
  const april = line("2026-04", "A")!;
  assert.deepEqual([april.averageCost, april.salesCost, april.closingQty, april.closingValue], [1234.375, 9875, 0, 0]);
  // Lo vendido en total = todo lo que entró menos el ajuste: 10.000 + 13.000 − 2.000.
  const sold = ["2026-01", "2026-02", "2026-03", "2026-04"].reduce(
    (sum, month) => sum + (line(month, "A")?.salesCost ?? 0),
    0
  );
  assert.equal(sold, 21000);
  // Con saldo y sin movimientos en mayo, sigue en cero y no aparece.
  assert.equal(line("2026-05", "A"), undefined);
});

test("stock negativo y productos que aún no tienen movimientos", () => {
  const negative = line("2026-02", "B")!;
  assert.equal(negative.negative, true);
  assert.equal(negative.closingQty, -3);
  assert.equal(negative.salesCost, 0);
  assert.equal(line("2026-02", "C"), undefined);
});

test("redondeo: sin existencias no queda valor", () => {
  const result = computeCosting(
    [
      { productId: "R", month: "2026-01", kind: "IN", quantity: 3, value: 100 },
      { productId: "R", month: "2026-01", kind: "SALE", quantity: 3, value: 0 },
    ],
    "2026-01"
  )[0]!;
  assert.equal(result.salesCost, 100);
  assert.equal(result.closingValue, 0);
});

test("estado del mes y referencia del asiento", () => {
  const run = { executedAt: new Date("2026-11-10T00:00:00Z") };
  assert.equal(monthStatus(null, null, true), "FUTURE");
  assert.equal(monthStatus(null, null, false), "NONE");
  assert.equal(monthStatus(run, new Date("2026-11-09T00:00:00Z"), false), "DONE");
  assert.equal(monthStatus(run, new Date("2026-11-11T00:00:00Z"), false), "OUTDATED");
  assert.equal(costingReference(2026, 3, 2), "CV-2026-03-v2");
});
