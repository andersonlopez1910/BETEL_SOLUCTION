CREATE TABLE "TaxCatalogItem" (
  "id" TEXT NOT NULL, "organizationId" TEXT, "code" TEXT NOT NULL, "fiscalCode" TEXT,
  "name" TEXT NOT NULL, "shortName" TEXT, "category" TEXT NOT NULL, "description" TEXT,
  "behavior" TEXT NOT NULL DEFAULT 'DOCUMENT_INCREASE', "increasesDocument" BOOLEAN NOT NULL DEFAULT true,
  "representsWithholding" BOOLEAN NOT NULL DEFAULT false, "calculationType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
  "requiresRate" BOOLEAN NOT NULL DEFAULT true, "requiresFixedValue" BOOLEAN NOT NULL DEFAULT false,
  "requiresMunicipality" BOOLEAN NOT NULL DEFAULT false, "requiresConfiguration" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true, "validFrom" TIMESTAMP(3), "validTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxCatalogItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "OrganizationTaxConfiguration" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "taxCatalogItemId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "rate" DECIMAL(8,4), "fixedValue" DECIMAL(18,2), "base" TEXT,
  "municipalityCode" TEXT, "accountReceivableId" TEXT, "accountPayableId" TEXT, "withholdingAccountId" TEXT,
  "validFrom" TIMESTAMP(3), "validTo" TIMESTAMP(3), "status" TEXT NOT NULL DEFAULT 'PENDING', "additionalConfig" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationTaxConfiguration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxCatalogItem_code_key" ON "TaxCatalogItem"("code");
CREATE INDEX "TaxCatalogItem_organizationId_active_idx" ON "TaxCatalogItem"("organizationId", "active");
CREATE INDEX "TaxCatalogItem_category_active_idx" ON "TaxCatalogItem"("category", "active");
CREATE UNIQUE INDEX "OrganizationTaxConfiguration_organizationId_taxCatalogItemId_key" ON "OrganizationTaxConfiguration"("organizationId", "taxCatalogItemId");
CREATE INDEX "OrganizationTaxConfiguration_organizationId_active_idx" ON "OrganizationTaxConfiguration"("organizationId", "active");
ALTER TABLE "TaxCatalogItem" ADD CONSTRAINT "TaxCatalogItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationTaxConfiguration" ADD CONSTRAINT "OrganizationTaxConfiguration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationTaxConfiguration" ADD CONSTRAINT "OrganizationTaxConfiguration_taxCatalogItemId_fkey" FOREIGN KEY ("taxCatalogItemId") REFERENCES "TaxCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
