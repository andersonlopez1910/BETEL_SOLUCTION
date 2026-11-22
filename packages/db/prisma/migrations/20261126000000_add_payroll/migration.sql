-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('INDEFINITE', 'FIXED', 'WORK');

-- CreateEnum
CREATE TYPE "SalaryType" AS ENUM ('ORDINARY', 'INTEGRAL');

-- CreateEnum
CREATE TYPE "PayFrequency" AS ENUM ('BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "PayrollSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "minimumWage" DECIMAL(18,2) NOT NULL,
    "transportAllowance" DECIMAL(18,2) NOT NULL,
    "monthlyHours" INTEGER NOT NULL,
    "overtimeDayPct" DECIMAL(6,2) NOT NULL,
    "overtimeNightPct" DECIMAL(6,2) NOT NULL,
    "nightSurchargePct" DECIMAL(6,2) NOT NULL,
    "holidaySurchargePct" DECIMAL(6,2) NOT NULL,
    "healthEmployeePct" DECIMAL(6,2) NOT NULL,
    "pensionEmployeePct" DECIMAL(6,2) NOT NULL,
    "healthEmployerPct" DECIMAL(6,2) NOT NULL,
    "pensionEmployerPct" DECIMAL(6,2) NOT NULL,
    "compensationFundPct" DECIMAL(6,2) NOT NULL,
    "icbfPct" DECIMAL(6,2) NOT NULL,
    "senaPct" DECIMAL(6,2) NOT NULL,
    "exempt" BOOLEAN NOT NULL DEFAULT true,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "identificationType" TEXT NOT NULL,
    "identificationNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "position" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "contractType" "ContractType" NOT NULL,
    "salaryType" "SalaryType" NOT NULL DEFAULT 'ORDINARY',
    "salary" DECIMAL(18,2) NOT NULL,
    "frequency" "PayFrequency" NOT NULL DEFAULT 'MONTHLY',
    "riskClass" INTEGER NOT NULL DEFAULT 1,
    "healthFund" TEXT NOT NULL,
    "pensionFund" TEXT NOT NULL,
    "severanceFund" TEXT,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "frequency" "PayFrequency" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "totalEarnings" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employerCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "paidAt" DATE,
    "paymentMethod" "CollectionMethod",
    "voidReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "overtimeDay" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "overtimeNight" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "nightHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "holidayHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "salaryBonus" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "nonSalaryBonus" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "withholding" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otherDeductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "earnings" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employerCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "calculation" JSONB NOT NULL,

    CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollElectronic" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "earnings" DECIMAL(18,2) NOT NULL,
    "deductions" DECIMAL(18,2) NOT NULL,
    "netPay" DECIMAL(18,2) NOT NULL,
    "runCount" INTEGER NOT NULL,
    "dianStatus" TEXT NOT NULL,
    "providerResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollElectronic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSettings_organizationId_year_key" ON "PayrollSettings"("organizationId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_organizationId_identificationType_identificationNu_key" ON "Employee"("organizationId", "identificationType", "identificationNumber");

-- CreateIndex
CREATE INDEX "PayrollRun_organizationId_periodEnd_idx" ON "PayrollRun"("organizationId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_organizationId_number_key" ON "PayrollRun"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollItem_runId_employeeId_key" ON "PayrollItem"("runId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollElectronic_organizationId_employeeId_year_month_key" ON "PayrollElectronic"("organizationId", "employeeId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollElectronic_organizationId_number_key" ON "PayrollElectronic"("organizationId", "number");

-- AddForeignKey
ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollElectronic" ADD CONSTRAINT "PayrollElectronic_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollElectronic" ADD CONSTRAINT "PayrollElectronic_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Aislamiento por organización (RLS). Los renglones heredan el de su liquidación.
ALTER TABLE "PayrollSettings" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PayrollSettings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Employee" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PayrollRun" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PayrollRun" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PayrollItem" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PayrollItem" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PayrollElectronic" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PayrollElectronic" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation_payroll_settings ON "PayrollSettings"; CREATE POLICY organization_isolation_payroll_settings ON "PayrollSettings" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_employee ON "Employee"; CREATE POLICY organization_isolation_employee ON "Employee" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_payroll_run ON "PayrollRun"; CREATE POLICY organization_isolation_payroll_run ON "PayrollRun" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
DROP POLICY IF EXISTS organization_isolation_payroll_item ON "PayrollItem"; CREATE POLICY organization_isolation_payroll_item ON "PayrollItem" USING (EXISTS (SELECT 1 FROM "PayrollRun" run WHERE run.id = "runId")) WITH CHECK (EXISTS (SELECT 1 FROM "PayrollRun" run WHERE run.id = "runId"));
DROP POLICY IF EXISTS organization_isolation_payroll_electronic ON "PayrollElectronic"; CREATE POLICY organization_isolation_payroll_electronic ON "PayrollElectronic" USING ("organizationId" = current_setting('app.organization_id', true)) WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
