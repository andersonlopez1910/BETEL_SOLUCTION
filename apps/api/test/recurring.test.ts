import assert from "node:assert/strict";
import test from "node:test";
import { createRecurringInvoiceSchema, recurringInvoiceQuerySchema } from "@betel/contracts";
import { afterGeneration, nextPeriodAfter, occurrenceDate, recurringNumber, recurringWhere } from "../src/recurring.js";

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);
const uuid = "00000000-0000-4000-8000-000000000001";

test("número visible", () => {
  assert.equal(recurringNumber(5), "FR-5");
});

test("mensual conserva el día de inicio y se ajusta al fin de mes", () => {
  const start = day("2026-01-31");
  assert.deepEqual(
    [0, 1, 2, 3].map(n => iso(occurrenceDate(start, "MONTHLY", n))),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]
  );
  assert.equal(iso(occurrenceDate(day("2028-01-31"), "MONTHLY", 1)), "2028-02-29"); // año bisiesto
});

test("semanal, quincenal, trimestral, semestral y anual", () => {
  const start = day("2026-11-16");
  assert.equal(iso(occurrenceDate(start, "WEEKLY", 2)), "2026-11-30");
  assert.equal(iso(occurrenceDate(start, "BIWEEKLY", 1)), "2026-11-30");
  assert.equal(iso(occurrenceDate(start, "BIMONTHLY", 1)), "2027-01-16");
  assert.equal(iso(occurrenceDate(start, "QUARTERLY", 1)), "2027-02-16");
  assert.equal(iso(occurrenceDate(start, "SEMIANNUAL", 1)), "2027-05-16");
  assert.equal(iso(occurrenceDate(start, "ANNUAL", 1)), "2027-11-16");
});

test("después de generar avanza al siguiente período futuro sin generar los atrasados", () => {
  const template = {
    startDate: day("2026-08-16"),
    frequency: "MONTHLY" as const,
    periodIndex: 0,
    generatedCount: 0,
    occurrences: null,
  };
  // Generado el 16 nov (la API estuvo detenida): sigue el 16 dic, no sep/oct/nov.
  const next = afterGeneration(template, day("2026-11-16"));
  assert.equal(next.generatedCount, 1);
  assert.equal(iso(next.nextRunDate!), "2026-12-16");
  assert.equal(next.periodIndex, 4);
});

test("al llegar al número de veces ya no hay siguiente fecha", () => {
  const template = {
    startDate: day("2026-11-16"),
    frequency: "WEEKLY" as const,
    periodIndex: 2,
    generatedCount: 2,
    occurrences: 3,
  };
  assert.equal(afterGeneration(template, day("2026-11-30")).nextRunDate, null);
  assert.ok(afterGeneration({ ...template, occurrences: null }, day("2026-11-30")).nextRunDate);
});

test("generar antes de la fecha (manual) pasa al período siguiente", () => {
  const template = {
    startDate: day("2026-12-01"),
    frequency: "MONTHLY" as const,
    periodIndex: 0,
    generatedCount: 0,
    occurrences: 12,
  };
  assert.equal(iso(afterGeneration(template, day("2026-11-16")).nextRunDate!), "2027-01-01");
});

test("reactivar: primer período desde hoy (inclusive)", () => {
  const start = day("2026-09-16");
  assert.equal(iso(nextPeriodAfter(start, "MONTHLY", 0, day("2026-11-16"), true).date), "2026-11-16");
  assert.equal(iso(nextPeriodAfter(start, "MONTHLY", 0, day("2026-11-17"), true).date), "2026-12-16");
});

test("valida la plantilla y los filtros", () => {
  const base = {
    customerId: uuid,
    frequency: "MONTHLY",
    startDate: "2026-11-20",
    paymentMethod: "CASH",
    lines: [{ description: "Soporte", quantity: 1, unitPrice: 100000 }],
  };
  assert.equal(createRecurringInvoiceSchema.safeParse(base).success, true);
  assert.equal(createRecurringInvoiceSchema.safeParse({ ...base, paymentMethod: "CREDIT" }).success, false);
  assert.equal(createRecurringInvoiceSchema.safeParse({ ...base, paymentMethod: "CREDIT", dueDays: 30 }).success, true);
  assert.equal(createRecurringInvoiceSchema.safeParse({ ...base, occurrences: 0 }).success, false);
  assert.equal(createRecurringInvoiceSchema.safeParse({ ...base, frequency: "DAILY" }).success, false);
  const where = recurringWhere(recurringInvoiceQuerySchema.parse({ active: "true", frequency: "MONTHLY" }));
  assert.equal(where.active, true);
  assert.equal(where.frequency, "MONTHLY");
});
