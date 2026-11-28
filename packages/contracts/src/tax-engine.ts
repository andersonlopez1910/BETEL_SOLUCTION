/**
 * MOTOR TRIBUTARIO ÚNICO de Betel Solution (IVA, INC, costo contable).
 *
 * Lo usan la API (productos, facturas, POS, importación, exportación, reportes, contabilidad) y la web (resumen en
 * tiempo real). No debe existir otro cálculo de IVA: si una pantalla o módulo necesita base, impuesto o total,
 * llama a estas funciones.
 *
 * Redondeo (política central):
 *   - Los cálculos intermedios se hacen con 4 decimales (r4); los valores que se guardan y muestran, con 2 (r2).
 *   - Cuando el valor INCLUYE impuestos, el total es exactamente el valor digitado y el impuesto es la diferencia
 *     (total − base): así base + impuestos = total, sin diferencias de $0,01.
 *   - Cuando NO los incluye, la base es el valor digitado y cada impuesto se redondea una vez; total = base + impuestos.
 *
 * Exento, excluido y no gravado tienen tarifa 0 % pero son códigos distintos (la DIAN los reporta distinto).
 */

const factor = (decimals: number) => 10 ** decimals;
/** Redondeo half-up a n decimales sin errores de punto flotante en los .5. */
export const roundTo = (value: number, decimals: number) =>
  Math.round((value + Math.sign(value) * Number.EPSILON) * factor(decimals)) / factor(decimals);
export const r4 = (value: number) => roundTo(value, 4);
export const r2 = (value: number) => roundTo(value, 2);

// ─── Catálogos ────────────────────────────────────────────────────────────────

/** IVA en compra (costo). */
export const PURCHASE_VAT_TREATMENTS = {
  GRAVADO_19: { label: "Gravado 19 %", rate: 19 },
  GRAVADO_5: { label: "Gravado 5 %", rate: 5 },
  EXENTO: { label: "Exento", rate: 0 },
  EXCLUIDO: { label: "Excluido", rate: 0 },
  NO_GRAVADO: { label: "No gravado", rate: 0 },
} as const;
export type PurchaseVatTreatment = keyof typeof PURCHASE_VAT_TREATMENTS;

/** Qué parte del IVA de la compra se puede descontar. */
export const DEDUCTIBLE_TREATMENTS = {
  DESCONTABLE_TOTAL: "100 % descontable",
  DESCONTABLE_PARCIAL: "Parcialmente descontable",
  NO_DESCONTABLE: "No descontable",
} as const;
export type DeductibleTreatment = keyof typeof DEDUCTIBLE_TREATMENTS;

/**
 * Tratamiento tributario de venta. `vatRate` es la tarifa de IVA; `inc` indica Impuesto Nacional al Consumo
 * (tarifa configurable, 8 % por defecto). `dian` es el tratamiento que se reporta en la factura electrónica.
 */
export const SALE_TAX_TREATMENTS = {
  IVA_19: { label: "Gravado IVA 19 %", vatRate: 19, inc: false, dian: "TAXED" },
  IVA_5: { label: "Gravado IVA 5 %", vatRate: 5, inc: false, dian: "TAXED" },
  IVA_EXENTO: { label: "Exento de IVA", vatRate: 0, inc: false, dian: "EXEMPT" },
  IVA_EXCLUIDO: { label: "Excluido de IVA", vatRate: 0, inc: false, dian: "EXCLUDED" },
  NO_GRAVADO: { label: "No gravado", vatRate: 0, inc: false, dian: "OTHER" },
  INC: { label: "Impuesto Nacional al Consumo", vatRate: 0, inc: true, dian: "OTHER" },
  SIN_IMPUESTO: { label: "Sin impuesto", vatRate: 0, inc: false, dian: "OTHER" },
} as const;
export type SaleTaxTreatment = keyof typeof SALE_TAX_TREATMENTS;
export const DEFAULT_INC_RATE = 8;

export const BILLING_CHANNELS = {
  FE: "Factura electrónica",
  POS: "POS",
  AMBOS: "Factura electrónica y POS",
  NO_FACTURABLE: "No facturable",
} as const;
export type BillingChannel = keyof typeof BILLING_CHANNELS;

/** Tratamiento de venta a partir del modelo anterior (TAXED/EXEMPT/EXCLUDED/OTHER + tarifa + INC). */
export function saleTreatmentFromLegacy(taxTreatment: string, vatRate: number, appliesInc = false): SaleTaxTreatment {
  if (appliesInc) return "INC";
  if (taxTreatment === "EXEMPT") return "IVA_EXENTO";
  if (taxTreatment === "EXCLUDED") return "IVA_EXCLUIDO";
  if (taxTreatment === "OTHER") return "NO_GRAVADO";
  return vatRate === 5 ? "IVA_5" : "IVA_19";
}

// ─── Costo (compra) ───────────────────────────────────────────────────────────

export type CostInput = {
  amount: number;
  includesVat: boolean;
  treatment: PurchaseVatTreatment;
  deductible: DeductibleTreatment;
  /** % del IVA que es descontable cuando `deductible` = DESCONTABLE_PARCIAL (0 a 100). */
  deductiblePct?: number;
};

export function computeCost(input: CostInput) {
  const rate = PURCHASE_VAT_TREATMENTS[input.treatment].rate;
  const entered = r2(input.amount);
  let base: number;
  let vat: number;
  if (input.includesVat) {
    base = r2(entered / (1 + rate / 100));
    vat = r2(entered - base);
  } else {
    base = entered;
    vat = r2(r4((base * rate) / 100));
  }
  const total = r2(base + vat);
  const pct =
    input.deductible === "DESCONTABLE_TOTAL"
      ? 100
      : input.deductible === "NO_DESCONTABLE"
        ? 0
        : (input.deductiblePct ?? 0);
  const vatDeductible = r2((vat * pct) / 100);
  const vatNonDeductible = r2(vat - vatDeductible);
  return {
    entered,
    includesVat: input.includesVat,
    treatment: input.treatment,
    rate,
    base,
    vat,
    total,
    deductiblePct: pct,
    vatDeductible,
    vatNonDeductible,
    /** Costo contable = base + IVA que no se puede descontar. */
    accountingCost: r2(base + vatNonDeductible),
  };
}

// ─── Precio de venta ──────────────────────────────────────────────────────────

export type SaleInput = {
  amount: number;
  includesTax: boolean;
  treatment: SaleTaxTreatment;
  /** Tarifa INC cuando el tratamiento es INC (por defecto 8 %). */
  incRate?: number;
};

/** Tarifas efectivas de IVA e INC de un tratamiento de venta. */
export function saleRates(treatment: SaleTaxTreatment, incRate?: number) {
  const config = SALE_TAX_TREATMENTS[treatment];
  return { vatRate: config.vatRate, incRate: config.inc ? (incRate ?? DEFAULT_INC_RATE) : 0 };
}

/**
 * Discrimina una cantidad en base, IVA e INC. Núcleo común de productos y renglones de factura.
 * `amount` incluye impuestos si `includesTax`; si no, es la base.
 */
export function splitTaxes(amount: number, includesTax: boolean, vatRate: number, incRate: number) {
  const value = r2(amount);
  if (includesTax) {
    const base = r2(value / (1 + (vatRate + incRate) / 100));
    const taxes = r2(value - base);
    // El IVA se calcula sobre la base; el INC recibe el resto, así la suma es exacta.
    const vat = incRate ? r2(r4((base * vatRate) / 100)) : taxes;
    const inc = r2(taxes - vat);
    return { base, vat, inc, total: value };
  }
  const vat = r2(r4((value * vatRate) / 100));
  const inc = r2(r4((value * incRate) / 100));
  return { base: value, vat, inc, total: r2(value + vat + inc) };
}

export function computeSale(input: SaleInput) {
  const { vatRate, incRate } = saleRates(input.treatment, input.incRate);
  const split = splitTaxes(input.amount, input.includesTax, vatRate, incRate);
  return {
    entered: r2(input.amount),
    includesTax: input.includesTax,
    treatment: input.treatment,
    vatRate,
    incRate,
    ...split,
  };
}

/** Utilidad y margen bruto unitarios: base de venta − costo contable. */
export function grossProfit(saleBase: number, accountingCost: number) {
  const profit = r2(saleBase - accountingCost);
  return { profit, margin: saleBase ? r2((profit / saleBase) * 100) : 0 };
}

// ─── Renglón de documento (factura electrónica, POS, cotización…) ────────────

export type LineInput = {
  quantity: number;
  /** Precio unitario tal como se digitó (con o sin impuestos según `includesTax`). */
  unitPrice: number;
  includesTax: boolean;
  vatRate: number;
  incRate?: number;
  discountType?: "PERCENTAGE" | "FIXED";
  /** % o valor; en valor se expresa en la misma forma que el precio (con o sin impuestos). */
  discountValue?: number;
};

/**
 * Secuencia: precio × cantidad − descuento = base antes de impuestos; luego IVA e INC.
 * Con precio con impuestos incluidos, el total del renglón es el valor digitado (menos el descuento) y los impuestos
 * se discriminan; nunca se suman otra vez.
 */
export function computeLine(input: LineInput) {
  const incRate = input.incRate ?? 0;
  const gross = r2(r4(input.quantity * input.unitPrice));
  const requested =
    input.discountType === "FIXED" ? (input.discountValue ?? 0) : r4((gross * (input.discountValue ?? 0)) / 100);
  const discount = r2(Math.min(gross, Math.max(0, requested)));
  const split = splitTaxes(r2(gross - discount), input.includesTax, input.vatRate, incRate);
  // Subtotal y descuento siempre expresados antes de impuestos (lo que muestra la factura).
  const grossBase = input.includesTax ? r2(gross / (1 + (input.vatRate + incRate) / 100)) : gross;
  return {
    entered: r2(input.unitPrice),
    includesTax: input.includesTax,
    grossBase,
    discountBase: r2(grossBase - split.base),
    base: split.base,
    vatRate: input.vatRate,
    vat: split.vat,
    incRate,
    inc: split.inc,
    total: split.total,
  };
}
