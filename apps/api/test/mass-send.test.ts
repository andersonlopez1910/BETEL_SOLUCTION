import assert from "node:assert/strict";
import test from "node:test";
import { massSendQuerySchema } from "@betel/contracts";
import { dianLabel, plan } from "../src/mass-send.js";
import { invoiceEmailBlocked } from "../src/dian.js";

const parse = (query: Record<string, string>) => massSendQuerySchema.parse(query);

test("sin filtros incluye los cuatro tipos y todos los estados DIAN", () => {
  const result = plan(parse({}));
  assert.deepEqual([...result.types].sort(), ["CashReceipt", "Delivery", "Invoice", "Quote"]);
  assert.equal(result.invoiceDian, undefined);
});

test("filtro DIAN sin 'No aplica' deja solo facturas con esos estados", () => {
  const result = plan(parse({ dian: "NOT_SENT,REJECTED" }));
  assert.deepEqual([...result.types], ["Invoice"]);
  assert.deepEqual(result.invoiceDian, ["PENDING", "REJECTED"]);
});

test("filtro DIAN solo 'No aplica' excluye facturas", () => {
  const result = plan(parse({ dian: "NOT_APPLICABLE", types: "Invoice,Quote" }));
  assert.deepEqual([...result.types], ["Quote"]);
});

test("tipos de comprobante por lista separada por comas", () => {
  assert.deepEqual([...plan(parse({ types: "Quote,Delivery" })).types], ["Quote", "Delivery"]);
  assert.equal(massSendQuerySchema.safeParse({ types: "Quote,Pagaré" }).success, false);
  assert.equal(parse({}).pageSize, 10);
});

test("estado DIAN visible: PENDING es 'No enviado'", () => {
  assert.equal(dianLabel("PENDING"), "NOT_SENT");
  assert.equal(dianLabel("ACCEPTED"), "ACCEPTED");
});

test("una factura solo se envía cuando la DIAN la aprueba (salvo DIAN de pruebas)", () => {
  const previous = process.env.DIAN_MODE;
  try {
    delete process.env.DIAN_MODE;
    assert.equal(invoiceEmailBlocked({ status: "ISSUED", dianStatus: "QUEUED" }), null);
    process.env.DIAN_MODE = "production";
    assert.match(invoiceEmailBlocked({ status: "ISSUED", dianStatus: "QUEUED" })!, /DIAN/);
    assert.equal(invoiceEmailBlocked({ status: "ACCEPTED", dianStatus: "ACCEPTED" }), null);
    assert.match(invoiceEmailBlocked({ status: "DRAFT", dianStatus: "PENDING" })!, /borrador/);
  } finally {
    if (previous === undefined) delete process.env.DIAN_MODE;
    else process.env.DIAN_MODE = previous;
  }
});
