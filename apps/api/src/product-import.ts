/**
 * Importación masiva de productos y servicios (Excel o CSV) con VISTA PREVIA.
 *
 * analyzeImport(rows, context) valida cada fila y calcula sus valores con el MOTOR TRIBUTARIO ÚNICO (el mismo de la
 * creación manual), sin escribir nada. La ruta de importación vuelve a analizar en el servidor e importa solo las
 * filas sin error. Las fórmulas del archivo no se usan: se leen solo los valores.
 *
 * Columnas (encabezados sin importar tildes ni mayúsculas): Nombre, Código, Código de barras, Categoría, Tipo, Unidad,
 * UNSPSC, Inventariable, Cantidad inicial, Costo unitario, IVA incluido costo, Tratamiento IVA compra, Tarifa IVA
 * compra, Tratamiento IVA descontable, Porcentaje IVA descontable, Precio de venta, Impuesto incluido venta,
 * Tratamiento tributario venta, Tarifa IVA venta, Tarifa INC, Canal de facturación, Descripción.
 * La plantilla anterior (Nombre, Código, Tipo, Unidad, Precio sin IVA, IVA, Descripción) se sigue aceptando.
 */
import {
  BILLING_CHANNELS,
  computeCost,
  computeSale,
  DEDUCTIBLE_TREATMENTS,
  grossProfit,
  PURCHASE_VAT_TREATMENTS,
  SALE_TAX_TREATMENTS,
  type BillingChannel,
  type DeductibleTreatment,
  type PurchaseVatTreatment,
  type SaleTaxTreatment,
} from "@betel/contracts";

export const IMPORT_COLUMNS = [
  "Nombre",
  "Código",
  "Código de barras",
  "Categoría",
  "Tipo",
  "Unidad",
  "UNSPSC",
  "Inventariable",
  "Cantidad inicial",
  "Costo unitario",
  "IVA incluido costo",
  "Tratamiento IVA compra",
  "Tarifa IVA compra",
  "Tratamiento IVA descontable",
  "Porcentaje IVA descontable",
  "Precio de venta",
  "Impuesto incluido venta",
  "Tratamiento tributario venta",
  "Tarifa IVA venta",
  "Tarifa INC",
  "Canal de facturación",
  "Descripción",
] as const;

const UNITS: Record<string, string> = {
  unidad: "UND",
  und: "UND",
  servicio: "SERV",
  serv: "SERV",
  kilogramo: "KG",
  kg: "KG",
  metro: "M",
  m: "M",
  litro: "LT",
  lt: "LT",
  caja: "CJ",
  cj: "CJ",
  hora: "HR",
  hr: "HR",
  galon: "GL",
  gl: "GL",
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();

/** Valor de la primera columna presente (por nombre normalizado). */
function picker(row: Record<string, unknown>) {
  const byKey = new Map(Object.entries(row).map(([key, value]) => [normalize(key), value]));
  return (...names: string[]) => {
    for (const name of names) {
      const value = byKey.get(normalize(name));
      if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
    }
    return "";
  };
}

/** Acepta 1.234,56 · 1,234.56 · 1234.56 · $ 5.500 (el punto con 3 decimales es separador de miles). */
export function parseAmount(value: string) {
  const clean = value.replace(/[^\d.,-]/g, "");
  if (!clean) return NaN;
  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  const decimal = lastComma > lastDot ? "," : ".";
  const thousands = decimal === "," ? "." : ",";
  const decimals = clean.length - Math.max(lastComma, lastDot) - 1;
  if (decimal === "." && lastComma < 0 && decimals === 3 && clean.split(".").length === 2)
    return Number(clean.replace(".", ""));
  return Number(clean.split(thousands).join("").replace(decimal, "."));
}

const yesNo = (value: string) => {
  const text = normalize(value);
  if (!text) return undefined;
  if (["si", "s", "yes", "true", "1", "x"].includes(text)) return true;
  if (["no", "n", "false", "0"].includes(text)) return false;
  return null; // valor inválido
};
const code = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

export type ImportStatus = "OK" | "WARNING" | "ERROR";
export type ImportedRow = {
  row: number;
  status: ImportStatus;
  messages: string[];
  name: string;
  sku: string | null;
  kind: "PRODUCT" | "SERVICE";
  /** Valores calculados por el motor (para la vista previa). */
  values: {
    cost: number;
    costBase: number;
    purchaseVat: number;
    accountingCost: number;
    price: number;
    priceBase: number;
    saleVat: number;
    saleInc: number;
    finalPrice: number;
    margin: number;
  };
  /** Cuerpo listo para productSchema (solo si no hay errores). */
  payload?: Record<string, unknown>;
};

export function analyzeImport(
  rows: Record<string, unknown>[],
  context: { existingCodes: Set<string>; existingBarcodes: Set<string> }
): ImportedRow[] {
  const codesInFile = new Map<string, number>();
  const barcodesInFile = new Map<string, number>();
  return rows.map((raw, index) => {
    const rowNumber = index + 2; // fila 1 = encabezados
    const get = picker(raw);
    const errors: string[] = [];
    const warnings: string[] = [];
    const name = get("nombre", "name", "producto", "producto o servicio");
    if (name.length < 2) errors.push("El nombre es obligatorio (mínimo 2 caracteres).");

    const kindText = normalize(get("tipo", "type", "kind"));
    const kind: "PRODUCT" | "SERVICE" = ["servicio", "service"].includes(kindText) ? "SERVICE" : "PRODUCT";
    if (kindText && !["producto", "product", "servicio", "service"].includes(kindText))
      errors.push("Tipo inválido: use PRODUCTO o SERVICIO.");

    const sku = get("codigo", "code", "sku", "referencia", "codigo interno") || null;
    if (sku) {
      const key = sku.toLowerCase();
      if (context.existingCodes.has(key)) errors.push(`El código ${sku} ya existe en Betel.`);
      else if (codesInFile.has(key))
        errors.push(`El código ${sku} está repetido en el archivo (fila ${codesInFile.get(key)}).`);
      codesInFile.set(key, rowNumber);
    }
    const barcode = get("codigo de barras", "barcode", "gtin", "ean") || null;
    if (barcode) {
      if (context.existingBarcodes.has(barcode))
        warnings.push(`El código de barras ${barcode} ya está en otro producto.`);
      else if (barcodesInFile.has(barcode))
        warnings.push(`El código de barras ${barcode} se repite en el archivo (fila ${barcodesInFile.get(barcode)}).`);
      barcodesInFile.set(barcode, rowNumber);
    }

    const unitText = get("unidad", "unidad de medida", "unit");
    const unit = unitText
      ? (UNITS[normalize(unitText)] ?? unitText.toUpperCase().slice(0, 10))
      : kind === "SERVICE"
        ? "SERV"
        : "";

    const inventoryText = get("inventariable");
    const inventory = yesNo(inventoryText);
    if (inventory === null) errors.push("Inventariable debe ser SI o NO.");
    if (kind === "SERVICE" && inventory) errors.push("Servicio marcado como inventariable.");
    if (inventory && !unitText) errors.push("Un producto inventariable requiere unidad de medida.");
    const quantityText = get("cantidad inicial");
    const initialQuantity = quantityText ? parseAmount(quantityText) : 0;
    if (quantityText && (!Number.isFinite(initialQuantity) || initialQuantity < 0))
      errors.push("Cantidad inicial inválida.");
    if (initialQuantity > 0 && !inventory) errors.push("La cantidad inicial requiere Inventariable = SI.");

    // ─── Costo ───
    const costText = get("costo unitario", "costo");
    const costAmount = costText ? parseAmount(costText) : 0;
    if (costText && (!Number.isFinite(costAmount) || costAmount < 0)) errors.push("Costo unitario inválido.");
    const costIncludesVat = yesNo(get("iva incluido costo"));
    if (costIncludesVat === null) errors.push("IVA incluido costo debe ser SI o NO.");
    let purchaseTreatment = code(get("tratamiento iva compra")) as PurchaseVatTreatment | "";
    const purchaseRateText = get("tarifa iva compra");
    if (purchaseTreatment && !(purchaseTreatment in PURCHASE_VAT_TREATMENTS)) {
      errors.push(`Tratamiento IVA compra inválido: use ${Object.keys(PURCHASE_VAT_TREATMENTS).join(", ")}.`);
      purchaseTreatment = "";
    }
    if (!purchaseTreatment && purchaseRateText) {
      const rate = parseAmount(purchaseRateText);
      if (rate === 19) purchaseTreatment = "GRAVADO_19";
      else if (rate === 5) purchaseTreatment = "GRAVADO_5";
      else errors.push("Tarifa de compra 0 %: indique si es EXENTO, EXCLUIDO o NO_GRAVADO.");
    }
    if (costIncludesVat && !purchaseTreatment)
      errors.push("Costo con IVA incluido pero no se indicó el tratamiento de IVA en compra.");
    if (
      purchaseTreatment &&
      purchaseRateText &&
      parseAmount(purchaseRateText) !== PURCHASE_VAT_TREATMENTS[purchaseTreatment].rate
    )
      errors.push(
        `La tarifa IVA compra debe ser ${PURCHASE_VAT_TREATMENTS[purchaseTreatment].rate} para ${purchaseTreatment}.`
      );
    let deductible = (code(get("tratamiento iva descontable")) || "DESCONTABLE_TOTAL") as DeductibleTreatment;
    if (!(deductible in DEDUCTIBLE_TREATMENTS)) {
      errors.push(`Tratamiento IVA descontable inválido: use ${Object.keys(DEDUCTIBLE_TREATMENTS).join(", ")}.`);
      deductible = "DESCONTABLE_TOTAL";
    }
    const deductibleText = get("porcentaje iva descontable");
    const deductiblePct = deductibleText ? parseAmount(deductibleText.replace("%", "")) : undefined;
    if (
      deductible === "DESCONTABLE_PARCIAL" &&
      (deductiblePct === undefined || !(deductiblePct >= 0 && deductiblePct <= 100))
    )
      errors.push("IVA parcialmente descontable requiere un porcentaje entre 0 y 100.");

    // ─── Venta ───
    const legacy = !get("precio de venta") && !!get("precio", "precio sin iva", "valor", "price");
    const priceText = get("precio de venta", "precio", "precio sin iva", "valor", "price");
    const price = parseAmount(priceText);
    if (!priceText || !Number.isFinite(price) || price < 0) errors.push("Precio de venta inválido o vacío.");
    const includesTax = legacy ? false : yesNo(get("impuesto incluido venta", "iva incluido venta"));
    if (includesTax === null) errors.push("Impuesto incluido venta debe ser SI o NO.");
    let saleTreatment = code(get("tratamiento tributario venta", "tratamiento venta")) as SaleTaxTreatment | "";
    const saleRateText = get("tarifa iva venta", "iva", "iva %", "impuesto", "tax");
    if (saleTreatment && !(saleTreatment in SALE_TAX_TREATMENTS)) {
      errors.push(`Tratamiento tributario venta inválido: use ${Object.keys(SALE_TAX_TREATMENTS).join(", ")}.`);
      saleTreatment = "";
    }
    if (!saleTreatment && saleRateText) {
      const rate = parseAmount(saleRateText.replace("%", ""));
      if (rate === 19) saleTreatment = "IVA_19";
      else if (rate === 5) saleTreatment = "IVA_5";
      else if (rate === 0 && legacy)
        saleTreatment = "IVA_EXENTO"; // plantilla anterior: 0 % = exento
      else if (rate === 0)
        errors.push("Tarifa de venta 0 %: indique si es IVA_EXENTO, IVA_EXCLUIDO, NO_GRAVADO o SIN_IMPUESTO.");
      else errors.push("Tarifa IVA venta inválida (19, 5 o 0).");
    }
    if (!saleTreatment && !saleRateText && legacy) saleTreatment = "IVA_19";
    if (includesTax && !saleTreatment)
      errors.push("Precio configurado con IVA incluido pero no se indicó la tarifa de IVA.");
    if (!saleTreatment && !includesTax && !errors.some(message => message.includes("venta")))
      errors.push("Indique el tratamiento tributario de venta.");
    if (saleTreatment && saleRateText && !SALE_TAX_TREATMENTS[saleTreatment].inc) {
      const expected = SALE_TAX_TREATMENTS[saleTreatment].vatRate;
      if (parseAmount(saleRateText.replace("%", "")) !== expected)
        errors.push(`La tarifa IVA venta debe ser ${expected} para ${saleTreatment}.`);
    }
    const incText = get("tarifa inc");
    const incRate = incText ? parseAmount(incText.replace("%", "")) : undefined;
    if (incText && !(incRate! >= 0 && incRate! <= 100)) errors.push("Tarifa INC inválida.");

    let channel = (code(get("canal de facturacion", "canal")) || "AMBOS") as BillingChannel;
    if (!(channel in BILLING_CHANNELS)) {
      errors.push(`Canal de facturación inválido: use ${Object.keys(BILLING_CHANNELS).join(", ")}.`);
      channel = "AMBOS";
    }

    // ─── Cálculo (motor único) ───
    const cost = computeCost({
      amount: Number.isFinite(costAmount) ? costAmount : 0,
      includesVat: !!costIncludesVat,
      treatment: purchaseTreatment || "NO_GRAVADO",
      deductible,
      deductiblePct,
    });
    const sale = computeSale({
      amount: Number.isFinite(price) ? price : 0,
      includesTax: !!includesTax,
      treatment: saleTreatment || "SIN_IMPUESTO",
      incRate,
    });
    const profit = grossProfit(sale.base, cost.accountingCost);
    if (costAmount > 0 && sale.base < cost.accountingCost) warnings.push("Precio de venta inferior al costo contable.");

    const status: ImportStatus = errors.length ? "ERROR" : warnings.length ? "WARNING" : "OK";
    return {
      row: rowNumber,
      status,
      messages: [...errors, ...warnings],
      name,
      sku,
      kind,
      values: {
        cost: cost.entered,
        costBase: cost.base,
        purchaseVat: cost.vat,
        accountingCost: cost.accountingCost,
        price: sale.entered,
        priceBase: sale.base,
        saleVat: sale.vat,
        saleInc: sale.inc,
        finalPrice: sale.total,
        margin: profit.margin,
      },
      payload: errors.length
        ? undefined
        : {
            kind,
            sku: sku ?? undefined,
            name,
            description: get("descripcion", "description") || undefined,
            unit: unit || "UND",
            gtin: barcode ?? undefined,
            category: get("categoria", "category") || undefined,
            unspscCode: get("unspsc", "codigo unspsc") || undefined,
            billingChannel: channel,
            unitPrice: sale.base,
            cost:
              costAmount > 0 || purchaseTreatment
                ? {
                    amount: cost.entered,
                    includesVat: !!costIncludesVat,
                    treatment: cost.treatment,
                    deductible,
                    deductiblePct,
                  }
                : undefined,
            sale: {
              amount: sale.entered,
              includesTax: !!includesTax,
              treatment: sale.treatment,
              incRate: sale.incRate || undefined,
            },
            initialQuantity: initialQuantity > 0 ? initialQuantity : undefined,
            inventoryConfig: {
              controlled: !!inventory,
              valuationMethod: inventory ? "WEIGHTED_AVERAGE" : undefined,
              initialCost: costAmount > 0 ? cost.accountingCost : undefined,
            },
          },
    };
  });
}
