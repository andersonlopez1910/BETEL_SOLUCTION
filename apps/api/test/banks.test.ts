import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@betel/db";
import { bankMovementsQuerySchema } from "@betel/contracts";
import { accountKind, runningBalance } from "../src/banks.js";

const d = (value: string) => new Prisma.Decimal(value);

test("saldo acumulado desde el saldo anterior", () => {
  const rows = runningBalance(d("1000"), [
    { debit: d("500"), credit: d("0") },
    { debit: d("0"), credit: d("1700.50") },
    { debit: d("200.50"), credit: d("0") },
  ]);
  assert.deepEqual(
    rows.map(row => row.balance.toFixed(2)),
    ["1500.00", "-200.50", "0.00"]
  );
});

test("tipo de cuenta por código PUC", () => {
  assert.equal(accountKind("110505"), "CASH");
  assert.equal(accountKind("11050501"), "CASH");
  assert.equal(accountKind("111005"), "BANK");
});

test("período del auxiliar", () => {
  assert.equal(bankMovementsQuerySchema.parse({}).pageSize, 50);
  assert.equal(bankMovementsQuerySchema.safeParse({ from: "2026-11-30", to: "2026-11-01" }).success, false);
});
