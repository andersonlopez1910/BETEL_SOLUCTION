/**
 * Facturas recurrentes: plantillas que generan una factura EN BORRADOR en cada período.
 *
 * Rutas:
 *   GET  /v1/reports/billing/recurring-invoices ......... pestaña: filas paginadas
 *   GET  /v1/reports/billing/recurring-invoices/export .. todas las filas filtradas (Descargar)
 *   GET  /v1/recurring-invoices/:id ..................... detalle con las facturas generadas
 *   POST /v1/recurring-invoices ......................... crear plantilla
 *   POST /v1/recurring-invoices/:id/active .............. activar o desactivar. Body: { active }
 *   POST /v1/recurring-invoices/:id/generate ............ generar ya la factura del período pendiente
 *
 * GENERACIÓN AUTOMÁTICA (startRecurringScheduler): al arrancar la API y cada hora se revisan las plantillas
 * activas con nextRunDate ≤ hoy (hora de Colombia) de todas las organizaciones y se genera UNA factura por
 * plantilla, con fecha de elaboración = HOY: la DIAN exige que la fecha de elaboración coincida con la de
 * envío. Si la API estuvo detenida varios períodos, NO se generan facturas atrasadas en lote (saldrían todas
 * con la misma fecha): se genera la del período vencido y se salta a la siguiente fecha futura.
 *   - "Número de veces" limita las facturas generadas; al llegar al límite nextRunDate queda vacío.
 *   - La factura queda en borrador (como al convertir cotizaciones); su emisión es aparte (Ventas).
 *   - Responsable de la factura (AuditLog CREATE_DRAFT): quien la generó a mano o, si fue automática,
 *     quien creó la plantilla.
 *   - Variable RECURRING_SCHEDULER=false desactiva la generación automática (p. ej. en pruebas).
 */
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { prisma, Prisma, withOrganizationScope } from "@betel/db";
import {
  createRecurringInvoiceSchema,
  recurringInvoiceQuerySchema,
  toggleRecurringInvoiceSchema,
  type RecurringInvoiceQuery,
} from "@betel/contracts";
import { allowRoles } from "./auth.js";
import { calculateDocumentTotals } from "./accounting.js";
import { createDraftInvoiceFrom } from "./draft-invoice.js";
import { invoiceNumber } from "./collections.js";
import { QUOTE_ROLES } from "./quotes.js";
import { EXPORT_LIMIT, REPORT_EXPORT_ROLES, REPORT_VIEW_ROLES, resolvePeriod, todayIn } from "./reports.js";

type Tx = Prisma.TransactionClient;
type Frequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "BIMONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "ANNUAL";

const DAY_MS = 86_400_000;

// ─── Cálculos puros (probados en test/recurring.test.ts) ─────────────────────

/** Número visible de una factura recurrente. */
export const recurringNumber = (number: number) => `FR-${number}`;

const monthsPer: Partial<Record<Frequency, number>> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

/**
 * Fecha del período n (0 = fecha de inicio). En las frecuencias por meses se conserva el día de inicio y
 * se ajusta al último día del mes cuando no existe (31 ene → 28 feb → 31 mar).
 */
export function occurrenceDate(start: Date, frequency: Frequency, n: number) {
  if (frequency === "WEEKLY") return new Date(start.getTime() + 7 * n * DAY_MS);
  if (frequency === "BIWEEKLY") return new Date(start.getTime() + 14 * n * DAY_MS);
  const months = start.getUTCMonth() + monthsPer[frequency]! * n;
  const year = start.getUTCFullYear() + Math.floor(months / 12);
  const month = ((months % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(start.getUTCDate(), lastDay)));
}

/** Primer período con índice ≥ `from` cuya fecha sea posterior a `today` (o igual si `inclusive`). */
export function nextPeriodAfter(start: Date, frequency: Frequency, from: number, today: Date, inclusive = false) {
  let index = from;
  while (inclusive ? occurrenceDate(start, frequency, index) < today : occurrenceDate(start, frequency, index) <= today)
    index++;
  return { index, date: occurrenceDate(start, frequency, index) };
}

/**
 * Estado de la plantilla después de generar la factura del período `periodIndex` en la fecha `today`.
 * Devuelve el nuevo contador, el siguiente período y su fecha (null si se alcanzó "Número de veces").
 */
export function afterGeneration(
  template: {
    startDate: Date;
    frequency: Frequency;
    periodIndex: number;
    generatedCount: number;
    occurrences: number | null;
  },
  today: Date
) {
  const generatedCount = template.generatedCount + 1;
  const finished = template.occurrences !== null && generatedCount >= template.occurrences;
  const next = nextPeriodAfter(template.startDate, template.frequency, template.periodIndex + 1, today);
  return { generatedCount, periodIndex: next.index, nextRunDate: finished ? null : next.date };
}

/** Filtro de la lista. */
export function recurringWhere(query: RecurringInvoiceQuery): Prisma.RecurringInvoiceWhereInput {
  const period = resolvePeriod(query);
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  return {
    startDate: { gte: period.from, lte: period.to },
    ...(query.frequency && { frequency: query.frequency }),
    ...(query.active && { active: query.active === "true" }),
    ...(query.customer && {
      customer: {
        OR: [
          { legalName: contains(query.customer) },
          { tradeName: contains(query.customer) },
          { identificationNumber: contains(query.customer) },
        ],
      },
    }),
  };
}

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const today = () => todayIn("America/Bogota");
const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

// ─── Generación ───────────────────────────────────────────────────────────────

const templateInclude = { lines: true } satisfies Prisma.RecurringInvoiceInclude;
type Template = Prisma.RecurringInvoiceGetPayload<{ include: typeof templateInclude }>;

/**
 * Genera la factura en borrador del período pendiente de una plantilla (dentro de la transacción de su
 * organización) y avanza la plantilla. `userId`: quien la generó; null = automática.
 */
async function generateInvoice(tx: Tx, template: Template, userId: string | null, ipHash: string | null) {
  const now = today();
  const periodDate = template.nextRunDate!;
  const invoice = await createDraftInvoiceFrom(
    tx,
    template,
    {
      paymentMethod: template.paymentTerm,
      issueDate: now,
      dueDate: template.paymentTerm === "CREDIT" ? new Date(now.getTime() + template.dueDays! * DAY_MS) : undefined,
    },
    `Generada por la factura recurrente ${recurringNumber(template.number)} (período del ${dateOnly(periodDate)}).`
  );
  await tx.recurringInvoiceRun.create({ data: { recurringInvoiceId: template.id, invoiceId: invoice.id, periodDate } });
  const next = afterGeneration(template, now);
  await tx.recurringInvoice.update({ where: { id: template.id }, data: { ...next, lastRunAt: new Date() } });
  const responsible = userId ?? template.createdById;
  await tx.auditLog.createMany({
    data: [
      {
        organizationId: template.organizationId,
        userId: responsible,
        entity: "Invoice",
        entityId: invoice.id,
        action: "CREATE_DRAFT",
        after: {
          total: invoice.total.toString(),
          lines: template.lines.length,
          fromRecurring: recurringNumber(template.number),
        },
        ipHash,
      },
      {
        organizationId: template.organizationId,
        userId,
        entity: "RecurringInvoice",
        entityId: template.id,
        action: userId ? "GENERATE" : "GENERATE_AUTO",
        after: { invoiceId: invoice.id, periodDate: dateOnly(periodDate) },
        ipHash,
      },
    ],
  });
  return invoice;
}

/** Genera las facturas vencidas de todas las organizaciones. Cada plantilla en su propia transacción. */
export async function runDueRecurringInvoices(log: FastifyBaseLogger) {
  const organizations = await prisma.organization.findMany({ select: { id: true } });
  let generated = 0;
  for (const organization of organizations) {
    const due = await withOrganizationScope(organization.id, tx =>
      tx.recurringInvoice.findMany({
        where: { active: true, nextRunDate: { lte: today() } },
        select: { id: true },
        take: 500,
      })
    );
    for (const { id } of due) {
      try {
        const done = await withOrganizationScope(organization.id, async tx => {
          await tx.$queryRaw`SELECT id FROM "RecurringInvoice" WHERE id = ${id} FOR UPDATE`;
          const template = await tx.recurringInvoice.findFirst({
            where: { id, active: true, nextRunDate: { lte: today() } },
            include: templateInclude,
          });
          return template ? generateInvoice(tx, template, null, null) : null;
        });
        if (done) generated++;
      } catch (error) {
        log.error({ err: error, recurringInvoiceId: id }, "No se pudo generar la factura recurrente");
      }
    }
  }
  if (generated) log.info({ generated }, "Facturas recurrentes generadas");
  return generated;
}

/** Revisión automática: al arrancar (con 15 s de espera) y cada hora. */
export function startRecurringScheduler(log: FastifyBaseLogger) {
  if (process.env.RECURRING_SCHEDULER === "false") return;
  const run = () =>
    void runDueRecurringInvoices(log).catch(error => log.error({ err: error }, "Error en facturas recurrentes"));
  setTimeout(run, 15_000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}

// ─── Consultas ────────────────────────────────────────────────────────────────

async function loadRecurring(tx: Tx, query: RecurringInvoiceQuery, rows: { skip: number; take: number }) {
  const period = resolvePeriod(query);
  const where = recurringWhere(query);
  const count = await tx.recurringInvoice.count({ where });
  const templates = await tx.recurringInvoice.findMany({
    where,
    include: {
      customer: { select: { id: true, legalName: true, identificationType: true, identificationNumber: true } },
      createdBy: { select: { displayName: true } },
    },
    orderBy: [{ startDate: "desc" }, { number: "desc" }],
    skip: rows.skip,
    take: rows.take,
  });
  return {
    period: { from: dateOnly(period.from), to: dateOnly(period.to) },
    count,
    rows: templates.map(template => ({
      id: template.id,
      number: recurringNumber(template.number),
      customer: template.customer,
      branch: null,
      frequency: template.frequency,
      occurrences: template.occurrences,
      generatedCount: template.generatedCount,
      startDate: dateOnly(template.startDate),
      nextRunDate: template.nextRunDate ? dateOnly(template.nextRunDate) : null,
      active: template.active,
      paymentTerm: template.paymentTerm,
      total: template.total.toFixed(2),
      currency: template.currency,
      createdBy: template.createdBy?.displayName ?? null,
    })),
  };
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerRecurringRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowRoles(...REPORT_VIEW_ROLES) };
  const canExport = { preHandler: allowRoles(...REPORT_EXPORT_ROLES) };
  const canEdit = { preHandler: allowRoles(...QUOTE_ROLES) };
  const audit = (
    tx: Tx,
    request: { ip: string; actor?: { organizationId: string; sub: string } },
    entityId: string,
    action: string,
    after: Prisma.InputJsonValue
  ) =>
    tx.auditLog.create({
      data: {
        organizationId: request.actor!.organizationId,
        userId: request.actor!.sub,
        entity: "RecurringInvoice",
        entityId,
        action,
        after,
        ipHash: options.auditIp(request.ip),
      },
    });

  /** GET /v1/reports/billing/recurring-invoices — pestaña. Query: recurringInvoiceQuerySchema. */
  app.get("/v1/reports/billing/recurring-invoices", canView, async (request, reply) => {
    const parsed = recurringInvoiceQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const { page, pageSize } = parsed.data;
    const { rows, count, ...rest } = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadRecurring(tx, parsed.data, { skip: (page - 1) * pageSize, take: pageSize })
    );
    return { data: rows, pagination: { page, pageSize, total: count }, ...rest };
  });

  /** GET /v1/reports/billing/recurring-invoices/export — todas las filas filtradas (auditado). */
  app.get("/v1/reports/billing/recurring-invoices/export", canExport, async (request, reply) => {
    const parsed = recurringInvoiceQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const report = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await loadRecurring(tx, parsed.data, { skip: 0, take: EXPORT_LIMIT + 1 });
      if (result.count <= EXPORT_LIMIT)
        await tx.auditLog.create({
          data: {
            organizationId: request.actor!.organizationId,
            userId: request.actor!.sub,
            entity: "BillingReport",
            entityId: "recurring-invoices",
            action: "EXPORT",
            after: { filters: request.query, rows: result.count } as Prisma.InputJsonValue,
            ipHash: options.auditIp(request.ip),
          },
        });
      return result;
    });
    if (report.count > EXPORT_LIMIT)
      return reply
        .code(413)
        .send({ error: `La consulta supera ${EXPORT_LIMIT} filas. Acota el período o los filtros.` });
    const { rows, count, ...rest } = report;
    return { data: rows, total: count, ...rest };
  });

  /** GET /v1/recurring-invoices/:id — plantilla con sus líneas y las facturas generadas. */
  app.get<{ Params: { id: string } }>("/v1/recurring-invoices/:id", canView, async (request, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id))
      return reply.code(404).send({ error: "Factura recurrente no encontrada." });
    const template = await withOrganizationScope(request.actor!.organizationId, tx =>
      tx.recurringInvoice.findFirst({
        where: { id: request.params.id },
        include: {
          customer: { select: { legalName: true, identificationType: true, identificationNumber: true, email: true } },
          createdBy: { select: { displayName: true } },
          lines: true,
          runs: {
            include: {
              invoice: { select: { id: true, prefix: true, number: true, issueDate: true, status: true, total: true } },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      })
    );
    if (!template) return reply.code(404).send({ error: "Factura recurrente no encontrada." });
    return {
      data: {
        id: template.id,
        number: recurringNumber(template.number),
        customer: template.customer,
        frequency: template.frequency,
        startDate: dateOnly(template.startDate),
        occurrences: template.occurrences,
        generatedCount: template.generatedCount,
        nextRunDate: template.nextRunDate ? dateOnly(template.nextRunDate) : null,
        lastRunAt: template.lastRunAt?.toISOString() ?? null,
        active: template.active,
        paymentTerm: template.paymentTerm,
        dueDays: template.dueDays,
        currency: template.currency,
        notes: template.notes,
        createdBy: template.createdBy?.displayName ?? null,
        lines: template.lines.map(line => ({
          description: line.description,
          quantity: line.quantity.toString(),
          unitPrice: line.unitPrice.toFixed(2),
          discountRate: line.discountRate.toString(),
          taxRate: line.taxRate.toString(),
          total: line.lineTotal.toFixed(2),
        })),
        totals: [
          { label: "Subtotal", value: template.subtotal.toFixed(2) },
          { label: "Descuentos", value: template.discountTotal.toFixed(2) },
          { label: "Impuestos", value: template.taxTotal.toFixed(2) },
          { label: "Total por factura", value: template.total.toFixed(2) },
        ],
        runs: template.runs.map(run => ({
          periodDate: dateOnly(run.periodDate),
          createdAt: run.createdAt.toISOString(),
          invoice: {
            id: run.invoice.id,
            number: invoiceNumber(run.invoice),
            issueDate: dateOnly(run.invoice.issueDate),
            status: run.invoice.status,
            total: run.invoice.total.toFixed(2),
          },
        })),
      },
    };
  });

  /** POST /v1/recurring-invoices — crea la plantilla activa. Body: createRecurringInvoiceSchema. */
  app.post("/v1/recurring-invoices", canEdit, async (request, reply) => {
    const parsed = createRecurringInvoiceSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: "Factura recurrente inválida", details: parsed.error.flatten() });
    if (parsed.data.startDate < today())
      return reply.code(422).send({ error: "La fecha de inicio no puede ser anterior a hoy." });
    const actor = request.actor!;
    try {
      const template = await withOrganizationScope(actor.organizationId, async tx => {
        const customer = await tx.party.findFirst({
          where: { id: parsed.data.customerId, isCustomer: true },
          select: { id: true },
        });
        if (!customer) throw httpError(404, "Cliente no encontrado en esta organización.");
        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: actor.organizationId },
          select: { currency: true },
        });
        const totals = calculateDocumentTotals(parsed.data.lines);
        const last = await tx.recurringInvoice.aggregate({ _max: { number: true } });
        const created = await tx.recurringInvoice.create({
          data: {
            organizationId: actor.organizationId,
            customerId: customer.id,
            number: (last._max.number ?? 0) + 1,
            frequency: parsed.data.frequency,
            startDate: parsed.data.startDate,
            occurrences: parsed.data.occurrences,
            nextRunDate: parsed.data.startDate,
            paymentTerm: parsed.data.paymentMethod,
            dueDays: parsed.data.paymentMethod === "CREDIT" ? parsed.data.dueDays : null,
            currency: organization.currency,
            notes: parsed.data.notes || undefined,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            taxTotal: totals.taxTotal,
            total: totals.total,
            createdById: actor.sub,
            lines: {
              create: totals.lines.map(line => ({
                productId: line.productId,
                description: line.description,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                discountRate: line.discountRate ?? 0,
                taxRate: line.taxRate,
                lineTotal: line.total,
              })),
            },
          },
        });
        await audit(tx, request, created.id, "CREATE", { number: created.number, total: created.total.toFixed(2) });
        return created;
      });
      return reply.code(201).send({ data: { id: template.id, number: recurringNumber(template.number) } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: "Otra factura recurrente tomó el mismo consecutivo. Intenta de nuevo." });
      throw error;
    }
  });

  /**
   * POST /v1/recurring-invoices/:id/active — activa o desactiva. Al reactivar, los períodos que pasaron
   * mientras estuvo inactiva no se generan: la siguiente fecha es la primera desde hoy.
   */
  app.post<{ Params: { id: string } }>("/v1/recurring-invoices/:id/active", canEdit, async (request, reply) => {
    const parsed = toggleRecurringInvoiceSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: "Indica si queda activa.", details: parsed.error.flatten() });
    const updated = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const template = await tx.recurringInvoice.findFirst({ where: { id: request.params.id } });
      if (!template) return null;
      let next = {};
      if (parsed.data.active && template.nextRunDate && template.nextRunDate < today()) {
        const period = nextPeriodAfter(template.startDate, template.frequency, template.periodIndex, today(), true);
        next = { periodIndex: period.index, nextRunDate: period.date };
      }
      const result = await tx.recurringInvoice.update({
        where: { id: template.id },
        data: { active: parsed.data.active, ...next },
      });
      await audit(tx, request, template.id, parsed.data.active ? "ACTIVATE" : "DEACTIVATE", {
        active: parsed.data.active,
      });
      return result;
    });
    if (!updated) return reply.code(404).send({ error: "Factura recurrente no encontrada." });
    return {
      data: {
        id: updated.id,
        active: updated.active,
        nextRunDate: updated.nextRunDate ? dateOnly(updated.nextRunDate) : null,
      },
    };
  });

  /** POST /v1/recurring-invoices/:id/generate — genera ya la factura del período pendiente (con fecha de hoy). */
  app.post<{ Params: { id: string } }>("/v1/recurring-invoices/:id/generate", canEdit, async (request, reply) => {
    const actor = request.actor!;
    const invoice = await withOrganizationScope(actor.organizationId, async tx => {
      await tx.$queryRaw`SELECT id FROM "RecurringInvoice" WHERE id = ${request.params.id} FOR UPDATE`;
      const template = await tx.recurringInvoice.findFirst({
        where: { id: request.params.id, active: true, nextRunDate: { not: null } },
        include: templateInclude,
      });
      return template ? generateInvoice(tx, template, actor.sub, options.auditIp(request.ip)) : null;
    });
    if (!invoice)
      return reply.code(404).send({ error: "Factura recurrente activa con períodos pendientes no encontrada." });
    return reply.code(201).send({
      data: { invoiceId: invoice.id, total: invoice.total.toFixed(2) },
      message: "Factura creada en borrador con la fecha de hoy. Se emite desde Ventas.",
    });
  });
}
