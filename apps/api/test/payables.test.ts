import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@betel/db";
import { createSupplierPaymentSchema, payablesQuerySchema } from "@betel/contracts";
import { agingBucket, agingTotals, applyToPayables, paymentNumber } from "../src/payables.js";

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

test("número visible del comprobante de egreso", () => {
  assert.equal(paymentNumber(7), "CE-7");
});

test("tramos de antigüedad", () => {
  assert.equal(agingBucket(0), "current");
  assert.equal(agingBucket(1), "d1_30");
  assert.equal(agingBucket(30), "d1_30");
  assert.equal(agingBucket(31), "d31_60");
  assert.equal(agingBucket(90), "d61_90");
  assert.equal(agingBucket(91), "d90");

  const today = day("2026-11-20");
  const totals = agingTotals(
    [
      { balance: new Prisma.Decimal(100), dueDate: day("2026-12-01") }, // por vencer
      { balance: new Prisma.Decimal(50), dueDate: null }, // sin fecha: por vencer
      { balance: new Prisma.Decimal(30), dueDate: day("2026-11-10") }, // 10 días
      { balance: new Prisma.Decimal(20), dueDate: day("2026-07-01") }, // 142 días
    ],
    today
  );
  assert.deepEqual(Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value.toFixed(2)])), {
    current: "150.00",
    d1_30: "30.00",
    d31_60: "0.00",
    d61_90: "0.00",
    d90: "20.00",
  });
});

test("un pago no supera el saldo de cada documento", () => {
  const balances = new Map([
    [uuid(1), new Prisma.Decimal("119000.00")],
    [uuid(2), new Prisma.Decimal("50000.00")],
  ]);
  const ok = applyToPayables(
    [
      { purchaseDocumentId: uuid(1), amount: 100000 },
      { purchaseDocumentId: uuid(2), amount: 50000 },
    ],
    balances
  );
  assert.ok("total" in ok && ok.total.toFixed(2) === "150000.00");
  const over = applyToPayables([{ purchaseDocumentId: uuid(2), amount: 50000.01 }], balances);
  assert.ok("error" in over && /supera el saldo/.test(over.error));
  const unknown = applyToPayables([{ purchaseDocumentId: uuid(3), amount: 1 }], balances);
  assert.ok("error" in unknown && /no tiene saldo/.test(unknown.error));
});

test("validaciones", () => {
  assert.deepEqual(
    { balance: payablesQuerySchema.parse({}).balance, status: payablesQuerySchema.parse({}).status },
    { balance: "ALL", status: "ACTIVE" }
  );
  const payment = {
    supplierId: uuid(1),
    date: "2026-11-20",
    method: "BANK_TRANSFER",
    applications: [{ purchaseDocumentId: uuid(2), amount: 1000 }],
  };
  assert.equal(createSupplierPaymentSchema.safeParse(payment).success, true);
  assert.equal(createSupplierPaymentSchema.safeParse({ ...payment, applications: [] }).success, false);
  assert.equal(
    createSupplierPaymentSchema.safeParse({
      ...payment,
      applications: [...payment.applications, ...payment.applications],
    }).success,
    false
  );
  assert.equal(
    createSupplierPaymentSchema.safeParse({
      ...payment,
      applications: [{ purchaseDocumentId: uuid(2), amount: 1.005 }],
    }).success,
    false
  );
});
