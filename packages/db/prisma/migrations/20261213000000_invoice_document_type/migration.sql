-- Tipo de documento de venta: FE (factura electrónica) o POS (documento equivalente electrónico POS).
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "documentType" TEXT NOT NULL DEFAULT 'FE';

ALTER TYPE "ElectronicDocumentKind" ADD VALUE IF NOT EXISTS 'POS_EQUIVALENT';
