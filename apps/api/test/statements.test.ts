import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@betel/db";
import { balanceSheet, incomeStatement } from "../src/statements.js";

const b = (code: string, balance: number) => ({ code, balance: new Prisma.Decimal(balance) });
const value = (rows: { label: string; current: string; previous?: string }[], label: string) =>
  rows.find(row => row.label === label);

test("estado de resultados: utilidades intermedias y período anterior", () => {
  const current = [
    b("413595", -1000000), // ingresos operacionales (crédito)
    b("613505", 400000), // costo de ventas
    b("519595", 150000), // administración
    b("523505", 50000), // ventas
    b("421005", -20000), // financieros (no operacional)
    b("530505", 10000), // gastos financieros (no operacional)
    b("540505", 100000), // impuesto de renta
  ];
  const previous = [b("413595", -500000), b("519595", 100000)];
  const { rows, net } = incomeStatement(current, previous);
  assert.equal(value(rows, "Ingresos operacionales")?.current, "1000000.00");
  assert.equal(value(rows, "Utilidad bruta")?.current, "600000.00");
  assert.equal(value(rows, "Utilidad operacional")?.current, "400000.00");
  assert.equal(value(rows, "Utilidad antes de impuestos")?.current, "410000.00");
  assert.deepEqual(net, { current: "310000.00", previous: "400000.00" });
  assert.equal(rows.at(-1)?.kind, "result");
  assert.ok(
    rows.some(row => row.kind === "account" && row.code === "4135"),
    "agrupa por cuenta de 4 dígitos"
  );
});

test("estado de resultados sin movimientos", () => {
  const { rows, net } = incomeStatement([], []);
  assert.deepEqual(net, { current: "0.00", previous: "0.00" });
  assert.ok(rows.every(row => row.kind !== "account"));
});

test("situación financiera cuadra con el resultado sin cerrar", () => {
  const balances = [
    b("110505", 1119000), // caja
    b("240802", -19000), // IVA por pagar
    b("370505", -1000000), // saldos iniciales en patrimonio
    b("413595", -100000),
  ];
  const sheet = balanceSheet(balances);
  assert.equal(sheet.totals.assets, "1119000.00");
  assert.equal(sheet.totals.liabilities, "19000.00");
  assert.equal(sheet.totals.openResult, "100000.00");
  assert.equal(sheet.totals.equity, "1100000.00");
  assert.equal(sheet.balanced, true);
  assert.ok(sheet.rows.some(row => row.label === "Resultado del ejercicio (años sin cerrar)"));
});

test("situación financiera tras el cierre: sin resultado pendiente", () => {
  const sheet = balanceSheet([b("110505", 70000), b("360505", -70000)]);
  assert.equal(sheet.totals.openResult, "0.00");
  assert.ok(!sheet.rows.some(row => row.label.startsWith("Resultado del ejercicio")));
  assert.equal(sheet.balanced, true);
});
