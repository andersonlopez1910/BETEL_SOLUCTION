import assert from "node:assert/strict";
import test from "node:test";
import { createPurchaseSchema, purchaseQuerySchema } from "@betel/contracts";
import { assertBalanced } from "../src/accounting.js";
import { purchaseJournalLines, purchaseNumber, sources, supportNumber } from "../src/purchases.js";

const accounts = Object.fromEntries(
  ["110505", "143505", "220505", "240810", "519595"].map(code => [code, { id: `cuenta-${code}` }])
);
const uuid = "00000000-0000-4000-8000-000000000001";

test("números visibles", () => {
  assert.equal(purchaseNumber(7), "CG-7");
  assert.equal(supportNumber("15"), "DS-15");
  assert.equal(supportNumber(null), "Sin numerar");
});

test("compra a crédito: inventario + IVA descontable contra proveedores, cuadrado", () => {
  const lines = purchaseJournalLines(
    { type: "PURCHASE", paymentTerm: "CREDIT", total: 119000, taxTotal: 19000 },
    accounts
  );
  assert.deepEqual(
    lines.map(line => [line.accountId, line.debit, line.credit]),
    [
      ["cuenta-143505", 100000, 0],
      ["cuenta-240810", 19000, 0],
      ["cuenta-220505", 0, 119000],
    ]
  );
  assertBalanced(lines);
});

test("gasto de contado sin IVA: gasto contra caja", () => {
  const lines = purchaseJournalLines({ type: "EXPENSE", paymentTerm: "CASH", total: 50000.5, taxTotal: 0 }, accounts);
  assert.deepEqual(
    lines.map(line => [line.accountId, line.debit, line.credit]),
    [
      ["cuenta-519595", 50000.5, 0],
      ["cuenta-110505", 0, 50000.5],
    ]
  );
  assertBalanced(lines);
});

test("fuentes según el tipo de transacción", () => {
  assert.deepEqual(sources({}), { purchaseTypes: ["PURCHASE", "EXPENSE"], support: true });
  assert.deepEqual(sources({ type: "EXPENSE" }), { purchaseTypes: ["EXPENSE"], support: false });
  assert.deepEqual(sources({ type: "SUPPORT" }), { purchaseTypes: [], support: true });
  // El documento soporte no tiene factura del proveedor.
  assert.deepEqual(sources({ supplierInvoice: "FE-10" }), { purchaseTypes: ["PURCHASE", "EXPENSE"], support: false });
});

test("validaciones: crédito exige vencimiento, factura del proveedor obligatoria", () => {
  const base = {
    type: "PURCHASE",
    supplierId: uuid,
    supplierInvoiceNumber: "FE-100",
    issueDate: "2026-11-20",
    paymentMethod: "CASH",
    lines: [{ description: "Tornillos", quantity: 10, unitPrice: 1000 }],
  };
  assert.equal(createPurchaseSchema.safeParse(base).success, true);
  assert.equal(createPurchaseSchema.safeParse({ ...base, paymentMethod: "CREDIT" }).success, false);
  assert.equal(
    createPurchaseSchema.safeParse({ ...base, paymentMethod: "CREDIT", dueDate: "2026-12-20" }).success,
    true
  );
  assert.equal(createPurchaseSchema.safeParse({ ...base, supplierInvoiceNumber: " " }).success, false);
  assert.equal(createPurchaseSchema.safeParse({ ...base, type: "SUPPORT" }).success, false);
  assert.equal(purchaseQuerySchema.parse({}).pageSize, 50);
});
