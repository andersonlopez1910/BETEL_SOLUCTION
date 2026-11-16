-- Recaudos: recibos de caja, sus aplicaciones a facturas y el registro de correos enviados.
-- Generado con prisma migrate diff; al final se agregan las políticas RLS (igual que enable_tenant_rls).

-- CreateEnum
CREATE TYPE "CollectionMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'CHECK', 'OTHER');

-- CreateEnum
CREATE TYPE "CashReceiptStatus" AS ENUM ('ACTIVE', 'VOID');

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "CashReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "method" "CollectionMethod" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "total" DECIMAL(18,2) NOT NULL,
    "status" "CashReceiptStatus" NOT NULL DEFAULT 'ACTIVE',
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashReceiptApplication" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "CashReceiptApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentEmail" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL,
    "error" TEXT,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashReceipt_organizationId_date_idx" ON "CashReceipt"("organizationId", "date");

-- CreateIndex
CREATE INDEX "CashReceipt_organizationId_customerId_idx" ON "CashReceipt"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CashReceipt_organizationId_number_key" ON "CashReceipt"("organizationId", "number");

-- CreateIndex
CREATE INDEX "CashReceiptApplication_invoiceId_idx" ON "CashReceiptApplication"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CashReceiptApplication_receiptId_invoiceId_key" ON "CashReceiptApplication"("receiptId", "invoiceId");

-- CreateIndex
CREATE INDEX "DocumentEmail_organizationId_documentType_documentId_idx" ON "DocumentEmail"("organizationId", "documentType", "documentId");

-- AddForeignKey
ALTER TABLE "CashReceipt" ADD CONSTRAINT "CashReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReceipt" ADD CONSTRAINT "CashReceipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReceipt" ADD CONSTRAINT "CashReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReceiptApplication" ADD CONSTRAINT "CashReceiptApplication_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "CashReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReceiptApplication" ADD CONSTRAINT "CashReceiptApplication_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEmail" ADD CONSTRAINT "DocumentEmail_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEmail" ADD CONSTRAINT "DocumentEmail_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Aislamiento por organización (RLS). Las aplicaciones heredan el aislamiento de su recibo.
ALTER TABLE "CashReceipt" ENABLE ROW LEVEL SECURITY; ALTER TABLE "CashReceipt" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CashReceiptApplication" ENABLE ROW LEVEL SECURITY; ALTER TABLE "CashReceiptApplication" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DocumentEmail" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DocumentEmail" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation_cash_receipt ON "CashReceipt"; CREATE POLICY organization_isolation_cash_receipt ON "CashReceipt" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_cash_receipt_application ON "CashReceiptApplication"; CREATE POLICY organization_isolation_cash_receipt_application ON "CashReceiptApplication" USING (EXISTS (SELECT 1 FROM "CashReceipt" receipt WHERE receipt.id = "receiptId")) WITH CHECK (EXISTS (SELECT 1 FROM "CashReceipt" receipt WHERE receipt.id = "receiptId"));
DROP POLICY IF EXISTS organization_isolation_document_email ON "DocumentEmail"; CREATE POLICY organization_isolation_document_email ON "DocumentEmail" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
