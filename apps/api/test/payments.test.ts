import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@betel/db";
import { createPaymentLinkSchema, onlinePaymentQuerySchema, sandboxPaymentResultSchema } from "@betel/contracts";
import { sandboxFee } from "../src/payment-provider.js";
import { newToken, parseToken, paymentNumber, settlement } from "../src/payments.js";

const D = (value: string) => new Prisma.Decimal(value);
const ORG = "0b8f2d1e-4c3a-4e5f-9a7b-1c2d3e4f5a6b";

test("comisión de pruebas: 2,99 % + $900, más IVA 19 % sobre la comisión", () => {
  // 100.000 × 2,99 % = 2.990 + 900 = 3.890; × 1,19 = 4.629,10
  assert.equal(sandboxFee(D("100000")).toFixed(2), "4629.10");
});

test("neto = total pagado − comisión, con Decimal", () => {
  const result = settlement(D("59500.60"), { fee: sandboxFee });
  assert.ok("net" in result);
  assert.equal(result.fee.plus(result.net).toFixed(2), "59500.60");
  assert.equal(result.fee.toFixed(2), sandboxFee(D("59500.60")).toFixed(2));
});

test("rechaza valores que la comisión se come completos", () => {
  const result = settlement(D("1000"), { fee: sandboxFee });
  assert.ok("error" in result);
});

test("el token lleva la organización y un secreto de 48 caracteres", () => {
  const token = newToken(ORG);
  assert.deepEqual(parseToken(token), { organizationId: ORG });
  assert.notEqual(newToken(ORG), token);
  assert.equal(parseToken(`${ORG}.corto`), null);
  assert.equal(parseToken("sin-organizacion"), null);
  assert.equal(parseToken(`${ORG}.${"z".repeat(48)}`), null); // solo hexadecimal
});

test("número visible del pago", () => {
  assert.equal(paymentNumber(12), "PL-12");
});

test("valida link, resultado de la pasarela y filtros", () => {
  const invoiceId = "00000000-0000-4000-8000-000000000001";
  assert.equal(createPaymentLinkSchema.safeParse({ invoiceId }).success, true);
  assert.equal(createPaymentLinkSchema.safeParse({ invoiceId, amount: -5 }).success, false);
  assert.equal(sandboxPaymentResultSchema.safeParse({ result: "APPROVED", method: "PSE" }).success, true);
  assert.equal(sandboxPaymentResultSchema.safeParse({ result: "MAYBE", method: "PSE" }).success, false);
  assert.equal(onlinePaymentQuerySchema.parse({}).pageSize, 50);
  assert.equal(onlinePaymentQuerySchema.safeParse({ status: "APPROVED", disbursement: "PENDING" }).success, true);
  assert.equal(onlinePaymentQuerySchema.safeParse({ disbursement: "LATER" }).success, false);
});
