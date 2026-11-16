import assert from "node:assert/strict";
import test from "node:test";
import { commercialTaskQuerySchema, commercialTaskSchema } from "@betel/contracts";
import { bogotaDayRange, isTaskOverdue, probabilityRange, taskNumber, taskWhere } from "../src/commercial.js";

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const uuid = "00000000-0000-4000-8000-000000000001";

test("número visible de la tarea", () => {
  assert.equal(taskNumber(3), "TC-3");
});

test("días completos en hora de Colombia (UTC−5)", () => {
  const range = bogotaDayRange(day("2026-11-01"), day("2026-11-30"))!;
  assert.equal(range.gte!.toISOString(), "2026-11-01T05:00:00.000Z");
  assert.equal(range.lt!.toISOString(), "2026-12-01T05:00:00.000Z");
  assert.equal(bogotaDayRange(), undefined);
});

test("rango de probabilidad", () => {
  assert.deepEqual(probabilityRange("26-50"), { gte: 26, lte: 50 });
  assert.equal(probabilityRange(), undefined);
});

test("vencida: pendiente con compromiso anterior a hoy", () => {
  const today = day("2026-11-16");
  assert.equal(isTaskOverdue({ status: "PENDING", dueDate: day("2026-11-15") }, today), true);
  assert.equal(isTaskOverdue({ status: "COMPLETED", dueDate: day("2026-11-15") }, today), false);
  assert.equal(isTaskOverdue({ status: "PENDING", dueDate: null }, today), false);
});

test("criterios: pendientes y contactos activos por defecto; varios responsables y filtros de oportunidad", () => {
  const defaults = taskWhere(commercialTaskQuerySchema.parse({}));
  assert.equal(defaults.status, "PENDING");
  assert.deepEqual(defaults.party, { active: true });
  const where = taskWhere(
    commercialTaskQuerySchema.parse({
      status: "ALL",
      allContacts: "true",
      responsibleIds: `${uuid},${uuid.replace(/1$/, "2")}`,
      stage: "NEGOTIATION",
      probability: "51-75",
      minExpectedValue: "1000000",
      createdFrom: "",
    })
  );
  assert.equal(where.status, undefined);
  assert.equal(where.party, undefined);
  assert.deepEqual(where.responsibleId, { in: [uuid, uuid.replace(/1$/, "2")] });
  assert.equal(where.stage, "NEGOTIATION");
  assert.deepEqual(where.probability, { gte: 51, lte: 75 });
  assert.deepEqual(where.expectedValue, { gte: 1000000 });
  assert.equal(where.createdAt, undefined);
});

test("valida la tarea y los criterios", () => {
  const base = {
    partyId: uuid,
    description: "Llamar para presentar propuesta",
    commitment: "CALL",
    responsibleId: uuid,
  };
  const parsed = commercialTaskSchema.parse({ ...base, dueDate: "", expectedValue: "" });
  assert.equal(parsed.dueDate, undefined);
  assert.equal(parsed.expectedValue, undefined);
  assert.equal(parsed.stage, "PROSPECT");
  assert.equal(commercialTaskSchema.safeParse({ ...base, probability: 120 }).success, false);
  assert.equal(commercialTaskSchema.safeParse({ ...base, description: "x" }).success, false);
  assert.equal(commercialTaskQuerySchema.parse({}).pageSize, 20);
  assert.equal(commercialTaskQuerySchema.safeParse({ dueFrom: "2026-11-20", dueTo: "2026-11-01" }).success, false);
  assert.equal(commercialTaskQuerySchema.safeParse({ responsibleIds: "no-es-uuid" }).success, false);
});
