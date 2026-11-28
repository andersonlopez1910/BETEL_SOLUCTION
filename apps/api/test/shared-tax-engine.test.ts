import assert from "node:assert/strict";
import test from "node:test";
import {
  computeCost,
  computeLine,
  computeSale,
  grossProfit,
  r2,
  saleTreatmentFromLegacy,
  splitTaxes,
} from "@betel/contracts";

test("Caso 1: costo $3.000 con IVA 19 % incluido", () => {
  const cost = computeCost({
    amount: 3000,
    includesVat: true,
    treatment: "GRAVADO_19",
    deductible: "DESCONTABLE_TOTAL",
  });
  assert.equal(cost.base, 2521.01);
  assert.equal(cost.vat, 478.99);
  assert.equal(cost.total, 3000);
  assert.equal(cost.accountingCost, 2521.01);
});

test("Caso 2: precio $5.500 con IVA 19 % incluido", () => {
  const sale = computeSale({ amount: 5500, includesTax: true, treatment: "IVA_19" });
  assert.deepEqual([sale.base, sale.vat, sale.total], [4621.85, 878.15, 5500]);
});

test("Caso 3: precio $5.500 sin IVA (19 %)", () => {
  const sale = computeSale({ amount: 5500, includesTax: false, treatment: "IVA_19" });
  assert.deepEqual([sale.base, sale.vat, sale.total], [5500, 1045, 6545]);
});

test("Caso 4: servicio $80.000 sin IVA", () => {
  for (const treatment of ["IVA_EXCLUIDO", "IVA_EXENTO", "NO_GRAVADO", "SIN_IMPUESTO"] as const) {
    const sale = computeSale({ amount: 80000, includesTax: true, treatment });
    assert.deepEqual([sale.base, sale.vat, sale.inc, sale.total], [80000, 0, 0, 80000], treatment);
  }
});

test("Resumen tributario: utilidad $2.100,84 y margen 45,45 %", () => {
  const cost = computeCost({
    amount: 3000,
    includesVat: true,
    treatment: "GRAVADO_19",
    deductible: "DESCONTABLE_TOTAL",
  });
  const sale = computeSale({ amount: 5500, includesTax: true, treatment: "IVA_19" });
  assert.deepEqual(grossProfit(sale.base, cost.accountingCost), { profit: 2100.84, margin: 45.45 });
});

test("Costo contable con IVA no descontable o parcialmente descontable", () => {
  const none = computeCost({ amount: 1000, includesVat: false, treatment: "GRAVADO_19", deductible: "NO_DESCONTABLE" });
  assert.deepEqual([none.vat, none.vatDeductible, none.vatNonDeductible, none.accountingCost], [190, 0, 190, 1190]);
  const partial = computeCost({
    amount: 1000,
    includesVat: false,
    treatment: "GRAVADO_19",
    deductible: "DESCONTABLE_PARCIAL",
    deductiblePct: 70,
  });
  assert.deepEqual([partial.vatDeductible, partial.vatNonDeductible, partial.accountingCost], [133, 57, 1057]);
  // El valor digitado no se modifica.
  assert.equal(partial.entered, 1000);
});

test("Exento, excluido y no gravado conservan códigos distintos", () => {
  assert.equal(saleTreatmentFromLegacy("EXEMPT", 0), "IVA_EXENTO");
  assert.equal(saleTreatmentFromLegacy("EXCLUDED", 0), "IVA_EXCLUIDO");
  assert.equal(saleTreatmentFromLegacy("OTHER", 0), "NO_GRAVADO");
  assert.equal(saleTreatmentFromLegacy("TAXED", 5), "IVA_5");
  assert.equal(saleTreatmentFromLegacy("TAXED", 0, true), "INC");
});

test("INC 8 % incluido: base + INC = total exacto", () => {
  const sale = computeSale({ amount: 10800, includesTax: true, treatment: "INC" });
  assert.deepEqual([sale.base, sale.vat, sale.inc, sale.total], [10000, 0, 800, 10800]);
});

test("Renglón con IVA incluido: no se suma el IVA otra vez (Caso 7)", () => {
  const line = computeLine({ quantity: 1, unitPrice: 5500, includesTax: true, vatRate: 19 });
  assert.deepEqual([line.base, line.vat, line.total], [4621.85, 878.15, 5500]);
});

test("Renglón: el descuento se aplica antes del impuesto", () => {
  const percent = computeLine({
    quantity: 2,
    unitPrice: 10000,
    includesTax: false,
    vatRate: 19,
    discountType: "PERCENTAGE",
    discountValue: 10,
  });
  assert.deepEqual(
    [percent.grossBase, percent.discountBase, percent.base, percent.vat, percent.total],
    [20000, 2000, 18000, 3420, 21420]
  );
  const included = computeLine({
    quantity: 3,
    unitPrice: 5500,
    includesTax: true,
    vatRate: 19,
    discountType: "FIXED",
    discountValue: 500,
  });
  assert.equal(included.total, 16000);
  assert.equal(r2(included.base + included.vat), included.total);
});

test("Sin diferencias de $0,01: base + impuestos = total en muchos precios con IVA incluido", () => {
  for (let price = 1; price <= 20000; price += 7) {
    for (const [vat, inc] of [
      [19, 0],
      [5, 0],
      [0, 8],
    ]) {
      const split = splitTaxes(price, true, vat!, inc!);
      assert.equal(r2(split.base + split.vat + split.inc), split.total, `${price} ${vat} ${inc}`);
      assert.equal(split.total, price);
    }
  }
});
