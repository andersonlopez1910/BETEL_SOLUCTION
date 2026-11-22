-- Remisiones. Generado con prisma migrate diff + RLS al final.

-- CreateEnum
CREATE TYPE "DeliveryType" AS ENUM ('SALE', 'CONSIGNMENT', 'SAMPLE');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('OPEN', 'INVOICED', 'VOID');

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "transactionType" "DeliveryType" NOT NULL DEFAULT 'SALE',
    "issueDate" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "subtotal" DECIMAL(18,2) NOT NULL,
    "discountTotal" DECIMAL(18,2) NOT NULL,
    "taxTotal" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'OPEN',
    "voidReason" TEXT,
    "invoiceId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryLine" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "discountRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 19,
    "lineTotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "DeliveryLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_invoiceId_key" ON "Delivery"("invoiceId");

-- CreateIndex
CREATE INDEX "Delivery_organizationId_issueDate_idx" ON "Delivery"("organizationId", "issueDate");

-- CreateIndex
CREATE INDEX "Delivery_organizationId_createdById_idx" ON "Delivery"("organizationId", "createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_organizationId_number_key" ON "Delivery"("organizationId", "number");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Aislamiento por organización (RLS). Las líneas heredan el de su remisión.
ALTER TABLE "Delivery" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Delivery" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryLine" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DeliveryLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation_delivery ON "Delivery"; CREATE POLICY organization_isolation_delivery ON "Delivery" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_delivery_line ON "DeliveryLine"; CREATE POLICY organization_isolation_delivery_line ON "DeliveryLine" USING (EXISTS (SELECT 1 FROM "Delivery" delivery WHERE delivery.id = "deliveryId")) WITH CHECK (EXISTS (SELECT 1 FROM "Delivery" delivery WHERE delivery.id = "deliveryId"));
