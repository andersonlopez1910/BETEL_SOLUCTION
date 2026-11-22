-- Compras y gastos: documentos de compra y gasto de proveedores. Generado con prisma migrate diff + RLS al final.

-- CreateEnum
CREATE TYPE "PurchaseType" AS ENUM ('PURCHASE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('ACTIVE', 'VOID');

-- CreateTable
CREATE TABLE "PurchaseDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "type" "PurchaseType" NOT NULL,
    "supplierInvoiceNumber" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE,
    "paymentTerm" "PaymentTerm" NOT NULL DEFAULT 'CASH',
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "subtotal" DECIMAL(18,2) NOT NULL,
    "discountTotal" DECIMAL(18,2) NOT NULL,
    "taxTotal" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "voidReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" TEXT NOT NULL,
    "purchaseDocumentId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "discountRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 19,
    "lineTotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseDocument_organizationId_issueDate_idx" ON "PurchaseDocument"("organizationId", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDocument_organizationId_number_key" ON "PurchaseDocument"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDocument_organizationId_supplierId_supplierInvoiceN_key" ON "PurchaseDocument"("organizationId", "supplierId", "supplierInvoiceNumber");

-- AddForeignKey
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_purchaseDocumentId_fkey" FOREIGN KEY ("purchaseDocumentId") REFERENCES "PurchaseDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Aislamiento por organización (RLS). Las líneas heredan el de su documento.
ALTER TABLE "PurchaseDocument" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PurchaseDocument" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseLine" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PurchaseLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation_purchase_document ON "PurchaseDocument"; CREATE POLICY organization_isolation_purchase_document ON "PurchaseDocument" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_purchase_line ON "PurchaseLine"; CREATE POLICY organization_isolation_purchase_line ON "PurchaseLine" USING (EXISTS (SELECT 1 FROM "PurchaseDocument" document WHERE document.id = "purchaseDocumentId")) WITH CHECK (EXISTS (SELECT 1 FROM "PurchaseDocument" document WHERE document.id = "purchaseDocumentId"));
