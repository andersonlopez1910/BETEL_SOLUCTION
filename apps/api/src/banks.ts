/**
 * Cajas y bancos: saldo de cada cuenta de caja (PUC 1105) y bancos (PUC 1110) según la contabilidad, y su auxiliar.
 *
 * Rutas:
 *   GET /v1/reports/banks?to= .............................. saldos a la fecha de corte (hoy por defecto)
 *   GET /v1/reports/banks/export?to= ....................... lo mismo, para descargar (auditado)
 *   GET /v1/banks/:accountId/movements?from&to&page ........ movimientos de la cuenta con saldo acumulado
 *   GET /v1/banks/:accountId/movements/export?from&to ...... todos los movimientos del período (auditado)
 *
 * DEFINICIONES (también en docs/cajas-y-bancos.md):
 *   - Cuentas: las del plan de cuentas de la organización cuyo código empieza por 1105 (caja) o 1110 (bancos).
 *     Se crean con el primer comprobante contable (accounting.ts, ensureDefaultAccounts).
 *   - Saldo = Σ débitos − Σ créditos de los renglones de comprobantes CONTABILIZADOS (POSTED) con fecha hasta el corte.
 *     Lo mueven: facturas de contado, recibos de caja, pagos en línea, compras y gastos de contado, documentos
 *     soporte, comprobantes de egreso y sus anulaciones (asientos inversos).
 *   - Auxiliar: saldo anterior al período + movimientos ordenados por fecha con saldo acumulado.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import { bankMovementsQuerySchema, banksQuerySchema, type BankMovementsQuery } from "@betel/contracts";
import { allowRoles } from "./auth.js";
import { EXPORT_LIMIT, REPORT_EXPORT_ROLES, REPORT_VIEW_ROLES, resolvePeriod, todayIn } from "./reports.js";

type Tx = Prisma.TransactionClient;
const ZERO = new Prisma.Decimal(0);
const CASH_AND_BANKS = [{ code: { startsWith: "1105" } }, { code: { startsWith: "1110" } }];
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

/** Tipo de cuenta para la columna "Cuenta bancaria / caja". */
export const accountKind = (code: string) => (code.startsWith("1105") ? "CASH" : "BANK");

// ─── Cálculo puro (probado en test/banks.test.ts) ───────────────────────────

/** Saldo acumulado renglón a renglón a partir del saldo anterior. */
export function runningBalance<T extends { debit: Prisma.Decimal; credit: Prisma.Decimal }>(
  opening: Prisma.Decimal,
  lines: T[]
) {
  let balance = opening;
  return lines.map(line => {
    balance = balance.plus(line.debit).minus(line.credit);
    return { ...line, balance };
  });
}

// ─── Consultas ────────────────────────────────────────────────────────────────

async function loadBalances(tx: Tx, to: Date) {
  const accounts = await tx.account.findMany({ where: { OR: CASH_AND_BANKS }, orderBy: { code: "asc" } });
  const sums = await tx.journalLine.groupBy({
    by: ["accountId"],
    where: {
      accountId: { in: accounts.map(account => account.id) },
      journalEntry: { status: "POSTED", date: { lte: to } },
    },
    _sum: { debit: true, credit: true },
  });
  // Fecha del último movimiento contabilizado de cada cuenta (columna opcional).
  const ids = accounts.map(account => account.id);
  const lastDates = ids.length
    ? await tx.$queryRaw<{ accountId: string; last: Date }[]>`
        SELECT l."accountId" AS "accountId", max(e.date) AS last
        FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."journalEntryId"
        WHERE e.status = 'POSTED' AND e.date <= ${to} AND l."accountId" = ANY(${ids}::text[])
        GROUP BY l."accountId"`
    : [];
  const byAccount = new Map(sums.map(row => [row.accountId, row._sum]));
  const lastByAccount = new Map(lastDates.map(row => [row.accountId, row.last]));
  const rows = accounts
    .map(account => {
      const sum = byAccount.get(account.id);
      const debits = sum?.debit ?? ZERO;
      const credits = sum?.credit ?? ZERO;
      const last = lastByAccount.get(account.id);
      return {
        id: account.id,
        code: account.code,
        name: account.name,
        kind: accountKind(account.code),
        active: account.active,
        debits: debits.toFixed(2),
        credits: credits.toFixed(2),
        balance: debits.minus(credits).toFixed(2),
        lastMovement: last ? dateOnly(last) : null,
      };
    })
    // Una cuenta inactiva sin saldo no se muestra.
    .filter(row => row.active || row.balance !== "0.00");
  const total = rows.reduce((sum, row) => sum.plus(row.balance), ZERO);
  return { rows, total: total.toFixed(2), to: dateOnly(to) };
}

async function loadMovements(tx: Tx, accountId: string, query: BankMovementsQuery, limit: number) {
  const account = await tx.account.findFirst({ where: { id: accountId, OR: CASH_AND_BANKS } });
  if (!account) return null;
  const period = resolvePeriod(query);
  const posted = { accountId: account.id, journalEntry: { status: "POSTED" as const } };
  const before = await tx.journalLine.aggregate({
    where: { ...posted, journalEntry: { status: "POSTED", date: { lt: period.from } } },
    _sum: { debit: true, credit: true },
  });
  const opening = (before._sum.debit ?? ZERO).minus(before._sum.credit ?? ZERO);
  const where = { ...posted, journalEntry: { status: "POSTED" as const, date: { gte: period.from, lte: period.to } } };
  const count = await tx.journalLine.count({ where });
  const lines = await tx.journalLine.findMany({
    where,
    select: {
      id: true,
      debit: true,
      credit: true,
      memo: true,
      journalEntry: {
        select: {
          id: true,
          reference: true,
          date: true,
          description: true,
          sourceType: true,
          sourceId: true,
          createdAt: true,
        },
      },
    },
    orderBy: [{ journalEntry: { date: "asc" } }, { journalEntry: { createdAt: "asc" } }, { id: "asc" }],
    take: limit,
  });
  // Para enlazar el comprobante de egreso se necesita el proveedor (sus cuentas por pagar).
  const paymentIds = lines
    .filter(line => line.journalEntry.sourceType === "SupplierPayment")
    .map(line => line.journalEntry.sourceId!);
  const payments = paymentIds.length
    ? await tx.supplierPayment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, supplierId: true } })
    : [];
  const supplierOf = new Map(payments.map(payment => [payment.id, payment.supplierId]));
  const withBalance = runningBalance(opening, lines);
  const debits = lines.reduce((sum, line) => sum.plus(line.debit), ZERO);
  const credits = lines.reduce((sum, line) => sum.plus(line.credit), ZERO);
  return {
    account: { id: account.id, code: account.code, name: account.name, kind: accountKind(account.code) },
    period: { from: dateOnly(period.from), to: dateOnly(period.to) },
    count,
    opening: opening.toFixed(2),
    debits: debits.toFixed(2),
    credits: credits.toFixed(2),
    closing: opening.plus(debits).minus(credits).toFixed(2),
    rows: withBalance.map(line => ({
      id: line.id,
      date: dateOnly(line.journalEntry.date),
      reference: line.journalEntry.reference,
      description: line.journalEntry.description,
      memo: line.memo,
      sourceType: line.journalEntry.sourceType,
      sourceId: line.journalEntry.sourceId,
      supplierId:
        line.journalEntry.sourceType === "SupplierPayment"
          ? (supplierOf.get(line.journalEntry.sourceId!) ?? null)
          : null,
      debit: line.debit.toFixed(2),
      credit: line.credit.toFixed(2),
      balance: line.balance.toFixed(2),
    })),
  };
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerBankRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowRoles(...REPORT_VIEW_ROLES) };
  const canExport = { preHandler: allowRoles(...REPORT_EXPORT_ROLES) };
  const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
  const audit = (
    tx: Tx,
    request: { ip: string; actor?: { organizationId: string; sub: string } },
    entityId: string,
    after: Prisma.InputJsonValue
  ) =>
    tx.auditLog.create({
      data: {
        organizationId: request.actor!.organizationId,
        userId: request.actor!.sub,
        entity: "CashAndBanks",
        entityId,
        action: "EXPORT",
        after,
        ipHash: options.auditIp(request.ip),
      },
    });

  /** GET /v1/reports/banks?to= — saldos de cajas y bancos. */
  app.get("/v1/reports/banks", canView, async (request, reply) => {
    const parsed = banksQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Fecha de corte inválida." });
    const to = parsed.data.to ?? todayIn("America/Bogota");
    const result = await withOrganizationScope(request.actor!.organizationId, tx => loadBalances(tx, to));
    return { data: result.rows, total: result.total, to: result.to };
  });

  /** GET /v1/reports/banks/export?to= — lo mismo, auditado. */
  app.get("/v1/reports/banks/export", canExport, async (request, reply) => {
    const parsed = banksQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Fecha de corte inválida." });
    const to = parsed.data.to ?? todayIn("America/Bogota");
    const result = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const balances = await loadBalances(tx, to);
      await audit(tx, request, "balances", { to: balances.to, rows: balances.rows.length });
      return balances;
    });
    return { data: result.rows, total: result.total, to: result.to };
  });

  /** GET /v1/banks/:accountId/movements — auxiliar paginado con saldo acumulado. */
  app.get<{ Params: { accountId: string } }>("/v1/banks/:accountId/movements", canView, async (request, reply) => {
    const parsed = bankMovementsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Período inválido", details: parsed.error.flatten() });
    if (!validId(request.params.accountId))
      return reply.code(404).send({ error: "Cuenta de caja o banco no encontrada." });
    const { page, pageSize } = parsed.data;
    const result = await withOrganizationScope(request.actor!.organizationId, tx =>
      // El saldo acumulado necesita los renglones anteriores de la página: se calculan hasta el final de ella.
      loadMovements(tx, request.params.accountId, parsed.data, page * pageSize)
    );
    if (!result) return reply.code(404).send({ error: "Cuenta de caja o banco no encontrada." });
    const { rows, count, ...rest } = result;
    return { data: rows.slice((page - 1) * pageSize), pagination: { page, pageSize, total: count }, ...rest };
  });

  /** GET /v1/banks/:accountId/movements/export — todos los movimientos del período (máx. EXPORT_LIMIT). */
  app.get<{ Params: { accountId: string } }>(
    "/v1/banks/:accountId/movements/export",
    canExport,
    async (request, reply) => {
      const parsed = bankMovementsQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(422).send({ error: "Período inválido" });
      if (!validId(request.params.accountId))
        return reply.code(404).send({ error: "Cuenta de caja o banco no encontrada." });
      const result = await withOrganizationScope(request.actor!.organizationId, async tx => {
        const movements = await loadMovements(tx, request.params.accountId, parsed.data, EXPORT_LIMIT + 1);
        if (movements && movements.count <= EXPORT_LIMIT)
          await audit(tx, request, request.params.accountId, { period: movements.period, rows: movements.count });
        return movements;
      });
      if (!result) return reply.code(404).send({ error: "Cuenta de caja o banco no encontrada." });
      if (result.count > EXPORT_LIMIT)
        return reply
          .code(413)
          .send({ error: `El período tiene más de ${EXPORT_LIMIT} movimientos. Acota las fechas.` });
      const { rows, ...rest } = result;
      return { data: rows, ...rest };
    }
  );
}
