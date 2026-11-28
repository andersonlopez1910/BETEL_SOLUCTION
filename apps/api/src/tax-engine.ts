/**
 * Motor tributario de facturas de venta. El cálculo de cada renglón (base, descuento, IVA, INC y total, con o sin
 * impuesto incluido) es el del MOTOR ÚNICO (computeLine en @betel/contracts tax-engine); aquí se agregan el AIU, las
 * retenciones y los totales del documento, en Decimal para persistirlos.
 */
import { computeLine } from "@betel/contracts";
import { Prisma } from "@betel/db";

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const money = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export type TaxInputLine = {
  quantity: number;
  unitPrice: number;
  discountRate?: number;
  discountType?: "PERCENTAGE" | "FIXED";
  discountValue?: number;
  taxTreatment: "TAXED" | "EXEMPT" | "EXCLUDED" | "OTHER";
  taxRate: number;
  incRate?: number;
  /** Precio digitado con impuestos incluidos: se discriminan, nunca se suman otra vez. */
  includesTax?: boolean;
  withholdings?: { withholdingType: string; conceptCode?: string; rate: number }[];
};

/**
 * AIU (Administración, Imprevistos y Utilidad), contratos de obra, aseo, vigilancia, etc.
 * Los porcentajes se aplican sobre el subtotal (base después de descuentos).
 *   model ADDED ..... modelo 2: la base AIU (A + I + U) se suma al total de la factura.
 *   model INCLUDED .. modelo 1: la base AIU NO se suma; A, I y U son informativos (ya están en los precios).
 * Base de cada impuesto: SUBTOTAL, AIU (A + I + U) o PROFIT (solo la utilidad).
 *   vatBase ......... IVA (el INC sigue sobre el subtotal)
 *   withholdingBase . retenciones en la fuente y demás (salvo ICA)
 *   icaBase ......... retenciones cuyo tipo contiene "ICA"
 * Cada renglón conserva su tarifa: su base de IVA es su base × factor (1, (A+I+U)/100 o U/100).
 */
export type AiuBase = "SUBTOTAL" | "AIU" | "PROFIT";
export type AiuConfig = {
  model: "ADDED" | "INCLUDED";
  administrationRate: number;
  contingencyRate: number;
  profitRate: number;
  vatBase: AiuBase;
  withholdingBase: AiuBase;
  icaBase: AiuBase;
};

/** Factor que convierte la base de un renglón en la base de un impuesto con AIU. */
export function aiuFactor(aiu: AiuConfig | undefined, base: AiuBase) {
  if (!aiu || base === "SUBTOTAL") return new Prisma.Decimal(1);
  const rate = base === "PROFIT" ? aiu.profitRate : aiu.administrationRate + aiu.contingencyRate + aiu.profitRate;
  return new Prisma.Decimal(rate).dividedBy(HUNDRED);
}

export function calculateInvoiceTaxes(lines: TaxInputLine[], aiu?: AiuConfig) {
  const vatFactor = aiuFactor(aiu, aiu?.vatBase ?? "SUBTOTAL");
  const withholdingFactor = (type: string) =>
    aiuFactor(aiu, /ICA/i.test(type) ? (aiu?.icaBase ?? "SUBTOTAL") : (aiu?.withholdingBase ?? "SUBTOTAL"));
  const calculated = lines.map(line => {
    const taxRate = line.taxTreatment === "TAXED" ? new Prisma.Decimal(line.taxRate) : ZERO;
    const incRate = new Prisma.Decimal(line.incRate ?? 0);
    // Motor único: precio × cantidad − descuento = base; luego IVA e INC (discriminados si el precio los incluye).
    const shared = computeLine({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      includesTax: line.includesTax ?? false,
      vatRate: taxRate.toNumber(),
      incRate: incRate.toNumber(),
      discountType: line.discountType ?? "PERCENTAGE",
      discountValue: line.discountValue ?? line.discountRate ?? 0,
    });
    const grossAmount = money(shared.grossBase);
    const discountAmount = money(shared.discountBase);
    const taxableBase = money(shared.base);
    // Con AIU el IVA se liquida sobre la base elegida (subtotal, A + I + U o utilidad) de este renglón.
    const vatBase = aiu ? money(taxableBase.times(vatFactor)) : taxableBase;
    const taxAmount = aiu ? money(vatBase.times(taxRate).dividedBy(HUNDRED)) : money(shared.vat);
    const incAmount = money(shared.inc);
    const withholdings = (line.withholdings ?? []).map(withholding => {
      const base = money(taxableBase.times(withholdingFactor(withholding.withholdingType)));
      return { ...withholding, taxableBase: base, amount: money(base.times(withholding.rate).dividedBy(HUNDRED)) };
    });
    const withholdingTotal = money(withholdings.reduce((sum, item) => sum.plus(item.amount), ZERO));
    return {
      grossAmount,
      discountAmount,
      taxableBase,
      taxRate,
      vatBase,
      taxAmount,
      incRate,
      incAmount,
      withholdings,
      withholdingTotal,
      lineTotal: aiu ? money(taxableBase.plus(taxAmount).plus(incAmount)) : money(shared.total),
    };
  });
  const sum = (key: keyof (typeof calculated)[number]) =>
    money(
      calculated.reduce(
        (total, line) => total.plus(line[key] instanceof Prisma.Decimal ? (line[key] as Prisma.Decimal) : ZERO),
        ZERO
      )
    );
  const subtotal = sum("grossAmount");
  const discountTotal = sum("discountAmount");
  const taxableBase = sum("taxableBase");
  const taxTotal = sum("taxAmount");
  const incTotal = sum("incAmount");
  const withholdingTotal = sum("withholdingTotal");
  const portion = (rate: number) => (aiu ? money(taxableBase.times(rate).dividedBy(HUNDRED)) : ZERO);
  const aiuAmounts = {
    administration: portion(aiu?.administrationRate ?? 0),
    contingency: portion(aiu?.contingencyRate ?? 0),
    profit: portion(aiu?.profitRate ?? 0),
  };
  const aiuTotal = money(aiuAmounts.administration.plus(aiuAmounts.contingency).plus(aiuAmounts.profit));
  // Modelo 2: la base AIU se suma al total; modelo 1: ya está dentro de los precios.
  const total = money(sum("lineTotal").plus(aiu?.model === "ADDED" ? aiuTotal : ZERO));
  return {
    lines: calculated,
    subtotal,
    discountTotal,
    taxableBase,
    taxTotal,
    incTotal,
    withholdingTotal,
    aiu: aiu ? { ...aiuAmounts, total: aiuTotal, added: aiu.model === "ADDED" } : null,
    total,
    estimatedNetReceivable: money(total.minus(withholdingTotal)),
  };
}
