-- Estado del cliente (activo/inactivo) para la pestaña Clientes del reporte de facturación.

-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

