import assert from "node:assert/strict";
import test from "node:test";
import { assertBalanced, calculateDocumentTotals } from "../src/accounting.js";

test("calcula descuentos, IVA y total de una factura", () => {
  const totals = calculateDocumentTotals([
    { description: "Servicio", quantity: 2, unitPrice: 100_000, discountRate: 10, taxRate: 19 }
  ]);
  assert.equal(totals.subtotal, 200_000);
  assert.equal(totals.discountTotal, 20_000);
  assert.equal(totals.taxTotal, 34_200);
  assert.equal(totals.total, 214_200);
});

test("rechaza comprobantes sin partida doble", () => {
  assert.throws(() => assertBalanced([{ debit: 100, credit: 0 }]), /descuadrado/i);
  assert.doesNotThrow(() => assertBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }]));
});
