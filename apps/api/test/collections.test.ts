import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@betel/db";
import { collectionReportQuerySchema, createCashReceiptSchema, sendDocumentEmailSchema } from "@betel/contracts";
import {
  applyToBalances,
  documentEmail,
  invoiceNumber,
  mergeByDateDesc,
  methodAccount,
  receiptNumber,
} from "../src/collections.js";

const D = (value: string) => new Prisma.Decimal(value);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("el recibo suma los valores aplicados con Decimal", () => {
  const result = applyToBalances(
    [
      { invoiceId: "a", amount: 0.1 },
      { invoiceId: "b", amount: 0.2 },
    ],
    new Map([
      ["a", D("100")],
      ["b", D("100")],
    ])
  );
  assert.ok("total" in result);
  assert.equal(result.total.toFixed(2), "0.30"); // Con Number sería 0.30000000000000004
});

test("no se puede abonar más que el saldo de la factura", () => {
  const result = applyToBalances([{ invoiceId: "a", amount: 50000.01 }], new Map([["a", D("50000.00")]]));
  assert.ok("error" in result);
  assert.match(result.error, /supera el saldo/);
});

test("abonar exactamente el saldo es válido", () => {
  const result = applyToBalances([{ invoiceId: "a", amount: 59500.6 }], new Map([["a", D("59500.60")]]));
  assert.ok("total" in result);
  assert.equal(result.total.toFixed(2), "59500.60");
});

test("no se puede abonar a una factura que no está pendiente (contado, pagada u otro cliente)", () => {
  const result = applyToBalances([{ invoiceId: "otra", amount: 10 }], new Map([["a", D("100")]]));
  assert.ok("error" in result);
});

test("mezcla facturas y recibos por fecha descendente y respeta la ventana", () => {
  const row = (id: string, date: string, createdAt = "2026-01-01T00:00:00Z") => ({ id, date, createdAt });
  const invoices = [row("f3", "2026-11-15"), row("f1", "2026-11-10")];
  const receipts = [row("r2", "2026-11-12"), row("r0", "2026-11-01")];
  assert.deepEqual(
    mergeByDateDesc(invoices, receipts, 0, 10).map(item => item.id),
    ["f3", "r2", "f1", "r0"]
  );
  assert.deepEqual(
    mergeByDateDesc(invoices, receipts, 1, 2).map(item => item.id),
    ["r2", "f1"]
  );
});

test("el mismo día ordena por hora de creación", () => {
  const a = { id: "a", date: "2026-11-15", createdAt: "2026-11-15T10:00:00Z" };
  const b = { id: "b", date: "2026-11-15", createdAt: "2026-11-15T11:00:00Z" };
  assert.deepEqual(
    mergeByDateDesc([a], [b], 0, 2).map(item => item.id),
    ["b", "a"]
  );
});

test("efectivo va a Caja y los demás medios a Bancos", () => {
  assert.equal(methodAccount("CASH"), "110505");
  assert.equal(methodAccount("BANK_TRANSFER"), "111005");
  assert.equal(methodAccount("CARD"), "111005");
});

test("números visibles de recibos y facturas", () => {
  assert.equal(receiptNumber(7), "RC-7");
  assert.equal(invoiceNumber({ prefix: "FV-", number: "1044" }), "FV-1044");
  assert.equal(invoiceNumber({ prefix: null, number: null }), "Sin numerar");
});

test("valida el recibo: valores positivos, dos decimales y sin facturas repetidas", () => {
  const base = { customerId: uuid(1), date: "2026-11-16", method: "CASH" };
  assert.equal(
    createCashReceiptSchema.safeParse({ ...base, applications: [{ invoiceId: uuid(2), amount: "1000.50" }] }).success,
    true
  );
  assert.equal(createCashReceiptSchema.safeParse({ ...base, applications: [] }).success, false);
  assert.equal(
    createCashReceiptSchema.safeParse({ ...base, applications: [{ invoiceId: uuid(2), amount: 0 }] }).success,
    false
  );
  assert.equal(
    createCashReceiptSchema.safeParse({ ...base, applications: [{ invoiceId: uuid(2), amount: 1.234 }] }).success,
    false
  );
  assert.equal(
    createCashReceiptSchema.safeParse({
      ...base,
      applications: [
        { invoiceId: uuid(2), amount: 1 },
        { invoiceId: uuid(2), amount: 2 },
      ],
    }).success,
    false
  );
});

test("valida filtros de Recaudos y envío de correo", () => {
  assert.equal(collectionReportQuerySchema.safeParse({ from: "2026-11-20", to: "2026-11-01" }).success, false);
  assert.equal(collectionReportQuerySchema.safeParse({ email: "SENT", method: "CARD" }).success, true);
  assert.equal(collectionReportQuerySchema.safeParse({ method: "BITCOIN" }).success, false);
  assert.equal(
    sendDocumentEmailSchema.safeParse({ documentType: "CashReceipt", documentId: uuid(1), to: "no-es-correo" }).success,
    false
  );
});

test("el correo escapa el HTML de los datos del cliente", () => {
  const email = documentEmail(
    {
      type: "CashReceipt",
      id: uuid(1),
      number: "RC-1",
      title: "Recibo de caja",
      date: "2026-11-16",
      status: "ACTIVE",
      customer: {
        id: uuid(2),
        legalName: "<script>alert(1)</script>",
        identificationType: "NIT",
        identificationNumber: "900",
        email: null,
      },
      total: "1000.00",
      method: "Efectivo",
      reference: null,
      notes: null,
      voidReason: null,
      createdBy: null,
      lines: [{ description: "Abono", quantity: null, unitPrice: null, taxRate: null, total: "1000.00" }],
      totals: [{ label: "Total recibido", value: "1000.00" }],
    },
    "Empresa"
  );
  assert.ok(!email.html.includes("<script>"));
  assert.ok(email.html.includes("&lt;script&gt;"));
  assert.equal(email.subject, "Recibo de caja RC-1 — Empresa");
});
