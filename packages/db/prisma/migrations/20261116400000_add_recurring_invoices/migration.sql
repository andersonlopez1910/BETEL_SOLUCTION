-- Facturas recurrentes. Generado con prisma migrate diff + RLS al final.

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL');

-- CreateTable
CREATE TABLE "RecurringInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "startDate" DATE NOT NULL,
    "occurrences" INTEGER,
    "generatedCount" INTEGER NOT NULL DEFAULT 0,
    "periodIndex" INTEGER NOT NULL DEFAULT 0,
    "nextRunDate" DATE,
    "lastRunAt" TIMESTAMP(3),
    "paymentTerm" "PaymentTerm" NOT NULL DEFAULT 'CASH',
    "dueDays" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "subtotal" DECIMAL(18,2) NOT NULL,
    "discountTotal" DECIMAL(18,2) NOT NULL,
    "taxTotal" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringInvoiceLine" (
    "id" TEXT NOT NULL,
    "recurringInvoiceId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "discountRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 19,
    "lineTotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "RecurringInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringInvoiceRun" (
    "id" TEXT NOT NULL,
    "recurringInvoiceId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "periodDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringInvoiceRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringInvoice_organizationId_startDate_idx" ON "RecurringInvoice"("organizationId", "startDate");

-- CreateIndex
CREATE INDEX "RecurringInvoice_active_nextRunDate_idx" ON "RecurringInvoice"("active", "nextRunDate");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringInvoice_organizationId_number_key" ON "RecurringInvoice"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringInvoiceRun_invoiceId_key" ON "RecurringInvoiceRun"("invoiceId");

-- CreateIndex
CREATE INDEX "RecurringInvoiceRun_recurringInvoiceId_idx" ON "RecurringInvoiceRun"("recurringInvoiceId");

-- AddForeignKey
ALTER TABLE "RecurringInvoice" ADD CONSTRAINT "RecurringInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoice" ADD CONSTRAINT "RecurringInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoice" ADD CONSTRAINT "RecurringInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceLine" ADD CONSTRAINT "RecurringInvoiceLine_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "RecurringInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceLine" ADD CONSTRAINT "RecurringInvoiceLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceRun" ADD CONSTRAINT "RecurringInvoiceRun_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "RecurringInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceRun" ADD CONSTRAINT "RecurringInvoiceRun_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Aislamiento por organización (RLS). Líneas y ejecuciones heredan el de su plantilla.
ALTER TABLE "RecurringInvoice" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RecurringInvoice" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RecurringInvoiceLine" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RecurringInvoiceLine" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RecurringInvoiceRun" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RecurringInvoiceRun" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation_recurring_invoice ON "RecurringInvoice"; CREATE POLICY organization_isolation_recurring_invoice ON "RecurringInvoice" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_RecurringInvoiceLine ON "RecurringInvoiceLine"; CREATE POLICY organization_isolation_RecurringInvoiceLine ON "RecurringInvoiceLine" USING (EXISTS (SELECT 1 FROM "RecurringInvoice" template WHERE template.id = "recurringInvoiceId")) WITH CHECK (EXISTS (SELECT 1 FROM "RecurringInvoice" template WHERE template.id = "recurringInvoiceId"));
DROP POLICY IF EXISTS organization_isolation_RecurringInvoiceRun ON "RecurringInvoiceRun"; CREATE POLICY organization_isolation_RecurringInvoiceRun ON "RecurringInvoiceRun" USING (EXISTS (SELECT 1 FROM "RecurringInvoice" template WHERE template.id = "recurringInvoiceId")) WITH CHECK (EXISTS (SELECT 1 FROM "RecurringInvoice" template WHERE template.id = "recurringInvoiceId"));
