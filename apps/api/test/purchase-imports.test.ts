import assert from "node:assert/strict";
import test from "node:test";
import { addressedTo, totalsWarning } from "../src/purchase-imports.js";
import { parseElectronicInvoice, parseXml } from "../src/ubl.js";
import { attachedDocument, ublInvoice } from "./fixtures/ubl-invoice.js";

test("lee una factura electrónica UBL 2.1", () => {
  const invoice = parseElectronicInvoice(ublInvoice());
  assert.equal(invoice.cufe.length, 96);
  assert.equal(invoice.number, "SETP990000123");
  assert.equal(invoice.issueDate, "2026-11-18");
  assert.equal(invoice.dueDate, "2026-12-18");
  assert.equal(invoice.paymentTerm, "CREDIT");
  assert.deepEqual(invoice.supplier, { nit: "900373115", idType: "NIT", name: "Suministros Industriales & Cía SAS" });
  assert.equal(invoice.customerNit, "900999778");
  assert.equal(invoice.lines.length, 2);
  // Casco: 2 × 50.000 con valor 90.000 → 10 % de descuento.
  assert.deepEqual(invoice.lines[1], {
    description: "Casco de seguridad",
    quantity: 2,
    unitPrice: 50000,
    discountRate: 10,
    taxRate: 19,
    total: 107100,
  });
  assert.equal(invoice.subtotal, 340000);
  assert.equal(invoice.taxTotal, 64600);
  assert.equal(invoice.total, 404600);
  assert.deepEqual(invoice.warnings, []);
  assert.equal(totalsWarning(invoice.lines, invoice.total), null);
});

test("lee el AttachedDocument que envía el proveedor", () => {
  const invoice = parseElectronicInvoice(attachedDocument(ublInvoice({ seed: 2, credit: false, dueDate: null })));
  assert.equal(invoice.paymentTerm, "CASH");
  assert.equal(invoice.dueDate, null);
  assert.equal(invoice.total, 404600);
});

test("advertencias que impiden legalizar", () => {
  const inc = parseElectronicInvoice(
    ublInvoice({ lines: [{ description: "Almuerzo", quantity: 1, price: 100000, iva: 0, otherTax: 8000 }] })
  );
  assert.ok(inc.warnings.some(warning => warning.blocking && /INC/.test(warning.message)));
  // El total trae el INC que Betel no suma: también descuadra.
  assert.ok(totalsWarning(inc.lines, inc.total)?.blocking);

  const usd = parseElectronicInvoice(ublInvoice({ currency: "USD" }));
  assert.ok(usd.warnings.some(warning => warning.blocking && /USD/.test(warning.message)));

  const withholding = parseElectronicInvoice(ublInvoice({ withholding: true }));
  assert.ok(withholding.warnings.some(warning => !warning.blocking && /retenciones/.test(warning.message)));

  const noDue = parseElectronicInvoice(ublInvoice({ dueDate: null }));
  assert.ok(noDue.warnings.some(warning => !warning.blocking && /vencimiento/.test(warning.message)));
});

test("rechaza archivos que no son facturas o son peligrosos", () => {
  assert.throws(() => parseElectronicInvoice("hola"), /mal formado|no es una factura/);
  assert.throws(() => parseElectronicInvoice("<CreditNote><ID>1</ID></CreditNote>"), /nota crédito/);
  assert.throws(
    () =>
      parseElectronicInvoice(
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><Invoice>&a;</Invoice>'
      ),
    /DOCTYPE/
  );
  assert.throws(
    () => parseElectronicInvoice(ublInvoice().replace(/<cbc:UUID[^>]*>[0-9a-f]+/, "<cbc:UUID>123")),
    /CUFE/
  );
  assert.throws(() => parseElectronicInvoice("<Invoice><a></b></Invoice>"), /mal formado/);
});

test("lector XML: atributos, entidades y CDATA", () => {
  const node = parseXml(
    `<a:root x="1" b:y='dos &amp; tres'><c>&lt;ok&gt; &#65;&#x42;</c><d><![CDATA[<raw>]]></d><e/></a:root>`
  );
  assert.equal(node.name, "root");
  assert.deepEqual(node.attrs, { x: "1", y: "dos & tres" });
  assert.equal(node.children[0]!.text, "<ok> AB");
  assert.equal(node.children[1]!.text, "<raw>");
  assert.equal(node.children[2]!.name, "e");
});

test("la factura debe ir dirigida a la organización", () => {
  assert.equal(addressedTo("900999778", { nit: "900999778", verificationDigit: "1" }), true);
  assert.equal(addressedTo("9009997781", { nit: "900999778", verificationDigit: "1" }), true);
  assert.equal(addressedTo("800111222", { nit: "900999778", verificationDigit: "1" }), false);
});
