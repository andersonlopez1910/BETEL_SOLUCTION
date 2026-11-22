-- Seguimiento comercial. Generado con prisma migrate diff + RLS al final.

-- CreateEnum
CREATE TYPE "CommercialTaskStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CommitmentType" AS ENUM ('CALL', 'MEETING', 'VISIT', 'EMAIL', 'SEND_QUOTE', 'FOLLOW_UP', 'OTHER');

-- CreateEnum
CREATE TYPE "SalesStage" AS ENUM ('PROSPECT', 'CONTACTED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "NegotiationProgress" AS ENUM ('NONE', 'INITIAL', 'INTERMEDIATE', 'ADVANCED', 'CLOSED');

-- CreateEnum
CREATE TYPE "LeadOrigin" AS ENUM ('REFERRAL', 'WEBSITE', 'SOCIAL', 'CALL', 'EVENT', 'CUSTOMER', 'OTHER');

-- CreateEnum
CREATE TYPE "CompanySize" AS ENUM ('MICRO', 'SMALL', 'MEDIUM', 'LARGE');

-- CreateTable
CREATE TABLE "CommercialTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "partyId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "commitment" "CommitmentType" NOT NULL,
    "dueDate" DATE,
    "stage" "SalesStage" NOT NULL DEFAULT 'PROSPECT',
    "progress" "NegotiationProgress" NOT NULL DEFAULT 'NONE',
    "probability" INTEGER NOT NULL DEFAULT 0,
    "expectedValue" DECIMAL(18,2),
    "origin" "LeadOrigin",
    "companyType" "CompanySize",
    "status" "CommercialTaskStatus" NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "completedAt" TIMESTAMP(3),
    "responsibleId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommercialTask_organizationId_createdAt_idx" ON "CommercialTask"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CommercialTask_organizationId_status_responsibleId_idx" ON "CommercialTask"("organizationId", "status", "responsibleId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialTask_organizationId_number_key" ON "CommercialTask"("organizationId", "number");

-- AddForeignKey
ALTER TABLE "CommercialTask" ADD CONSTRAINT "CommercialTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialTask" ADD CONSTRAINT "CommercialTask_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialTask" ADD CONSTRAINT "CommercialTask_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialTask" ADD CONSTRAINT "CommercialTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Aislamiento por organización (RLS).
ALTER TABLE "CommercialTask" ENABLE ROW LEVEL SECURITY; ALTER TABLE "CommercialTask" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation_commercial_task ON "CommercialTask"; CREATE POLICY organization_isolation_commercial_task ON "CommercialTask" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
