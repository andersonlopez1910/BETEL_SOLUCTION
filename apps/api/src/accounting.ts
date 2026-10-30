/**
 * Reglas contables base: totales de documentos, catálogo PUC mínimo y validación de partida doble.
 *
 * IMPORTANTE: todos los montos se redondean a 2 decimales con `round`. Si se cambia la lógica
 * de redondeo, actualizar también las pruebas en `test/accounting.test.ts`.
 */
import type { Prisma } from "@betel/db";

/** Línea mínima de un documento (factura o documento soporte). Tasas en porcentaje: 19 = 19 %. */
type DocumentLine = { quantity: number; unitPrice: number; discountRate?: number; taxRate: number };

/**
 * Calcula los totales de un documento.
 *
 * Por cada línea:
 *   bruto     = cantidad × precio unitario
 *   descuento = bruto × % descuento
 *   base      = bruto − descuento          (base gravable)
 *   impuesto  = base × % IVA
 *   total     = base + impuesto
 *
 * Devuelve las líneas enriquecidas y los totales del documento (subtotal = suma de brutos).
 */
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
    total: round(normalized.reduce((sum, line) => sum + line.total, 0)),
  };
}

/**
 * Garantiza que la organización tenga las cuentas PUC mínimas que usan los comprobantes automáticos.
 * Es idempotente (upsert): se puede llamar en cada emisión sin duplicar cuentas.
 *
 * Devuelve un objeto indexado por código, p. ej. `accounts["130505"].id`.
 *
 * NOTA: es un catálogo base de ejemplo. Cada empresa debe parametrizar su plan de cuentas
 * con su contador antes de operar en producción.
 */
export async function ensureDefaultAccounts(tx: Prisma.TransactionClient, organizationId: string) {
  const definitions = [
    ["130505", "Clientes nacionales", "ASSET"], // Cuentas por cobrar de facturas a crédito/contado
    ["240805", "IVA generado", "LIABILITY"], // IVA cobrado en ventas
    ["240810", "IVA descontable", "ASSET"], // IVA pagado en compras (documento soporte)
    ["413595", "Ingresos por ventas", "INCOME"],
    ["220505", "Proveedores nacionales", "LIABILITY"], // Cuentas por pagar de documentos soporte
    ["519595", "Gastos operacionales", "EXPENSE"],
  ] as const;
  const accounts = await Promise.all(
    definitions.map(([code, name, accountType]) =>
      tx.account.upsert({
        where: { organizationId_code: { organizationId, code } },
        update: {}, // Si ya existe no se modifica (respeta cambios hechos por el usuario).
        create: { organizationId, code, name, accountType },
      })
    )
  );
  return Object.fromEntries(accounts.map(account => [account.code, account]));
}

/**
 * Valida la partida doble: la suma de débitos debe ser igual a la de créditos (a 2 decimales).
 * Lanza un error si el comprobante está descuadrado; llamarla SIEMPRE antes de guardar un JournalEntry.
 */
export function assertBalanced(lines: Array<{ debit: number; credit: number }>) {
  const debit = round(lines.reduce((sum, line) => sum + line.debit, 0));
  const credit = round(lines.reduce((sum, line) => sum + line.credit, 0));
  if (debit !== credit) throw new Error(`Comprobante descuadrado: débitos ${debit}, créditos ${credit}.`);
}

/** Redondea a 2 decimales evitando errores de coma flotante (p. ej. 1.005 → 1.01). */
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
