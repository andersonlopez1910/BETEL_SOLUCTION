import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@betel/db";
import { bucketKey, buckets, change, margin, monthRange } from "../src/dashboard.js";

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);
const D = (value: string) => new Prisma.Decimal(value);

test("mes actual y anterior, incluido el cambio de año", () => {
  const current = monthRange(day("2026-01-16"));
  assert.deepEqual([iso(current.from), iso(current.to)], ["2026-01-01", "2026-01-31"]);
  const previous = monthRange(day("2026-01-16"), -1);
  assert.deepEqual([iso(previous.from), iso(previous.to)], ["2025-12-01", "2025-12-31"]);
});

test("claves de período por mes, trimestre y año", () => {
  assert.equal(bucketKey(day("2026-11-16"), "month"), "2026-11");
  assert.equal(bucketKey(day("2026-11-16"), "quarter"), "2026-T4");
  assert.equal(bucketKey(day("2026-02-01"), "quarter"), "2026-T1");
  assert.equal(bucketKey(day("2026-11-16"), "year"), "2026");
});

test("evolución: 10 meses, 8 trimestres o 5 años terminando en el actual", () => {
  const months = buckets(day("2026-11-16"), "month");
  assert.equal(months.length, 10);
  assert.deepEqual([months[0]!.key, months.at(-1)!.key], ["2026-02", "2026-11"]);
  const quarters = buckets(day("2026-11-16"), "quarter");
  assert.deepEqual([quarters[0]!.key, quarters.at(-1)!.key], ["2025-T1", "2026-T4"]);
  assert.equal(iso(quarters.at(-1)!.to), "2026-12-31");
  const years = buckets(day("2026-11-16"), "year");
  assert.deepEqual(
    years.map(item => item.key),
    ["2022", "2023", "2024", "2025", "2026"]
  );
});

test("variación y margen con Decimal; sin base devuelven null", () => {
  assert.equal(change(D("112.4"), D("100")), "12.4");
  assert.equal(change(D("50"), D("0")), null);
  assert.equal(change(D("-50"), D("-100")), "50.0"); // pérdida que se reduce a la mitad
  assert.equal(margin(D("1000"), D("339")), "33.9");
  assert.equal(margin(D("0"), D("-10")), null);
});
