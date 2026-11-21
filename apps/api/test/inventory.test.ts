import assert from "node:assert/strict";
import test from "node:test";
import { createInventoryDocumentSchema } from "@betel/contracts";
import { assertBalanced } from "../src/accounting.js";
import {
  inventoryJournalLines,
  inventoryLineFromRow,
  inventoryNumber,
  inventoryValues,
  parseAmount,
} from "../src/inventory.js";

const accounts = Object.fromEntries(
  ["143505", "370505", "429595", "519595"].map(code => [code, { id: `cuenta-${code}` }])
);
const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

test("números visibles", () => {
  assert.equal(inventoryNumber("INITIAL", 3), "SI-3");
  assert.equal(inventoryNumber("ADJUSTMENT", 12), "AJ-12");
});

test("valores y asientos", () => {
  const values = inventoryValues([
    { direction: "IN" as const, quantity: 10, unitCost: 2500 },
    { direction: "OUT" as const, quantity: 3, unitCost: 1999.99 },
  ]);
  assert.deepEqual([values.inflow, values.outflow, values.total], [25000, 5999.97, 19000.03]);

  const initial = inventoryJournalLines("INITIAL", { inflow: 25000, outflow: 0 }, accounts);
  assertBalanced(initial);
  assert.deepEqual(
    initial.map(line => `${line.accountId}:${line.debit}/${line.credit}`),
    ["cuenta-143505:25000/0", "cuenta-370505:0/25000"]
  );
  const adjustment = inventoryJournalLines("ADJUSTMENT", { inflow: 100, outflow: 40 }, accounts);
  assertBalanced(adjustment);
  assert.deepEqual(
    adjustment.map(line => `${line.accountId}:${line.debit}/${line.credit}`),
    ["cuenta-143505:100/0", "cuenta-429595:0/100", "cuenta-519595:40/0", "cuenta-143505:0/40"]
  );
  assert.deepEqual(inventoryJournalLines("ADJUSTMENT", { inflow: 0, outflow: 0 }, accounts), []);
});

test("números escritos en Colombia o en inglés", () => {
  assert.equal(parseAmount("5.500"), 5500);
  assert.equal(parseAmount("1.234,56"), 1234.56);
  assert.equal(parseAmount("1,234.56"), 1234.56);
  assert.equal(parseAmount("$ 2.500.000"), 2500000);
  assert.equal(parseAmount("12.5"), 12.5);
  assert.equal(parseAmount("-3"), -3);
  assert.ok(Number.isNaN(parseAmount("")));
});

test("filas de Excel o CSV", () => {
  const products = new Map([
    ["c-1", { id: uuid(1), kind: "PRODUCT", active: true, name: "Tubo" }],
    ["s-1", { id: uuid(2), kind: "SERVICE", active: true, name: "Instalación" }],
    ["c-2", { id: uuid(3), kind: "PRODUCT", active: false, name: "Viejo" }],
  ]);
  assert.deepEqual(
    inventoryLineFromRow({ Código: "C-1", Cantidad: "10", "Costo unitario": "2.500" }, "INITIAL", products),
    {
      line: { productId: uuid(1), direction: "IN", quantity: 10, unitCost: 2500 },
    }
  );
  assert.equal(
    inventoryLineFromRow({ codigo: "c-1", cantidad: "2", costo: "100", movimiento: "Salida" }, "ADJUSTMENT", products)
      .line?.direction,
    "OUT"
  );
  assert.deepEqual(inventoryLineFromRow({ codigo: "C-1", cantidad: "-4", costo: "100" }, "ADJUSTMENT", products).line, {
    productId: uuid(1),
    direction: "OUT",
    quantity: 4,
    unitCost: 100,
  });
  assert.match(
    inventoryLineFromRow({ codigo: "C-1", cantidad: "-4", costo: "100" }, "INITIAL", products).error!,
    /solo tiene entradas/
  );
  assert.match(
    inventoryLineFromRow({ codigo: "X-9", cantidad: "1", costo: "1" }, "ADJUSTMENT", products).error!,
    /No existe/
  );
  assert.match(
    inventoryLineFromRow({ codigo: "S-1", cantidad: "1", costo: "1" }, "ADJUSTMENT", products).error!,
    /servicio/
  );
  assert.match(
    inventoryLineFromRow({ codigo: "C-2", cantidad: "1", costo: "1" }, "ADJUSTMENT", products).error!,
    /inactivo/
  );
  assert.match(
    inventoryLineFromRow({ codigo: "C-1", cantidad: "0", costo: "1" }, "ADJUSTMENT", products).error!,
    /Cantidad/
  );
  assert.match(
    inventoryLineFromRow({ codigo: "C-1", cantidad: "1", costo: "" }, "ADJUSTMENT", products).error!,
    /Costo/
  );
});

test("validaciones del documento", () => {
  const base = {
    type: "ADJUSTMENT",
    date: "2026-11-20",
    lines: [{ productId: uuid(1), direction: "OUT", quantity: 1, unitCost: 10 }],
  };
  assert.equal(createInventoryDocumentSchema.safeParse(base).success, true);
  assert.equal(createInventoryDocumentSchema.safeParse({ ...base, type: "INITIAL" }).success, false);
  assert.equal(
    createInventoryDocumentSchema.safeParse({ ...base, lines: [...base.lines, ...base.lines] }).success,
    false
  );
  assert.equal(createInventoryDocumentSchema.safeParse({ ...base, lines: [] }).success, false);
  assert.equal(
    createInventoryDocumentSchema.safeParse({ ...base, lines: [{ ...base.lines[0], unitCost: 1.005 }] }).success,
    false
  );
});
