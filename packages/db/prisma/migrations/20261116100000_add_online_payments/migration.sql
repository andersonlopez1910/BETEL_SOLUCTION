-- Gestión de cobro cartera Betel: pagos en línea por pasarela. Generado con prisma migrate diff + RLS al final.

-- CreateEnum
CREATE TYPE "OnlinePaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DisbursementStatus" AS ENUM ('PENDING', 'DISBURSED');

-- AlterEnum
ALTER TYPE "CollectionMethod" ADD VALUE 'ONLINE';

-- CreateTable
CREATE TABLE "OnlinePayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "fee" DECIMAL(18,2),
    "net" DECIMAL(18,2),
    "status" "OnlinePaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" TEXT,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "token" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "disbursementStatus" "DisbursementStatus",
    "disbursedAt" TIMESTAMP(3),
    "cashReceiptId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnlinePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnlinePayment_token_key" ON "OnlinePayment"("token");

-- CreateIndex
CREATE UNIQUE INDEX "OnlinePayment_cashReceiptId_key" ON "OnlinePayment"("cashReceiptId");

-- CreateIndex
CREATE INDEX "OnlinePayment_organizationId_createdAt_idx" ON "OnlinePayment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OnlinePayment_organizationId_status_idx" ON "OnlinePayment"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OnlinePayment_organizationId_number_key" ON "OnlinePayment"("organizationId", "number");

-- AddForeignKey
ALTER TABLE "OnlinePayment" ADD CONSTRAINT "OnlinePayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePayment" ADD CONSTRAINT "OnlinePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePayment" ADD CONSTRAINT "OnlinePayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlinePayment" ADD CONSTRAINT "OnlinePayment_cashReceiptId_fkey" FOREIGN KEY ("cashReceiptId") REFERENCES "CashReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Aislamiento por organización (RLS).
ALTER TABLE "OnlinePayment" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OnlinePayment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation_online_payment ON "OnlinePayment"; CREATE POLICY organization_isolation_online_payment ON "OnlinePayment" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
