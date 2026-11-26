/**
 * Compras y gastos › Registro de eventos en factura electrónica de proveedores (Res. DIAN 000085 de 2022).
 *
 * Para que una factura de venta a crédito recibida de un proveedor sirva como soporte de costos, deducciones o
 * impuestos descontables, el comprador registra su CUFE y envía a la DIAN, en orden:
 *   030 Acuse de recibo de la factura → 032 Recibo del bien o prestación del servicio →
 *   033 Aceptación expresa  o  031 Reclamo (con motivo 01–04).
 * La aceptación o el reclamo deben hacerse dentro de los 3 días hábiles siguientes al 032; después opera la
 * aceptación tácita (la registra el emisor, no el comprador) y la factura pasa a "Eventos finalizados".
 *
 * Rutas:
 *   GET  /v1/reports/purchases/events ................ lista paginada (pestañas "en proceso" y "finalizados")
 *   GET  /v1/purchases/received-invoices/:id ........ detalle con el historial de eventos
 *   POST /v1/purchases/received-invoices ............ "Registrar nueva factura" (409 si el CUFE ya existe)
 *   POST /v1/purchases/received-invoices/:id/events . registrar un evento y enviarlo al proveedor DIAN
 *
 * Los eventos pasan por el puerto DIAN (dian.ts). Con el adaptador de pruebas quedan "En cola" y se permite
 * continuar con el siguiente; con un proveedor real, el anterior debe estar aceptado por la DIAN.
 * Ver docs/compras-y-gastos.md.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import {
  claimReasons,
  receivedInvoiceEventSchema,
  receivedInvoiceQuerySchema,
  registerReceivedInvoiceSchema,
  type ReceivedInvoiceQuery,
} from "@betel/contracts";
import { allowPermission } from "./auth.js";
import { RECEIPT_ROLES } from "./collections.js";
import { dianIsSandbox, getDianProvider } from "./dian.js";
import { REPORT_VIEW_ROLES, todayIn } from "./reports.js";

type Tx = Prisma.TransactionClient;
type EventType = "RECEIPT" | "GOODS_RECEIPT" | "ACCEPTANCE" | "CLAIM";

export const eventCodes: Record<EventType, string> = {
  RECEIPT: "030",
  CLAIM: "031",
  GOODS_RECEIPT: "032",
  ACCEPTANCE: "033",
};
export const eventLabels: Record<EventType, string> = {
  RECEIPT: "Recepción de factura",
  GOODS_RECEIPT: "Recepción de mercancía o servicio",
  ACCEPTANCE: "Aceptación expresa",
  CLAIM: "Reclamo",
};
/** Días hábiles para aceptar o reclamar después del recibo del bien (032). */
export const RESPONSE_BUSINESS_DAYS = 3;

// ─── Cálculos puros (probados en test/received-invoices.test.ts) ─────────────

const DAY = 86_400_000;
const utcDate = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher, calendario gregoriano). */
export function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

/** Festivos de Colombia (Ley 51 de 1983): fijos, trasladados al lunes siguiente y los que dependen de la Pascua. */
export function colombianHolidays(year: number) {
  const nextMonday = (date: Date) => new Date(date.getTime() + ((8 - date.getUTCDay()) % 7) * DAY);
  const easter = easterSunday(year).getTime();
  const fromEaster = (days: number) => new Date(easter + days * DAY);
  const dates = [
    ...[
      [1, 1],
      [5, 1],
      [7, 20],
      [8, 7],
      [12, 8],
      [12, 25],
    ].map(([month, day]) => utcDate(year, month!, day!)),
    ...[
      [1, 6],
      [3, 19],
      [6, 29],
      [8, 15],
      [10, 12],
      [11, 1],
      [11, 11],
    ].map(([month, day]) => nextMonday(utcDate(year, month!, day!))),
    // Jueves y Viernes Santo; Ascensión, Corpus Christi y Sagrado Corazón (ya trasladados a lunes).
    ...[-3, -2, 43, 64, 71].map(fromEaster),
  ];
  return new Set(dates.map(iso));
}

/** true si la fecha (UTC a medianoche) es día hábil en Colombia: ni sábado, ni domingo, ni festivo. */
export function isBusinessDay(date: Date) {
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !colombianHolidays(date.getUTCFullYear()).has(iso(date));
}

/** Fecha que resulta de contar `days` días hábiles después de `date` (sin contar el mismo día). */
export function addBusinessDays(date: Date, days: number) {
  let current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  let left = days;
  while (left > 0) {
    current = new Date(current.getTime() + DAY);
    if (isBusinessDay(current)) left--;
  }
  return current;
}

type EventState = { type: EventType; dianStatus: string };
type InvoiceState = { events: EventState[]; outcome: EventType | null; responseDeadline: Date | null };

/** Finalizada: aceptada, reclamada o con el plazo vencido (aceptación tácita). */
export const isFinalized = (invoice: InvoiceState, today: Date) =>
  Boolean(invoice.outcome) || (invoice.responseDeadline !== null && invoice.responseDeadline < today);

/**
 * Si se puede registrar el evento: devuelve null o el motivo por el que no. `requireAccepted` exige que el evento
 * anterior esté aceptado por la DIAN (proveedor real); con el de pruebas basta con que esté registrado.
 */
export function eventBlocked(invoice: InvoiceState, type: EventType, today: Date, requireAccepted: boolean) {
  const has = (wanted: EventType) => invoice.events.find(event => event.type === wanted);
  const ready = (wanted: EventType) => {
    const event = has(wanted);
    return event && (!requireAccepted || event.dianStatus === "ACCEPTED");
  };
  if (has(type)) return `Ya registraste ${eventLabels[type].toLowerCase()}.`;
  if (type === "RECEIPT") return null;
  if (!has("RECEIPT")) return "Primero registra la recepción de la factura (030).";
  if (!ready("RECEIPT")) return "La DIAN aún no ha aceptado el acuse de recibo (030).";
  if (type === "GOODS_RECEIPT") return null;
  if (!has("GOODS_RECEIPT")) return "Primero registra la recepción de la mercancía o del servicio (032).";
  if (!ready("GOODS_RECEIPT")) return "La DIAN aún no ha aceptado el recibo del bien (032).";
  if (invoice.outcome)
    return invoice.outcome === "ACCEPTANCE" ? "La factura ya fue aceptada." : "La factura ya fue reclamada.";
  if (invoice.responseDeadline && invoice.responseDeadline < today)
    return "Venció el plazo de 3 días hábiles: opera la aceptación tácita.";
  return null;
}

// ─── Consultas ────────────────────────────────────────────────────────────────

/** Columnas que pueden estar vacías (evento aún sin registrar). */
const nullableSort = new Set(["receiptAt", "goodsReceiptAt", "outcomeAt"]);

const BOGOTA_OFFSET = 5 * 60 * 60 * 1000; // UTC-5, sin horario de verano

function where(query: ReceivedInvoiceQuery, today: Date): Prisma.ReceivedInvoiceWhereInput {
  const status: Prisma.ReceivedInvoiceWhereInput =
    query.status === "finalized"
      ? { OR: [{ outcome: { not: null } }, { responseDeadline: { lt: today } }] }
      : { outcome: null, OR: [{ responseDeadline: null }, { responseDeadline: { gte: today } }] };
  return {
    AND: [
      status,
      ...(query.supplier
        ? [
            {
              OR: [
                { supplierName: { contains: query.supplier, mode: "insensitive" as const } },
                { supplierNit: { contains: query.supplier } },
              ],
            },
          ]
        : []),
    ],
    ...((query.from || query.to) && {
      createdAt: {
        ...(query.from && { gte: new Date(query.from.getTime() + BOGOTA_OFFSET) }),
        ...(query.to && { lt: new Date(query.to.getTime() + DAY + BOGOTA_OFFSET) }),
      },
    }),
    ...(query.cufe && { cufe: { contains: query.cufe.toLowerCase() } }),
    ...(query.number && { number: { contains: query.number, mode: "insensitive" as const } }),
  };
}

const eventSelect = {
  id: true,
  type: true,
  dianStatus: true,
  claimReason: true,
  notes: true,
  receiverName: true,
  receiverDocument: true,
  receiverRole: true,
  createdAt: true,
  createdBy: { select: { displayName: true, email: true } },
} satisfies Prisma.ReceivedInvoiceEventSelect;

type InvoiceRecord = Prisma.ReceivedInvoiceGetPayload<{ include: { events: { select: typeof eventSelect } } }>;

function present(invoice: InvoiceRecord, today: Date) {
  const event = (type: EventType) => {
    const found = invoice.events.find(item => item.type === type);
    return found ? { at: found.createdAt.toISOString(), dianStatus: found.dianStatus } : null;
  };
  const outcome = invoice.outcome ? invoice.events.find(item => item.type === invoice.outcome) : null;
  const finalized = isFinalized(invoice, today);
  const requireAccepted = !dianIsSandbox();
  return {
    id: invoice.id,
    cufe: invoice.cufe,
    supplierId: invoice.supplierId,
    supplierNit: invoice.supplierNit,
    supplierName: invoice.supplierName,
    number: invoice.number,
    issueDate: iso(invoice.issueDate),
    total: invoice.total?.toFixed(2) ?? null,
    createdAt: invoice.createdAt.toISOString(),
    receipt: event("RECEIPT"),
    goodsReceipt: event("GOODS_RECEIPT"),
    outcome: outcome
      ? {
          type: outcome.type,
          at: outcome.createdAt.toISOString(),
          dianStatus: outcome.dianStatus,
          claimReason: outcome.claimReason,
        }
      : null,
    responseDeadline: invoice.responseDeadline ? iso(invoice.responseDeadline) : null,
    tacitAcceptance: !invoice.outcome && finalized,
    finalized,
    actions: (["RECEIPT", "GOODS_RECEIPT", "ACCEPTANCE", "CLAIM"] as const).map(type => ({
      type,
      blocked: eventBlocked(invoice, type, today, requireAccepted),
    })),
  };
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export function registerReceivedInvoiceRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowPermission("reports.view") };
  const canRegister = { preHandler: allowPermission("purchases.manage") };
  const today = () => todayIn("America/Bogota");
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
        entity: "ReceivedInvoice",
        entityId,
        action,
        after,
        ipHash: options.auditIp(request.ip),
      },
    });

  /** GET /v1/reports/purchases/events — Query: receivedInvoiceQuerySchema. */
  app.get("/v1/reports/purchases/events", canView, async (request, reply) => {
    const parsed = receivedInvoiceQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const query = parsed.data;
    const now = today();
    const filter = where(query, now);
    const [rows, total, processing, finalized] = await withOrganizationScope(request.actor!.organizationId, tx =>
      Promise.all([
        tx.receivedInvoice.findMany({
          where: filter,
          include: { events: { select: eventSelect } },
          // Los nulos (evento aún sin registrar) van al final en ambos sentidos.
          orderBy: [
            {
              [query.sort]: nullableSort.has(query.sort) ? { sort: query.direction, nulls: "last" } : query.direction,
            },
            { id: "asc" },
          ],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.receivedInvoice.count({ where: filter }),
        tx.receivedInvoice.count({ where: where({ ...query, status: "processing" }, now) }),
        tx.receivedInvoice.count({ where: where({ ...query, status: "finalized" }, now) }),
      ])
    );
    return {
      data: rows.map(row => present(row, now)),
      pagination: { page: query.page, pageSize: query.pageSize, total },
      counts: { processing, finalized },
      sandbox: dianIsSandbox(),
    };
  });

  /** GET /v1/purchases/received-invoices/:id — detalle con historial de eventos. */
  app.get<{ Params: { id: string } }>("/v1/purchases/received-invoices/:id", canView, async (request, reply) => {
    const invoice = await withOrganizationScope(request.actor!.organizationId, tx =>
      tx.receivedInvoice.findFirst({
        where: { id: request.params.id },
        include: {
          events: { select: eventSelect, orderBy: { createdAt: "asc" } },
          createdBy: { select: { displayName: true, email: true } },
        },
      })
    );
    if (!invoice) return reply.code(404).send({ error: "Factura no encontrada." });
    return {
      data: {
        ...present(invoice, today()),
        createdBy: invoice.createdBy?.displayName ?? invoice.createdBy?.email ?? null,
        events: invoice.events.map(event => ({
          id: event.id,
          type: event.type,
          code: eventCodes[event.type],
          label: eventLabels[event.type],
          dianStatus: event.dianStatus,
          claimReason: event.claimReason
            ? `${event.claimReason} ${claimReasons[event.claimReason as keyof typeof claimReasons]}`
            : null,
          notes: event.notes,
          receiver: event.receiverName
            ? { name: event.receiverName, document: event.receiverDocument, role: event.receiverRole }
            : null,
          at: event.createdAt.toISOString(),
          by: event.createdBy?.displayName ?? event.createdBy?.email ?? null,
        })),
      },
      sandbox: dianIsSandbox(),
    };
  });

  /** POST /v1/purchases/received-invoices — Body: registerReceivedInvoiceSchema. */
  app.post("/v1/purchases/received-invoices", canRegister, async (request, reply) => {
    const parsed = registerReceivedInvoiceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Datos inválidos", details: parsed.error.flatten() });
    const body = parsed.data;
    if (body.issueDate > today()) return reply.code(422).send({ error: "La fecha de la factura no puede ser futura." });
    const actor = request.actor!;
    try {
      const invoice = await withOrganizationScope(actor.organizationId, async tx => {
        // Se enlaza al tercero proveedor con la misma identificación, si existe.
        const supplier = await tx.party.findFirst({
          where: { identificationNumber: body.supplierNit, isSupplier: true },
          select: { id: true },
        });
        const created = await tx.receivedInvoice.create({
          data: {
            organizationId: actor.organizationId,
            cufe: body.cufe,
            supplierId: supplier?.id ?? null,
            supplierNit: body.supplierNit,
            supplierName: body.supplierName,
            number: body.number,
            issueDate: body.issueDate,
            total:
              body.total === "" || body.total === undefined ? null : new Prisma.Decimal(body.total).toDecimalPlaces(2),
            createdById: actor.sub,
          },
        });
        await audit(tx, request, created.id, "CREATE", { cufe: created.cufe, number: created.number });
        return created;
      });
      return reply.code(201).send({ data: { id: invoice.id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: "Esa factura (CUFE) ya está registrada." });
      throw error;
    }
  });

  /** POST /v1/purchases/received-invoices/:id/events — Body: receivedInvoiceEventSchema. */
  app.post<{ Params: { id: string } }>(
    "/v1/purchases/received-invoices/:id/events",
    canRegister,
    async (request, reply) => {
      const parsed = receivedInvoiceEventSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(422).send({ error: "Revisa los datos del evento.", details: parsed.error.flatten() });
      const body = parsed.data;
      const actor = request.actor!;
      const now = today();
      try {
        const event = await withOrganizationScope(actor.organizationId, async tx => {
          // Bloquea la fila para que dos eventos simultáneos no se salten el orden.
          await tx.$queryRaw`SELECT id FROM "ReceivedInvoice" WHERE id = ${request.params.id} FOR UPDATE`;
          const invoice = await tx.receivedInvoice.findFirst({
            where: { id: request.params.id },
            include: { events: { select: eventSelect } },
          });
          if (!invoice) throw httpError(404, "Factura no encontrada.");
          const blocked = eventBlocked(invoice, body.type, now, !dianIsSandbox());
          if (blocked) throw httpError(409, blocked);

          const created = await tx.receivedInvoiceEvent.create({
            data: {
              organizationId: actor.organizationId,
              receivedInvoiceId: invoice.id,
              type: body.type,
              dianStatus: "PENDING",
              claimReason: body.type === "CLAIM" ? body.claimReason : null,
              notes: body.notes || null,
              ...((body.type === "RECEIPT" || body.type === "GOODS_RECEIPT") && {
                receiverName: body.receiverName,
                receiverDocument: body.receiverDocument,
                receiverRole: body.receiverRole,
              }),
              createdById: actor.sub,
            },
          });
          const submission = await getDianProvider().submitDocumentEvent({
            eventId: created.id,
            organizationId: actor.organizationId,
            cufe: invoice.cufe,
            code: eventCodes[body.type],
          });
          await tx.receivedInvoiceEvent.update({
            where: { id: created.id },
            data: {
              dianStatus: submission.status,
              providerResponse: submission.providerResponse as Prisma.InputJsonValue,
            },
          });
          await tx.receivedInvoice.update({
            where: { id: invoice.id },
            data:
              body.type === "RECEIPT"
                ? { receiptAt: created.createdAt }
                : body.type === "GOODS_RECEIPT"
                  ? {
                      goodsReceiptAt: created.createdAt,
                      responseDeadline: addBusinessDays(now, RESPONSE_BUSINESS_DAYS),
                    }
                  : { outcome: body.type, outcomeAt: created.createdAt },
          });
          await audit(tx, request, invoice.id, `EVENT_${eventCodes[body.type]}`, {
            type: body.type,
            dianStatus: submission.status,
            ...(body.claimReason && { claimReason: body.claimReason }),
          });
          return { id: created.id, dianStatus: submission.status };
        });
        return reply.code(201).send({ data: event });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
          return reply.code(409).send({ error: "Ese evento ya está registrado." });
        throw error;
      }
    }
  );
}
