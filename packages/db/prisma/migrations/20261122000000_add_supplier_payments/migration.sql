-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
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

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPaymentApplication" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "purchaseDocumentId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "SupplierPaymentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierPayment_organizationId_date_idx" ON "SupplierPayment"("organizationId", "date");

-- CreateIndex
CREATE INDEX "SupplierPayment_organizationId_supplierId_idx" ON "SupplierPayment"("organizationId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_organizationId_number_key" ON "SupplierPayment"("organizationId", "number");

-- CreateIndex
CREATE INDEX "SupplierPaymentApplication_purchaseDocumentId_idx" ON "SupplierPaymentApplication"("purchaseDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPaymentApplication_paymentId_purchaseDocumentId_key" ON "SupplierPaymentApplication"("paymentId", "purchaseDocumentId");

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentApplication" ADD CONSTRAINT "SupplierPaymentApplication_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "SupplierPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentApplication" ADD CONSTRAINT "SupplierPaymentApplication_purchaseDocumentId_fkey" FOREIGN KEY ("purchaseDocumentId") REFERENCES "PurchaseDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Aislamiento por organización (RLS). Las aplicaciones heredan el de su comprobante.
ALTER TABLE "SupplierPayment" ENABLE ROW LEVEL SECURITY; ALTER TABLE "SupplierPayment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SupplierPaymentApplication" ENABLE ROW LEVEL SECURITY; ALTER TABLE "SupplierPaymentApplication" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation_supplier_payment ON "SupplierPayment"; CREATE POLICY organization_isolation_supplier_payment ON "SupplierPayment" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_supplier_payment_application ON "SupplierPaymentApplication"; CREATE POLICY organization_isolation_supplier_payment_application ON "SupplierPaymentApplication" USING (EXISTS (SELECT 1 FROM "SupplierPayment" payment WHERE payment.id = "paymentId")) WITH CHECK (EXISTS (SELECT 1 FROM "SupplierPayment" payment WHERE payment.id = "paymentId"));
