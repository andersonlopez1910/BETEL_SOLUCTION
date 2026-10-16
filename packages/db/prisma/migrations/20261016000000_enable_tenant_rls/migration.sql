-- withOrganizationScope() define app.organization_id para cada transacción.

ALTER TABLE "Party" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Party" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SupportDocument" ENABLE ROW LEVEL SECURITY; ALTER TABLE "SupportDocument" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CalendarEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "CalendarEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Account" FORCE ROW LEVEL SECURITY;
ALTER TABLE "JournalEntry" ENABLE ROW LEVEL SECURITY; ALTER TABLE "JournalEntry" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LegalDocument" ENABLE ROW LEVEL SECURITY; ALTER TABLE "LegalDocument" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY; ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PartyContact" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PartyContact" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceLine" ENABLE ROW LEVEL SECURITY; ALTER TABLE "InvoiceLine" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SupportDocumentLine" ENABLE ROW LEVEL SECURITY; ALTER TABLE "SupportDocumentLine" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ElectronicEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ElectronicEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "JournalLine" ENABLE ROW LEVEL SECURITY; ALTER TABLE "JournalLine" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_isolation_party ON "Party"; CREATE POLICY organization_isolation_party ON "Party" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_product ON "Product"; CREATE POLICY organization_isolation_product ON "Product" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_invoice ON "Invoice"; CREATE POLICY organization_isolation_invoice ON "Invoice" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_support_document ON "SupportDocument"; CREATE POLICY organization_isolation_support_document ON "SupportDocument" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_calendar_event ON "CalendarEvent"; CREATE POLICY organization_isolation_calendar_event ON "CalendarEvent" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_notification ON "Notification"; CREATE POLICY organization_isolation_notification ON "Notification" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_account ON "Account"; CREATE POLICY organization_isolation_account ON "Account" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_journal_entry ON "JournalEntry"; CREATE POLICY organization_isolation_journal_entry ON "JournalEntry" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_subscription ON "Subscription"; CREATE POLICY organization_isolation_subscription ON "Subscription" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_legal_document ON "LegalDocument"; CREATE POLICY organization_isolation_legal_document ON "LegalDocument" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_audit_log ON "AuditLog"; CREATE POLICY organization_isolation_audit_log ON "AuditLog" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_party_contact ON "PartyContact"; CREATE POLICY organization_isolation_party_contact ON "PartyContact" USING (EXISTS (SELECT 1 FROM "Party" party WHERE party.id = "partyId")) WITH CHECK (EXISTS (SELECT 1 FROM "Party" party WHERE party.id = "partyId"));
DROP POLICY IF EXISTS organization_isolation_invoice_line ON "InvoiceLine"; CREATE POLICY organization_isolation_invoice_line ON "InvoiceLine" USING (EXISTS (SELECT 1 FROM "Invoice" invoice WHERE invoice.id = "invoiceId")) WITH CHECK (EXISTS (SELECT 1 FROM "Invoice" invoice WHERE invoice.id = "invoiceId"));
DROP POLICY IF EXISTS organization_isolation_support_line ON "SupportDocumentLine"; CREATE POLICY organization_isolation_support_line ON "SupportDocumentLine" USING (EXISTS (SELECT 1 FROM "SupportDocument" document WHERE document.id = "supportDocumentId")) WITH CHECK (EXISTS (SELECT 1 FROM "SupportDocument" document WHERE document.id = "supportDocumentId"));
DROP POLICY IF EXISTS organization_isolation_electronic_event ON "ElectronicEvent"; CREATE POLICY organization_isolation_electronic_event ON "ElectronicEvent" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_journal_line ON "JournalLine"; CREATE POLICY organization_isolation_journal_line ON "JournalLine" USING (EXISTS (SELECT 1 FROM "JournalEntry" entry WHERE entry.id = "journalEntryId")) WITH CHECK (EXISTS (SELECT 1 FROM "JournalEntry" entry WHERE entry.id = "journalEntryId"));
