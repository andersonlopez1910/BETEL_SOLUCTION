import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@betel/db";
import { portfolioQuerySchema } from "@betel/contracts";
import { balanceFilter, balancesByCustomer, daysOverdue, isOverdue } from "../src/portfolio.js";

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const D = (value: string) => new Prisma.Decimal(value);
const today = day("2026-11-16");

test("vencida: fecha de vencimiento anterior a hoy o estado vencida", () => {
  assert.equal(isOverdue({ dueDate: day("2026-11-15"), status: "ISSUED" }, today), true);
  assert.equal(isOverdue({ dueDate: day("2026-11-16"), status: "ISSUED" }, today), false); // vence hoy
  assert.equal(isOverdue({ dueDate: null, status: "ISSUED" }, today), false);
  assert.equal(isOverdue({ dueDate: null, status: "OVERDUE" }, today), true);
});

test("días de mora", () => {
  assert.equal(daysOverdue(day("2026-11-06"), today), 10);
  assert.equal(daysOverdue(day("2026-11-20"), today), 0);
  assert.equal(daysOverdue(null, today), 0);
});

test("saldos por cliente separan vencido y por vencer con Decimal", () => {
  const balances = balancesByCustomer(
    [
      { customerId: "a", balance: D("0.10"), dueDate: day("2026-11-01"), status: "ISSUED" },
      { customerId: "a", balance: D("0.20"), dueDate: day("2026-11-02"), status: "ISSUED" },
      { customerId: "a", balance: D("500"), dueDate: day("2026-12-01"), status: "ISSUED" },
      { customerId: "b", balance: D("100"), dueDate: null, status: "ISSUED" },
    ],
    today
  );
  assert.equal(balances.get("a")!.overdue.toFixed(2), "0.30");
  assert.equal(balances.get("a")!.upcoming.toFixed(2), "500.00");
  assert.equal(balances.get("b")!.overdue.toFixed(2), "0.00");
});

test("filtro de saldo de cartera", () => {
  const balances = new Map([
    ["a", { overdue: D("10"), upcoming: D("0") }],
    ["b", { overdue: D("0"), upcoming: D("5") }],
  ]);
  assert.deepEqual(balanceFilter("ALL", balances), {});
  assert.deepEqual(balanceFilter("WITH_BALANCE", balances), { id: { in: ["a", "b"] } });
  assert.deepEqual(balanceFilter("OVERDUE", balances), { id: { in: ["a"] } });
  assert.deepEqual(balanceFilter("NO_BALANCE", balances), { id: { notIn: ["a", "b"] } });
});

test("filtros por defecto: todos los saldos, clientes activos, 50 por página", () => {
  const query = portfolioQuerySchema.parse({});
  assert.deepEqual([query.balance, query.status, query.pageSize], ["ALL", "ACTIVE", 50]);
  assert.equal(portfolioQuerySchema.safeParse({ balance: "DEUDORES" }).success, false);
});
