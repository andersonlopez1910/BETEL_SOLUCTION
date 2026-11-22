/**
 * Contabilidad: plan de cuentas (árbol PUC + cuentas de la organización), balance de prueba, libro diario y
 * comprobantes contables manuales.
 *
 * Rutas:
 *   GET    /v1/accounting/chart ........................ árbol completo con saldos acumulados por nodo
 *   POST   /v1/accounting/accounts ..................... crear cuenta (4 dígitos bajo un grupo, subcuenta o auxiliar)
 *   PUT    /v1/accounting/accounts/:id ................. renombrar o activar/inactivar
 *   DELETE /v1/accounting/accounts/:id ................. eliminar (sin movimientos, sin subcuentas, no del sistema)
 *   GET    /v1/accounting/trial-balance ................ balance de prueba (from, to, level)
 *   GET    /v1/accounting/journal ...................... libro diario: comprobantes del período
 *   GET    /v1/accounting/journal/:id .................. detalle de un comprobante
 *   POST   /v1/accounting/journal ...................... comprobante contable manual (CC-n)
 *   POST   /v1/accounting/journal/:id/void ............. anular un comprobante manual
 *
 * DEFINICIONES (también en docs/contabilidad.md):
 *   - Árbol: clases, grupos y cuentas del PUC (puc.ts) + cuentas de la organización (Account). Saldo de un nodo =
 *     movimientos contabilizados (POSTED) de la cuenta y de todas sus subcuentas; se muestra según su naturaleza
 *     (débito: débitos − créditos; crédito: créditos − débitos).
 *   - Cuentas del sistema: las que usan los comprobantes automáticos (DEFAULT_ACCOUNTS y nómina): no se inactivan ni
 *     se eliminan.
 *   - Comprobante manual: solo en cuentas de la organización activas y sin subcuentas (cuentas de movimiento);
 *     débitos = créditos. Anularlo lo marca REVERSED y deja de sumar.
 *   - Balance de prueba: por cuenta agrupada al nivel pedido; saldo inicial (antes del período), débitos, créditos y
 *     saldo final con signo débito (+) / crédito (−). El total de débitos debe ser igual al de créditos.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import {
  createAccountSchema,
  journalQuerySchema,
  manualEntrySchema,
  trialBalanceQuerySchema,
  updateAccountSchema,
  voidCashReceiptSchema,
} from "@betel/contracts";
import { allowRoles, type MembershipRole } from "./auth.js";
import { assertBalanced, DEFAULT_ACCOUNTS } from "./accounting.js";
import { PAYROLL_ACCOUNTS } from "./payroll.js";
import {
  accountLevel,
  accountNature,
  accountTypeFor,
  catalogName,
  catalogNodes,
  childCode,
  parentCode,
} from "./puc.js";
import { REPORT_VIEW_ROLES, resolvePeriod, todayIn } from "./reports.js";

type Tx = Prisma.TransactionClient;
const ZERO = new Prisma.Decimal(0);

/** Crean y editan cuentas y comprobantes manuales; consultan balance y libro diario. */
export const LEDGER_ROLES: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT"];

export const SYSTEM_ACCOUNTS = new Set<string>([
  ...DEFAULT_ACCOUNTS.map(([code]) => code),
  ...PAYROLL_ACCOUNTS.map(([code]) => code),
]);

export const sourceLabels: Record<string, string> = {
  Invoice: "Factura de venta",
  CashReceipt: "Recibo de caja",
  OnlinePayment: "Pago en línea",
  PurchaseDocument: "Compra o gasto",
  SupportDocument: "Documento soporte",
  SupplierPayment: "Comprobante de egreso",
  InventoryDocument: "Documento de inventario",
  CostingRun: "Costeo mensual",
  PayrollRun: "Nómina",
  Manual: "Comprobante contable",
};

// ─── Cálculos puros (probados en test/ledger.test.ts) ────────────────────────

export type ChartAccount = { id: string | null; code: string; name: string; active: boolean };
export type Movement = { code: string; debit: Prisma.Decimal; credit: Prisma.Decimal; count: number };

/**
 * Árbol plano ordenado por código: estructura PUC + cuentas de la organización (+ ancestros que falten), con
 * débitos, créditos y saldo acumulados de cada nodo y sus descendientes.
 */
export function buildChart(accounts: ChartAccount[], movements: Movement[]) {
  const nodes = new Map<string, { code: string; name: string; id: string | null; active: boolean; org: boolean }>();
  for (const node of catalogNodes()) nodes.set(node.code, { ...node, id: null, active: true, org: false });
  for (const account of accounts) nodes.set(account.code, { ...account, org: true });
  // Ancestros que no están en el catálogo ni en la organización (p. ej. una cuenta de 4 dígitos no listada).
  for (const code of [...nodes.keys()]) {
    let parent = parentCode(code);
    while (parent && !nodes.has(parent)) {
      nodes.set(parent, {
        code: parent,
        name: catalogName(parent) ?? `Cuenta ${parent}`,
        id: null,
        active: true,
        org: false,
      });
      parent = parentCode(parent);
    }
  }
  const codes = [...nodes.keys()].sort();
  return codes.map(code => {
    const node = nodes.get(code)!;
    let debits = ZERO;
    let credits = ZERO;
    let count = 0;
    for (const movement of movements)
      if (movement.code.startsWith(code)) {
        debits = debits.plus(movement.debit);
        credits = credits.plus(movement.credit);
        count += movement.count;
      }
    const nature = accountNature(code);
    const hasChildren = codes.some(other => other !== code && parentCode(other) === code);
    return {
      code,
      name: node.name,
      id: node.id,
      level: accountLevel(code),
      nature,
      source: node.org ? ("ORG" as const) : ("PUC" as const),
      active: node.active,
      system: SYSTEM_ACCOUNTS.has(code),
      hasChildren,
      // Cuenta de movimiento: de la organización, activa y sin subcuentas.
      postable: node.org && node.active && !hasChildren && code.length >= 4,
      movements: count,
      debits: debits.toFixed(2),
      credits: credits.toFixed(2),
      balance: (nature === "DEBIT" ? debits.minus(credits) : credits.minus(debits)).toFixed(2),
    };
  });
}

/** Agrupa saldos por el prefijo del nivel pedido (las cuentas más cortas que el nivel quedan con su código). */
export function trialBalanceRows(
  accounts: { code: string; name: string }[],
  before: Map<string, Prisma.Decimal>,
  period: Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>,
  level: number
) {
  const rows = new Map<
    string,
    { code: string; opening: Prisma.Decimal; debits: Prisma.Decimal; credits: Prisma.Decimal }
  >();
  for (const account of accounts) {
    const key = account.code.slice(0, Math.min(level, account.code.length));
    const opening = before.get(account.code) ?? ZERO;
    const moves = period.get(account.code);
    if (opening.isZero() && !moves) continue;
    const row = rows.get(key) ?? { code: key, opening: ZERO, debits: ZERO, credits: ZERO };
    row.opening = row.opening.plus(opening);
    row.debits = row.debits.plus(moves?.debit ?? ZERO);
    row.credits = row.credits.plus(moves?.credit ?? ZERO);
    rows.set(key, row);
  }
  const names = new Map(accounts.map(account => [account.code, account.name]));
  return [...rows.values()]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(row => ({
      code: row.code,
      name: names.get(row.code) ?? catalogName(row.code) ?? `Cuenta ${row.code}`,
      nature: accountNature(row.code),
      opening: row.opening.toFixed(2),
      debits: row.debits.toFixed(2),
      credits: row.credits.toFixed(2),
      closing: row.opening.plus(row.debits).minus(row.credits).toFixed(2),
    }));
}

export const manualNumber = (number: number) => `CC-${number}`;

// ─── Consultas ────────────────────────────────────────────────────────────────

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const iso = (date: Date) => date.toISOString().slice(0, 10);

async function postedByAccount(tx: Tx, where: Prisma.JournalEntryWhereInput = {}) {
  const sums = await tx.journalLine.groupBy({
    by: ["accountId"],
    where: { journalEntry: { status: "POSTED", ...where } },
    _sum: { debit: true, credit: true },
    _count: { _all: true },
  });
  return sums;
}

async function loadChart(tx: Tx) {
  const accounts = await tx.account.findMany({ select: { id: true, code: true, name: true, active: true } });
  const sums = await postedByAccount(tx);
  const codeOf = new Map(accounts.map(account => [account.id, account.code]));
  const movements = sums.map(row => ({
    code: codeOf.get(row.accountId)!,
    debit: row._sum.debit ?? ZERO,
    credit: row._sum.credit ?? ZERO,
    count: row._count._all,
  }));
  return buildChart(accounts, movements);
}

async function nextManualNumber(tx: Tx) {
  const references = await tx.journalEntry.findMany({ where: { sourceType: "Manual" }, select: { reference: true } });
  const max = references.reduce((top, entry) => {
    const match = entry.reference.match(/^CC-(\d+)$/);
    return match ? Math.max(top, Number(match[1])) : top;
  }, 0);
  return max + 1;
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerLedgerRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowRoles(...REPORT_VIEW_ROLES) };
  const canEdit = { preHandler: allowRoles(...LEDGER_ROLES) };
  const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
  const audit = (
    tx: Tx,
    request: { ip: string; actor?: { organizationId: string; sub: string } },
    entity: string,
    entityId: string,
    action: string,
    after: Prisma.InputJsonValue
  ) =>
    tx.auditLog.create({
      data: {
        organizationId: request.actor!.organizationId,
        userId: request.actor!.sub,
        entity,
        entityId,
        action,
        after,
        ipHash: options.auditIp(request.ip),
      },
    });

  /** GET /v1/accounting/chart — árbol con saldos. */
  app.get("/v1/accounting/chart", canView, async request => ({
    data: await withOrganizationScope(request.actor!.organizationId, loadChart),
  }));

  /** POST /v1/accounting/accounts — Body: createAccountSchema. */
  app.post("/v1/accounting/accounts", canEdit, async (request, reply) => {
    const parsed = createAccountSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: parsed.error.issues[0]?.message ?? "Cuenta inválida" });
    const { parentCode: parent, suffix, name } = parsed.data;
    const code = childCode(parent, suffix);
    if (!code) return reply.code(422).send({ error: "Código inválido." });
    try {
      const created = await withOrganizationScope(request.actor!.organizationId, async tx => {
        const parentExists =
          catalogName(parent) !== null ||
          (await tx.account.findFirst({ where: { code: parent }, select: { id: true } }));
        if (!parentExists) throw httpError(404, `La cuenta ${parent} no existe.`);
        if (catalogName(code)) throw httpError(409, `La cuenta ${code} ya existe en el PUC (${catalogName(code)}).`);
        const account = await tx.account.create({
          data: { organizationId: request.actor!.organizationId, code, name, accountType: accountTypeFor(code) },
        });
        await audit(tx, request, "Account", account.id, "CREATE", { code, name });
        return account;
      });
      return reply.code(201).send({ data: { id: created.id, code: created.code } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: `La cuenta ${code} ya existe.` });
      throw error;
    }
  });

  /** PUT /v1/accounting/accounts/:id — Body: updateAccountSchema. */
  app.put<{ Params: { id: string } }>("/v1/accounting/accounts/:id", canEdit, async (request, reply) => {
    const parsed = updateAccountSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Cuenta no encontrada." });
    const updated = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const account = await tx.account.findFirst({ where: { id: request.params.id } });
      if (!account) throw httpError(404, "Cuenta no encontrada.");
      if (!parsed.data.active && SYSTEM_ACCOUNTS.has(account.code))
        throw httpError(
          409,
          `La cuenta ${account.code} la usan los comprobantes automáticos de Betel: no se puede inactivar.`
        );
      const row = await tx.account.update({ where: { id: account.id }, data: parsed.data });
      await audit(tx, request, "Account", account.id, "UPDATE", {
        before: { name: account.name, active: account.active },
        after: parsed.data,
      } as Prisma.InputJsonValue);
      return row;
    });
    return { data: { id: updated.id, code: updated.code } };
  });

  /** DELETE /v1/accounting/accounts/:id — sin movimientos, sin subcuentas y que no sea del sistema. */
  app.delete<{ Params: { id: string } }>("/v1/accounting/accounts/:id", canEdit, async (request, reply) => {
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Cuenta no encontrada." });
    const deleted = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const account = await tx.account.findFirst({
        where: { id: request.params.id },
        include: { _count: { select: { lines: true } } },
      });
      if (!account) throw httpError(404, "Cuenta no encontrada.");
      if (SYSTEM_ACCOUNTS.has(account.code))
        throw httpError(409, `La cuenta ${account.code} la usan los comprobantes automáticos: no se puede eliminar.`);
      if (account._count.lines)
        throw httpError(409, `La cuenta ${account.code} tiene movimientos: inactívala en lugar de eliminarla.`);
      const children = await tx.account.count({
        where: { code: { startsWith: account.code }, NOT: { id: account.id } },
      });
      if (children) throw httpError(409, `La cuenta ${account.code} tiene subcuentas: elimínalas primero.`);
      await tx.account.delete({ where: { id: account.id } });
      await audit(tx, request, "Account", account.id, "DELETE", { code: account.code, name: account.name });
      return account;
    });
    return { data: { id: deleted.id } };
  });

  /** GET /v1/accounting/trial-balance — Query: trialBalanceQuerySchema. */
  app.get("/v1/accounting/trial-balance", canEdit, async (request, reply) => {
    const parsed = trialBalanceQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const period = resolvePeriod(parsed.data);
    const result = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const accounts = await tx.account.findMany({ select: { id: true, code: true, name: true } });
      const codeOf = new Map(accounts.map(account => [account.id, account.code]));
      const [before, during] = await Promise.all([
        postedByAccount(tx, { date: { lt: period.from } }),
        postedByAccount(tx, { date: { gte: period.from, lte: period.to } }),
      ]);
      const beforeMap = new Map(
        before.map(row => [codeOf.get(row.accountId)!, (row._sum.debit ?? ZERO).minus(row._sum.credit ?? ZERO)])
      );
      const duringMap = new Map(
        during.map(row => [
          codeOf.get(row.accountId)!,
          { debit: row._sum.debit ?? ZERO, credit: row._sum.credit ?? ZERO },
        ])
      );
      // Los nombres de los niveles agregados salen del PUC o de la cuenta de la organización con ese código.
      const rows = trialBalanceRows(accounts, beforeMap, duringMap, parsed.data.level);
      return rows;
    });
    const sum = (field: "opening" | "debits" | "credits" | "closing") =>
      result.reduce((total, row) => total.plus(row[field]), ZERO);
    return {
      data: result,
      totals: {
        opening: sum("opening").toFixed(2),
        debits: sum("debits").toFixed(2),
        credits: sum("credits").toFixed(2),
        closing: sum("closing").toFixed(2),
      },
      balanced: sum("debits").equals(sum("credits")),
      period: { from: iso(period.from), to: iso(period.to) },
      level: parsed.data.level,
    };
  });

  /** GET /v1/accounting/journal — Query: journalQuerySchema. */
  app.get("/v1/accounting/journal", canEdit, async (request, reply) => {
    const parsed = journalQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const { page, pageSize, search, source } = parsed.data;
    const period = resolvePeriod(parsed.data);
    const where: Prisma.JournalEntryWhereInput = {
      status: { in: ["POSTED", "REVERSED"] },
      date: { gte: period.from, lte: period.to },
      ...(source === "MANUAL" && { sourceType: "Manual" }),
      ...(source === "AUTOMATIC" && { NOT: { sourceType: "Manual" } }),
      ...(search && {
        OR: [
          { reference: { contains: search, mode: "insensitive" as const } },
          { description: { contains: search, mode: "insensitive" as const } },
        ],
      }),
    };
    const [count, entries] = await withOrganizationScope(request.actor!.organizationId, tx =>
      Promise.all([
        tx.journalEntry.count({ where }),
        tx.journalEntry.findMany({
          where,
          include: { lines: { select: { debit: true, credit: true } } },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ])
    );
    return {
      data: entries.map(entry => ({
        id: entry.id,
        reference: entry.reference,
        date: iso(entry.date),
        description: entry.description,
        source: entry.sourceType,
        sourceLabel: sourceLabels[entry.sourceType ?? ""] ?? "Otro",
        status: entry.status,
        lines: entry.lines.length,
        total: entry.lines.reduce((sum, line) => sum.plus(line.debit), ZERO).toFixed(2),
      })),
      pagination: { page, pageSize, total: count },
      period: { from: iso(period.from), to: iso(period.to) },
    };
  });

  /** GET /v1/accounting/journal/:id — detalle con renglones. */
  app.get<{ Params: { id: string } }>("/v1/accounting/journal/:id", canEdit, async (request, reply) => {
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Comprobante no encontrado." });
    const entry = await withOrganizationScope(request.actor!.organizationId, tx =>
      tx.journalEntry.findFirst({
        where: { id: request.params.id },
        include: { lines: { include: { account: { select: { code: true, name: true } } } } },
      })
    );
    if (!entry) return reply.code(404).send({ error: "Comprobante no encontrado." });
    const debits = entry.lines.reduce((sum, line) => sum.plus(line.debit), ZERO);
    const credits = entry.lines.reduce((sum, line) => sum.plus(line.credit), ZERO);
    return {
      data: {
        id: entry.id,
        reference: entry.reference,
        date: iso(entry.date),
        description: entry.description,
        source: entry.sourceType,
        sourceId: entry.sourceId,
        sourceLabel: sourceLabels[entry.sourceType ?? ""] ?? "Otro",
        status: entry.status,
        postedAt: entry.postedAt?.toISOString() ?? null,
        lines: entry.lines
          .sort(
            (a, b) =>
              Number(b.debit.greaterThan(0)) - Number(a.debit.greaterThan(0)) ||
              a.account.code.localeCompare(b.account.code)
          )
          .map(line => ({
            id: line.id,
            code: line.account.code,
            name: line.account.name,
            memo: line.memo,
            debit: line.debit.toFixed(2),
            credit: line.credit.toFixed(2),
          })),
        debits: debits.toFixed(2),
        credits: credits.toFixed(2),
      },
    };
  });

  /** POST /v1/accounting/journal — comprobante manual. Body: manualEntrySchema. */
  app.post("/v1/accounting/journal", canEdit, async (request, reply) => {
    const parsed = manualEntrySchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(422)
        .send({ error: parsed.error.issues[0]?.message ?? "Comprobante inválido", details: parsed.error.flatten() });
    const body = parsed.data;
    if (body.date > todayIn("America/Bogota")) return reply.code(422).send({ error: "La fecha no puede ser futura." });
    try {
      const created = await withOrganizationScope(request.actor!.organizationId, async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`manual-entry:${request.actor!.organizationId}`}))`;
        const accounts = await tx.account.findMany({ where: { id: { in: body.lines.map(line => line.accountId) } } });
        const byId = new Map(accounts.map(account => [account.id, account]));
        for (const line of body.lines) {
          const account = byId.get(line.accountId);
          if (!account) throw httpError(404, "Una de las cuentas no existe en esta organización.");
          if (!account.active) throw httpError(422, `La cuenta ${account.code} está inactiva.`);
          const children = await tx.account.count({
            where: { code: { startsWith: account.code }, NOT: { id: account.id } },
          });
          if (children)
            throw httpError(422, `La cuenta ${account.code} tiene subcuentas: registra el movimiento en una de ellas.`);
        }
        const lines = body.lines.map(line => ({
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          memo: line.memo || null,
        }));
        assertBalanced(lines);
        const number = await nextManualNumber(tx);
        const entry = await tx.journalEntry.create({
          data: {
            organizationId: request.actor!.organizationId,
            reference: manualNumber(number),
            date: body.date,
            description: body.description,
            status: "POSTED",
            postedAt: new Date(),
            sourceType: "Manual",
            lines: { create: lines },
          },
        });
        await audit(tx, request, "JournalEntry", entry.id, "CREATE", {
          reference: entry.reference,
          total: lines.reduce((sum, line) => sum + line.debit, 0).toFixed(2),
          lines: lines.length,
        });
        return entry;
      });
      return reply.code(201).send({ data: { id: created.id, reference: created.reference } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: "Otro comprobante tomó el mismo número. Intenta de nuevo." });
      throw error;
    }
  });

  /** POST /v1/accounting/journal/:id/void — anula un comprobante manual (queda REVERSED y no suma). */
  app.post<{ Params: { id: string } }>("/v1/accounting/journal/:id/void", canEdit, async (request, reply) => {
    const parsed = voidCashReceiptSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: "Indica el motivo de la anulación (mínimo 3 caracteres)." });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Comprobante no encontrado." });
    const voided = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const entry = await tx.journalEntry.findFirst({ where: { id: request.params.id } });
      if (!entry) throw httpError(404, "Comprobante no encontrado.");
      if (entry.sourceType !== "Manual")
        throw httpError(409, "Solo se anulan comprobantes manuales; los automáticos se anulan desde su documento.");
      if (entry.status !== "POSTED") throw httpError(409, "El comprobante ya está anulado.");
      await tx.journalEntry.update({
        where: { id: entry.id },
        data: { status: "REVERSED", description: `${entry.description} — ANULADO: ${parsed.data.reason}` },
      });
      await audit(tx, request, "JournalEntry", entry.id, "VOID", {
        reference: entry.reference,
        reason: parsed.data.reason,
      });
      return entry;
    });
    return { data: { id: voided.id, status: "REVERSED" } };
  });
}
