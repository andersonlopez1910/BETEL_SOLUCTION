-- CreateTable
CREATE TABLE "CostingRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "executedAt" TIMESTAMP(3) NOT NULL,
    "executedById" TEXT,
    "productCount" INTEGER NOT NULL,
    "costOfSales" DECIMAL(18,2) NOT NULL,
    "closingValue" DECIMAL(18,2) NOT NULL,
    "negativeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostingLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "openingQty" DECIMAL(18,4) NOT NULL,
    "openingValue" DECIMAL(18,2) NOT NULL,
    "inQty" DECIMAL(18,4) NOT NULL,
    "inValue" DECIMAL(18,2) NOT NULL,
    "salesQty" DECIMAL(18,4) NOT NULL,
    "salesCost" DECIMAL(18,2) NOT NULL,
    "adjustOutQty" DECIMAL(18,4) NOT NULL,
    "adjustOutValue" DECIMAL(18,2) NOT NULL,
    "closingQty" DECIMAL(18,4) NOT NULL,
    "closingValue" DECIMAL(18,2) NOT NULL,
    "averageCost" DECIMAL(18,4) NOT NULL,
    "negative" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CostingLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CostingRun_organizationId_year_month_key" ON "CostingRun"("organizationId", "year", "month");

-- CreateIndex
CREATE INDEX "CostingLine_productId_idx" ON "CostingLine"("productId");

-- AddForeignKey
ALTER TABLE "CostingRun" ADD CONSTRAINT "CostingRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingRun" ADD CONSTRAINT "CostingRun_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLine" ADD CONSTRAINT "CostingLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CostingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLine" ADD CONSTRAINT "CostingLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Aislamiento por organización (RLS). Los renglones heredan el de su ejecución.
ALTER TABLE "CostingRun" ENABLE ROW LEVEL SECURITY; ALTER TABLE "CostingRun" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CostingLine" ENABLE ROW LEVEL SECURITY; ALTER TABLE "CostingLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation_costing_run ON "CostingRun"; CREATE POLICY organization_isolation_costing_run ON "CostingRun" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_costing_line ON "CostingLine"; CREATE POLICY organization_isolation_costing_line ON "CostingLine" USING (EXISTS (SELECT 1 FROM "CostingRun" run WHERE run.id = "runId")) WITH CHECK (EXISTS (SELECT 1 FROM "CostingRun" run WHERE run.id = "runId"));
