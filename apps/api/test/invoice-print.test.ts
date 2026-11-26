import assert from "node:assert/strict";
import test from "node:test";
import { invoiceQrText } from "../src/invoice-print.js";

const base = {
  number: "FE-00000001",
  issuedAt: new Date("2026-11-26T04:35:21Z"), // 25-nov-2026 23:35:21 en Bogotá
  sellerNit: "900999778",
  buyerId: "901222333",
  base: "183520.00",
  vat: "27268.80",
  otherTaxes: "0.00",
  total: "210788.80",
};

test("QR con los campos de la representación gráfica DIAN en hora de Colombia", () => {
  const text = invoiceQrText({ ...base, cufe: "abc123" });
  assert.match(text, /^NumFac: FE-00000001$/m);
  assert.match(text, /^FecFac: 2026-11-25$/m);
  assert.match(text, /^HorFac: 23:35:21-05:00$/m);
  assert.match(text, /^ValTolFac: 210788.80$/m);
  assert.match(text, /^QRCode: https:\/\/catalogo-vpfe\.dian\.gov\.co\/document\/searchqr\?documentkey=abc123$/m);
});

test("sin CUFE (ambiente de pruebas) no lleva URL de consulta", () => {
  const text = invoiceQrText({ ...base, cufe: null });
  assert.match(text, /CUFE: Pendiente/);
  assert.doesNotMatch(text, /QRCode:/);
});
