import assert from "node:assert/strict";
import test from "node:test";
import { calculateInvoiceTaxes } from "../src/tax-engine.js";

test("impuestos se calculan sobre la base después del descuento", () => {
  const result = calculateInvoiceTaxes([
    { quantity: 2, unitPrice: 100000, discountType: "PERCENTAGE", discountValue: 10, taxTreatment: "TAXED", taxRate: 19 },
  ]);
  assert.equal(result.subtotal.toString(), "200000");
  assert.equal(result.discountTotal.toString(), "20000");
  assert.equal(result.taxableBase.toString(), "180000");
  assert.equal(result.taxTotal.toString(), "34200");
  assert.equal(result.total.toString(), "214200");
});

test("INC aumenta la factura y las retenciones solo disminuyen el neto esperado", () => {
  const result = calculateInvoiceTaxes([
    { quantity: 1, unitPrice: 100000, discountType: "FIXED", discountValue: 0, taxTreatment: "EXEMPT", taxRate: 0, incRate: 8, withholdings: [{ withholdingType: "RETEFUENTE", rate: 2.5 }] },
  ]);
  assert.equal(result.incTotal.toString(), "8000");
  assert.equal(result.total.toString(), "108000");
  assert.equal(result.withholdingTotal.toString(), "2500");
  assert.equal(result.estimatedNetReceivable.toString(), "105500");
});

test("exento y excluido conservan IVA cero como tratamientos distintos", () => {
  const result = calculateInvoiceTaxes([
    { quantity: 1, unitPrice: 10, taxTreatment: "EXEMPT", taxRate: 0 },
    { quantity: 1, unitPrice: 10, taxTreatment: "EXCLUDED", taxRate: 0 },
  ]);
  assert.equal(result.taxTotal.toString(), "0");
  assert.equal(result.lines[0]!.taxRate.toString(), "0");
  assert.equal(result.lines[1]!.taxRate.toString(), "0");
});
