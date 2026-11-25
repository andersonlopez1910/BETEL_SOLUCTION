import assert from "node:assert/strict";
import test from "node:test";
import { generateInvoicePdf } from "../src/invoice-pdf.js";

const decimal = (value: number) => ({ toFixed: (digits: number) => value.toFixed(digits) });

test("la representación de una factura en proceso conserva encabezado y totales alineados", () => {
  const pdf = generateInvoicePdf(
    {
      legalName: "Organización de desarrollo Betel",
      nit: "900999001",
      verificationDigit: "1",
      address: "Bogotá D.C.",
      email: "demo@betel.local",
    },
    {
      legalName: "Cliente de prueba",
      identificationType: "NIT",
      identificationNumber: "901220840",
      address: "Bogotá D.C.",
      email: "cliente@ejemplo.co",
    },
    {
      number: null,
      prefix: "FE-",
      issueDate: new Date("2026-11-22T12:00:00Z"),
      dueDate: null,
      paymentTerm: "CASH",
      paymentMethodCode: "42",
      subtotal: decimal(16806.72),
      discountTotal: decimal(0),
      taxableBase: decimal(16806.72),
      taxTotal: decimal(3193.28),
      incTotal: decimal(0),
      total: decimal(20000),
      notes: null,
      dianStatus: "PENDING",
      cufe: null,
      lines: [
        {
          description: "Servicio de prueba",
          quantity: decimal(1),
          unitName: null,
          unitPrice: decimal(16806.72),
          discountAmount: decimal(0),
          taxRate: decimal(19),
          lineTotal: decimal(20000),
        },
      ],
    }
  ).toString("latin1");

  assert.match(pdf, /FACTURA EN PROCESO/);
  assert.match(pdf, /Estado\) Tj ET/);
  assert.match(pdf, /Total a pagar/);
  assert.match(pdf, /Subtotal/);
  assert.match(pdf, /Descuentos/);
  assert.match(pdf, /IVA/);
});

test("la representación incorpora el logo documental de la organización", () => {
  // JPEG mínimo con marcador SOF0 de 1 × 1; basta para comprobar que se crea el XObject del PDF.
  const logoData = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 1, 0, 1, 3, 0xff, 0xd9]).toString("base64")}`;
  const pdf = generateInvoicePdf(
    { legalName: "Logo SAS", nit: "900999001", verificationDigit: "1", address: null, email: null, logoData },
    { legalName: "Cliente", identificationType: "NIT", identificationNumber: "901220840", address: null, email: null },
    {
      number: "1",
      prefix: "FE-",
      issueDate: new Date("2026-11-22T12:00:00Z"),
      dueDate: null,
      paymentTerm: "CASH",
      paymentMethodCode: null,
      subtotal: decimal(1),
      discountTotal: decimal(0),
      taxableBase: decimal(1),
      taxTotal: decimal(0),
      incTotal: decimal(0),
      total: decimal(1),
      notes: null,
      dianStatus: "PENDING",
      cufe: null,
      lines: [
        {
          description: "Servicio",
          quantity: decimal(1),
          unitName: null,
          unitPrice: decimal(1),
          discountAmount: decimal(0),
          taxRate: decimal(0),
          lineTotal: decimal(1),
        },
      ],
    }
  ).toString("latin1");

  assert.match(pdf, /\/XObject << \/Logo 7 0 R >>/);
  assert.match(pdf, /\/Subtype \/Image/);
});
