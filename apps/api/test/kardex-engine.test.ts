import assert from "node:assert/strict";
import test from "node:test";
import { computeKardex, type KardexMovement } from "../src/kardex-engine.js";

const move = (
  date: string,
  kind: KardexMovement["kind"],
  quantity: number,
  unitCost?: number,
  order = 0
): KardexMovement => ({
  date,
  order,
  kind,
  document: `${kind}-${date}`,
  sourceType: "X",
  sourceId: `${kind}-${date}`,
  quantity,
  unitCost,
});

test("promedio ponderado: el ejemplo de los tubos", () => {
  const rows = computeKardex(
    [
      move("2026-11-01", "INITIAL", 10, 2521.01),
      move("2026-11-05", "PURCHASE", 5, 3000),
      move("2026-11-10", "SALE", 4),
      move("2026-11-12", "PURCHASE", 10, 2800),
    ],
    "WEIGHTED_AVERAGE"
  );
  assert.deepEqual(
    rows.map(row => [row.balanceQty, row.balanceValue, row.averageCost]),
    [
      [10, 25210.1, 2521.01],
      [15, 40210.1, 2680.6733],
      [11, 29487.41, 2680.6736],
      [21, 57487.41, 2737.4957],
    ]
  );
  assert.equal(rows[2]!.totalCost, 10722.69); // 4 × 2.680,67 (con 4 decimales internos)
});

test("las salidas no cambian el promedio y las entradas sí", () => {
  const rows = computeKardex(
    [
      move("2026-01-01", "PURCHASE", 100, 1000),
      move("2026-01-02", "SALE", 30),
      move("2026-01-03", "PURCHASE", 50, 1300),
    ],
    "WEIGHTED_AVERAGE"
  );
  assert.equal(rows[1]!.unitCost, 1000);
  assert.equal(rows[1]!.averageCost, 1000);
  assert.equal(rows[2]!.averageCost, 1125); // (70 × 1.000 + 50 × 1.300) / 120
});

test("PEPS: las salidas consumen primero las capas más antiguas", () => {
  const rows = computeKardex(
    [
      move("2026-11-01", "INITIAL", 10, 2521.01),
      move("2026-11-05", "PURCHASE", 5, 3000),
      move("2026-11-10", "SALE", 12),
    ],
    "FIFO"
  );
  // 10 × 2.521,01 + 2 × 3.000 = 31.210,10; quedan 3 a 3.000.
  assert.equal(rows[2]!.totalCost, 31210.1);
  assert.deepEqual([rows[2]!.balanceQty, rows[2]!.balanceValue], [3, 9000]);
});

test("venta sin existencias: el faltante sale al último costo conocido", () => {
  const rows = computeKardex(
    [move("2026-11-01", "PURCHASE", 3, 1000), move("2026-11-02", "SALE", 5)],
    "WEIGHTED_AVERAGE"
  );
  assert.deepEqual([rows[1]!.totalCost, rows[1]!.shortage, rows[1]!.balanceQty], [5000, 2, -2]);
});

test("el orden es por fecha (un documento con fecha anterior recalcula lo posterior)", () => {
  const rows = computeKardex(
    [move("2026-11-10", "SALE", 4), move("2026-11-01", "PURCHASE", 10, 1000), move("2026-11-05", "PURCHASE", 10, 2000)],
    "WEIGHTED_AVERAGE"
  );
  assert.deepEqual(
    rows.map(row => row.kind),
    ["PURCHASE", "PURCHASE", "SALE"]
  );
  assert.equal(rows[2]!.totalCost, 6000); // 4 × 1.500
});

test("ajuste de salida conserva el costo con que se registró", () => {
  const rows = computeKardex(
    [move("2026-11-01", "PURCHASE", 10, 1000), move("2026-11-02", "ADJUST_OUT", 2, 900)],
    "WEIGHTED_AVERAGE"
  );
  assert.deepEqual([rows[1]!.totalCost, rows[1]!.balanceValue], [1800, 8200]);
});
