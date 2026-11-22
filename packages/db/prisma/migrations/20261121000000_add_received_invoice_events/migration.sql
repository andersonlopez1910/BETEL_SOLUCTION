-- CreateEnum
CREATE TYPE "ReceivedInvoiceEventType" AS ENUM ('RECEIPT', 'CLAIM', 'GOODS_RECEIPT', 'ACCEPTANCE');

-- CreateTable
CREATE TABLE "ReceivedInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cufe" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierNit" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "total" DECIMAL(18,2),
    "receiptAt" TIMESTAMP(3),
    "goodsReceiptAt" TIMESTAMP(3),
    "responseDeadline" DATE,
    "outcome" "ReceivedInvoiceEventType",
    "outcomeAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceivedInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivedInvoiceEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receivedInvoiceId" TEXT NOT NULL,
    "type" "ReceivedInvoiceEventType" NOT NULL,
    "dianStatus" TEXT NOT NULL,
    "claimReason" TEXT,
    "notes" TEXT,
    "receiverName" TEXT,
    "receiverDocument" TEXT,
    "receiverRole" TEXT,
    "providerResponse" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceivedInvoiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReceivedInvoice_organizationId_createdAt_idx" ON "ReceivedInvoice"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReceivedInvoice_organizationId_cufe_key" ON "ReceivedInvoice"("organizationId", "cufe");

-- CreateIndex
CREATE UNIQUE INDEX "ReceivedInvoiceEvent_receivedInvoiceId_type_key" ON "ReceivedInvoiceEvent"("receivedInvoiceId", "type");

-- AddForeignKey
ALTER TABLE "ReceivedInvoice" ADD CONSTRAINT "ReceivedInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivedInvoice" ADD CONSTRAINT "ReceivedInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivedInvoice" ADD CONSTRAINT "ReceivedInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivedInvoiceEvent" ADD CONSTRAINT "ReceivedInvoiceEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivedInvoiceEvent" ADD CONSTRAINT "ReceivedInvoiceEvent_receivedInvoiceId_fkey" FOREIGN KEY ("receivedInvoiceId") REFERENCES "ReceivedInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivedInvoiceEvent" ADD CONSTRAINT "ReceivedInvoiceEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Aislamiento por organización (RLS).
ALTER TABLE "ReceivedInvoice" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ReceivedInvoice" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ReceivedInvoiceEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ReceivedInvoiceEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation_received_invoice ON "ReceivedInvoice"; CREATE POLICY organization_isolation_received_invoice ON "ReceivedInvoice" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_received_invoice_event ON "ReceivedInvoiceEvent"; CREATE POLICY organization_isolation_received_invoice_event ON "ReceivedInvoiceEvent" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
