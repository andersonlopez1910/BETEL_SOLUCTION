ALTER TABLE "OrganizationTaxConfiguration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrganizationTaxConfiguration" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_isolation_tax_configuration ON "OrganizationTaxConfiguration";
CREATE POLICY organization_isolation_tax_configuration ON "OrganizationTaxConfiguration"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
