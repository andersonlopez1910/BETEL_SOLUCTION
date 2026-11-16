/**
 * Clientes (cartera por cliente) y estado de cuenta.
 *
 * Rutas:
 *   GET  /v1/reports/billing/portfolio ............ pestaña Clientes: saldos por cliente, paginado
 *   GET  /v1/reports/billing/portfolio/export ..... todas las filas filtradas (Descargar)
 *   GET  /v1/customers/:id/statement .............. estado de cuenta de un cliente
 *   POST /v1/customers/:id/statement/email ........ enviar el estado de cuenta por correo
 *   POST /v1/customers/:id/active ................. activar o desactivar el cliente
 *
 * DEFINICIONES (también en docs/reporte-facturacion.md):
 *   - Saldo de una factura a crédito vigente = total − abonos de recibos de caja activos (mismo cálculo de
 *     Recaudos). Las facturas de contado se pagan al emitirse y no tienen saldo.
 *   - Saldo vencido: saldo de las facturas con vencimiento anterior a hoy (hora de Colombia) o en estado
 *     vencida. Saldo por vencer: el resto (incluye las que no tienen fecha de vencimiento).
 *   - Saldo a favor: Betel aún no registra anticipos ni pagos mayores al saldo, así que hoy siempre es 0.
 *   - Total cartera = saldo vencido + saldo por vencer − saldo a favor.
 *   - Estado: Activo/Inactivo (Party.active). Un cliente inactivo no se ofrece al crear documentos nuevos.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import { portfolioQuerySchema, toggleCustomerSchema, type PortfolioQuery } from "@betel/contracts";
import { z } from "zod";
import { allowRoles } from "./auth.js";
import { invoiceNumber, pendingInvoices, receiptNumber } from "./collections.js";
import { mailerConfigured, sendMail } from "./mailer.js";
import { QUOTE_ROLES } from "./quotes.js";
import { EXPORT_LIMIT, REPORT_EXPORT_ROLES, REPORT_VIEW_ROLES, todayIn } from "./reports.js";

type Tx = Prisma.TransactionClient;
const ZERO = new Prisma.Decimal(0);
const DAY_MS = 86_400_000;

// ─── Cálculos puros (probados en test/portfolio.test.ts) ─────────────────────

/** ¿La factura está vencida? (fecha de vencimiento anterior a hoy o estado vencida). */
export const isOverdue = (invoice: { dueDate: Date | null; status: string }, today: Date) =>
  invoice.status === "OVERDUE" || (invoice.dueDate !== null && invoice.dueDate < today);

/** Días de mora (0 si no está vencida o no tiene fecha). */
export const daysOverdue = (dueDate: Date | null, today: Date) =>
  dueDate && dueDate < today ? Math.round((today.getTime() - dueDate.getTime()) / DAY_MS) : 0;

/** Saldos por cliente a partir de las facturas con saldo pendiente. */
export function balancesByCustomer(
  invoices: { customerId: string; balance: Prisma.Decimal; dueDate: Date | null; status: string }[],
  today: Date
) {
  const result = new Map<string, { overdue: Prisma.Decimal; upcoming: Prisma.Decimal }>();
  for (const invoice of invoices) {
    const current = result.get(invoice.customerId) ?? { overdue: ZERO, upcoming: ZERO };
    if (isOverdue(invoice, today)) current.overdue = current.overdue.plus(invoice.balance);
    else current.upcoming = current.upcoming.plus(invoice.balance);
    result.set(invoice.customerId, current);
  }
  return result;
}

/** Ids a incluir según el filtro de saldo (undefined = sin restricción). */
export function balanceFilter(
  filter: PortfolioQuery["balance"],
  balances: Map<string, { overdue: Prisma.Decimal; upcoming: Prisma.Decimal }>
): Prisma.PartyWhereInput {
  const withBalance = [...balances.keys()];
  if (filter === "WITH_BALANCE") return { id: { in: withBalance } };
  if (filter === "NO_BALANCE") return { id: { notIn: withBalance } };
  if (filter === "OVERDUE")
    return { id: { in: [...balances].filter(([, value]) => value.overdue.greaterThan(0)).map(([id]) => id) } };
  return {};
}

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

// ─── Consultas ────────────────────────────────────────────────────────────────

const customerSelect = {
  id: true,
  legalName: true,
  tradeName: true,
  identificationType: true,
  identificationNumber: true,
  email: true,
  phone: true,
  active: true,
} satisfies Prisma.PartySelect;

async function loadPortfolio(tx: Tx, query: PortfolioQuery, rows: { skip: number; take: number }) {
  const today = todayIn("America/Bogota");
  const balances = balancesByCustomer(await pendingInvoices(tx, {}), today);
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  const where: Prisma.PartyWhereInput = {
    isCustomer: true,
    ...(query.status !== "ALL" && { active: query.status === "ACTIVE" }),
    ...(query.search && {
      OR: [
        { legalName: contains(query.search) },
        { tradeName: contains(query.search) },
        { identificationNumber: contains(query.search) },
      ],
    }),
    ...balanceFilter(query.balance, balances),
  };
  const count = await tx.party.count({ where });
  const parties = await tx.party.findMany({
    where,
    select: customerSelect,
    orderBy: { legalName: "asc" },
    skip: rows.skip,
    take: rows.take,
  });
  // Totales de todos los clientes filtrados (no solo de la página).
  const filteredIds = new Set((await tx.party.findMany({ where, select: { id: true } })).map(party => party.id));
  let overdue = ZERO;
  let upcoming = ZERO;
  for (const [id, value] of balances)
    if (filteredIds.has(id)) {
      overdue = overdue.plus(value.overdue);
      upcoming = upcoming.plus(value.upcoming);
    }
  return {
    count,
    rows: parties.map(party => {
      const balance = balances.get(party.id) ?? { overdue: ZERO, upcoming: ZERO };
      return {
        ...party,
        branch: null,
        overdue: balance.overdue.toFixed(2),
        upcoming: balance.upcoming.toFixed(2),
        credit: "0.00",
        total: balance.overdue.plus(balance.upcoming).toFixed(2),
      };
    }),
    summary: {
      overdue: overdue.toFixed(2),
      upcoming: upcoming.toFixed(2),
      credit: "0.00",
      total: overdue.plus(upcoming).toFixed(2),
    },
  };
}

/** Estado de cuenta: facturas con saldo (con mora), recibos de los últimos 12 meses y totales. */
async function loadStatement(tx: Tx, customerId: string) {
  const customer = await tx.party.findFirst({ where: { id: customerId, isCustomer: true }, select: customerSelect });
  if (!customer) return null;
  const today = todayIn("America/Bogota");
  const invoices = await pendingInvoices(tx, { customerId });
  const since = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()));
  const receipts = await tx.cashReceipt.findMany({
    where: { customerId, date: { gte: since } },
    select: { id: true, number: true, date: true, method: true, total: true, status: true },
    orderBy: { date: "desc" },
    take: 100,
  });
  const balances = balancesByCustomer(
    invoices.map(invoice => ({ ...invoice, customerId })),
    today
  ).get(customerId) ?? { overdue: ZERO, upcoming: ZERO };
  return {
    customer,
    date: dateOnly(today),
    invoices: invoices.map(invoice => ({
      id: invoice.id,
      number: invoiceNumber(invoice),
      issueDate: dateOnly(invoice.issueDate),
      dueDate: invoice.dueDate ? dateOnly(invoice.dueDate) : null,
      total: invoice.total.toFixed(2),
      applied: invoice.applied.toFixed(2),
      balance: invoice.balance.toFixed(2),
      overdue: isOverdue(invoice, today),
      daysOverdue: daysOverdue(invoice.dueDate, today),
    })),
    receipts: receipts.map(receipt => ({
      id: receipt.id,
      number: receiptNumber(receipt.number),
      date: dateOnly(receipt.date),
      method: receipt.method,
      total: receipt.total.toFixed(2),
      status: receipt.status,
    })),
    summary: {
      overdue: balances.overdue.toFixed(2),
      upcoming: balances.upcoming.toFixed(2),
      credit: "0.00",
      total: balances.overdue.plus(balances.upcoming).toFixed(2),
    },
  };
}

type Statement = NonNullable<Awaited<ReturnType<typeof loadStatement>>>;

const cop = (value: string) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 2 }).format(
    Number(value)
  );
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const dmy = (value: string | null) => (value ? value.split("-").reverse().join("/") : "—");

/** Correo del estado de cuenta (HTML y texto). */
export function statementEmail(statement: Statement, company: string) {
  const rows = statement.invoices
    .map(
      invoice =>
        `<tr><td style="padding:6px;border-bottom:1px solid #dde7ef">${escapeHtml(invoice.number)}</td><td style="padding:6px;border-bottom:1px solid #dde7ef">${dmy(invoice.issueDate)}</td><td style="padding:6px;border-bottom:1px solid #dde7ef">${dmy(invoice.dueDate)}${invoice.overdue ? ` <b style="color:#c2353a">(vencida ${invoice.daysOverdue} días)</b>` : ""}</td><td style="padding:6px;border-bottom:1px solid #dde7ef;text-align:right">${cop(invoice.balance)}</td></tr>`
    )
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#0d293b;max-width:680px">
<h2 style="margin:0 0 4px">Estado de cuenta</h2>
<p style="margin:0 0 16px;color:#5b7186">${escapeHtml(company)} · corte ${dmy(statement.date)}</p>
<p>Cliente: <b>${escapeHtml(statement.customer.legalName)}</b> (${escapeHtml(statement.customer.identificationType)} ${escapeHtml(statement.customer.identificationNumber)})</p>
${statement.invoices.length ? `<table style="width:100%;border-collapse:collapse;margin:12px 0"><tr><th align="left">Factura</th><th align="left">Emisión</th><th align="left">Vencimiento</th><th align="right">Saldo</th></tr>${rows}</table>` : "<p>No tiene facturas pendientes de pago.</p>"}
<p style="text-align:right">Saldo vencido: <b>${cop(statement.summary.overdue)}</b><br>Saldo por vencer: <b>${cop(statement.summary.upcoming)}</b><br>Total cartera: <b>${cop(statement.summary.total)}</b></p>
<p style="color:#5b7186;font-size:12px">Enviado desde Betel Solution.</p></div>`;
  const text = [
    `Estado de cuenta — ${company} (corte ${dmy(statement.date)})`,
    `Cliente: ${statement.customer.legalName} (${statement.customer.identificationType} ${statement.customer.identificationNumber})`,
    ...statement.invoices.map(
      invoice => `- ${invoice.number}: saldo ${cop(invoice.balance)}, vence ${dmy(invoice.dueDate)}`
    ),
    `Total cartera: ${cop(statement.summary.total)}`,
  ].join("\n");
  return { subject: `Estado de cuenta — ${company}`, html, text };
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerPortfolioRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowRoles(...REPORT_VIEW_ROLES) };
  const canExport = { preHandler: allowRoles(...REPORT_EXPORT_ROLES) };
  const canEdit = { preHandler: allowRoles(...QUOTE_ROLES) };
  const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

  /** GET /v1/reports/billing/portfolio — Query: portfolioQuerySchema. */
  app.get("/v1/reports/billing/portfolio", canView, async (request, reply) => {
    const parsed = portfolioQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const { page, pageSize } = parsed.data;
    const { rows, count, ...rest } = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadPortfolio(tx, parsed.data, { skip: (page - 1) * pageSize, take: pageSize })
    );
    return { data: rows, pagination: { page, pageSize, total: count }, ...rest };
  });

  /** GET /v1/reports/billing/portfolio/export — todas las filas filtradas (auditado). */
  app.get("/v1/reports/billing/portfolio/export", canExport, async (request, reply) => {
    const parsed = portfolioQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const report = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await loadPortfolio(tx, parsed.data, { skip: 0, take: EXPORT_LIMIT + 1 });
      if (result.count <= EXPORT_LIMIT)
        await tx.auditLog.create({
          data: {
            organizationId: request.actor!.organizationId,
            userId: request.actor!.sub,
            entity: "BillingReport",
            entityId: "portfolio",
            action: "EXPORT",
            after: { filters: request.query, rows: result.count } as Prisma.InputJsonValue,
            ipHash: options.auditIp(request.ip),
          },
        });
      return result;
    });
    if (report.count > EXPORT_LIMIT)
      return reply.code(413).send({ error: `La consulta supera ${EXPORT_LIMIT} filas. Acota los filtros.` });
    const { rows, count, ...rest } = report;
    return { data: rows, total: count, ...rest };
  });

  /** GET /v1/customers/:id/statement — estado de cuenta del cliente. */
  app.get<{ Params: { id: string } }>("/v1/customers/:id/statement", canView, async (request, reply) => {
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Cliente no encontrado." });
    const statement = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadStatement(tx, request.params.id)
    );
    if (!statement) return reply.code(404).send({ error: "Cliente no encontrado." });
    return { data: statement };
  });

  /** POST /v1/customers/:id/statement/email — envía el estado de cuenta. Body: { to? }. */
  app.post<{ Params: { id: string } }>("/v1/customers/:id/statement/email", canEdit, async (request, reply) => {
    const parsed = z
      .object({ to: z.string().trim().email("Correo inválido.").optional() })
      .safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(422).send({ error: "Correo inválido.", details: parsed.error.flatten() });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Cliente no encontrado." });
    if (!mailerConfigured())
      return reply
        .code(503)
        .send({ error: "El envío de correos no está configurado (SMTP_HOST en el .env de la API)." });
    const actor = request.actor!;
    const loaded = await withOrganizationScope(actor.organizationId, async tx => {
      const statement = await loadStatement(tx, request.params.id);
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: actor.organizationId },
        select: { legalName: true },
      });
      return statement && { statement, company: organization.legalName };
    });
    if (!loaded) return reply.code(404).send({ error: "Cliente no encontrado." });
    const recipient = parsed.data.to ?? loaded.statement.customer.email;
    if (!recipient)
      return reply.code(422).send({ error: "El cliente no tiene correo registrado. Escribe un correo de destino." });
    let failure: string | null = null;
    try {
      await sendMail({ to: recipient, ...statementEmail(loaded.statement, loaded.company) });
    } catch (error) {
      failure = (error as Error).message.slice(0, 500);
    }
    await withOrganizationScope(actor.organizationId, async tx => {
      await tx.documentEmail.create({
        data: {
          organizationId: actor.organizationId,
          documentType: "Statement",
          documentId: request.params.id,
          recipient,
          status: failure ? "FAILED" : "SENT",
          error: failure,
          sentById: actor.sub,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.sub,
          entity: "Party",
          entityId: request.params.id,
          action: failure ? "STATEMENT_EMAIL_FAILED" : "STATEMENT_EMAIL_SENT",
          after: { recipient },
          ipHash: options.auditIp(request.ip),
        },
      });
    });
    if (failure) return reply.code(502).send({ error: `El servidor de correo rechazó el envío: ${failure}` });
    return reply.code(201).send({ data: { recipient } });
  });

  /** POST /v1/customers/:id/active — activa o desactiva el cliente. Body: { active }. */
  app.post<{ Params: { id: string } }>("/v1/customers/:id/active", canEdit, async (request, reply) => {
    const parsed = toggleCustomerSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: "Indica si queda activo.", details: parsed.error.flatten() });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Cliente no encontrado." });
    const actor = request.actor!;
    const updated = await withOrganizationScope(actor.organizationId, async tx => {
      const result = await tx.party.updateMany({
        where: { id: request.params.id, isCustomer: true },
        data: { active: parsed.data.active },
      });
      if (result.count)
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.sub,
            entity: "Party",
            entityId: request.params.id,
            action: parsed.data.active ? "ACTIVATE" : "DEACTIVATE",
            after: { active: parsed.data.active },
            ipHash: options.auditIp(request.ip),
          },
        });
      return result.count;
    });
    if (!updated) return reply.code(404).send({ error: "Cliente no encontrado." });
    return { data: { id: request.params.id, active: parsed.data.active } };
  });
}
