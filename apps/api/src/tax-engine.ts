/**
 * Motor tributario de facturas de venta. Mantiene impuestos generados y retenciones separados,
 * y usa Decimal para que el servidor sea la fuente de verdad de los importes persistidos.
 */
import { Prisma } from "@betel/db";

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

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

export function calculateInvoiceTaxes(lines: TaxInputLine[]) {
  const calculated = lines.map(line => {
    const grossAmount = money(new Prisma.Decimal(line.quantity).times(line.unitPrice));
    const requestedDiscount = line.discountType === "FIXED"
      ? new Prisma.Decimal(line.discountValue ?? 0)
      : grossAmount.times(line.discountValue ?? line.discountRate ?? 0).dividedBy(HUNDRED);
    // Un descuento nunca puede dejar una base negativa.
    const discountAmount = money(Prisma.Decimal.min(grossAmount, Prisma.Decimal.max(ZERO, requestedDiscount)));
    const taxableBase = money(grossAmount.minus(discountAmount));
    const taxRate = line.taxTreatment === "TAXED" ? new Prisma.Decimal(line.taxRate) : ZERO;
    const taxAmount = money(taxableBase.times(taxRate).dividedBy(HUNDRED));
    const incRate = new Prisma.Decimal(line.incRate ?? 0);
    const incAmount = money(taxableBase.times(incRate).dividedBy(HUNDRED));
    const withholdings = (line.withholdings ?? []).map(withholding => ({
      ...withholding,
      taxableBase,
      amount: money(taxableBase.times(withholding.rate).dividedBy(HUNDRED)),
    }));
    const withholdingTotal = money(withholdings.reduce((sum, item) => sum.plus(item.amount), ZERO));
    return {
      grossAmount,
      discountAmount,
      taxableBase,
      taxRate,
      taxAmount,
      incRate,
      incAmount,
      withholdings,
      withholdingTotal,
      lineTotal: money(taxableBase.plus(taxAmount).plus(incAmount)),
    };
  });
  const sum = (key: keyof (typeof calculated)[number]) =>
    money(calculated.reduce((total, line) => total.plus(line[key] instanceof Prisma.Decimal ? line[key] as Prisma.Decimal : ZERO), ZERO));
  const subtotal = sum("grossAmount");
  const discountTotal = sum("discountAmount");
  const taxableBase = sum("taxableBase");
  const taxTotal = sum("taxAmount");
  const incTotal = sum("incAmount");
  const withholdingTotal = sum("withholdingTotal");
  const total = sum("lineTotal");
  return { lines: calculated, subtotal, discountTotal, taxableBase, taxTotal, incTotal, withholdingTotal, total, estimatedNetReceivable: money(total.minus(withholdingTotal)) };
}
