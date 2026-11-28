-- Costeo automático (kárdex permanente): modo por organización, costo vigente por producto y costo por renglón.
-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "costTotal" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "costingAutomaticFrom" DATE,
ADD COLUMN     "costingMode" TEXT NOT NULL DEFAULT 'MONTHLY';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "averageCost" DECIMAL(18,4) NOT NULL DEFAULT 0;


-- El costo vigente parte del costo contable del maestro hasta el primer recálculo del kárdex.
UPDATE "Product" SET "averageCost" = "accountingCost";
