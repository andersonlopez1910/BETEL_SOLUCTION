import assert from "node:assert/strict";
import test from "node:test";
import { employeeSchema, payrollItemSchema } from "@betel/contracts";
import { assertBalanced } from "../src/accounting.js";
import {
  calculatePayroll,
  commercialDays,
  PAYROLL_ACCOUNTS,
  payrollJournal,
  payrollPeriod,
  PROPOSED_SETTINGS,
  solidarityRate,
  type Novelties,
} from "../src/payroll.js";

const settings = PROPOSED_SETTINGS; // Valores de 2025 (SMMLV 1.423.500, auxilio 200.000, 220 horas)
const none: Novelties = {
  days: 30,
  overtimeDay: 0,
  overtimeNight: 0,
  nightHours: 0,
  holidayHours: 0,
  salaryBonus: 0,
  nonSalaryBonus: 0,
  withholding: 0,
  otherDeductions: 0,
};
const d = (value: string) => new Date(`${value}T00:00:00Z`);

test("salario ordinario con horas extra (calculado a mano)", () => {
  // Salario 2.000.000, 30 días, 2 horas extra diurnas: hora = 2.000.000 / 220 = 9.090,91; HED = 2 × hora × 1,25.
  const result = calculatePayroll(
    { salary: 2000000, salaryType: "ORDINARY", riskClass: 1 },
    { ...none, overtimeDay: 2 },
    settings
  );
  assert.equal(result.basicPay, 2000000);
  assert.equal(result.overtimeDayPay, 22727.27);
  assert.equal(result.transport, 200000); // ≤ 2 SMMLV
  assert.equal(result.ibc, 2022727.27); // sin auxilio de transporte
  assert.equal(result.healthEmployee, 80909.09);
  assert.equal(result.pensionEmployee, 80909.09);
  assert.equal(result.solidarity, 0);
  assert.equal(result.earnings, 2222727.27);
  assert.equal(result.deductions, 161818.18);
  assert.equal(result.netPay, 2060909.09);
  // Empresa exonerada y empleado < 10 SMMLV: sin salud, ICBF ni SENA del empleador.
  assert.deepEqual([result.healthEmployer, result.icbf, result.sena], [0, 0, 0]);
  assert.equal(result.pensionEmployer, 242727.27);
  assert.equal(result.arl, 10558.64); // clase I 0,522 %
  assert.equal(result.compensation, 80909.09);
  // Provisiones: (salariales + auxilio) / 12; intereses 12 %; vacaciones básico / 24.
  assert.equal(result.severance, 185227.27);
  assert.equal(result.severanceInterest, 22227.27);
  assert.equal(result.serviceBonus, 185227.27);
  assert.equal(result.vacation, 83333.33);
  assert.equal(result.employerCost, 810210.14);
});

test("quincena con salario mínimo", () => {
  const result = calculatePayroll(
    { salary: 1423500, salaryType: "ORDINARY", riskClass: 1 },
    { ...none, days: 15 },
    settings
  );
  assert.deepEqual(
    [result.basicPay, result.transport, result.ibc, result.healthEmployee, result.pensionEmployee, result.netPay],
    [711750, 100000, 711750, 28470, 28470, 754810]
  );
});

test("salario integral: IBC 70 %, sin auxilio ni prima ni cesantías, con FSP", () => {
  const result = calculatePayroll(
    { salary: 20000000, salaryType: "INTEGRAL", riskClass: 1 },
    { ...none, overtimeDay: 5 },
    settings
  );
  assert.equal(result.overtimePay, 0);
  assert.equal(result.transport, 0);
  assert.equal(result.ibc, 14000000);
  assert.equal(result.solidarityPct, 1);
  assert.equal(result.solidarity, 140000);
  assert.equal(result.healthEmployer, 1190000); // gana más de 10 SMMLV: no aplica la exoneración
  assert.deepEqual([result.severance, result.serviceBonus, result.severanceInterest], [0, 0, 0]);
  assert.equal(result.vacation, 833333.33);
});

test("tope de 25 SMMLV y tabla del Fondo de Solidaridad", () => {
  const result = calculatePayroll({ salary: 40000000, salaryType: "ORDINARY", riskClass: 1 }, none, settings);
  assert.equal(result.ibc, 35587500);
  assert.equal(result.solidarityPct, 2);
  assert.equal(result.solidarity, 711750);
  assert.equal(solidarityRate(3.99 * 1423500, 1423500), 0);
  assert.equal(solidarityRate(16.5 * 1423500, 1423500), 1.2);
  assert.equal(solidarityRate(19.5 * 1423500, 1423500), 1.8);
});

test("días comerciales y períodos", () => {
  assert.equal(commercialDays(d("2026-02-01"), d("2026-02-28")), 30);
  assert.equal(commercialDays(d("2026-02-16"), d("2026-02-28")), 15);
  assert.equal(commercialDays(d("2026-01-16"), d("2026-01-31")), 15);
  assert.equal(commercialDays(d("2026-03-10"), d("2026-03-31")), 21);
  assert.equal(commercialDays(d("2026-03-10"), d("2026-03-05")), 0);
  assert.deepEqual(
    Object.values(payrollPeriod("BIWEEKLY", 2026, 2, 2)).map(date => date.toISOString().slice(0, 10)),
    ["2026-02-16", "2026-02-28"]
  );
  assert.deepEqual(
    Object.values(payrollPeriod("MONTHLY", 2026, 11)).map(date => date.toISOString().slice(0, 10)),
    ["2026-11-01", "2026-11-30"]
  );
});

test("el asiento de la nómina cuadra", () => {
  const accounts = Object.fromEntries(PAYROLL_ACCOUNTS.map(([code]) => [code, { id: `cuenta-${code}` }]));
  const lines = payrollJournal(
    [
      calculatePayroll(
        { salary: 2000000, salaryType: "ORDINARY", riskClass: 3 },
        { ...none, overtimeDay: 2, withholding: 5000, otherDeductions: 20000, nonSalaryBonus: 50000 },
        settings
      ),
      calculatePayroll({ salary: 20000000, salaryType: "INTEGRAL", riskClass: 1 }, none, settings),
    ],
    accounts
  );
  assertBalanced(lines);
  assert.ok(lines.some(line => line.accountId === "cuenta-250505" && line.credit > 0));
});

test("validaciones", () => {
  const employee = {
    identificationType: "CC",
    identificationNumber: "1020304050",
    firstName: "Ana",
    lastName: "Pérez",
    position: "Auxiliar",
    startDate: "2026-01-15",
    contractType: "INDEFINITE",
    salary: 1800000,
    healthFund: "EPS Sura",
    pensionFund: "Porvenir",
  };
  assert.equal(employeeSchema.safeParse(employee).success, true);
  assert.equal(employeeSchema.safeParse({ ...employee, endDate: "2026-01-01" }).success, false);
  assert.equal(employeeSchema.safeParse({ ...employee, salary: 0 }).success, false);
  assert.equal(payrollItemSchema.safeParse({ days: 31 }).success, false);
  assert.equal(payrollItemSchema.parse({ days: "15" }).overtimeDay, 0);
});
