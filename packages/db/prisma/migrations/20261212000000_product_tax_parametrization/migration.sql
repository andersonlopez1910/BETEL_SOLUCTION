-- Parametrización tributaria del producto (costo y precio digitados y calculados) y fotografía tributaria del renglón.
-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "priceIncludesTax" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "saleTaxTreatment" TEXT,
ADD COLUMN     "unitAccountingCost" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "accountingCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "billingChannel" TEXT NOT NULL DEFAULT 'AMBOS',
ADD COLUMN     "category" TEXT,
ADD COLUMN     "costBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "costEntered" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "costIncludesVat" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "costTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "deductiblePct" DECIMAL(5,2) NOT NULL DEFAULT 100,
ADD COLUMN     "deductibleTreatment" TEXT NOT NULL DEFAULT 'DESCONTABLE_TOTAL',
ADD COLUMN     "finalPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "incRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "priceEntered" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "purchaseVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "purchaseVatRate" DECIMAL(5,2) NOT NULL DEFAULT 19,
ADD COLUMN     "purchaseVatTreatment" TEXT NOT NULL DEFAULT 'GRAVADO_19',
ADD COLUMN     "saleInc" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "saleTaxTreatment" TEXT NOT NULL DEFAULT 'IVA_19',
ADD COLUMN     "saleVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "unspscCode" TEXT,
ADD COLUMN     "vatDeductible" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vatNonDeductible" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProductInventoryConfig" ADD COLUMN     "expiryControl" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lotControl" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serialControl" BOOLEAN NOT NULL DEFAULT false;


-- Productos existentes: el precio guardado (unitPrice) es la base; se reconstruyen el valor digitado y los
-- impuestos con el tratamiento actual. Costo: el costo inicial del inventario, sin IVA.
UPDATE "Product" p SET
  "saleTaxTreatment" = CASE
    WHEN tc."appliesInc" THEN 'INC'
    WHEN p."taxTreatment" = 'EXEMPT' THEN 'IVA_EXENTO'
    WHEN p."taxTreatment" = 'EXCLUDED' THEN 'IVA_EXCLUIDO'
    WHEN p."taxTreatment" = 'OTHER' THEN 'NO_GRAVADO'
    WHEN p."taxRate" = 5 THEN 'IVA_5'
    ELSE 'IVA_19' END,
  "incRate" = CASE WHEN tc."appliesInc" THEN COALESCE(tc."incRate", 8) ELSE 0 END,
  "saleVat" = round(p."unitPrice" * (CASE WHEN p."taxTreatment" = 'TAXED' THEN p."taxRate" ELSE 0 END) / 100, 2),
  "saleInc" = round(p."unitPrice" * (CASE WHEN tc."appliesInc" THEN COALESCE(tc."incRate", 8) ELSE 0 END) / 100, 2)
FROM "Product" p2 LEFT JOIN "ProductTaxConfig" tc ON tc."productId" = p2.id
WHERE p2.id = p.id;
UPDATE "Product" SET
  "finalPrice" = "unitPrice" + "saleVat" + "saleInc",
  "priceEntered" = CASE WHEN "priceIncludesTaxes" THEN "unitPrice" + "saleVat" + "saleInc" ELSE "unitPrice" END;
UPDATE "Product" p SET
  "costEntered" = COALESCE(ic."initialCost", 0), "costBase" = COALESCE(ic."initialCost", 0),
  "costTotal" = COALESCE(ic."initialCost", 0), "accountingCost" = COALESCE(ic."initialCost", 0),
  "purchaseVatTreatment" = 'NO_GRAVADO', "purchaseVatRate" = 0
FROM "ProductInventoryConfig" ic WHERE ic."productId" = p.id;
UPDATE "Product" SET "billingChannel" = 'AMBOS';
