-- CreateEnum
CREATE TYPE "InventoryDocumentType" AS ENUM ('INITIAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "InventoryDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "InventoryDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "InventoryDocumentType" NOT NULL,
    "number" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "partyId" TEXT,
    "notes" TEXT,
    "total" DECIMAL(18,2) NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "voidReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLine" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "direction" "InventoryDirection" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "InventoryLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryDocument_organizationId_date_idx" ON "InventoryDocument"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryDocument_organizationId_type_number_key" ON "InventoryDocument"("organizationId", "type", "number");

-- CreateIndex
CREATE INDEX "InventoryLine_productId_idx" ON "InventoryLine"("productId");

-- AddForeignKey
ALTER TABLE "InventoryDocument" ADD CONSTRAINT "InventoryDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryDocument" ADD CONSTRAINT "InventoryDocument_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryDocument" ADD CONSTRAINT "InventoryDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLine" ADD CONSTRAINT "InventoryLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "InventoryDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLine" ADD CONSTRAINT "InventoryLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Aislamiento por organización (RLS). Los renglones heredan el de su documento.
ALTER TABLE "InventoryDocument" ENABLE ROW LEVEL SECURITY; ALTER TABLE "InventoryDocument" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InventoryLine" ENABLE ROW LEVEL SECURITY; ALTER TABLE "InventoryLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation_inventory_document ON "InventoryDocument"; CREATE POLICY organization_isolation_inventory_document ON "InventoryDocument" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_inventory_line ON "InventoryLine"; CREATE POLICY organization_isolation_inventory_line ON "InventoryLine" USING (EXISTS (SELECT 1 FROM "InventoryDocument" document WHERE document.id = "documentId")) WITH CHECK (EXISTS (SELECT 1 FROM "InventoryDocument" document WHERE document.id = "documentId"));
