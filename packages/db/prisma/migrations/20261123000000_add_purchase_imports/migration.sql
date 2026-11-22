-- CreateEnum
CREATE TYPE "PurchaseImportStatus" AS ENUM ('PENDING', 'LEGALIZED', 'REJECTED');

-- CreateTable
CREATE TABLE "PurchaseImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cufe" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "supplierNit" TEXT NOT NULL,
    "supplierIdType" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE,
    "paymentTerm" "PaymentTerm" NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "taxTotal" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "lines" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "xml" TEXT NOT NULL,
    "status" "PurchaseImportStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "purchaseDocumentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseImport_purchaseDocumentId_key" ON "PurchaseImport"("purchaseDocumentId");

-- CreateIndex
CREATE INDEX "PurchaseImport_organizationId_issueDate_idx" ON "PurchaseImport"("organizationId", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseImport_organizationId_cufe_key" ON "PurchaseImport"("organizationId", "cufe");

-- AddForeignKey
ALTER TABLE "PurchaseImport" ADD CONSTRAINT "PurchaseImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseImport" ADD CONSTRAINT "PurchaseImport_purchaseDocumentId_fkey" FOREIGN KEY ("purchaseDocumentId") REFERENCES "PurchaseDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseImport" ADD CONSTRAINT "PurchaseImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Aislamiento por organización (RLS).
ALTER TABLE "PurchaseImport" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PurchaseImport" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation_purchase_import ON "PurchaseImport"; CREATE POLICY organization_isolation_purchase_import ON "PurchaseImport" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
