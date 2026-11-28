-- Documento equivalente POS: resolución DIAN de la numeración, WhatsApp y mensaje de la tirilla; referencia del pedido.
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "orderReference" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "posPrefix" TEXT NOT NULL DEFAULT 'POS',
ADD COLUMN     "posRangeFrom" INTEGER,
ADD COLUMN     "posRangeTo" INTEGER,
ADD COLUMN     "posResolutionDate" DATE,
ADD COLUMN     "posResolutionNumber" TEXT,
ADD COLUMN     "posValidityMonths" INTEGER,
ADD COLUMN     "receiptFooter" TEXT,
ADD COLUMN     "whatsapp" TEXT;

