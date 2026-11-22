-- CreateTable
CREATE TABLE "JournalTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JournalTemplate_organizationId_name_key" ON "JournalTemplate"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "JournalTemplate" ADD CONSTRAINT "JournalTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Aislamiento por organización (RLS).
ALTER TABLE "JournalTemplate" ENABLE ROW LEVEL SECURITY; ALTER TABLE "JournalTemplate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation_journal_template ON "JournalTemplate"; CREATE POLICY organization_isolation_journal_template ON "JournalTemplate" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
