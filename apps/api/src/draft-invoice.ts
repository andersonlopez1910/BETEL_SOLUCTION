/**
 * Crea una FACTURA EN BORRADOR a partir de un documento previo (cotización o remisión), con las mismas
 * líneas y totales. No emite: la emisión DIAN y la contabilidad siguen siendo POST /v1/invoices/:id/issue.
 */
import type { Prisma } from "@betel/db";

type SourceLine = {
  productId: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountRate: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
};

export async function createDraftInvoiceFrom(
  tx: Prisma.TransactionClient,
  source: {
    organizationId: string;
    customerId: string;
    currency: string;
    notes: string | null;
    subtotal: Prisma.Decimal;
    discountTotal: Prisma.Decimal;
    taxTotal: Prisma.Decimal;
    total: Prisma.Decimal;
    lines: SourceLine[];
  },
  terms: { paymentMethod: "CASH" | "CREDIT"; issueDate: Date; dueDate?: Date },
  /** Texto de origen que encabeza las notas, p. ej. "Generada desde la cotización COT-3." */
  origin: string
) {
  return tx.invoice.create({
    data: {
      organizationId: source.organizationId,
      customerId: source.customerId,
      issueDate: terms.issueDate,
      dueDate: terms.dueDate,
      paymentTerm: terms.paymentMethod,
      currency: source.currency,
      notes: [origin, source.notes].filter(Boolean).join("\n"),
      subtotal: source.subtotal,
      discountTotal: source.discountTotal,
      taxTotal: source.taxTotal,
      total: source.total,
      lines: {
        create: source.lines.map(line => ({
          productId: line.productId,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountRate: line.discountRate,
          taxRate: line.taxRate,
          lineTotal: line.lineTotal,
        })),
      },
    },
  });
}
