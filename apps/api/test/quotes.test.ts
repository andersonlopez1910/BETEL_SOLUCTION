import assert from "node:assert/strict";
import test from "node:test";
import { convertQuoteSchema, createQuoteSchema, quoteQuerySchema } from "@betel/contracts";
import { quoteNumber, quoteWhere, visibleStatus } from "../src/quotes.js";

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const uuid = "00000000-0000-4000-8000-000000000001";
const today = day("2026-11-16");

test("número visible de la cotización", () => {
  assert.equal(quoteNumber(7), "COT-7");
});

test("una cotización abierta con validez vencida se muestra como vencida", () => {
  assert.equal(visibleStatus({ status: "OPEN", validUntil: day("2026-11-15") }, today), "EXPIRED");
  assert.equal(visibleStatus({ status: "OPEN", validUntil: day("2026-11-16") }, today), "OPEN"); // vence al final del día
  assert.equal(visibleStatus({ status: "OPEN", validUntil: null }, today), "OPEN");
  assert.equal(visibleStatus({ status: "INVOICED", validUntil: day("2026-01-01") }, today), "INVOICED");
});

test("el filtro Vencida busca abiertas con validez anterior a hoy y Abierta excluye las vencidas", () => {
  const expired = quoteWhere(quoteQuerySchema.parse({ status: "EXPIRED" }), today);
  assert.deepEqual(expired.status, "OPEN");
  assert.deepEqual(expired.validUntil, { lt: today });
  const open = quoteWhere(quoteQuerySchema.parse({ status: "OPEN" }), today);
  assert.deepEqual(open.OR, [{ validUntil: null }, { validUntil: { gte: today } }]);
});

test("filtra por usuario que elaboró y por cliente", () => {
  const where = quoteWhere(quoteQuerySchema.parse({ userId: uuid, customer: "900" }), today);
  assert.equal(where.createdById, uuid);
  assert.ok(where.customer);
});

test("valida la cotización: ítems, validez y paginación por defecto", () => {
  const line = { description: "Servicio", quantity: 1, unitPrice: 1000 };
  assert.equal(createQuoteSchema.safeParse({ customerId: uuid, issueDate: "2026-11-16", lines: [line] }).success, true);
  assert.equal(createQuoteSchema.safeParse({ customerId: uuid, issueDate: "2026-11-16", lines: [] }).success, false);
  assert.equal(
    createQuoteSchema.safeParse({ customerId: uuid, issueDate: "2026-11-16", validUntil: "2026-11-01", lines: [line] })
      .success,
    false
  );
  assert.equal(quoteQuerySchema.parse({}).pageSize, 50);
  assert.equal(quoteQuerySchema.safeParse({ status: "PERDIDA" }).success, false);
});

test("convertir a crédito exige vencimiento", () => {
  assert.equal(convertQuoteSchema.safeParse({ paymentMethod: "CREDIT", issueDate: "2026-11-16" }).success, false);
  assert.equal(
    convertQuoteSchema.safeParse({ paymentMethod: "CREDIT", issueDate: "2026-11-16", dueDate: "2026-12-16" }).success,
    true
  );
  assert.equal(convertQuoteSchema.safeParse({ paymentMethod: "CASH", issueDate: "2026-11-16" }).success, true);
});
