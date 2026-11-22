/**
 * Catálogo de reportes (menú Reportes): tipos y utilidades comunes. Cada reporte declara sus filtros, los roles que
 * lo pueden ver y una función que devuelve columnas y filas; la ruta y la pantalla son genéricas (ver index.ts y
 * apps/web/components/catalog-report.tsx).
 */
import { Prisma } from "@betel/db";
import type { MembershipRole } from "../auth.js";

export type Tx = Prisma.TransactionClient;
export const ZERO = new Prisma.Decimal(0);

export type ColumnType = "text" | "money" | "number" | "date" | "percent";
/** `sum: false` evita el total de una columna numérica (saldos acumulados, costos unitarios, porcentajes). */
export type Column = { key: string; label: string; type?: ColumnType; sum?: boolean };
export type Cell = string | number | null;
export type Row = Record<string, Cell>;

/**
 * Filtros posibles: period (from/to), date (corte), year, search (texto), partyKind (clientes o proveedores),
 * account (código de cuenta), product (id de producto).
 */
export type ParamName = "period" | "date" | "year" | "search" | "partyKind" | "account" | "product";
export type Params = {
  from: Date;
  to: Date;
  date: Date;
  year: number;
  search?: string;
  partyKind: "CUSTOMER" | "SUPPLIER";
  account?: string;
  product?: string;
};
export type ReportResult = { columns: Column[]; rows: Row[]; totals?: Row; notes?: string[] };
export type CatalogReport = {
  id: string;
  title: string;
  params: ParamName[];
  roles: MembershipRole[];
  run: (tx: Tx, params: Params) => Promise<ReportResult>;
};

export const LEDGER: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT"];
export const VIEW: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT", "SALES", "VIEWER"];
export const BILLED = ["ISSUED", "ACCEPTED", "OVERDUE"] as const;

export const D = (value: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(value ?? 0);
export const money = (value: Prisma.Decimal.Value) => D(value).toFixed(2);
export const qty = (value: Prisma.Decimal.Value) => D(value).toDecimalPlaces(4).toString();
export const iso = (date: Date) => date.toISOString().slice(0, 10);
export const percent = (part: Prisma.Decimal, whole: Prisma.Decimal) =>
  whole.isZero() ? null : part.dividedBy(whole).times(100).toFixed(1);
export const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const yearRange = (year: number) => ({
  gte: new Date(Date.UTC(year, 0, 1)),
  lte: new Date(Date.UTC(year, 11, 31)),
});

/** Base gravable e IVA de un renglón (mismo cálculo que calculateDocumentTotals en accounting.ts). */
export function lineAmounts(line: {
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountRate: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}) {
  const base = line.quantity.times(line.unitPrice).times(D(1).minus(line.discountRate.dividedBy(100)));
  return { base, tax: line.lineTotal.minus(base) };
}

export const invoiceLabel = (invoice: { prefix: string | null; number: string | null }) =>
  invoice.number ? `${invoice.prefix ?? ""}${invoice.number}` : "Sin numerar";
export const partyName = (party: { legalName: string; tradeName?: string | null }) => party.legalName;

/** Acumula filas por clave: `add` suma sobre el acumulado (o lo crea con `init`). */
export function accumulate<T, A>(
  items: T[],
  key: (item: T) => string,
  init: (item: T) => A,
  add: (acc: A, item: T) => void
) {
  const map = new Map<string, A>();
  for (const item of items) {
    const k = key(item);
    let acc = map.get(k);
    if (!acc) {
      acc = init(item);
      map.set(k, acc);
    }
    add(acc, item);
  }
  return map;
}

/** Totales de las columnas numéricas (money y number) salvo las marcadas `sum: false`. */
export function columnTotals(columns: Column[], rows: Row[]): Row | undefined {
  const summable = columns.filter(
    column => (column.type === "money" || column.type === "number") && column.sum !== false
  );
  if (!summable.length || !rows.length) return undefined;
  const totals: Row = { [columns[0]!.key]: "Total" };
  for (const column of summable) {
    const sum = rows.reduce(
      (acc, row) => (row[column.key] == null ? acc : acc.plus(D(row[column.key] as string))),
      ZERO
    );
    totals[column.key] = column.type === "money" ? sum.toFixed(2) : sum.toDecimalPlaces(4).toString();
  }
  return totals;
}

/** Responsable (vendedor) de cada factura: el usuario del AuditLog "Invoice CREATE_DRAFT" (ver reports.ts). */
export async function sellersOf(tx: Tx, invoiceIds: string[]) {
  if (!invoiceIds.length) return new Map<string, string>();
  const logs = await tx.auditLog.findMany({
    where: { entity: "Invoice", action: "CREATE_DRAFT", entityId: { in: invoiceIds } },
    select: { entityId: true, user: { select: { displayName: true, email: true } } },
  });
  return new Map(logs.map(log => [log.entityId, log.user?.displayName || log.user?.email || "Sin responsable"]));
}
export const NO_SELLER = "Sin responsable";
