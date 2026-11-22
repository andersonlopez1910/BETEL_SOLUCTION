import assert from "node:assert/strict";
import test from "node:test";
import { receivedInvoiceEventSchema, registerReceivedInvoiceSchema } from "@betel/contracts";
import {
  addBusinessDays,
  colombianHolidays,
  easterSunday,
  eventBlocked,
  isFinalized,
} from "../src/received-invoices.js";

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const cufe = "a".repeat(96);

test("festivos de Colombia 2026", () => {
  assert.equal(easterSunday(2026).toISOString().slice(0, 10), "2026-04-05");
  const holidays = [...colombianHolidays(2026)].sort();
  assert.deepEqual(holidays, [
    "2026-01-01",
    "2026-01-12", // Reyes (6 de enero, martes → lunes)
    "2026-03-23", // San José
    "2026-04-02", // Jueves Santo
    "2026-04-03", // Viernes Santo
    "2026-05-01",
    "2026-05-18", // Ascensión
    "2026-06-08", // Corpus Christi
    "2026-06-15", // Sagrado Corazón
    "2026-06-29", // San Pedro y San Pablo (ya es lunes)
    "2026-07-20",
    "2026-08-07",
    "2026-08-17", // Asunción (sábado 15 → lunes)
    "2026-10-12",
    "2026-11-02", // Todos los Santos (domingo 1 → lunes)
    "2026-11-16", // Independencia de Cartagena
    "2026-12-08",
    "2026-12-25",
  ]);
});

test("plazo de 3 días hábiles", () => {
  // Viernes 20 nov → lunes 23, martes 24, miércoles 25.
  assert.equal(addBusinessDays(day("2026-11-20"), 3).toISOString().slice(0, 10), "2026-11-25");
  // Viernes 13 nov: el lunes 16 es festivo → martes 17, miércoles 18, jueves 19.
  assert.equal(addBusinessDays(day("2026-11-13"), 3).toISOString().slice(0, 10), "2026-11-19");
  // Miércoles 1 abril: jueves y viernes santos → lunes 6, martes 7, miércoles 8.
  assert.equal(addBusinessDays(day("2026-04-01"), 3).toISOString().slice(0, 10), "2026-04-08");
});

test("orden de los eventos", () => {
  const today = day("2026-11-20");
  const empty = { events: [], outcome: null, responseDeadline: null };
  assert.equal(eventBlocked(empty, "RECEIPT", today, false), null);
  assert.match(eventBlocked(empty, "GOODS_RECEIPT", today, false)!, /030/);
  assert.match(eventBlocked(empty, "ACCEPTANCE", today, false)!, /030/);

  const received = {
    events: [{ type: "RECEIPT" as const, dianStatus: "QUEUED" }],
    outcome: null,
    responseDeadline: null,
  };
  assert.match(eventBlocked(received, "RECEIPT", today, false)!, /Ya registraste/);
  assert.equal(eventBlocked(received, "GOODS_RECEIPT", today, false), null);
  // Con proveedor DIAN real, el 030 debe estar aceptado.
  assert.match(eventBlocked(received, "GOODS_RECEIPT", today, true)!, /aún no ha aceptado/);
  assert.match(eventBlocked(received, "CLAIM", today, false)!, /032/);

  const goods = {
    events: [
      { type: "RECEIPT" as const, dianStatus: "QUEUED" },
      { type: "GOODS_RECEIPT" as const, dianStatus: "QUEUED" },
    ],
    outcome: null,
    responseDeadline: day("2026-11-25"),
  };
  assert.equal(eventBlocked(goods, "ACCEPTANCE", today, false), null);
  assert.equal(eventBlocked(goods, "CLAIM", today, false), null);
  assert.equal(isFinalized(goods, today), false);
  // Vencido el plazo: aceptación tácita.
  assert.match(eventBlocked(goods, "CLAIM", day("2026-11-26"), false)!, /tácita/);
  assert.equal(isFinalized(goods, day("2026-11-26")), true);
  // El último día del plazo todavía se puede.
  assert.equal(eventBlocked(goods, "ACCEPTANCE", day("2026-11-25"), false), null);

  const claimed = { ...goods, outcome: "CLAIM" as const };
  assert.match(eventBlocked(claimed, "ACCEPTANCE", today, false)!, /reclamada/);
  assert.equal(isFinalized(claimed, today), true);
});

test("validaciones", () => {
  const invoice = {
    cufe,
    supplierNit: "890100200",
    supplierName: "Proveedor SAS",
    number: "FE-1",
    issueDate: "2026-11-20",
  };
  assert.equal(registerReceivedInvoiceSchema.safeParse(invoice).success, true);
  assert.equal(registerReceivedInvoiceSchema.parse({ ...invoice, cufe: cufe.toUpperCase() }).cufe, cufe);
  assert.equal(registerReceivedInvoiceSchema.safeParse({ ...invoice, cufe: "abc" }).success, false);
  assert.equal(registerReceivedInvoiceSchema.safeParse({ ...invoice, supplierNit: "890.100.200-1" }).success, false);

  assert.equal(receivedInvoiceEventSchema.safeParse({ type: "RECEIPT" }).success, false);
  assert.equal(
    receivedInvoiceEventSchema.safeParse({
      type: "RECEIPT",
      receiverName: "Ana Pérez",
      receiverDocument: "1020304050",
      receiverRole: "Almacén",
    }).success,
    true
  );
  assert.equal(receivedInvoiceEventSchema.safeParse({ type: "CLAIM" }).success, false);
  assert.equal(receivedInvoiceEventSchema.safeParse({ type: "CLAIM", claimReason: "02" }).success, true);
  assert.equal(receivedInvoiceEventSchema.safeParse({ type: "ACCEPTANCE" }).success, true);
});
