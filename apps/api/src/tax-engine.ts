/**
 * Motor tributario de facturas de venta. Mantiene impuestos generados y retenciones separados,
 * y usa Decimal para que el servidor sea la fuente de verdad de los importes persistidos.
 */
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
    const grossAmount = money(new Prisma.Decimal(line.quantity).times(line.unitPrice));
    const requestedDiscount =
      line.discountType === "FIXED"
        ? new Prisma.Decimal(line.discountValue ?? 0)
        : grossAmount.times(line.discountValue ?? line.discountRate ?? 0).dividedBy(HUNDRED);
    // Un descuento nunca puede dejar una base negativa.
    const discountAmount = money(Prisma.Decimal.min(grossAmount, Prisma.Decimal.max(ZERO, requestedDiscount)));
    const taxableBase = money(grossAmount.minus(discountAmount));
    const taxRate = line.taxTreatment === "TAXED" ? new Prisma.Decimal(line.taxRate) : ZERO;
    // Con AIU el IVA se liquida sobre la base elegida (subtotal, A + I + U o utilidad) de este renglón.
    const vatBase = money(taxableBase.times(vatFactor));
    const taxAmount = money(vatBase.times(taxRate).dividedBy(HUNDRED));
    const incRate = new Prisma.Decimal(line.incRate ?? 0);
    const incAmount = money(taxableBase.times(incRate).dividedBy(HUNDRED));
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
      lineTotal: money(taxableBase.plus(taxAmount).plus(incAmount)),
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
