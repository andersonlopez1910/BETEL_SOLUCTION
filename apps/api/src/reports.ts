/**
 * Reporte de facturación: consultas de SOLO LECTURA sobre los datos que ya existen.
 *
 * Rutas (prefijo /v1/reports/billing):
 *   GET /users ................ usuarios de la organización (filtro "Usuario responsable")
 *   GET /sales ................ Ventas: filas paginadas + indicadores + series por día y mes
 *   GET /sales/export ......... Ventas: todas las filas filtradas (máx. EXPORT_LIMIT) para CSV/XLSX/PDF
 *   GET /customers ............ Clientes: consolidado paginado
 *   GET /customers/export ..... Clientes: todas las filas filtradas
 *   GET /customers/:id ........ Detalle de un cliente: historial de facturas y evolución mensual
 *
 * Permisos: ver REPORT_VIEW_ROLES y REPORT_EXPORT_ROLES. SUPPORT no ve información financiera.
 * Cada exportación queda registrada en AuditLog (action "EXPORT").
 *
 * DEFINICIONES DE CÁLCULO (también en docs/reporte-facturacion.md):
 *   - Factura vigente: estado ISSUED, ACCEPTED u OVERDUE. Los borradores (DRAFT) no son ventas;
 *     las anuladas (VOID) y rechazadas (REJECTED) se listan pero NO suman en los indicadores.
 *   - Total de ventas: suma de Invoice.total de las facturas vigentes del período.
 *     Subtotal, descuentos e impuestos: suma de los campos guardados en cada factura (no se recalculan).
 *   - Promedio por factura: total de ventas / cantidad de facturas vigentes (2 decimales).
 *   - Comparación: el período anterior tiene la misma cantidad de días y termina el día antes de "desde".
 *   - Responsable: usuario del AuditLog "CREATE_DRAFT" de la factura (la tabla Invoice no guarda autor).
 *   - Facturas vencidas: estado OVERDUE. No hay tabla de pagos, así que no se calculan recaudos ni saldos.
 *   - Todas las sumas usan Decimal (Prisma.Decimal), nunca Number.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import {
  customerReportQuerySchema,
  salesReportQuerySchema,
  type CustomerReportQuery,
  type SalesReportQuery,
} from "@betel/contracts";
import { allowRoles, type MembershipRole } from "./auth.js";

/** Pueden consultar el reporte (información financiera). */
export const REPORT_VIEW_ROLES: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT", "SALES", "VIEWER"];
/** Pueden exportar (sacar la información del sistema). */
export const REPORT_EXPORT_ROLES: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT"];
/** Estados que cuentan como facturación vigente. */
export const BILLED_STATUSES = ["ISSUED", "ACCEPTED", "OVERDUE"] as const;
/** Máximo de filas por exportación; por encima se pide acotar los filtros. */
export const EXPORT_LIMIT = 5000;

const DAY_MS = 86_400_000;
const ZERO = new Prisma.Decimal(0);

type Tx = Prisma.TransactionClient;
type Period = { from: Date; to: Date };
type Bucket = { period: string; total: string; count: number };

// ─── Cálculos puros (probados en test/reports.test.ts) ────────────────────────

/** Fecha de hoy en la zona horaria indicada, como Date UTC a medianoche (igual que Prisma guarda @db.Date). */
export function todayIn(timeZone: string, now = new Date()) {
  return new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone }).format(now)}T00:00:00Z`);
}

/** Período consultado. Por defecto: del día 1 del mes actual hasta hoy (hora de Colombia). */
export function resolvePeriod(query: { from?: Date; to?: Date }, now = new Date()): Period {
  const to = query.to ?? todayIn("America/Bogota", now);
  const from = query.from ?? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  return { from, to };
}

/** Período anterior de igual duración que termina el día antes de `from`. */
export function previousPeriod({ from, to }: Period): Period {
  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
  const previousTo = new Date(from.getTime() - DAY_MS);
  return { from: new Date(previousTo.getTime() - (days - 1) * DAY_MS), to: previousTo };
}

/** Variación porcentual con 1 decimal; null si el período anterior es 0 (no hay base de comparación). */
export function percentChange(current: Prisma.Decimal, previous: Prisma.Decimal) {
  if (previous.isZero()) return null;
  return current.minus(previous).dividedBy(previous).times(100).toDecimalPlaces(1).toFixed(1);
}

/** Promedio con 2 decimales; 0 si no hay facturas. */
export function average(total: Prisma.Decimal, count: number) {
  return count ? total.dividedBy(count).toDecimalPlaces(2).toFixed(2) : "0.00";
}

/** Totales diarios (resultado de groupBy por issueDate) ordenados por fecha. */
export function toDailyBuckets(
  groups: { issueDate: Date; _sum: { total: Prisma.Decimal | null }; _count: { _all: number } }[]
) {
  return groups
    .map(group => ({
      period: group.issueDate.toISOString().slice(0, 10),
      total: (group._sum.total ?? ZERO).toFixed(2),
      count: group._count._all,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

/** Agrupa totales diarios por mes (AAAA-MM). */
export function foldByMonth(days: Bucket[]): Bucket[] {
  const months = new Map<string, { total: Prisma.Decimal; count: number }>();
  for (const day of days) {
    const key = day.period.slice(0, 7);
    const month = months.get(key) ?? { total: ZERO, count: 0 };
    months.set(key, { total: month.total.plus(day.total), count: month.count + day.count });
  }
  return [...months].map(([period, month]) => ({ period, total: month.total.toFixed(2), count: month.count }));
}

/** Filtro de facturas de la pestaña Ventas. Sin filtro de estado se excluyen los borradores. */
export function salesWhere(query: SalesReportQuery, period: Period, createdByIds?: string[]): Prisma.InvoiceWhereInput {
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  return {
    issueDate: { gte: period.from, lte: period.to },
    status: query.status ?? { not: "DRAFT" },
    ...(query.number && { OR: [{ number: contains(query.number) }, { prefix: contains(query.number) }] }),
    ...(query.customer && {
      customer: {
        OR: [
          { legalName: contains(query.customer) },
          { tradeName: contains(query.customer) },
          { identificationNumber: contains(query.customer) },
        ],
      },
    }),
    ...(createdByIds && { id: { in: createdByIds } }),
  };
}

/** Restringe un filtro a facturas vigentes: base de TODOS los indicadores. */
export function billedOnly(where: Prisma.InvoiceWhereInput): Prisma.InvoiceWhereInput {
  return { AND: [where, { status: { in: [...BILLED_STATUSES] } }] };
}

/** Filtro de clientes por nombre, nombre comercial o identificación. */
export function customerWhere(search?: string): Prisma.PartyWhereInput {
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  return {
    isCustomer: true,
    ...(search && {
      OR: [
        { legalName: contains(search) },
        { tradeName: contains(search) },
        { identificationNumber: contains(search) },
      ],
    }),
  };
}

const dateOnly = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

// ─── Consultas ────────────────────────────────────────────────────────────────

const invoiceRowSelect = {
  id: true,
  prefix: true,
  number: true,
  issueDate: true,
  dueDate: true,
  status: true,
  dianStatus: true,
  paymentTerm: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  total: true,
  customer: { select: { id: true, legalName: true, identificationType: true, identificationNumber: true } },
} satisfies Prisma.InvoiceSelect;

/** Ids de las facturas creadas por un usuario (según AuditLog). */
async function invoiceIdsCreatedBy(tx: Tx, userId: string) {
  const logs = await tx.auditLog.findMany({
    where: { entity: "Invoice", action: "CREATE_DRAFT", userId },
    select: { entityId: true },
  });
  return logs.map(log => log.entityId);
}

/** Agrega el usuario responsable (creador) a cada fila. Una sola consulta por página. */
async function withResponsible<T extends { id: string }>(tx: Tx, rows: T[]) {
  const logs = await tx.auditLog.findMany({
    where: { entity: "Invoice", action: "CREATE_DRAFT", entityId: { in: rows.map(row => row.id) } },
    select: { entityId: true, user: { select: { id: true, displayName: true } } },
  });
  const byInvoice = new Map(logs.map(log => [log.entityId, log.user]));
  return rows.map(row => ({ ...row, responsible: byInvoice.get(row.id) ?? null }));
}

/** Suma de los campos monetarios de las facturas vigentes que cumplen el filtro. */
async function billedTotals(tx: Tx, where: Prisma.InvoiceWhereInput) {
  const result = await tx.invoice.aggregate({
    where: billedOnly(where),
    _count: { _all: true },
    _sum: { subtotal: true, discountTotal: true, taxTotal: true, total: true },
  });
  return {
    invoiceCount: result._count._all,
    subtotal: result._sum.subtotal ?? ZERO,
    discountTotal: result._sum.discountTotal ?? ZERO,
    taxTotal: result._sum.taxTotal ?? ZERO,
    total: result._sum.total ?? ZERO,
  };
}

/** Totales diarios de facturas vigentes (issueDate es solo fecha, así que agrupar por ella es agrupar por día). */
async function dailyTotals(tx: Tx, where: Prisma.InvoiceWhereInput) {
  const groups = await tx.invoice.groupBy({
    by: ["issueDate"],
    where: billedOnly(where),
    _sum: { total: true },
    _count: { _all: true },
  });
  return toDailyBuckets(groups);
}

async function loadSalesReport(tx: Tx, query: SalesReportQuery, rows: { skip: number; take: number }) {
  const period = resolvePeriod(query);
  const previous = previousPeriod(period);
  const createdBy = query.userId ? await invoiceIdsCreatedBy(tx, query.userId) : undefined;
  const where = salesWhere(query, period, createdBy);
  const previousWhere = salesWhere(query, previous, createdBy);

  const count = await tx.invoice.count({ where });
  const page = await tx.invoice.findMany({
    where,
    select: invoiceRowSelect,
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    skip: rows.skip,
    take: rows.take,
  });
  const current = await billedTotals(tx, where);
  const before = await billedTotals(tx, previousWhere);
  const byDay = await dailyTotals(tx, where);

  return {
    period: { from: dateOnly(period.from), to: dateOnly(period.to) },
    count,
    rows: await withResponsible(tx, page),
    summary: {
      invoiceCount: current.invoiceCount,
      subtotal: current.subtotal.toFixed(2),
      discountTotal: current.discountTotal.toFixed(2),
      taxTotal: current.taxTotal.toFixed(2),
      total: current.total.toFixed(2),
      average: average(current.total, current.invoiceCount),
      previous: {
        from: dateOnly(previous.from),
        to: dateOnly(previous.to),
        invoiceCount: before.invoiceCount,
        total: before.total.toFixed(2),
      },
      change: percentChange(current.total, before.total),
    },
    byDay,
    byMonth: foldByMonth(byDay),
  };
}

async function loadCustomerReport(tx: Tx, query: CustomerReportQuery, rows: { skip: number; take: number }) {
  const period = resolvePeriod(query);
  const where = customerWhere(query.search);
  const count = await tx.party.count({ where });
  const parties = await tx.party.findMany({
    where,
    select: { id: true, legalName: true, tradeName: true, identificationType: true, identificationNumber: true },
    orderBy: { legalName: "asc" },
    skip: rows.skip,
    take: rows.take,
  });
  const inPeriod = {
    customerId: { in: parties.map(party => party.id) },
    issueDate: { gte: period.from, lte: period.to },
  };
  const billed = await tx.invoice.groupBy({
    by: ["customerId"],
    where: { ...inPeriod, status: { in: [...BILLED_STATUSES] } },
    _count: { _all: true },
    _sum: { total: true },
    _max: { issueDate: true },
  });
  const overdue = await tx.invoice.groupBy({
    by: ["customerId"],
    where: { ...inPeriod, status: "OVERDUE" },
    _count: { _all: true },
  });
  // Totales de TODOS los clientes filtrados (no solo de la página).
  const totals = await billedTotals(tx, { customer: where, issueDate: { gte: period.from, lte: period.to } });

  const billedBy = new Map(billed.map(group => [group.customerId, group]));
  const overdueBy = new Map(overdue.map(group => [group.customerId, group._count._all]));
  return {
    period: { from: dateOnly(period.from), to: dateOnly(period.to) },
    count,
    rows: parties.map(party => {
      const group = billedBy.get(party.id);
      return {
        ...party,
        invoiceCount: group?._count._all ?? 0,
        totalInvoiced: (group?._sum.total ?? ZERO).toFixed(2),
        overdueCount: overdueBy.get(party.id) ?? 0,
        lastInvoiceDate: dateOnly(group?._max.issueDate ?? null),
      };
    }),
    summary: { invoiceCount: totals.invoiceCount, total: totals.total.toFixed(2) },
  };
}

async function loadCustomerDetail(tx: Tx, customerId: string, query: CustomerReportQuery) {
  const customer = await tx.party.findFirst({
    where: { id: customerId, isCustomer: true },
    select: {
      id: true,
      legalName: true,
      tradeName: true,
      identificationType: true,
      identificationNumber: true,
      email: true,
      phone: true,
    },
  });
  if (!customer) return null;
  const period = resolvePeriod(query);
  const where: Prisma.InvoiceWhereInput = {
    customerId,
    issueDate: { gte: period.from, lte: period.to },
    status: { not: "DRAFT" },
  };
  const count = await tx.invoice.count({ where });
  const invoices = await tx.invoice.findMany({
    where,
    select: invoiceRowSelect,
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  const totals = await billedTotals(tx, where);
  const overdueCount = await tx.invoice.count({ where: { ...where, status: "OVERDUE" } });
  const byDay = await dailyTotals(tx, where);
  return {
    customer,
    period: { from: dateOnly(period.from), to: dateOnly(period.to) },
    count,
    rows: await withResponsible(tx, invoices),
    summary: {
      invoiceCount: totals.invoiceCount,
      total: totals.total.toFixed(2),
      average: average(totals.total, totals.invoiceCount),
      overdueCount,
      lastInvoiceDate: byDay.at(-1)?.period ?? null,
    },
    byMonth: foldByMonth(byDay),
  };
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerBillingReportRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowRoles(...REPORT_VIEW_ROLES) };
  const canExport = { preHandler: allowRoles(...REPORT_EXPORT_ROLES) };
  const invalid = "Filtros del reporte inválidos";
  const tooMany = `La consulta supera ${EXPORT_LIMIT} filas. Acota el período o los filtros para exportar.`;

  /** Registra la exportación en AuditLog (quién sacó qué información y con qué filtros). */
  const auditExport = (
    tx: Tx,
    request: { ip: string; actor?: { organizationId: string; sub: string } },
    report: string,
    filters: unknown,
    rows: number
  ) =>
    tx.auditLog.create({
      data: {
        organizationId: request.actor!.organizationId,
        userId: request.actor!.sub,
        entity: "BillingReport",
        entityId: report,
        action: "EXPORT",
        after: { filters, rows } as Prisma.InputJsonValue,
        ipHash: options.auditIp(request.ip),
      },
    });

  /** GET /v1/reports/billing/users — Miembros de la organización, para el filtro "Usuario responsable". */
  app.get("/v1/reports/billing/users", canView, async request => {
    const actor = request.actor!;
    const memberships = await withOrganizationScope(actor.organizationId, tx =>
      tx.membership.findMany({
        where: { organizationId: actor.organizationId },
        select: { user: { select: { id: true, displayName: true } } },
        orderBy: { user: { displayName: "asc" } },
      })
    );
    return { data: memberships.map(membership => membership.user) };
  });

  /** GET /v1/reports/billing/sales — Ventas. Query: salesReportQuerySchema. */
  app.get("/v1/reports/billing/sales", canView, async (request, reply) => {
    const parsed = salesReportQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: invalid, details: parsed.error.flatten() });
    const { page, pageSize } = parsed.data;
    const report = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadSalesReport(tx, parsed.data, { skip: (page - 1) * pageSize, take: pageSize })
    );
    const { rows, count, ...rest } = report;
    return { data: rows, pagination: { page, pageSize, total: count }, ...rest };
  });

  /** GET /v1/reports/billing/sales/export — Todas las filas filtradas (sin paginar) + indicadores. */
  app.get("/v1/reports/billing/sales/export", canExport, async (request, reply) => {
    const parsed = salesReportQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: invalid, details: parsed.error.flatten() });
    const report = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await loadSalesReport(tx, parsed.data, { skip: 0, take: EXPORT_LIMIT + 1 });
      if (result.count <= EXPORT_LIMIT) await auditExport(tx, request, "sales", request.query, result.count);
      return result;
    });
    if (report.count > EXPORT_LIMIT) return reply.code(413).send({ error: tooMany });
    const { rows, count, ...rest } = report;
    return { data: rows, total: count, ...rest };
  });

  /** GET /v1/reports/billing/customers — Consolidado por cliente. Query: customerReportQuerySchema. */
  app.get("/v1/reports/billing/customers", canView, async (request, reply) => {
    const parsed = customerReportQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: invalid, details: parsed.error.flatten() });
    const { page, pageSize } = parsed.data;
    const report = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadCustomerReport(tx, parsed.data, { skip: (page - 1) * pageSize, take: pageSize })
    );
    const { rows, count, ...rest } = report;
    return { data: rows, pagination: { page, pageSize, total: count }, ...rest };
  });

  /** GET /v1/reports/billing/customers/export — Todos los clientes filtrados (sin paginar). */
  app.get("/v1/reports/billing/customers/export", canExport, async (request, reply) => {
    const parsed = customerReportQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: invalid, details: parsed.error.flatten() });
    const report = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await loadCustomerReport(tx, parsed.data, { skip: 0, take: EXPORT_LIMIT + 1 });
      if (result.count <= EXPORT_LIMIT) await auditExport(tx, request, "customers", request.query, result.count);
      return result;
    });
    if (report.count > EXPORT_LIMIT) return reply.code(413).send({ error: tooMany });
    const { rows, count, ...rest } = report;
    return { data: rows, total: count, ...rest };
  });

  /** GET /v1/reports/billing/customers/:id — Historial de facturas y evolución mensual de un cliente. */
  app.get<{ Params: { id: string } }>("/v1/reports/billing/customers/:id", canView, async (request, reply) => {
    const parsed = customerReportQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: invalid, details: parsed.error.flatten() });
    const detail = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadCustomerDetail(tx, request.params.id, parsed.data)
    );
    if (!detail) return reply.code(404).send({ error: "Cliente no encontrado." });
    const { rows, count, ...rest } = detail;
    return {
      data: rows,
      pagination: { page: parsed.data.page, pageSize: parsed.data.pageSize, total: count },
      ...rest,
    };
  });
}
