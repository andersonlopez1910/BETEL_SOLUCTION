-- Cotizaciones. Generado con prisma migrate diff + RLS al final.

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('OPEN', 'INVOICED', 'VOID');

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "issueDate" DATE NOT NULL,
    "validUntil" DATE,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "subtotal" DECIMAL(18,2) NOT NULL,
    "discountTotal" DECIMAL(18,2) NOT NULL,
    "taxTotal" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'OPEN',
    "voidReason" TEXT,
    "invoiceId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "discountRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 19,
    "lineTotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_invoiceId_key" ON "Quote"("invoiceId");

-- CreateIndex
CREATE INDEX "Quote_organizationId_issueDate_idx" ON "Quote"("organizationId", "issueDate");

-- CreateIndex
CREATE INDEX "Quote_organizationId_createdById_idx" ON "Quote"("organizationId", "createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_organizationId_number_key" ON "Quote"("organizationId", "number");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Aislamiento por organización (RLS). Las líneas heredan el de su cotización.
ALTER TABLE "Quote" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Quote" FORCE ROW LEVEL SECURITY;
ALTER TABLE "QuoteLine" ENABLE ROW LEVEL SECURITY; ALTER TABLE "QuoteLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation_quote ON "Quote"; CREATE POLICY organization_isolation_quote ON "Quote" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_quote_line ON "QuoteLine"; CREATE POLICY organization_isolation_quote_line ON "QuoteLine" USING (EXISTS (SELECT 1 FROM "Quote" quote WHERE quote.id = "quoteId")) WITH CHECK (EXISTS (SELECT 1 FROM "Quote" quote WHERE quote.id = "quoteId"));
