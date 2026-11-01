/**
 * API REST de Betel Solution (Fastify).
 *
 * Punto de entrada: `corepack pnpm dev` (desde la raíz) la ejecuta en http://localhost:4000.
 *
 * Convenciones de TODAS las rutas de negocio (respetarlas al agregar rutas nuevas):
 *   1. Seguridad: `preHandler: requireActor` (cualquier usuario) o `allowRoles(...)` (roles específicos).
 *   2. Validación: el body se valida con un esquema de @betel/contracts usando `safeParse`.
 *      Si falla → 422 con `details` para que el formulario muestre los errores.
 *   3. Multiempresa: los datos se leen/escriben con `withOrganizationScope(actor.organizationId, ...)`.
 *      El organizationId sale SIEMPRE del token (`request.actor`), nunca del body.
 *   4. Auditoría: toda creación o cambio relevante registra una fila en `AuditLog`
 *      dentro de la misma transacción.
 *   5. Respuesta: `{ data: ... }` (201 al crear).
 *
 * Mapa de rutas (prefijo /v1):
 *   Sesión ........... POST /auth/dev/session (solo desarrollo), GET /me
 *   Terceros ......... GET/POST /parties
 *   Productos ........ GET/POST /products
 *   Calendario ....... GET/POST /calendar-events
 *   Facturas ......... GET/POST /invoices, POST /invoices/:id/issue
 *   Doc. soporte ..... GET/POST /support-documents, POST /support-documents/:id/issue
 *   Contabilidad ..... GET /accounting/journal-entries
 *   Notificaciones ... GET /notifications, POST /notifications/:id/read
 *
 * Cuando este archivo crezca, la idea es dividirlo en `src/routes/<modulo>.ts` (ver docs/TAREAS.md).
 */
import { createHash } from "node:crypto";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { prisma, withOrganizationScope } from "@betel/db";
import type { Prisma } from "@betel/db";
import {
  calendarEventSchema,
  createInvoiceSchema,
  createSupportDocumentSchema,
  partySchema,
  productSchema,
} from "@betel/contracts";
import { allowRoles, requireActor, type BetelJwt } from "./auth.js";
import { assertBalanced, calculateDocumentTotals, ensureDefaultAccounts } from "./accounting.js";
import { getDianProvider } from "./dian.js";

// ─── Configuración ────────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === "production";
// En desarrollo hay un secreto por defecto; en producción JWT_SECRET es obligatorio (la API no arranca sin él).
const jwtSecret =
  process.env.JWT_SECRET ?? (isProduction ? undefined : "betel-local-development-secret-change-before-production");
if (!jwtSecret) throw new Error("JWT_SECRET es obligatorio en producción.");

const app = Fastify({ logger: true });
// CORS: solo el frontend (WEB_ORIGIN) puede llamar a la API desde el navegador.
await app.register(cors, { origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" });
// Tokens de corta duración (15 min) para reducir el impacto si uno se filtra.
await app.register(jwt, { secret: jwtSecret, sign: { expiresIn: "15m" } });

/**
 * La IP del usuario se guarda en AuditLog como hash (SHA-256 con el secreto como "sal"),
 * no en texto claro, por protección de datos personales. Permite comparar IPs sin exponerlas.
 */
const auditIp = (ip: string) => createHash("sha256").update(`${jwtSecret}:${ip}`).digest("hex");

// ─── Salud y sesión ───────────────────────────────────────────────────────────

/** Verificación de que la API está viva (la usan monitoreo y docs/human-test.md). Pública. */
app.get("/health", async () => ({ status: "ok", service: "betel-api", at: new Date().toISOString() }));

/**
 * POST /v1/auth/dev/session — SOLO DESARROLLO.
 * Crea (o reutiliza) un usuario OWNER y una organización de prueba y devuelve un token, sin contraseña.
 * Se registra únicamente si NODE_ENV ≠ production Y BETEL_ALLOW_INSECURE_DEV_AUTH=true.
 * Reemplazar por un login real (OIDC + MFA) antes de producción.
 *
 * Body opcional: { email?: string, organizationNit?: string }
 */
if (!isProduction && process.env.BETEL_ALLOW_INSECURE_DEV_AUTH === "true") {
  app.post("/v1/auth/dev/session", async request => {
    const body = (request.body ?? {}) as { email?: string; organizationNit?: string };
    const email = body.email?.trim().toLowerCase() || "owner@betel.local";
    const nit = body.organizationNit?.replace(/\D/g, "") || "900999001";
    const user = await prisma.user.upsert({
      where: { email },
      update: { active: true },
      create: { email, displayName: "Propietario local", active: true },
    });
    const organization = await prisma.organization.upsert({
      where: { nit },
      update: {},
      create: { nit, verificationDigit: "1", legalName: "Organización de desarrollo Betel", dianEnabled: false },
    });
    const membership = await prisma.membership.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
      update: { role: "OWNER" },
      create: { organizationId: organization.id, userId: user.id, role: "OWNER" },
    });
    const payload: BetelJwt = {
      sub: user.id,
      email: user.email,
      organizationId: organization.id,
      role: membership.role,
    };
    return {
      accessToken: app.jwt.sign(payload),
      expiresIn: 900,
      organization: { id: organization.id, legalName: organization.legalName },
      user: { id: user.id, email: user.email },
    };
  });
}

/** GET /v1/me — Usuario actual, su rol y la organización activa. Útil para el encabezado del frontend. */
app.get("/v1/me", { preHandler: requireActor }, async request => {
  const actor = request.actor!;
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: actor.organizationId },
    select: { id: true, legalName: true, nit: true, dianEnabled: true },
  });
  return { user: { id: actor.sub, email: actor.email, role: actor.role }, organization };
});

// ─── Terceros (clientes / proveedores) ────────────────────────────────────────

/**
 * GET /v1/parties — Lista los terceros de la organización ordenados por nombre.
 * PENDIENTE: paginación y búsqueda (hoy devuelve máximo 50).
 */
app.get("/v1/parties", { preHandler: requireActor }, async request => {
  const actor = request.actor!;
  const data = await withOrganizationScope(actor.organizationId, tx =>
    tx.party.findMany({ orderBy: { legalName: "asc" }, take: 50 })
  );
  return { data };
});

/**
 * POST /v1/parties — Crea un tercero. Body: partySchema (@betel/contracts).
 * Roles: OWNER, ADMIN, ACCOUNTANT, SALES. Registra AuditLog "CREATE".
 */
app.post("/v1/parties", { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT", "SALES") }, async (request, reply) => {
  const parsed = partySchema.safeParse(request.body);
  if (!parsed.success)
    return reply.code(422).send({ error: "Datos del tercero inválidos", details: parsed.error.flatten() });
  const actor = request.actor!;
  const party = await withOrganizationScope(actor.organizationId, async tx => {
    const created = await tx.party.create({ data: { ...parsed.data, organizationId: actor.organizationId } });
    await tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.sub,
        entity: "Party",
        entityId: created.id,
        action: "CREATE",
        after: parsed.data,
        ipHash: auditIp(request.ip),
      },
    });
    return created;
  });
  return reply.code(201).send({ data: party });
});

// ─── Productos y servicios ────────────────────────────────────────────────────

/** GET /v1/products — Catálogo activo de la organización (máx. 100). */
app.get("/v1/products", { preHandler: requireActor }, async request => {
  const actor = request.actor!;
  return {
    data: await withOrganizationScope(actor.organizationId, tx =>
      tx.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 100 })
    ),
  };
});

/**
 * POST /v1/products — Crea un producto o servicio. Body: productSchema.
 * Roles: OWNER, ADMIN, ACCOUNTANT, SALES.
 * PENDIENTE: editar y desactivar (active = false) productos.
 */
app.post(
  "/v1/products",
  { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT", "SALES") },
  async (request, reply) => {
    const parsed = productSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: "Producto o servicio inválido", details: parsed.error.flatten() });
    const actor = request.actor!;
    const product = await withOrganizationScope(actor.organizationId, async tx => {
      const created = await tx.product.create({ data: { ...parsed.data, organizationId: actor.organizationId } });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.sub,
          entity: "Product",
          entityId: created.id,
          action: "CREATE",
          after: parsed.data,
          ipHash: auditIp(request.ip),
        },
      });
      return created;
    });
    return reply.code(201).send({ data: product });
  }
);

// ─── Calendario ───────────────────────────────────────────────────────────────

/** GET /v1/calendar-events — Eventos de la organización ordenados por fecha de inicio. */
app.get("/v1/calendar-events", { preHandler: requireActor }, async request => {
  const actor = request.actor!;
  return {
    data: await withOrganizationScope(actor.organizationId, tx =>
      tx.calendarEvent.findMany({ orderBy: { startsAt: "asc" }, take: 100 })
    ),
  };
});

/** POST /v1/calendar-events — Crea un evento; el creador queda como dueño (ownerId). Body: calendarEventSchema. */
app.post("/v1/calendar-events", { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT") }, async (request, reply) => {
  const parsed = calendarEventSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(422).send({ error: "Evento inválido", details: parsed.error.flatten() });
  const actor = request.actor!;
  const event = await withOrganizationScope(actor.organizationId, async tx => {
    const created = await tx.calendarEvent.create({
      data: { ...parsed.data, organizationId: actor.organizationId, ownerId: actor.sub },
    });
    await tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.sub,
        entity: "CalendarEvent",
        entityId: created.id,
        action: "CREATE",
        after: { title: created.title, startsAt: created.startsAt },
        ipHash: auditIp(request.ip),
      },
    });
    return created;
  });
  return reply.code(201).send({ data: event });
});

// ─── Facturas de venta ────────────────────────────────────────────────────────
//
// Ciclo de vida: DRAFT (borrador, editable) → ISSUED (emitida, contabilizada, inmutable).
// El estado interno (`status`) es independiente del estado DIAN (`dianStatus`).

/**
 * POST /v1/invoices — Crea una factura en BORRADOR. Body: createInvoiceSchema.
 * Los totales se calculan en el servidor (no se confía en los que envíe el navegador).
 * No genera asiento contable ni se envía a la DIAN; eso ocurre en /issue.
 */
app.post(
  "/v1/invoices",
  { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT", "SALES") },
  async (request, reply) => {
    const parsed = createInvoiceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Factura inválida", details: parsed.error.flatten() });
    const actor = request.actor!;
    const invoice = await withOrganizationScope(actor.organizationId, async tx => {
      // El cliente debe existir en ESTA organización (RLS) y estar marcado como cliente.
      const customer = await tx.party.findFirst({
        where: { id: parsed.data.customerId, isCustomer: true },
        select: { id: true },
      });
      if (!customer) {
        // Fastify usa `statusCode` del error para responder 404; el throw también revierte la transacción.
        const error = new Error("Cliente no encontrado en esta organización.") as Error & { statusCode: number };
        error.statusCode = 404;
        throw error;
      }
      const totals = calculateDocumentTotals(parsed.data.lines);
      const lines = totals.lines.map(line => ({
        productId: line.productId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountRate: line.discountRate ?? 0,
        taxRate: line.taxRate,
        lineTotal: line.total,
      }));
      const created = await tx.invoice.create({
        data: {
          organizationId: actor.organizationId,
          customerId: customer.id,
          issueDate: parsed.data.issueDate,
          dueDate: parsed.data.dueDate,
          paymentTerm: parsed.data.paymentMethod,
          notes: parsed.data.notes,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxTotal: totals.taxTotal,
          total: totals.total,
          lines: { create: lines },
        },
        include: { lines: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.sub,
          entity: "Invoice",
          entityId: created.id,
          action: "CREATE_DRAFT",
          after: { total: created.total.toString(), lines: created.lines.length },
          ipHash: auditIp(request.ip),
        },
      });
      return created;
    });
    return reply.code(201).send({
      data: invoice,
      message: "Borrador creado. La transmisión DIAN se ejecutará mediante un adaptador habilitado.",
    });
  }
);

/**
 * POST /v1/invoices/:id/issue — Emite una factura en borrador. Roles: OWNER, ADMIN, ACCOUNTANT.
 *
 * En una sola transacción:
 *   1. Genera el asiento contable (JournalEntry) de partida doble:
 *        Débito  130505 Clientes ............ total
 *        Crédito 413595 Ingresos ............ total − IVA
 *        Crédito 240805 IVA generado ........ IVA (si aplica)
 *   2. Cambia la factura a ISSUED con el estado DIAN devuelto por el proveedor.
 *   3. Guarda el ElectronicEvent (respuesta del proveedor), una Notification y el AuditLog.
 *
 * OBSERVACIÓN: el proveedor DIAN se llama ANTES de verificar que la factura exista. Con el
 * adaptador sandbox no importa, pero con un proveedor real habría que validar primero y usar
 * una cola con idempotencia (ver docs/TAREAS.md).
 */
app.post<{ Params: { id: string } }>(
  "/v1/invoices/:id/issue",
  { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT") },
  async (request, reply) => {
    const actor = request.actor!;
    const providerResult = await getDianProvider().submitSalesInvoice({
      invoiceId: request.params.id,
      organizationId: actor.organizationId,
    });
    const result = await withOrganizationScope(actor.organizationId, async tx => {
      const invoice = await tx.invoice.findFirst({
        where: { id: request.params.id, status: "DRAFT" },
        include: { lines: true, customer: { select: { legalName: true } } },
      });
      if (!invoice) return null; // No existe o ya fue emitida → 404 más abajo.
      const accounts = await ensureDefaultAccounts(tx, actor.organizationId);
      // Prisma devuelve Decimal: se convierte a Number para sumar. Ingreso = total sin IVA.
      const revenue = Number(invoice.total) - Number(invoice.taxTotal);
      const journalLines = [
        { accountId: accounts["130505"].id, debit: Number(invoice.total), credit: 0, memo: "Cuenta por cobrar" },
        { accountId: accounts["413595"].id, debit: 0, credit: revenue, memo: "Ingreso por venta" },
        ...(Number(invoice.taxTotal) > 0
          ? [{ accountId: accounts["240805"].id, debit: 0, credit: Number(invoice.taxTotal), memo: "IVA generado" }]
          : []),
      ];
      assertBalanced(journalLines); // Si no cuadra, lanza error y se revierte todo.
      await tx.journalEntry.create({
        data: {
          organizationId: actor.organizationId,
          reference: `FV-${invoice.id}`,
          date: invoice.issueDate,
          description: `Factura de venta a ${invoice.customer.legalName}`,
          status: "POSTED",
          postedAt: new Date(),
          sourceType: "Invoice",
          sourceId: invoice.id,
          lines: { create: journalLines },
        },
      });
      const issued = await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: "ISSUED", dianStatus: providerResult.status },
      });
      await tx.electronicEvent.create({
        data: {
          organizationId: actor.organizationId,
          invoiceId: invoice.id,
          kind: "SALES_INVOICE",
          status: providerResult.status,
          providerResponse: providerResult.providerResponse as Prisma.InputJsonValue,
        },
      });
      await tx.notification.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.sub,
          kind: "DIAN",
          title: "Factura en cola DIAN",
          body: `La factura ${issued.id} quedó en cola del entorno ${providerResult.providerResponse.mode ?? "configurado"}.`,
          actionUrl: `/facturacion/${issued.id}`,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.sub,
          entity: "Invoice",
          entityId: invoice.id,
          action: "ISSUE",
          after: { dianStatus: providerResult.status, journalReference: `FV-${invoice.id}` },
          ipHash: auditIp(request.ip),
        },
      });
      return issued;
    });
    if (!result) return reply.code(404).send({ error: "Factura en borrador no encontrada." });
    return { data: result, dian: providerResult };
  }
);

/** GET /v1/invoices — Facturas más recientes con el cliente y el número de líneas (máx. 100). */
app.get("/v1/invoices", { preHandler: requireActor }, async request => {
  const actor = request.actor!;
  const data = await withOrganizationScope(actor.organizationId, tx =>
    tx.invoice.findMany({
      include: {
        customer: { select: { legalName: true, identificationNumber: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
  );
  return { data };
});

// ─── Documentos soporte (compras a no obligados a facturar) ──────────────────

/**
 * POST /v1/support-documents — Crea un documento soporte en BORRADOR. Body: createSupportDocumentSchema.
 * Roles: OWNER, ADMIN, ACCOUNTANT. El proveedor debe tener isSupplier = true.
 */
app.post(
  "/v1/support-documents",
  { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT") },
  async (request, reply) => {
    const parsed = createSupportDocumentSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: "Documento soporte inválido", details: parsed.error.flatten() });
    const actor = request.actor!;
    const document = await withOrganizationScope(actor.organizationId, async tx => {
      const supplier = await tx.party.findFirst({
        where: { id: parsed.data.supplierId, isSupplier: true },
        select: { id: true },
      });
      if (!supplier) {
        const error = new Error("Proveedor no encontrado en esta organización.") as Error & { statusCode: number };
        error.statusCode = 404;
        throw error;
      }
      const totals = calculateDocumentTotals(parsed.data.lines);
      const created = await tx.supportDocument.create({
        data: {
          organizationId: actor.organizationId,
          supplierId: supplier.id,
          issueDate: parsed.data.issueDate,
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          total: totals.total,
          lines: {
            create: totals.lines.map(line => ({
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              taxRate: line.taxRate,
              lineTotal: line.total,
            })),
          },
        },
        include: { lines: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.sub,
          entity: "SupportDocument",
          entityId: created.id,
          action: "CREATE_DRAFT",
          after: { total: created.total.toString(), lines: created.lines.length },
          ipHash: auditIp(request.ip),
        },
      });
      return created;
    });
    return reply.code(201).send({ data: document });
  }
);

/**
 * POST /v1/support-documents/:id/issue — Contabiliza un documento soporte en borrador.
 *
 * Asiento generado:
 *   Débito  519595 Gastos .............. total − IVA
 *   Débito  240810 IVA descontable ..... IVA (si aplica)
 *   Crédito 220505 Proveedores ......... total
 *
 * Queda con dianStatus = PENDING: la transmisión del CUDS aún no está implementada.
 */
app.post<{ Params: { id: string } }>(
  "/v1/support-documents/:id/issue",
  { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT") },
  async (request, reply) => {
    const actor = request.actor!;
    const result = await withOrganizationScope(actor.organizationId, async tx => {
      const document = await tx.supportDocument.findFirst({
        where: { id: request.params.id, status: "DRAFT" },
        include: { supplier: { select: { legalName: true } } },
      });
      if (!document) return null;
      const accounts = await ensureDefaultAccounts(tx, actor.organizationId);
      const expense = Number(document.total) - Number(document.taxTotal);
      const journalLines = [
        { accountId: accounts["519595"].id, debit: expense, credit: 0, memo: "Gasto por documento soporte" },
        ...(Number(document.taxTotal) > 0
          ? [{ accountId: accounts["240810"].id, debit: Number(document.taxTotal), credit: 0, memo: "IVA descontable" }]
          : []),
        { accountId: accounts["220505"].id, debit: 0, credit: Number(document.total), memo: "Cuenta por pagar" },
      ];
      assertBalanced(journalLines);
      await tx.journalEntry.create({
        data: {
          organizationId: actor.organizationId,
          reference: `DS-${document.id}`,
          date: document.issueDate,
          description: `Documento soporte de ${document.supplier.legalName}`,
          status: "POSTED",
          postedAt: new Date(),
          sourceType: "SupportDocument",
          sourceId: document.id,
          lines: { create: journalLines },
        },
      });
      const issued = await tx.supportDocument.update({
        where: { id: document.id },
        data: { status: "ISSUED", dianStatus: "PENDING" },
      });
      await tx.notification.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.sub,
          kind: "ACTION",
          title: "Documento soporte contabilizado",
          body: `El documento soporte ${issued.id} fue contabilizado y queda pendiente de transmisión mediante el proveedor habilitado.`,
          actionUrl: `/documentos-soporte/${issued.id}`,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.sub,
          entity: "SupportDocument",
          entityId: document.id,
          action: "ISSUE",
          after: { dianStatus: "PENDING", journalReference: `DS-${document.id}` },
          ipHash: auditIp(request.ip),
        },
      });
      return issued;
    });
    if (!result) return reply.code(404).send({ error: "Documento soporte en borrador no encontrado." });
    return {
      data: result,
      message: "Documento soporte contabilizado; la transmisión requiere un proveedor DIAN habilitado.",
    };
  }
);

/** GET /v1/support-documents — Documentos soporte más recientes con el proveedor (máx. 100). */
app.get("/v1/support-documents", { preHandler: requireActor }, async request => {
  const actor = request.actor!;
  const data = await withOrganizationScope(actor.organizationId, tx =>
    tx.supportDocument.findMany({
      include: {
        supplier: { select: { legalName: true, identificationNumber: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
  );
  return { data };
});

// ─── Contabilidad ─────────────────────────────────────────────────────────────

/** GET /v1/accounting/journal-entries — Comprobantes contables con sus líneas y cuentas (consulta). */
app.get(
  "/v1/accounting/journal-entries",
  { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT", "VIEWER") },
  async request => {
    const actor = request.actor!;
    const data = await withOrganizationScope(actor.organizationId, tx =>
      tx.journalEntry.findMany({
        include: { lines: { include: { account: { select: { code: true, name: true } } } } },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 100,
      })
    );
    return { data };
  }
);

// ─── Notificaciones ───────────────────────────────────────────────────────────

/**
 * GET /v1/notifications — Últimas 50 notificaciones de la organización.
 * OBSERVACIÓN: no filtra por usuario (userId); todos los miembros ven todas. Revisar si debe ser por usuario.
 */
app.get("/v1/notifications", { preHandler: requireActor }, async request => {
  const actor = request.actor!;
  return {
    data: await withOrganizationScope(actor.organizationId, tx =>
      tx.notification.findMany({ orderBy: { createdAt: "desc" }, take: 50 })
    ),
  };
});

/** POST /v1/notifications/:id/read — Marca una notificación como leída. Responde 204 sin contenido. */
app.post<{ Params: { id: string } }>(
  "/v1/notifications/:id/read",
  { preHandler: requireActor },
  async (request, reply) => {
    const actor = request.actor!;
    const notification = await withOrganizationScope(actor.organizationId, tx =>
      tx.notification.updateMany({ where: { id: request.params.id }, data: { readAt: new Date() } })
    );
    if (!notification.count) return reply.code(404).send({ error: "Notificación no encontrada." });
    return reply.code(204).send();
  }
);

// ─── Arranque ─────────────────────────────────────────────────────────────────

// host 0.0.0.0 permite acceder desde Docker u otros equipos de la red local.
const port = Number(process.env.BETEL_API_PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
