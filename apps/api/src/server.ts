import { createHash } from "node:crypto";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { prisma, withOrganizationScope } from "@betel/db";
import type { Prisma } from "@betel/db";
import { calendarEventSchema, createInvoiceSchema, createSupportDocumentSchema, partySchema, productSchema } from "@betel/contracts";
import { allowRoles, requireActor, type BetelJwt } from "./auth.js";
import { assertBalanced, calculateDocumentTotals, ensureDefaultAccounts } from "./accounting.js";
import { getDianProvider } from "./dian.js";

const isProduction = process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET ?? (isProduction ? undefined : "betel-local-development-secret-change-before-production");
if (!jwtSecret) throw new Error("JWT_SECRET es obligatorio en producción.");

const app = Fastify({ logger: true });
await app.register(cors, { origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" });
await app.register(jwt, { secret: jwtSecret, sign: { expiresIn: "15m" } });
const auditIp = (ip: string) => createHash("sha256").update(`${jwtSecret}:${ip}`).digest("hex");

app.get("/health", async () => ({ status: "ok", service: "betel-api", at: new Date().toISOString() }));

if (!isProduction && process.env.BETEL_ALLOW_INSECURE_DEV_AUTH === "true") {
  app.post("/v1/auth/dev/session", async (request) => {
    const body = (request.body ?? {}) as { email?: string; organizationNit?: string };
    const email = body.email?.trim().toLowerCase() || "owner@betel.local";
    const nit = body.organizationNit?.replace(/\D/g, "") || "900999001";
    const user = await prisma.user.upsert({ where: { email }, update: { active: true }, create: { email, displayName: "Propietario local", active: true } });
    const organization = await prisma.organization.upsert({ where: { nit }, update: {}, create: { nit, verificationDigit: "1", legalName: "Organización de desarrollo Betel", dianEnabled: false } });
    const membership = await prisma.membership.upsert({ where: { organizationId_userId: { organizationId: organization.id, userId: user.id } }, update: { role: "OWNER" }, create: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
    const payload: BetelJwt = { sub: user.id, email: user.email, organizationId: organization.id, role: membership.role };
    return { accessToken: app.jwt.sign(payload), expiresIn: 900, organization: { id: organization.id, legalName: organization.legalName }, user: { id: user.id, email: user.email } };
  });
}

app.get("/v1/me", { preHandler: requireActor }, async (request) => {
  const actor = request.actor!;
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { id: true, legalName: true, nit: true, dianEnabled: true } });
  return { user: { id: actor.sub, email: actor.email, role: actor.role }, organization };
});

app.get("/v1/parties", { preHandler: requireActor }, async (request) => {
  const actor = request.actor!;
  const data = await withOrganizationScope(actor.organizationId, tx => tx.party.findMany({ orderBy: { legalName: "asc" }, take: 50 }));
  return { data };
});

app.post("/v1/parties", { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT", "SALES") }, async (request, reply) => {
  const parsed = partySchema.safeParse(request.body);
  if (!parsed.success) return reply.code(422).send({ error: "Datos del tercero inválidos", details: parsed.error.flatten() });
  const actor = request.actor!;
  const party = await withOrganizationScope(actor.organizationId, async tx => {
    const created = await tx.party.create({ data: { ...parsed.data, organizationId: actor.organizationId } });
    await tx.auditLog.create({ data: { organizationId: actor.organizationId, userId: actor.sub, entity: "Party", entityId: created.id, action: "CREATE", after: parsed.data, ipHash: auditIp(request.ip) } });
    return created;
  });
  return reply.code(201).send({ data: party });
});

app.get("/v1/products", { preHandler: requireActor }, async (request) => {
  const actor = request.actor!;
  return { data: await withOrganizationScope(actor.organizationId, tx => tx.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 100 })) };
});

app.post("/v1/products", { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT", "SALES") }, async (request, reply) => {
  const parsed = productSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(422).send({ error: "Producto o servicio inválido", details: parsed.error.flatten() });
  const actor = request.actor!;
  const product = await withOrganizationScope(actor.organizationId, async tx => {
    const created = await tx.product.create({ data: { ...parsed.data, organizationId: actor.organizationId } });
    await tx.auditLog.create({ data: { organizationId: actor.organizationId, userId: actor.sub, entity: "Product", entityId: created.id, action: "CREATE", after: parsed.data, ipHash: auditIp(request.ip) } });
    return created;
  });
  return reply.code(201).send({ data: product });
});

app.get("/v1/calendar-events", { preHandler: requireActor }, async (request) => {
  const actor = request.actor!;
  return { data: await withOrganizationScope(actor.organizationId, tx => tx.calendarEvent.findMany({ orderBy: { startsAt: "asc" }, take: 100 })) };
});

app.post("/v1/calendar-events", { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT") }, async (request, reply) => {
  const parsed = calendarEventSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(422).send({ error: "Evento inválido", details: parsed.error.flatten() });
  const actor = request.actor!;
  const event = await withOrganizationScope(actor.organizationId, async tx => {
    const created = await tx.calendarEvent.create({ data: { ...parsed.data, organizationId: actor.organizationId, ownerId: actor.sub } });
    await tx.auditLog.create({ data: { organizationId: actor.organizationId, userId: actor.sub, entity: "CalendarEvent", entityId: created.id, action: "CREATE", after: { title: created.title, startsAt: created.startsAt }, ipHash: auditIp(request.ip) } });
    return created;
  });
  return reply.code(201).send({ data: event });
});

app.post("/v1/invoices", { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT", "SALES") }, async (request, reply) => {
  const parsed = createInvoiceSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(422).send({ error: "Factura inválida", details: parsed.error.flatten() });
  const actor = request.actor!;
  const invoice = await withOrganizationScope(actor.organizationId, async tx => {
    const customer = await tx.party.findFirst({ where: { id: parsed.data.customerId, isCustomer: true }, select: { id: true } });
    if (!customer) {
      const error = new Error("Cliente no encontrado en esta organización.") as Error & { statusCode: number };
      error.statusCode = 404;
      throw error;
    }
    const totals = calculateDocumentTotals(parsed.data.lines);
    const lines = totals.lines.map(line => ({ productId: line.productId, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, discountRate: line.discountRate ?? 0, taxRate: line.taxRate, lineTotal: line.total }));
    const created = await tx.invoice.create({ data: { organizationId: actor.organizationId, customerId: customer.id, issueDate: parsed.data.issueDate, dueDate: parsed.data.dueDate, paymentTerm: parsed.data.paymentMethod, notes: parsed.data.notes, subtotal: totals.subtotal, discountTotal: totals.discountTotal, taxTotal: totals.taxTotal, total: totals.total, lines: { create: lines } }, include: { lines: true } });
    await tx.auditLog.create({ data: { organizationId: actor.organizationId, userId: actor.sub, entity: "Invoice", entityId: created.id, action: "CREATE_DRAFT", after: { total: created.total.toString(), lines: created.lines.length }, ipHash: auditIp(request.ip) } });
    return created;
  });
  return reply.code(201).send({ data: invoice, message: "Borrador creado. La transmisión DIAN se ejecutará mediante un adaptador habilitado." });
});

app.post<{ Params: { id: string } }>("/v1/invoices/:id/issue", { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT") }, async (request, reply) => {
  const actor = request.actor!;
  const providerResult = await getDianProvider().submitSalesInvoice({ invoiceId: request.params.id, organizationId: actor.organizationId });
  const result = await withOrganizationScope(actor.organizationId, async tx => {
    const invoice = await tx.invoice.findFirst({ where: { id: request.params.id, status: "DRAFT" }, include: { lines: true, customer: { select: { legalName: true } } } });
    if (!invoice) return null;
    const accounts = await ensureDefaultAccounts(tx, actor.organizationId);
    const revenue = Number(invoice.total) - Number(invoice.taxTotal);
    const journalLines = [
      { accountId: accounts["130505"].id, debit: Number(invoice.total), credit: 0, memo: "Cuenta por cobrar" },
      { accountId: accounts["413595"].id, debit: 0, credit: revenue, memo: "Ingreso por venta" },
      ...(Number(invoice.taxTotal) > 0 ? [{ accountId: accounts["240805"].id, debit: 0, credit: Number(invoice.taxTotal), memo: "IVA generado" }] : [])
    ];
    assertBalanced(journalLines);
    await tx.journalEntry.create({ data: { organizationId: actor.organizationId, reference: `FV-${invoice.id}`, date: invoice.issueDate, description: `Factura de venta a ${invoice.customer.legalName}`, status: "POSTED", postedAt: new Date(), sourceType: "Invoice", sourceId: invoice.id, lines: { create: journalLines } } });
    const issued = await tx.invoice.update({ where: { id: invoice.id }, data: { status: "ISSUED", dianStatus: providerResult.status } });
    await tx.electronicEvent.create({ data: { organizationId: actor.organizationId, invoiceId: invoice.id, kind: "SALES_INVOICE", status: providerResult.status, providerResponse: providerResult.providerResponse as Prisma.InputJsonValue } });
    await tx.notification.create({ data: { organizationId: actor.organizationId, userId: actor.sub, kind: "DIAN", title: "Factura en cola DIAN", body: `La factura ${issued.id} quedó en cola del entorno ${providerResult.providerResponse.mode ?? "configurado"}.`, actionUrl: `/facturacion/${issued.id}` } });
    await tx.auditLog.create({ data: { organizationId: actor.organizationId, userId: actor.sub, entity: "Invoice", entityId: invoice.id, action: "ISSUE", after: { dianStatus: providerResult.status, journalReference: `FV-${invoice.id}` }, ipHash: auditIp(request.ip) } });
    return issued;
  });
  if (!result) return reply.code(404).send({ error: "Factura en borrador no encontrada." });
  return { data: result, dian: providerResult };
});

app.get("/v1/invoices", { preHandler: requireActor }, async request => {
  const actor = request.actor!;
  const data = await withOrganizationScope(actor.organizationId, tx => tx.invoice.findMany({
    include: { customer: { select: { legalName: true, identificationNumber: true } }, _count: { select: { lines: true } } },
    orderBy: { createdAt: "desc" },
    take: 100
  }));
  return { data };
});

app.post("/v1/support-documents", { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT") }, async (request, reply) => {
  const parsed = createSupportDocumentSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(422).send({ error: "Documento soporte inválido", details: parsed.error.flatten() });
  const actor = request.actor!;
  const document = await withOrganizationScope(actor.organizationId, async tx => {
    const supplier = await tx.party.findFirst({ where: { id: parsed.data.supplierId, isSupplier: true }, select: { id: true } });
    if (!supplier) { const error = new Error("Proveedor no encontrado en esta organización.") as Error & { statusCode: number }; error.statusCode = 404; throw error; }
    const totals = calculateDocumentTotals(parsed.data.lines);
    const created = await tx.supportDocument.create({ data: { organizationId: actor.organizationId, supplierId: supplier.id, issueDate: parsed.data.issueDate, subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total, lines: { create: totals.lines.map(line => ({ description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, taxRate: line.taxRate, lineTotal: line.total })) } }, include: { lines: true } });
    await tx.auditLog.create({ data: { organizationId: actor.organizationId, userId: actor.sub, entity: "SupportDocument", entityId: created.id, action: "CREATE_DRAFT", after: { total: created.total.toString(), lines: created.lines.length }, ipHash: auditIp(request.ip) } });
    return created;
  });
  return reply.code(201).send({ data: document });
});

app.post<{ Params: { id: string } }>("/v1/support-documents/:id/issue", { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT") }, async (request, reply) => {
  const actor = request.actor!;
  const result = await withOrganizationScope(actor.organizationId, async tx => {
    const document = await tx.supportDocument.findFirst({
      where: { id: request.params.id, status: "DRAFT" },
      include: { supplier: { select: { legalName: true } } }
    });
    if (!document) return null;
    const accounts = await ensureDefaultAccounts(tx, actor.organizationId);
    const expense = Number(document.total) - Number(document.taxTotal);
    const journalLines = [
      { accountId: accounts["519595"].id, debit: expense, credit: 0, memo: "Gasto por documento soporte" },
      ...(Number(document.taxTotal) > 0 ? [{ accountId: accounts["240810"].id, debit: Number(document.taxTotal), credit: 0, memo: "IVA descontable" }] : []),
      { accountId: accounts["220505"].id, debit: 0, credit: Number(document.total), memo: "Cuenta por pagar" }
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
        lines: { create: journalLines }
      }
    });
    const issued = await tx.supportDocument.update({ where: { id: document.id }, data: { status: "ISSUED", dianStatus: "PENDING" } });
    await tx.notification.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.sub,
        kind: "ACTION",
        title: "Documento soporte contabilizado",
        body: `El documento soporte ${issued.id} fue contabilizado y queda pendiente de transmisión mediante el proveedor habilitado.`,
        actionUrl: `/documentos-soporte/${issued.id}`
      }
    });
    await tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.sub,
        entity: "SupportDocument",
        entityId: document.id,
        action: "ISSUE",
        after: { dianStatus: "PENDING", journalReference: `DS-${document.id}` },
        ipHash: auditIp(request.ip)
      }
    });
    return issued;
  });
  if (!result) return reply.code(404).send({ error: "Documento soporte en borrador no encontrado." });
  return { data: result, message: "Documento soporte contabilizado; la transmisión requiere un proveedor DIAN habilitado." };
});

app.get("/v1/support-documents", { preHandler: requireActor }, async request => {
  const actor = request.actor!;
  const data = await withOrganizationScope(actor.organizationId, tx => tx.supportDocument.findMany({
    include: { supplier: { select: { legalName: true, identificationNumber: true } }, _count: { select: { lines: true } } },
    orderBy: { createdAt: "desc" },
    take: 100
  }));
  return { data };
});

app.get("/v1/accounting/journal-entries", { preHandler: allowRoles("OWNER", "ADMIN", "ACCOUNTANT", "VIEWER") }, async request => {
  const actor = request.actor!;
  const data = await withOrganizationScope(actor.organizationId, tx => tx.journalEntry.findMany({
    include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 100
  }));
  return { data };
});

app.get("/v1/notifications", { preHandler: requireActor }, async request => {
  const actor = request.actor!;
  return { data: await withOrganizationScope(actor.organizationId, tx => tx.notification.findMany({ orderBy: { createdAt: "desc" }, take: 50 })) };
});

app.post<{ Params: { id: string } }>("/v1/notifications/:id/read", { preHandler: requireActor }, async (request, reply) => {
  const actor = request.actor!;
  const notification = await withOrganizationScope(actor.organizationId, tx => tx.notification.updateMany({ where: { id: request.params.id }, data: { readAt: new Date() } }));
  if (!notification.count) return reply.code(404).send({ error: "Notificación no encontrada." });
  return reply.code(204).send();
});

const port = Number(process.env.BETEL_API_PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
