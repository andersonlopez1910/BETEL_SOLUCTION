-- Producto maestro ampliado: los datos comerciales se mantienen en Product y las reglas se separan
-- para que la factura y el motor contable interpreten configuración, no movimientos persistidos en el producto.
ALTER TABLE "Product"
  ADD COLUMN "gtin" TEXT,
  ADD COLUMN "niifNature" TEXT,
  ADD COLUMN "serviceNature" TEXT,
  ADD COLUMN "priceIncludesTaxes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "taxTreatment" TEXT NOT NULL DEFAULT 'TAXED';

CREATE TABLE "ProductTaxConfig" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "taxTreatment" TEXT NOT NULL,
  "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "appliesInc" BOOLEAN NOT NULL DEFAULT false,
  "incCode" TEXT,
  "incRate" DECIMAL(5,2),
  "withholdingHints" JSONB,
  "standardCodeType" TEXT,
  "standardCode" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductTaxConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductTaxConfig_productId_key" ON "ProductTaxConfig"("productId");
ALTER TABLE "ProductTaxConfig" ADD CONSTRAINT "ProductTaxConfig_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProductAccountingConfig" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "inventoryAccountId" TEXT,
  "incomeAccountId" TEXT,
  "costOfSalesAccountId" TEXT,
  "vatSalesAccountId" TEXT,
  "vatPurchaseAccountId" TEXT,
  "incAccountId" TEXT,
  "returnsAccountId" TEXT,
  "discountsAccountId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductAccountingConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductAccountingConfig_productId_key" ON "ProductAccountingConfig"("productId");
ALTER TABLE "ProductAccountingConfig" ADD CONSTRAINT "ProductAccountingConfig_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProductInventoryConfig" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "controlled" BOOLEAN NOT NULL DEFAULT false,
  "minimumStock" DECIMAL(18,4),
  "maximumStock" DECIMAL(18,4),
  "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false,
  "valuationMethod" TEXT,
  "initialCost" DECIMAL(18,2),
  "netRealizableValue" DECIMAL(18,2),
  "vnrEvaluatedAt" DATE,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductInventoryConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductInventoryConfig_productId_key" ON "ProductInventoryConfig"("productId");
ALTER TABLE "ProductInventoryConfig" ADD CONSTRAINT "ProductInventoryConfig_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProductPrice" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "includesTaxes" BOOLEAN NOT NULL DEFAULT false,
  "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductPrice_productId_validFrom_idx" ON "ProductPrice"("productId", "validFrom");
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: estas configuraciones heredan la empresa desde Product; ninguna acepta organizationId del cliente.
ALTER TABLE "ProductTaxConfig" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ProductTaxConfig" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProductAccountingConfig" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ProductAccountingConfig" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProductInventoryConfig" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ProductInventoryConfig" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProductPrice" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ProductPrice" FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation_product_tax ON "ProductTaxConfig" USING (EXISTS (SELECT 1 FROM "Product" p WHERE p.id = "productId")) WITH CHECK (EXISTS (SELECT 1 FROM "Product" p WHERE p.id = "productId"));
CREATE POLICY organization_isolation_product_accounting ON "ProductAccountingConfig" USING (EXISTS (SELECT 1 FROM "Product" p WHERE p.id = "productId")) WITH CHECK (EXISTS (SELECT 1 FROM "Product" p WHERE p.id = "productId"));
CREATE POLICY organization_isolation_product_inventory ON "ProductInventoryConfig" USING (EXISTS (SELECT 1 FROM "Product" p WHERE p.id = "productId")) WITH CHECK (EXISTS (SELECT 1 FROM "Product" p WHERE p.id = "productId"));
CREATE POLICY organization_isolation_product_price ON "ProductPrice" USING (EXISTS (SELECT 1 FROM "Product" p WHERE p.id = "productId")) WITH CHECK (EXISTS (SELECT 1 FROM "Product" p WHERE p.id = "productId"));
