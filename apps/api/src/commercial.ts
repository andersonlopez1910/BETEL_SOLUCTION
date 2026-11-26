/**
 * Seguimiento comercial: tareas de gestión con contactos (clientes o prospectos) y su oportunidad.
 *
 * Rutas:
 *   GET  /v1/reports/billing/commercial-tasks ......... búsqueda paginada con los criterios del reporte
 *   GET  /v1/reports/billing/commercial-tasks/export .. todas las tareas filtradas (copiar, imprimir, exportar)
 *   GET  /v1/commercial/contacts ...................... contactos para la tarea (terceros, máx. 50)
 *   POST /v1/commercial-tasks ......................... crear tarea
 *   POST /v1/commercial-tasks/:id ..................... editar tarea (pendiente)
 *   POST /v1/commercial-tasks/:id/complete ............ completar con resultado
 *   POST /v1/commercial-tasks/:id/reopen .............. volver a pendiente
 *
 * DEFINICIONES:
 *   - Vencida: tarea pendiente con fecha de compromiso anterior a hoy (se calcula).
 *   - "Todos los contactos": sin marcar, solo tareas de contactos activos; marcado, también de inactivos.
 *   - Probabilidad de cierre: 0 a 100 %; el filtro usa rangos (0-25, 26-50, 51-75, 76-100).
 *   - Valor esperado: filtro "desde" (valor esperado ≥ al indicado).
 *   - Las fechas de creación y modificación filtran por día completo en hora de Colombia.
 *   - El responsable debe ser usuario de la organización.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import {
  commercialTaskQuerySchema,
  commercialTaskSchema,
  completeCommercialTaskSchema,
  type CommercialTaskQuery,
} from "@betel/contracts";
import { allowPermission } from "./auth.js";
import { QUOTE_ROLES } from "./quotes.js";
import { EXPORT_LIMIT, REPORT_EXPORT_ROLES, REPORT_VIEW_ROLES, todayIn } from "./reports.js";

type Tx = Prisma.TransactionClient;
const DAY_MS = 86_400_000;
/** Colombia es UTC−5 todo el año: el día local empieza a las 05:00 UTC. */
const BOGOTA_OFFSET_MS = 5 * 3_600_000;

// ─── Cálculos puros (probados en test/commercial.test.ts) ────────────────────

export const taskNumber = (number: number) => `TC-${number}`;

/** Rango de fecha y hora (createdAt/updatedAt) que cubre días completos en hora de Colombia. */
export function bogotaDayRange(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  return {
    ...(from && { gte: new Date(from.getTime() + BOGOTA_OFFSET_MS) }),
    ...(to && { lt: new Date(to.getTime() + DAY_MS + BOGOTA_OFFSET_MS) }),
  };
}

/** Rango de probabilidad "26-50" → { gte: 26, lte: 50 }. */
export function probabilityRange(range?: string) {
  if (!range) return undefined;
  const [gte, lte] = range.split("-").map(Number);
  return { gte: gte!, lte: lte! };
}

export const isTaskOverdue = (task: { status: string; dueDate: Date | null }, today: Date) =>
  task.status === "PENDING" && task.dueDate !== null && task.dueDate < today;

export function taskWhere(query: CommercialTaskQuery): Prisma.CommercialTaskWhereInput {
  const created = bogotaDayRange(query.createdFrom, query.createdTo);
  const updated = bogotaDayRange(query.updatedFrom, query.updatedTo);
  return {
    ...(query.status !== "ALL" && { status: query.status }),
    ...(created && { createdAt: created }),
    ...(updated && { updatedAt: updated }),
    ...((query.dueFrom || query.dueTo) && {
      dueDate: { ...(query.dueFrom && { gte: query.dueFrom }), ...(query.dueTo && { lte: query.dueTo }) },
    }),
    ...(query.responsibleIds && { responsibleId: { in: query.responsibleIds } }),
    ...(query.createdById && { createdById: query.createdById }),
    ...(query.description && { description: { contains: query.description, mode: "insensitive" } }),
    ...(query.allContacts === "false" && { party: { active: true } }),
    ...(query.progress && { progress: query.progress }),
    ...(query.stage && { stage: query.stage }),
    ...(query.probability && { probability: probabilityRange(query.probability) }),
    ...(query.minExpectedValue !== undefined && { expectedValue: { gte: query.minExpectedValue } }),
    ...(query.commitment && { commitment: query.commitment }),
    ...(query.origin && { origin: query.origin }),
    ...(query.companyType && { companyType: query.companyType }),
  };
}

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

// ─── Consultas ────────────────────────────────────────────────────────────────

const include = {
  party: {
    select: {
      id: true,
      legalName: true,
      identificationType: true,
      identificationNumber: true,
      email: true,
      phone: true,
      active: true,
    },
  },
  responsible: { select: { id: true, displayName: true } },
  createdBy: { select: { id: true, displayName: true } },
} satisfies Prisma.CommercialTaskInclude;

async function loadTasks(tx: Tx, query: CommercialTaskQuery, rows: { skip: number; take: number }) {
  const today = todayIn("America/Bogota");
  const where = taskWhere(query);
  const count = await tx.commercialTask.count({ where });
  const tasks = await tx.commercialTask.findMany({
    where,
    include,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    skip: rows.skip,
    take: rows.take,
  });
  const totals = await tx.commercialTask.aggregate({ where, _sum: { expectedValue: true } });
  return {
    count,
    rows: tasks.map(task => ({
      id: task.id,
      number: taskNumber(task.number),
      party: task.party,
      description: task.description,
      commitment: task.commitment,
      dueDate: task.dueDate ? dateOnly(task.dueDate) : null,
      overdue: isTaskOverdue(task, today),
      stage: task.stage,
      progress: task.progress,
      probability: task.probability,
      expectedValue: task.expectedValue?.toFixed(2) ?? null,
      origin: task.origin,
      companyType: task.companyType,
      status: task.status,
      result: task.result,
      completedAt: task.completedAt?.toISOString() ?? null,
      responsible: task.responsible,
      createdBy: task.createdBy,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    })),
    summary: { expectedValue: (totals._sum.expectedValue ?? new Prisma.Decimal(0)).toFixed(2) },
  };
}

/** Valida contacto y responsable dentro de la organización. */
async function validateRefs(tx: Tx, organizationId: string, partyId: string, responsibleId: string) {
  const party = await tx.party.findFirst({ where: { id: partyId }, select: { id: true } });
  if (!party) throw httpError(404, "Contacto no encontrado en esta organización.");
  const member = await tx.membership.findFirst({
    where: { organizationId, userId: responsibleId },
    select: { id: true },
  });
  if (!member) throw httpError(422, "El responsable no es usuario de esta organización.");
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerCommercialRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowPermission("reports.view") };
  const canExport = { preHandler: allowPermission("reports.export") };
  const canEdit = { preHandler: allowPermission("sales.documents") };
  const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
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
        entity: "CommercialTask",
        entityId,
        action,
        after,
        ipHash: options.auditIp(request.ip),
      },
    });
  const data = (input: ReturnType<typeof commercialTaskSchema.parse>) => ({
    partyId: input.partyId,
    description: input.description,
    commitment: input.commitment,
    dueDate: input.dueDate ?? null,
    responsibleId: input.responsibleId,
    stage: input.stage,
    progress: input.progress,
    probability: input.probability,
    expectedValue: input.expectedValue ?? null,
    origin: input.origin ?? null,
    companyType: input.companyType ?? null,
  });

  /** GET /v1/reports/billing/commercial-tasks — Query: commercialTaskQuerySchema. */
  app.get("/v1/reports/billing/commercial-tasks", canView, async (request, reply) => {
    const parsed = commercialTaskQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(422).send({ error: "Criterios de búsqueda inválidos", details: parsed.error.flatten() });
    const { page, pageSize } = parsed.data;
    const { rows, count, ...rest } = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadTasks(tx, parsed.data, { skip: (page - 1) * pageSize, take: pageSize })
    );
    return { data: rows, pagination: { page, pageSize, total: count }, ...rest };
  });

  /** GET /v1/reports/billing/commercial-tasks/export — todas las tareas filtradas (auditado). */
  app.get("/v1/reports/billing/commercial-tasks/export", canExport, async (request, reply) => {
    const parsed = commercialTaskQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(422).send({ error: "Criterios de búsqueda inválidos", details: parsed.error.flatten() });
    const report = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await loadTasks(tx, parsed.data, { skip: 0, take: EXPORT_LIMIT + 1 });
      if (result.count <= EXPORT_LIMIT)
        await tx.auditLog.create({
          data: {
            organizationId: request.actor!.organizationId,
            userId: request.actor!.sub,
            entity: "BillingReport",
            entityId: "commercial-tasks",
            action: "EXPORT",
            after: { filters: request.query, rows: result.count } as Prisma.InputJsonValue,
            ipHash: options.auditIp(request.ip),
          },
        });
      return result;
    });
    if (report.count > EXPORT_LIMIT)
      return reply.code(413).send({ error: `La consulta supera ${EXPORT_LIMIT} filas. Acota los criterios.` });
    const { rows, count, ...rest } = report;
    return { data: rows, total: count, ...rest };
  });

  /** GET /v1/commercial/contacts?search= — terceros activos para asignar a una tarea (máx. 50). */
  app.get<{ Querystring: { search?: string } }>("/v1/commercial/contacts", canEdit, async request => {
    const search = request.query.search?.trim().slice(0, 120);
    const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
    const contacts = await withOrganizationScope(request.actor!.organizationId, tx =>
      tx.party.findMany({
        where: {
          active: true,
          ...(search && {
            OR: [
              { legalName: contains(search) },
              { tradeName: contains(search) },
              { identificationNumber: contains(search) },
            ],
          }),
        },
        select: { id: true, legalName: true, identificationType: true, identificationNumber: true, isCustomer: true },
        orderBy: { legalName: "asc" },
        take: 50,
      })
    );
    return { data: contacts };
  });

  /** POST /v1/commercial-tasks — crea una tarea pendiente. Body: commercialTaskSchema. */
  app.post("/v1/commercial-tasks", canEdit, async (request, reply) => {
    const parsed = commercialTaskSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Tarea inválida", details: parsed.error.flatten() });
    const actor = request.actor!;
    try {
      const task = await withOrganizationScope(actor.organizationId, async tx => {
        await validateRefs(tx, actor.organizationId, parsed.data.partyId, parsed.data.responsibleId);
        const last = await tx.commercialTask.aggregate({ _max: { number: true } });
        const created = await tx.commercialTask.create({
          data: {
            ...data(parsed.data),
            organizationId: actor.organizationId,
            number: (last._max.number ?? 0) + 1,
            createdById: actor.sub,
          },
        });
        await audit(tx, request, created.id, "CREATE", {
          number: created.number,
          responsibleId: created.responsibleId,
        });
        return created;
      });
      return reply.code(201).send({ data: { id: task.id, number: taskNumber(task.number) } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: "Otra tarea tomó el mismo consecutivo. Intenta de nuevo." });
      throw error;
    }
  });

  /** POST /v1/commercial-tasks/:id — edita una tarea pendiente. Body: commercialTaskSchema. */
  app.post<{ Params: { id: string } }>("/v1/commercial-tasks/:id", canEdit, async (request, reply) => {
    const parsed = commercialTaskSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Tarea inválida", details: parsed.error.flatten() });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Tarea no encontrada." });
    const actor = request.actor!;
    const updated = await withOrganizationScope(actor.organizationId, async tx => {
      const task = await tx.commercialTask.findFirst({ where: { id: request.params.id, status: "PENDING" } });
      if (!task) return null;
      await validateRefs(tx, actor.organizationId, parsed.data.partyId, parsed.data.responsibleId);
      const result = await tx.commercialTask.update({ where: { id: task.id }, data: data(parsed.data) });
      await audit(tx, request, task.id, "UPDATE", {
        stage: result.stage,
        progress: result.progress,
        probability: result.probability,
      });
      return result;
    });
    if (!updated) return reply.code(404).send({ error: "Tarea pendiente no encontrada." });
    return { data: { id: updated.id } };
  });

  /** POST /v1/commercial-tasks/:id/complete — completa la tarea con su resultado. */
  app.post<{ Params: { id: string } }>("/v1/commercial-tasks/:id/complete", canEdit, async (request, reply) => {
    const parsed = completeCommercialTaskSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(422)
        .send({ error: "Escribe el resultado de la gestión (mínimo 3 caracteres).", details: parsed.error.flatten() });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Tarea no encontrada." });
    const done = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await tx.commercialTask.updateMany({
        where: { id: request.params.id, status: "PENDING" },
        data: { status: "COMPLETED", result: parsed.data.result, completedAt: new Date() },
      });
      if (result.count) await audit(tx, request, request.params.id, "COMPLETE", { result: parsed.data.result });
      return result.count;
    });
    if (!done) return reply.code(404).send({ error: "Tarea pendiente no encontrada." });
    return { data: { id: request.params.id, status: "COMPLETED" } };
  });

  /** POST /v1/commercial-tasks/:id/reopen — vuelve a pendiente una tarea completada. */
  app.post<{ Params: { id: string } }>("/v1/commercial-tasks/:id/reopen", canEdit, async (request, reply) => {
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Tarea no encontrada." });
    const reopened = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await tx.commercialTask.updateMany({
        where: { id: request.params.id, status: "COMPLETED" },
        data: { status: "PENDING", completedAt: null },
      });
      if (result.count) await audit(tx, request, request.params.id, "REOPEN", { status: "PENDING" });
      return result.count;
    });
    if (!reopened) return reply.code(404).send({ error: "Tarea completada no encontrada." });
    return { data: { id: request.params.id, status: "PENDING" } };
  });
}
