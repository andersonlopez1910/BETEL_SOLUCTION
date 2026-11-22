import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@betel/db";
import { createAccountSchema, manualEntrySchema } from "@betel/contracts";
import { buildChart, manualNumber, SYSTEM_ACCOUNTS, trialBalanceRows } from "../src/ledger.js";
import { accountLevel, accountNature, accountTypeFor, childCode, parentCode } from "../src/puc.js";

const d = (value: string) => new Prisma.Decimal(value);

test("niveles y padres del PUC", () => {
  assert.deepEqual(["1", "11", "1105", "110505", "11050501"].map(accountLevel), [
    "CLASS",
    "GROUP",
    "ACCOUNT",
    "SUBACCOUNT",
    "AUXILIARY",
  ]);
  assert.deepEqual(["11050501", "110505", "1105", "11", "1"].map(parentCode), ["110505", "1105", "11", "1", null]);
  assert.equal(accountNature("110505"), "DEBIT");
  assert.equal(accountNature("220505"), "CREDIT");
  assert.equal(accountNature("413595"), "CREDIT");
  assert.equal(accountTypeFor("613505"), "COST");
  assert.equal(childCode("1105", "10"), "110510");
  assert.equal(childCode("1", "10"), null); // los grupos son fijos del PUC
  assert.equal(childCode("1105", "00"), null);
});

test("árbol con saldos acumulados por nodo y naturaleza", () => {
  const chart = buildChart(
    [
      { id: "a", code: "110505", name: "Caja general", active: true },
      { id: "b", code: "11050501", name: "Caja menor", active: true },
      { id: "c", code: "413595", name: "Ingresos por ventas", active: true },
      { id: "d", code: "999905", name: "Cuenta sin padre en el catálogo", active: true },
    ],
    [
      { code: "110505", debit: d("1000"), credit: d("200"), count: 3 },
      { code: "11050501", debit: d("50"), credit: d("0"), count: 1 },
      { code: "413595", debit: d("0"), credit: d("800"), count: 2 },
    ]
  );
  const node = (code: string) => chart.find(item => item.code === code)!;
  assert.equal(node("1").balance, "850.00"); // débito: 1.050 − 200
  assert.equal(node("1105").balance, "850.00");
  assert.equal(node("110505").balance, "850.00"); // incluye su auxiliar
  assert.equal(node("4").balance, "800.00"); // crédito: créditos − débitos
  assert.equal(node("110505").hasChildren, true);
  assert.equal(node("110505").postable, false); // tiene auxiliar
  assert.equal(node("11050501").postable, true);
  assert.equal(node("1105").source, "PUC");
  assert.equal(node("9999").name, "Cuenta 9999"); // ancestro que no está en el catálogo
  assert.ok(chart.findIndex(item => item.code === "1105") < chart.findIndex(item => item.code === "110505"));
});

test("balance de prueba por nivel", () => {
  const accounts = [
    { code: "110505", name: "Caja general" },
    { code: "111005", name: "Bancos" },
    { code: "413595", name: "Ingresos por ventas" },
  ];
  const before = new Map([["110505", d("100")]]);
  const period = new Map([
    ["110505", { debit: d("500"), credit: d("0") }],
    ["111005", { debit: d("300"), credit: d("50") }],
    ["413595", { debit: d("0"), credit: d("750") }],
  ]);
  const byGroup = trialBalanceRows(accounts, before, period, 2);
  assert.deepEqual(
    byGroup.map(row => [row.code, row.name, row.opening, row.debits, row.credits, row.closing]),
    [
      ["11", "Disponible", "100.00", "800.00", "50.00", "850.00"],
      ["41", "Operacionales", "0.00", "0.00", "750.00", "-750.00"],
    ]
  );
  const bySub = trialBalanceRows(accounts, before, period, 6);
  assert.equal(bySub.find(row => row.code === "110505")?.name, "Caja general");
});

test("validaciones y cuentas del sistema", () => {
  assert.equal(manualNumber(3), "CC-3");
  assert.ok(SYSTEM_ACCOUNTS.has("110505") && SYSTEM_ACCOUNTS.has("250505"));
  assert.equal(createAccountSchema.safeParse({ parentCode: "1105", suffix: "10", name: "Caja menor" }).success, true);
  assert.equal(createAccountSchema.safeParse({ parentCode: "1", suffix: "10", name: "Grupo" }).success, false);
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const base = {
    date: "2026-11-20",
    description: "Ajuste",
    lines: [
      { accountId: id(1), debit: 100 },
      { accountId: id(2), credit: 100 },
    ],
  };
  assert.equal(manualEntrySchema.safeParse(base).success, true);
  assert.equal(
    manualEntrySchema.safeParse({
      ...base,
      lines: [
        { accountId: id(1), debit: 100 },
        { accountId: id(2), credit: 90 },
      ],
    }).success,
    false
  );
  assert.equal(
    manualEntrySchema.safeParse({
      ...base,
      lines: [
        { accountId: id(1), debit: 100, credit: 100 },
        { accountId: id(2), credit: 0 },
      ],
    }).success,
    false
  );
  assert.equal(manualEntrySchema.safeParse({ ...base, lines: [base.lines[0]] }).success, false);
});
