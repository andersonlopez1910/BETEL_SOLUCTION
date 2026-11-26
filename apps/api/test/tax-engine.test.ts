import assert from "node:assert/strict";
import test from "node:test";
import { calculateInvoiceTaxes } from "../src/tax-engine.js";

test("impuestos se calculan sobre la base después del descuento", () => {
  const result = calculateInvoiceTaxes([
    {
      quantity: 2,
      unitPrice: 100000,
      discountType: "PERCENTAGE",
      discountValue: 10,
      taxTreatment: "TAXED",
      taxRate: 19,
    },
  ]);
  assert.equal(result.subtotal.toString(), "200000");
  assert.equal(result.discountTotal.toString(), "20000");
  assert.equal(result.taxableBase.toString(), "180000");
  assert.equal(result.taxTotal.toString(), "34200");
  assert.equal(result.total.toString(), "214200");
});

test("INC aumenta la factura y las retenciones solo disminuyen el neto esperado", () => {
  const result = calculateInvoiceTaxes([
    {
      quantity: 1,
      unitPrice: 100000,
      discountType: "FIXED",
      discountValue: 0,
      taxTreatment: "EXEMPT",
      taxRate: 0,
      incRate: 8,
      withholdings: [{ withholdingType: "RETEFUENTE", rate: 2.5 }],
    },
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

const aiuConfig = {
  administrationRate: 8,
  contingencyRate: 2,
  profitRate: 5,
  vatBase: "PROFIT" as const,
  withholdingBase: "AIU" as const,
  icaBase: "AIU" as const,
};
const contract = [
  {
    quantity: 1,
    unitPrice: 1000000,
    taxTreatment: "TAXED" as const,
    taxRate: 19,
    withholdings: [
      { withholdingType: "RETEFUENTE", rate: 2 },
      { withholdingType: "RETEICA", rate: 0.966 },
    ],
  },
];

test("AIU sumado al total: IVA sobre la utilidad y retenciones sobre la base AIU", () => {
  const result = calculateInvoiceTaxes(contract, { model: "ADDED", ...aiuConfig });
  assert.equal(result.aiu?.administration.toString(), "80000");
  assert.equal(result.aiu?.contingency.toString(), "20000");
  assert.equal(result.aiu?.profit.toString(), "50000");
  assert.equal(result.aiu?.total.toString(), "150000");
  assert.equal(result.lines[0]!.vatBase.toString(), "50000");
  assert.equal(result.taxTotal.toString(), "9500"); // 19 % de 50.000
  assert.equal(result.total.toString(), "1159500"); // 1.000.000 + 150.000 + 9.500
  assert.deepEqual(
    result.lines[0]!.withholdings.map(item => [item.taxableBase.toString(), item.amount.toString()]),
    [
      ["150000", "3000"],
      ["150000", "1449"],
    ]
  );
  assert.equal(result.estimatedNetReceivable.toString(), "1155051");
});

test("AIU no sumado: el total no incluye la base AIU", () => {
  const result = calculateInvoiceTaxes(contract, { model: "INCLUDED", ...aiuConfig });
  assert.equal(result.aiu?.total.toString(), "150000");
  assert.equal(result.aiu?.added, false);
  assert.equal(result.total.toString(), "1009500");
});

test("AIU con IVA sobre el subtotal equivale al cálculo normal del IVA", () => {
  const result = calculateInvoiceTaxes(contract, { model: "ADDED", ...aiuConfig, vatBase: "SUBTOTAL" });
  assert.equal(result.taxTotal.toString(), "190000");
  assert.equal(calculateInvoiceTaxes(contract).aiu, null);
});
