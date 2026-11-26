/**
 * Reportes › Estados financieros: estado de resultados y estado de situación financiera (balance general).
 *
 * Rutas (OWNER, ADMIN y ACCOUNTANT, como el balance de prueba):
 *   GET /v1/reports/income-statement?from&to ...... estado de resultados del período y del período anterior
 *   GET /v1/reports/balance-sheet?to .............. estado de situación financiera a una fecha
 *
 * DEFINICIONES (también en docs/reportes.md); saldos de los comprobantes contabilizados (POSTED):
 *   Estado de resultados (sin el comprobante de cierre de año, para ver el resultado aunque el año esté cerrado):
 *     Ingresos operacionales (41) − Costo de ventas (clases 6 y 7) = Utilidad bruta
 *     − Gastos de administración (51) − Gastos de ventas (52) = Utilidad operacional
 *     + Ingresos no operacionales (resto de la clase 4) − Gastos no operacionales (resto de la clase 5, sin 54)
 *     = Utilidad antes de impuestos − Impuesto de renta (54) = Utilidad neta del ejercicio.
 *     El período anterior es el de igual duración que termina el día antes.
 *   Situación financiera (a la fecha, incluido el cierre de año): Activo (clase 1), Pasivo (2) y Patrimonio (3) por
 *     grupo y cuenta, más el resultado de los años aún sin cerrar (clases 4 a 7) dentro del patrimonio.
 *     Activo = Pasivo + Patrimonio.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import { z } from "zod";
import { allowPermission } from "./auth.js";
import { LEDGER_ROLES } from "./ledger.js";
import { catalogName } from "./puc.js";
import { previousPeriod, resolvePeriod, todayIn } from "./reports.js";

type Tx = Prisma.TransactionClient;
const ZERO = new Prisma.Decimal(0);

export type Balance = { code: string; balance: Prisma.Decimal }; // débitos − créditos
export type StatementRow = {
  kind: "header" | "account" | "subtotal" | "result";
  code?: string;
  label: string;
  current: string;
  previous?: string;
};

/** Suma por cuenta de 4 dígitos (o el código completo si es más corto). */
function byAccount(balances: Balance[], names: Map<string, string>) {
  const map = new Map<string, { code: string; name: string; balance: Prisma.Decimal }>();
  for (const { code, balance } of balances) {
    const key = code.slice(0, 4);
    const row = map.get(key) ?? {
      code: key,
      name: names.get(key) ?? catalogName(key) ?? `Cuenta ${key}`,
      balance: ZERO,
    };
    row.balance = row.balance.plus(balance);
    map.set(key, row);
  }
  return map;
}

/** Estado de resultados con columnas del período actual y el anterior. */
export function incomeStatement(current: Balance[], previous: Balance[], names: Map<string, string> = new Map()) {
  const sections: { key: string; title: string; match: (code: string) => boolean; sign: 1 | -1 }[] = [
    { key: "income", title: "Ingresos operacionales", match: code => code.startsWith("41"), sign: -1 },
    { key: "cost", title: "Costo de ventas", match: code => code.startsWith("6") || code.startsWith("7"), sign: 1 },
    { key: "admin", title: "Gastos operacionales de administración", match: code => code.startsWith("51"), sign: 1 },
    { key: "sales", title: "Gastos operacionales de ventas", match: code => code.startsWith("52"), sign: 1 },
    {
      key: "otherIncome",
      title: "Ingresos no operacionales",
      match: code => code.startsWith("4") && !code.startsWith("41"),
      sign: -1,
    },
    {
      key: "otherExpense",
      title: "Gastos no operacionales",
      match: code => code.startsWith("5") && !["51", "52", "54", "59"].some(prefix => code.startsWith(prefix)),
      sign: 1,
    },
    { key: "tax", title: "Impuesto de renta y complementarios", match: code => code.startsWith("54"), sign: 1 },
  ];
  const now = byAccount(current, names);
  const before = byAccount(previous, names);
  const totals: Record<string, { current: Prisma.Decimal; previous: Prisma.Decimal }> = {};
  const rows: StatementRow[] = [];
  const pushSection = (section: (typeof sections)[number]) => {
    const codes = [...new Set([...now.keys(), ...before.keys()])].filter(section.match).sort();
    let currentTotal = ZERO;
    let previousTotal = ZERO;
    const lines: StatementRow[] = [];
    for (const code of codes) {
      const currentValue = (now.get(code)?.balance ?? ZERO).times(section.sign);
      const previousValue = (before.get(code)?.balance ?? ZERO).times(section.sign);
      if (currentValue.isZero() && previousValue.isZero()) continue;
      currentTotal = currentTotal.plus(currentValue);
      previousTotal = previousTotal.plus(previousValue);
      lines.push({
        kind: "account",
        code,
        label: (now.get(code) ?? before.get(code))!.name,
        current: currentValue.toFixed(2),
        previous: previousValue.toFixed(2),
      });
    }
    totals[section.key] = { current: currentTotal, previous: previousTotal };
    rows.push(
      { kind: "header", label: section.title, current: currentTotal.toFixed(2), previous: previousTotal.toFixed(2) },
      ...lines
    );
  };
  const subtotal = (
    label: string,
    kind: "subtotal" | "result",
    value: { current: Prisma.Decimal; previous: Prisma.Decimal }
  ) => rows.push({ kind, label, current: value.current.toFixed(2), previous: value.previous.toFixed(2) });
  const combine = (fn: (pick: (key: string) => Prisma.Decimal) => Prisma.Decimal) => ({
    current: fn(key => totals[key]!.current),
    previous: fn(key => totals[key]!.previous),
  });

  pushSection(sections[0]!);
  pushSection(sections[1]!);
  const gross = combine(t => t("income").minus(t("cost")));
  subtotal("Utilidad bruta", "subtotal", gross);
  pushSection(sections[2]!);
  pushSection(sections[3]!);
  const operating = combine(t => t("income").minus(t("cost")).minus(t("admin")).minus(t("sales")));
  subtotal("Utilidad operacional", "subtotal", operating);
  pushSection(sections[4]!);
  pushSection(sections[5]!);
  const beforeTax = combine(t =>
    t("income").minus(t("cost")).minus(t("admin")).minus(t("sales")).plus(t("otherIncome")).minus(t("otherExpense"))
  );
  subtotal("Utilidad antes de impuestos", "subtotal", beforeTax);
  pushSection(sections[6]!);
  const net = {
    current: beforeTax.current.minus(totals.tax!.current),
    previous: beforeTax.previous.minus(totals.tax!.previous),
  };
  subtotal("Utilidad neta del ejercicio", "result", net);
  return { rows, net: { current: net.current.toFixed(2), previous: net.previous.toFixed(2) } };
}

/** Estado de situación financiera: activo, pasivo y patrimonio por grupo y cuenta, con el resultado sin cerrar. */
export function balanceSheet(balances: Balance[], names: Map<string, string> = new Map()) {
  const accounts = byAccount(balances, names);
  const rows: StatementRow[] = [];
  const totals = { assets: ZERO, liabilities: ZERO, equity: ZERO };
  const classSection = (digit: "1" | "2" | "3", title: string, sign: 1 | -1, extra?: StatementRow) => {
    const codes = [...accounts.keys()].filter(code => code.startsWith(digit)).sort();
    let total = ZERO;
    const body: StatementRow[] = [];
    const groups = [...new Set(codes.map(code => code.slice(0, 2)))];
    for (const group of groups) {
      const lines = codes
        .filter(code => code.startsWith(group))
        .map(code => ({ code, name: accounts.get(code)!.name, value: accounts.get(code)!.balance.times(sign) }))
        .filter(line => !line.value.isZero());
      if (!lines.length) continue;
      const groupTotal = lines.reduce((sum, line) => sum.plus(line.value), ZERO);
      total = total.plus(groupTotal);
      body.push({
        kind: "subtotal",
        code: group,
        label: catalogName(group) ?? `Grupo ${group}`,
        current: groupTotal.toFixed(2),
      });
      body.push(
        ...lines.map(line => ({
          kind: "account" as const,
          code: line.code,
          label: line.name,
          current: line.value.toFixed(2),
        }))
      );
    }
    if (extra && !new Prisma.Decimal(extra.current).isZero()) {
      body.push(extra);
      total = total.plus(extra.current);
    }
    rows.push({ kind: "header", label: title, current: total.toFixed(2) }, ...body);
    return total;
  };
  // Resultado de los años sin cerrar: ingresos − gastos − costos (clases 4 a 7), en positivo si es utilidad.
  const openResult = [...accounts.values()]
    .filter(row => ["4", "5", "6", "7"].includes(row.code[0]!))
    .reduce((sum, row) => sum.minus(row.balance), ZERO);
  totals.assets = classSection("1", "Activo", 1);
  totals.liabilities = classSection("2", "Pasivo", -1);
  totals.equity = classSection("3", "Patrimonio", -1, {
    kind: "subtotal",
    label: "Resultado del ejercicio (años sin cerrar)",
    current: openResult.toFixed(2),
  });
  const liabilitiesAndEquity = totals.liabilities.plus(totals.equity);
  rows.push({ kind: "result", label: "Total pasivo + patrimonio", current: liabilitiesAndEquity.toFixed(2) });
  return {
    rows,
    totals: {
      assets: totals.assets.toFixed(2),
      liabilities: totals.liabilities.toFixed(2),
      equity: totals.equity.toFixed(2),
      liabilitiesAndEquity: liabilitiesAndEquity.toFixed(2),
      openResult: openResult.toFixed(2),
    },
    balanced: totals.assets.equals(liabilitiesAndEquity),
  };
}

// ─── Consultas y rutas ────────────────────────────────────────────────────────

async function balancesBetween(tx: Tx, where: Prisma.JournalEntryWhereInput) {
  const accounts = await tx.account.findMany({ select: { id: true, code: true, name: true } });
  const sums = await tx.journalLine.groupBy({
    by: ["accountId"],
    where: { journalEntry: { status: "POSTED", ...where } },
    _sum: { debit: true, credit: true },
  });
  const codeOf = new Map(accounts.map(account => [account.id, account.code]));
  const names = new Map(
    accounts.filter(account => account.code.length === 4).map(account => [account.code, account.name])
  );
  return {
    balances: sums.map(row => ({
      code: codeOf.get(row.accountId)!,
      balance: (row._sum.debit ?? ZERO).minus(row._sum.credit ?? ZERO),
    })),
    names,
  };
}

const iso = (date: Date) => date.toISOString().slice(0, 10);
const periodSchema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });

export function registerStatementRoutes(app: FastifyInstance) {
  const can = { preHandler: allowPermission("accounting.manage") };

  /** GET /v1/reports/income-statement?from&to — por defecto, el mes en curso. */
  app.get("/v1/reports/income-statement", can, async (request, reply) => {
    const parsed = periodSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Período inválido." });
    const period = resolvePeriod(parsed.data);
    if (period.from > period.to)
      return reply.code(422).send({ error: "La fecha inicial no puede ser posterior a la final." });
    const previous = previousPeriod(period);
    const notClose = { NOT: { sourceType: "YearClose" } };
    const result = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const now = await balancesBetween(tx, { date: { gte: period.from, lte: period.to }, ...notClose });
      const before = await balancesBetween(tx, { date: { gte: previous.from, lte: previous.to }, ...notClose });
      return incomeStatement(now.balances, before.balances, now.names);
    });
    return {
      data: result.rows,
      net: result.net,
      period: { from: iso(period.from), to: iso(period.to) },
      previousPeriod: { from: iso(previous.from), to: iso(previous.to) },
    };
  });

  /** GET /v1/reports/balance-sheet?to — por defecto, hoy. */
  app.get("/v1/reports/balance-sheet", can, async (request, reply) => {
    const parsed = periodSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Fecha inválida." });
    const to = parsed.data.to ?? todayIn("America/Bogota");
    const result = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const { balances, names } = await balancesBetween(tx, { date: { lte: to } });
      return balanceSheet(balances, names);
    });
    return { data: result.rows, totals: result.totals, balanced: result.balanced, period: { from: null, to: iso(to) } };
  });
}
