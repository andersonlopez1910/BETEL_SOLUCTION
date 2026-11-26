-- AIU (Administración, Imprevistos, Utilidad) en la factura de venta. Sin tablas nuevas: Invoice ya tiene RLS.
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "aiuAdministration" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "aiuAdministrationRate" DECIMAL(5,2),
ADD COLUMN     "aiuContingency" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "aiuContingencyRate" DECIMAL(5,2),
ADD COLUMN     "aiuIcaBase" TEXT,
ADD COLUMN     "aiuModel" TEXT,
ADD COLUMN     "aiuProfit" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "aiuProfitRate" DECIMAL(5,2),
ADD COLUMN     "aiuVatBase" TEXT,
ADD COLUMN     "aiuWithholdingBase" TEXT;

