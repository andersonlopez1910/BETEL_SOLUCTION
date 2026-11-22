/**
 * Factura electrónica UBL 2.1 de ejemplo (estructura del anexo técnico DIAN) para las pruebas de "Soporte por
 * legalizar". Los valores son de prueba; el CUFE se genera a partir de `seed` para que sea único.
 */
export type FixtureOptions = {
  seed?: number;
  number?: string;
  supplierNit?: string;
  supplierName?: string;
  customerNit?: string;
  issueDate?: string;
  dueDate?: string | null;
  credit?: boolean;
  currency?: string;
  /** Ítems: cantidad, precio, valor del ítem (con descuento), % IVA. */
  lines?: {
    description: string;
    quantity: number;
    price: number;
    lineTotal?: number;
    iva: number;
    otherTax?: number;
  }[];
  withholding?: boolean;
};

const hex = (seed: number) =>
  Array.from({ length: 96 }, (_, i) => ((i * 13 + seed * 7 + (i >> 2)) % 16).toString(16)).join("");

export function ublInvoice(options: FixtureOptions = {}) {
  const {
    seed = 1,
    number = "SETP990000123",
    supplierNit = "900373115",
    supplierName = "Suministros Industriales &amp; Cía SAS",
    customerNit = "900999778",
    issueDate = "2026-11-18",
    dueDate = "2026-12-18",
    credit = true,
    currency = "COP",
    lines = [
      { description: "Guantes de nitrilo x 100", quantity: 10, price: 25000, iva: 19 },
      { description: "Casco de seguridad", quantity: 2, price: 50000, lineTotal: 90000, iva: 19 },
    ],
    withholding = false,
  } = options;
  const subtotal = lines.reduce((sum, line) => sum + (line.lineTotal ?? line.quantity * line.price), 0);
  const tax = lines.reduce((sum, line) => sum + ((line.lineTotal ?? line.quantity * line.price) * line.iva) / 100, 0);
  const other = lines.reduce((sum, line) => sum + (line.otherTax ?? 0), 0);
  const total = subtotal + tax + other;
  const party = (nit: string, name: string) => `<cac:Party>
      <cac:PartyName><cbc:Name>${name}</cbc:Name></cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>${name}</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeID="9" schemeName="31">${nit}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Factura de prueba -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>
  <cbc:ID>${number}</cbc:ID>
  <cbc:UUID schemeID="2" schemeName="CUFE-SHA384">${hex(seed)}</cbc:UUID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>10:15:00-05:00</cbc:IssueTime>
  ${dueDate ? `<cbc:DueDate>${dueDate}</cbc:DueDate>` : ""}
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode listAgencyID="6">${currency}</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${lines.length}</cbc:LineCountNumeric>
  <cac:AccountingSupplierParty><cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>${party(supplierNit, supplierName)}</cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>${party(customerNit, "Organización compradora")}</cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:ID>${credit ? 2 : 1}</cbc:ID><cbc:PaymentMeansCode>10</cbc:PaymentMeansCode></cac:PaymentMeans>
  <cac:TaxTotal><cbc:TaxAmount currencyID="${currency}">${tax.toFixed(2)}</cbc:TaxAmount></cac:TaxTotal>
  ${withholding ? `<cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="COP">${(subtotal * 0.025).toFixed(2)}</cbc:TaxAmount></cac:WithholdingTaxTotal>` : ""}
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${subtotal.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${subtotal.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${total.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${total.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lines
    .map((line, index) => {
      const lineTotal = line.lineTotal ?? line.quantity * line.price;
      return `<cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="94">${line.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${lineTotal.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${currency}">${((lineTotal * line.iva) / 100).toFixed(2)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${currency}">${lineTotal.toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${currency}">${((lineTotal * line.iva) / 100).toFixed(2)}</cbc:TaxAmount>
        <cac:TaxCategory><cbc:Percent>${line.iva.toFixed(2)}</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme></cac:TaxCategory>
      </cac:TaxSubtotal>
      ${
        line.otherTax
          ? `<cac:TaxSubtotal><cbc:TaxAmount currencyID="${currency}">${line.otherTax.toFixed(2)}</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>8.00</cbc:Percent><cac:TaxScheme><cbc:ID>04</cbc:ID><cbc:Name>INC</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`
          : ""
      }
    </cac:TaxTotal>
    <cac:Item><cbc:Description>${line.description}</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${currency}">${line.price.toFixed(2)}</cbc:PriceAmount><cbc:BaseQuantity unitCode="94">1</cbc:BaseQuantity></cac:Price>
  </cac:InvoiceLine>`;
    })
    .join("\n  ")}
</Invoice>`;
}

/** Contenedor que envían los proveedores por correo: la factura va en CDATA dentro de AttachedDocument. */
export function attachedDocument(invoiceXml: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<AttachedDocument xmlns="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:ID>AD-1</cbc:ID>
  <cac:Attachment>
    <cac:ExternalReference>
      <cbc:MimeCode>text/xml</cbc:MimeCode>
      <cbc:EncodingCode>UTF-8</cbc:EncodingCode>
      <cbc:Description><![CDATA[${invoiceXml}]]></cbc:Description>
    </cac:ExternalReference>
  </cac:Attachment>
</AttachedDocument>`;
}
