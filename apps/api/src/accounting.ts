import type { Prisma } from "@betel/db";

type DocumentLine = { quantity: number; unitPrice: number; discountRate?: number; taxRate: number };

export function calculateDocumentTotals<T extends DocumentLine>(lines: T[]) {
  const normalized = lines.map(line => {
    const gross = line.quantity * line.unitPrice;
    const discount = gross * ((line.discountRate ?? 0) / 100);
    const taxable = gross - discount;
    const tax = taxable * (line.taxRate / 100);
    return { ...line, gross, discount, tax, total: round(taxable + tax) };
  });
  return {
    lines: normalized,
    subtotal: round(normalized.reduce((sum, line) => sum + line.gross, 0)),
    discountTotal: round(normalized.reduce((sum, line) => sum + line.discount, 0)),
    taxTotal: round(normalized.reduce((sum, line) => sum + line.tax, 0)),
    total: round(normalized.reduce((sum, line) => sum + line.total, 0))
  };
}

export async function ensureDefaultAccounts(tx: Prisma.TransactionClient, organizationId: string) {
  const definitions = [
    ["130505", "Clientes nacionales", "ASSET"],
    ["240805", "IVA generado", "LIABILITY"],
    ["240810", "IVA descontable", "ASSET"],
    ["413595", "Ingresos por ventas", "INCOME"],
    ["220505", "Proveedores nacionales", "LIABILITY"],
    ["519595", "Gastos operacionales", "EXPENSE"]
  ] as const;
  const accounts = await Promise.all(definitions.map(([code, name, accountType]) => tx.account.upsert({
    where: { organizationId_code: { organizationId, code } }, update: {}, create: { organizationId, code, name, accountType }
  })));
  return Object.fromEntries(accounts.map(account => [account.code, account]));
}

export function assertBalanced(lines: Array<{ debit: number; credit: number }>) {
  const debit = round(lines.reduce((sum, line) => sum + line.debit, 0));
  const credit = round(lines.reduce((sum, line) => sum + line.credit, 0));
  if (debit !== credit) throw new Error(`Comprobante descuadrado: débitos ${debit}, créditos ${credit}.`);
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
