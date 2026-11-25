-- Factura electrónica: snapshots de línea, totales fiscales y estructuras normalizadas extensibles.
ALTER TABLE "Invoice"
  ADD COLUMN "exchangeRate" DECIMAL(18,6),
  ADD COLUMN "paymentMethodCode" TEXT,
  ADD COLUMN "taxableBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "incTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "withholdingTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "estimatedNetReceivable" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "internalNotes" TEXT,
  ADD COLUMN "dianValidation" JSONB;

ALTER TABLE "InvoiceLine"
  ADD COLUMN "internalCode" TEXT,
  ADD COLUMN "unitCode" TEXT,
  ADD COLUMN "unitName" TEXT,
  ADD COLUMN "discountType" TEXT,
  ADD COLUMN "discountValue" DECIMAL(18,2),
  ADD COLUMN "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "discountReason" TEXT,
  ADD COLUMN "grossAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxableBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxTreatment" TEXT NOT NULL DEFAULT 'TAXED',
  ADD COLUMN "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "incRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "incAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "withholdingTotal" DECIMAL(18,2) NOT NULL DEFAULT 0;

CREATE TABLE "InvoiceLineTax" (
  "id" TEXT NOT NULL,
  "invoiceLineId" TEXT NOT NULL,
  "taxType" TEXT NOT NULL,
  "taxCode" TEXT NOT NULL,
  "taxableBase" DECIMAL(18,2) NOT NULL,
  "rate" DECIMAL(8,4) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  CONSTRAINT "InvoiceLineTax_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InvoiceLineTax_invoiceLineId_idx" ON "InvoiceLineTax"("invoiceLineId");
ALTER TABLE "InvoiceLineTax" ADD CONSTRAINT "InvoiceLineTax_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InvoiceLineWithholding" (
  "id" TEXT NOT NULL,
  "invoiceLineId" TEXT NOT NULL,
  "withholdingType" TEXT NOT NULL,
  "conceptCode" TEXT,
  "taxableBase" DECIMAL(18,2) NOT NULL,
  "rate" DECIMAL(8,4) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  CONSTRAINT "InvoiceLineWithholding_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InvoiceLineWithholding_invoiceLineId_idx" ON "InvoiceLineWithholding"("invoiceLineId");
ALTER TABLE "InvoiceLineWithholding" ADD CONSTRAINT "InvoiceLineWithholding_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceLineTax" ENABLE ROW LEVEL SECURITY; ALTER TABLE "InvoiceLineTax" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceLineWithholding" ENABLE ROW LEVEL SECURITY; ALTER TABLE "InvoiceLineWithholding" FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation_invoice_line_tax ON "InvoiceLineTax" USING (EXISTS (SELECT 1 FROM "InvoiceLine" l JOIN "Invoice" i ON i.id = l."invoiceId" WHERE l.id = "invoiceLineId")) WITH CHECK (EXISTS (SELECT 1 FROM "InvoiceLine" l JOIN "Invoice" i ON i.id = l."invoiceId" WHERE l.id = "invoiceLineId"));
CREATE POLICY organization_isolation_invoice_line_withholding ON "InvoiceLineWithholding" USING (EXISTS (SELECT 1 FROM "InvoiceLine" l JOIN "Invoice" i ON i.id = l."invoiceId" WHERE l.id = "invoiceLineId")) WITH CHECK (EXISTS (SELECT 1 FROM "InvoiceLine" l JOIN "Invoice" i ON i.id = l."invoiceId" WHERE l.id = "invoiceLineId"));
