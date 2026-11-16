import assert from "node:assert/strict";
import test from "node:test";
import { createDeliverySchema, deliveryQuerySchema } from "@betel/contracts";
import { deliveryNumber, deliveryWhere } from "../src/deliveries.js";

const uuid = "00000000-0000-4000-8000-000000000001";

test("número visible de la remisión", () => {
  assert.equal(deliveryNumber(4), "REM-4");
});

test("filtros por cliente, usuario, tipo y estado", () => {
  const where = deliveryWhere(
    deliveryQuerySchema.parse({ customer: "900", userId: uuid, transactionType: "CONSIGNMENT", status: "OPEN" })
  );
  assert.ok(where.customer);
  assert.equal(where.createdById, uuid);
  assert.equal(where.transactionType, "CONSIGNMENT");
  assert.equal(where.status, "OPEN");
});

test("estado del correo: enviados por id y sin enviar excluyéndolos", () => {
  const sent = deliveryWhere(deliveryQuerySchema.parse({ email: "SENT" }), ["a", "b"]);
  assert.deepEqual(sent.id, { in: ["a", "b"] });
  const unsent = deliveryWhere(deliveryQuerySchema.parse({ email: "UNSENT" }), ["a"]);
  assert.deepEqual(unsent.id, { notIn: ["a"] });
});

test("valida la remisión: tipo por defecto Venta, ítems obligatorios", () => {
  const line = { description: "Caja", quantity: 3, unitPrice: 1000 };
  const parsed = createDeliverySchema.parse({ customerId: uuid, issueDate: "2026-11-16", lines: [line] });
  assert.equal(parsed.transactionType, "SALE");
  assert.equal(createDeliverySchema.safeParse({ customerId: uuid, issueDate: "2026-11-16", lines: [] }).success, false);
  assert.equal(
    createDeliverySchema.safeParse({
      customerId: uuid,
      issueDate: "2026-11-16",
      transactionType: "LOAN",
      lines: [line],
    }).success,
    false
  );
});
