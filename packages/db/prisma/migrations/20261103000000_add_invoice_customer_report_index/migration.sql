-- Reporte de facturación por cliente: agrupa facturas por customerId dentro de un período.
CREATE INDEX IF NOT EXISTS "Invoice_organizationId_customerId_issueDate_idx"
  ON "Invoice" ("organizationId", "customerId", "issueDate");
