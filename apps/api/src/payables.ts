/**
 * Compras y gastos › Proveedores (cuentas por pagar) y comprobantes de egreso (pagos a proveedores).
 *
 * Rutas:
 *   GET  /v1/reports/purchases/suppliers ............ pestaña Proveedores: saldos por proveedor, paginado
 *   GET  /v1/reports/purchases/suppliers/export ..... todas las filas filtradas (Descargar)
 *   GET  /v1/reports/purchases/suppliers/aging ...... Ver reportes › Antigüedad de cuentas por pagar
 *   GET  /v1/suppliers/:id/statement ................ "Ver cuentas por pagar" de un proveedor
 *   POST /v1/suppliers/:id/active ................... activar o desactivar el proveedor
 *   GET  /v1/supplier-payments/pending-suppliers .... proveedores con saldo (formulario de pago)
 *   GET  /v1/supplier-payments/pending-documents .... compras y gastos con saldo de un proveedor
 *   POST /v1/supplier-payments ...................... registrar comprobante de egreso (CE-n)
 *   POST /v1/supplier-payments/:id/void ............. anular comprobante de egreso (asiento inverso)
 *
 * DEFINICIONES (también en docs/compras-y-gastos.md):
 *   - Cuenta por pagar: compra o gasto A CRÉDITO vigente (CG-n). Saldo = total − pagos de comprobantes de
 *     egreso activos. Las compras de contado y los documentos soporte se pagan al registrarse.
 *   - Saldo vencido: saldo de los documentos con vencimiento anterior a hoy (hora de Colombia). Saldo por
 *     vencer: el resto. Saldo a favor (anticipos a proveedores): Betel aún no los registra, siempre 0.
 *   - Total saldo = vencido + por vencer − a favor. Mismas reglas de la cartera de clientes (portfolio.ts).
 *   - Comprobante de egreso: Débito 220505 Proveedores / Crédito 110505 Caja (efectivo) o 111005 Bancos.
 *     No puede pagar más que el saldo de cada documento; al anularlo el saldo vuelve y se reversa el asiento.
 *   - Antigüedad: saldo por días de vencido: por vencer, 1–30, 31–60, 61–90 y más de 90.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import {
  createSupplierPaymentSchema,
  payablesQuerySchema,
  toggleCustomerSchema,
  voidCashReceiptSchema,
  type PayablesQuery,
} from "@betel/contracts";
import { allowPermission } from "./auth.js";
import { assertBalanced, ensureDefaultAccounts } from "./accounting.js";
import { methodAccount, methodLabels, RECEIPT_ROLES } from "./collections.js";
import { balanceFilter, balancesByCustomer, daysOverdue, isOverdue } from "./portfolio.js";
import { purchaseNumber, purchaseTypeLabels } from "./purchases.js";
import { EXPORT_LIMIT, REPORT_EXPORT_ROLES, REPORT_VIEW_ROLES, todayIn } from "./reports.js";

type Tx = Prisma.TransactionClient;
const ZERO = new Prisma.Decimal(0);

// ─── Cálculos puros (probados en test/payables.test.ts) ──────────────────────

export const paymentNumber = (number: number) => `CE-${number}`;

export const agingBuckets = ["current", "d1_30", "d31_60", "d61_90", "d90"] as const;
export type AgingBucket = (typeof agingBuckets)[number];

/** Tramo de antigüedad según los días de vencido (0 = por vencer). */
export function agingBucket(days: number): AgingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90";
}

/** Saldos por tramo de antigüedad de una lista de documentos con saldo. */
export function agingTotals(documents: { balance: Prisma.Decimal; dueDate: Date | null }[], today: Date) {
  const totals = Object.fromEntries(agingBuckets.map(bucket => [bucket, ZERO])) as Record<AgingBucket, Prisma.Decimal>;
  for (const document of documents) {
    const bucket = agingBucket(daysOverdue(document.dueDate, today));
    totals[bucket] = totals[bucket].plus(document.balance);
  }
  return totals;
}

/** Valida los abonos contra el saldo de cada documento y devuelve el total del pago. */
export function applyToPayables(
  applications: { purchaseDocumentId: string; amount: number }[],
  balances: Map<string, Prisma.Decimal>
): { total: Prisma.Decimal } | { error: string } {
  let total = ZERO;
  for (const application of applications) {
    const balance = balances.get(application.purchaseDocumentId);
    if (!balance) return { error: "Uno de los documentos no tiene saldo por pagar a este proveedor." };
    const amount = new Prisma.Decimal(application.amount);
    if (amount.greaterThan(balance))
      return { error: `El valor pagado (${amount.toFixed(2)}) supera el saldo del documento (${balance.toFixed(2)}).` };
    total = total.plus(amount);
  }
  return { total };
}

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

// ─── Consultas ────────────────────────────────────────────────────────────────

/** Compras y gastos a crédito vigentes con saldo (opcionalmente de un proveedor o de unos documentos). */
export async function pendingPurchases(tx: Tx, options: { supplierId?: string; documentIds?: string[] } = {}) {
  const documents = await tx.purchaseDocument.findMany({
    where: {
      paymentTerm: "CREDIT",
      status: "ACTIVE",
      ...(options.supplierId && { supplierId: options.supplierId }),
      ...(options.documentIds && { id: { in: options.documentIds } }),
    },
    select: {
      id: true,
      number: true,
      type: true,
      supplierInvoiceNumber: true,
      issueDate: true,
      dueDate: true,
      total: true,
      supplierId: true,
      paymentApplications: { where: { payment: { status: "ACTIVE" } }, select: { amount: true } },
    },
    orderBy: [{ issueDate: "asc" }, { number: "asc" }],
  });
  return documents
    .map(({ paymentApplications, ...document }) => {
      const applied = paymentApplications.reduce((sum, item) => sum.plus(item.amount), ZERO);
      return { ...document, applied, balance: document.total.minus(applied) };
    })
    .filter(document => document.balance.greaterThan(0));
}

type Pending = Awaited<ReturnType<typeof pendingPurchases>>[number];

/** Saldos por proveedor (misma regla de vencido/por vencer que la cartera de clientes). */
const balancesBySupplier = (documents: Pending[], today: Date) =>
  balancesByCustomer(
    documents.map(document => ({ ...document, customerId: document.supplierId, status: "ACTIVE" })),
    today
  );

const supplierSelect = {
  id: true,
  legalName: true,
  tradeName: true,
  identificationType: true,
  identificationNumber: true,
  email: true,
  phone: true,
  active: true,
} satisfies Prisma.PartySelect;

function supplierWhere(query: PayablesQuery, balances: ReturnType<typeof balancesBySupplier>): Prisma.PartyWhereInput {
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  return {
    isSupplier: true,
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
}

async function loadPayables(tx: Tx, query: PayablesQuery, rows: { skip: number; take: number }) {
  const today = todayIn("America/Bogota");
  const balances = balancesBySupplier(await pendingPurchases(tx), today);
  const where = supplierWhere(query, balances);
  const count = await tx.party.count({ where });
  const parties = await tx.party.findMany({
    where,
    select: supplierSelect,
    orderBy: { legalName: "asc" },
    skip: rows.skip,
    take: rows.take,
  });
  // Totales de todos los proveedores filtrados (no solo de la página).
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

/** Antigüedad de cuentas por pagar: un renglón por proveedor con saldo (respeta búsqueda y estado). */
async function loadAging(tx: Tx, query: PayablesQuery) {
  const today = todayIn("America/Bogota");
  const pending = await pendingPurchases(tx);
  const where = supplierWhere({ ...query, balance: "WITH_BALANCE" }, balancesBySupplier(pending, today));
  const suppliers = await tx.party.findMany({ where, select: supplierSelect, orderBy: { legalName: "asc" } });
  const toText = (totals: Record<AgingBucket, Prisma.Decimal>) => ({
    ...(Object.fromEntries(agingBuckets.map(bucket => [bucket, totals[bucket].toFixed(2)])) as Record<
      AgingBucket,
      string
    >),
    total: agingBuckets.reduce((sum, bucket) => sum.plus(totals[bucket]), ZERO).toFixed(2),
  });
  const ids = new Set(suppliers.map(supplier => supplier.id));
  return {
    date: dateOnly(today),
    rows: suppliers.map(supplier => ({
      id: supplier.id,
      legalName: supplier.legalName,
      identificationNumber: supplier.identificationNumber,
      ...toText(
        agingTotals(
          pending.filter(document => document.supplierId === supplier.id),
          today
        )
      ),
    })),
    totals: toText(
      agingTotals(
        pending.filter(document => ids.has(document.supplierId)),
        today
      )
    ),
  };
}

/** Cuentas por pagar de un proveedor: documentos con saldo, pagos de los últimos 12 meses y totales. */
async function loadStatement(tx: Tx, supplierId: string) {
  const supplier = await tx.party.findFirst({ where: { id: supplierId, isSupplier: true }, select: supplierSelect });
  if (!supplier) return null;
  const today = todayIn("America/Bogota");
  const documents = await pendingPurchases(tx, { supplierId });
  const since = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()));
  const payments = await tx.supplierPayment.findMany({
    where: { supplierId, date: { gte: since } },
    select: {
      id: true,
      number: true,
      date: true,
      method: true,
      reference: true,
      total: true,
      status: true,
      voidReason: true,
      applications: { select: { amount: true, purchaseDocument: { select: { number: true } } } },
    },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 100,
  });
  const balance = balancesBySupplier(documents, today).get(supplierId) ?? { overdue: ZERO, upcoming: ZERO };
  return {
    supplier,
    date: dateOnly(today),
    documents: documents.map(document => ({
      id: document.id,
      number: purchaseNumber(document.number),
      type: purchaseTypeLabels[document.type],
      supplierInvoiceNumber: document.supplierInvoiceNumber,
      issueDate: dateOnly(document.issueDate),
      dueDate: document.dueDate ? dateOnly(document.dueDate) : null,
      total: document.total.toFixed(2),
      applied: document.applied.toFixed(2),
      balance: document.balance.toFixed(2),
      overdue: isOverdue({ dueDate: document.dueDate, status: "ACTIVE" }, today),
      daysOverdue: daysOverdue(document.dueDate, today),
    })),
    payments: payments.map(payment => ({
      id: payment.id,
      number: paymentNumber(payment.number),
      date: dateOnly(payment.date),
      method: payment.method,
      reference: payment.reference,
      total: payment.total.toFixed(2),
      status: payment.status,
      voidReason: payment.voidReason,
      documents: payment.applications.map(item => ({
        number: purchaseNumber(item.purchaseDocument.number),
        amount: item.amount.toFixed(2),
      })),
    })),
    summary: {
      overdue: balance.overdue.toFixed(2),
      upcoming: balance.upcoming.toFixed(2),
      credit: "0.00",
      total: balance.overdue.plus(balance.upcoming).toFixed(2),
    },
  };
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerPayableRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowPermission("reports.view") };
  const canExport = { preHandler: allowPermission("reports.export") };
  const canPay = { preHandler: allowPermission("purchases.manage") };
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

  /** GET /v1/reports/purchases/suppliers — Query: payablesQuerySchema. */
  app.get("/v1/reports/purchases/suppliers", canView, async (request, reply) => {
    const parsed = payablesQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const { page, pageSize } = parsed.data;
    const { rows, count, ...rest } = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadPayables(tx, parsed.data, { skip: (page - 1) * pageSize, take: pageSize })
    );
    return { data: rows, pagination: { page, pageSize, total: count }, ...rest };
  });

  /** GET /v1/reports/purchases/suppliers/export — todas las filas filtradas (auditado). */
  app.get("/v1/reports/purchases/suppliers/export", canExport, async (request, reply) => {
    const parsed = payablesQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const report = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await loadPayables(tx, parsed.data, { skip: 0, take: EXPORT_LIMIT + 1 });
      if (result.count <= EXPORT_LIMIT)
        await audit(tx, request, "PurchasesReport", "suppliers", "EXPORT", {
          filters: request.query,
          rows: result.count,
        } as Prisma.InputJsonValue);
      return result;
    });
    if (report.count > EXPORT_LIMIT)
      return reply.code(413).send({ error: `La consulta supera ${EXPORT_LIMIT} filas. Acota los filtros.` });
    const { rows, count, ...rest } = report;
    return { data: rows, total: count, ...rest };
  });

  /** GET /v1/reports/purchases/suppliers/aging — antigüedad de cuentas por pagar. */
  app.get("/v1/reports/purchases/suppliers/aging", canView, async (request, reply) => {
    const parsed = payablesQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const data = await withOrganizationScope(request.actor!.organizationId, tx => loadAging(tx, parsed.data));
    return { data };
  });

  /** GET /v1/suppliers/:id/statement — cuentas por pagar del proveedor. */
  app.get<{ Params: { id: string } }>("/v1/suppliers/:id/statement", canView, async (request, reply) => {
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Proveedor no encontrado." });
    const statement = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadStatement(tx, request.params.id)
    );
    if (!statement) return reply.code(404).send({ error: "Proveedor no encontrado." });
    return { data: statement };
  });

  /** POST /v1/suppliers/:id/active — activa o desactiva el proveedor. Body: { active }. */
  app.post<{ Params: { id: string } }>("/v1/suppliers/:id/active", canPay, async (request, reply) => {
    const parsed = toggleCustomerSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: "Indica si queda activo.", details: parsed.error.flatten() });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Proveedor no encontrado." });
    const updated = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await tx.party.updateMany({
        where: { id: request.params.id, isSupplier: true },
        data: { active: parsed.data.active },
      });
      if (result.count)
        await audit(tx, request, "Party", request.params.id, parsed.data.active ? "ACTIVATE" : "DEACTIVATE", {
          active: parsed.data.active,
        });
      return result.count;
    });
    if (!updated) return reply.code(404).send({ error: "Proveedor no encontrado." });
    return { data: { id: request.params.id, active: parsed.data.active } };
  });

  /** GET /v1/supplier-payments/pending-suppliers — proveedores con compras o gastos a crédito por pagar. */
  app.get("/v1/supplier-payments/pending-suppliers", canPay, async request => {
    const data = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const pending = await pendingPurchases(tx);
      const bySupplier = new Map<string, { balance: Prisma.Decimal; count: number }>();
      for (const document of pending) {
        const current = bySupplier.get(document.supplierId) ?? { balance: ZERO, count: 0 };
        bySupplier.set(document.supplierId, {
          balance: current.balance.plus(document.balance),
          count: current.count + 1,
        });
      }
      const suppliers = await tx.party.findMany({
        where: { id: { in: [...bySupplier.keys()] } },
        select: supplierSelect,
        orderBy: { legalName: "asc" },
      });
      return suppliers.map(supplier => ({
        ...supplier,
        documentCount: bySupplier.get(supplier.id)!.count,
        balance: bySupplier.get(supplier.id)!.balance.toFixed(2),
      }));
    });
    return { data };
  });

  /** GET /v1/supplier-payments/pending-documents?supplierId= — compras y gastos con saldo del proveedor. */
  app.get<{ Querystring: { supplierId?: string } }>(
    "/v1/supplier-payments/pending-documents",
    canPay,
    async (request, reply) => {
      const supplierId = request.query.supplierId ?? "";
      if (!validId(supplierId)) return reply.code(422).send({ error: "Proveedor inválido." });
      const today = todayIn("America/Bogota");
      const documents = await withOrganizationScope(request.actor!.organizationId, tx =>
        pendingPurchases(tx, { supplierId })
      );
      return {
        data: documents.map(document => ({
          id: document.id,
          number: purchaseNumber(document.number),
          type: purchaseTypeLabels[document.type],
          supplierInvoiceNumber: document.supplierInvoiceNumber,
          issueDate: dateOnly(document.issueDate),
          dueDate: document.dueDate ? dateOnly(document.dueDate) : null,
          overdue: isOverdue({ dueDate: document.dueDate, status: "ACTIVE" }, today),
          total: document.total.toFixed(2),
          applied: document.applied.toFixed(2),
          balance: document.balance.toFixed(2),
        })),
      };
    }
  );

  /**
   * POST /v1/supplier-payments — Body: createSupplierPaymentSchema. Bloquea los documentos (FOR UPDATE) para
   * que dos pagos simultáneos no superen el saldo, asigna CE-n y registra el asiento.
   */
  app.post("/v1/supplier-payments", canPay, async (request, reply) => {
    const parsed = createSupplierPaymentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Pago inválido", details: parsed.error.flatten() });
    const body = parsed.data;
    if (body.date > todayIn("America/Bogota"))
      return reply.code(422).send({ error: "La fecha del pago no puede ser futura." });
    const actor = request.actor!;
    const documentIds = body.applications.map(item => item.purchaseDocumentId);
    try {
      const payment = await withOrganizationScope(actor.organizationId, async tx => {
        const supplier = await tx.party.findFirst({
          where: { id: body.supplierId, isSupplier: true },
          select: { id: true, legalName: true },
        });
        if (!supplier) throw httpError(404, "Proveedor no encontrado en esta organización.");
        await tx.$queryRaw`SELECT id FROM "PurchaseDocument" WHERE id = ANY(${documentIds}::text[]) FOR UPDATE`;
        const pending = await pendingPurchases(tx, { supplierId: supplier.id, documentIds });
        const result = applyToPayables(
          body.applications,
          new Map(pending.map(document => [document.id, document.balance]))
        );
        if ("error" in result) throw httpError(422, result.error);

        const last = await tx.supplierPayment.aggregate({ _max: { number: true } });
        const number = (last._max.number ?? 0) + 1;
        const created = await tx.supplierPayment.create({
          data: {
            organizationId: actor.organizationId,
            supplierId: supplier.id,
            number,
            date: body.date,
            method: body.method,
            reference: body.reference,
            notes: body.notes || undefined,
            total: result.total,
            createdById: actor.sub,
            applications: {
              create: body.applications.map(item => ({
                purchaseDocumentId: item.purchaseDocumentId,
                amount: item.amount,
              })),
            },
          },
        });
        const accounts = await ensureDefaultAccounts(tx, actor.organizationId);
        const amount = result.total.toNumber();
        const journalLines = [
          { accountId: accounts["220505"].id, debit: amount, credit: 0, memo: "Pago a proveedor" },
          {
            accountId: accounts[methodAccount(body.method)].id,
            debit: 0,
            credit: amount,
            memo: `Egreso ${methodLabels[body.method]}`,
          },
        ];
        assertBalanced(journalLines);
        await tx.journalEntry.create({
          data: {
            organizationId: actor.organizationId,
            reference: paymentNumber(number),
            date: body.date,
            description: `Comprobante de egreso a ${supplier.legalName}`,
            status: "POSTED",
            postedAt: new Date(),
            sourceType: "SupplierPayment",
            sourceId: created.id,
            lines: { create: journalLines },
          },
        });
        await audit(tx, request, "SupplierPayment", created.id, "CREATE", {
          number,
          total: result.total.toFixed(2),
          applications: body.applications,
        } as Prisma.InputJsonValue);
        return created;
      });
      return reply.code(201).send({ data: { id: payment.id, number: paymentNumber(payment.number) } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: "Otro pago tomó el mismo consecutivo. Intenta de nuevo." });
      throw error;
    }
  });

  /** POST /v1/supplier-payments/:id/void — anula (con motivo); el saldo vuelve y se registra CE-n-A. */
  app.post<{ Params: { id: string } }>("/v1/supplier-payments/:id/void", canPay, async (request, reply) => {
    const parsed = voidCashReceiptSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(422)
        .send({ error: "Indica el motivo de la anulación (mínimo 3 caracteres).", details: parsed.error.flatten() });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Pago activo no encontrado." });
    const actor = request.actor!;
    const voided = await withOrganizationScope(actor.organizationId, async tx => {
      const payment = await tx.supplierPayment.findFirst({
        where: { id: request.params.id, status: "ACTIVE" },
        include: { supplier: { select: { legalName: true } } },
      });
      if (!payment) return null;
      const accounts = await ensureDefaultAccounts(tx, actor.organizationId);
      const amount = payment.total.toNumber();
      const journalLines = [
        {
          accountId: accounts[methodAccount(payment.method)].id,
          debit: amount,
          credit: 0,
          memo: "Reversión de egreso",
        },
        { accountId: accounts["220505"].id, debit: 0, credit: amount, memo: "Reversión de pago a proveedor" },
      ];
      assertBalanced(journalLines);
      await tx.journalEntry.create({
        data: {
          organizationId: actor.organizationId,
          reference: `${paymentNumber(payment.number)}-A`,
          date: payment.date,
          description: `Anulación del comprobante de egreso ${paymentNumber(payment.number)} a ${payment.supplier.legalName}`,
          status: "POSTED",
          postedAt: new Date(),
          sourceType: "SupplierPayment",
          sourceId: payment.id,
          lines: { create: journalLines },
        },
      });
      await tx.supplierPayment.update({
        where: { id: payment.id },
        data: { status: "VOID", voidReason: parsed.data.reason, voidedAt: new Date() },
      });
      await audit(tx, request, "SupplierPayment", payment.id, "VOID", { status: "VOID", reason: parsed.data.reason });
      return payment;
    });
    if (!voided) return reply.code(404).send({ error: "Pago activo no encontrado." });
    return { data: { id: voided.id, number: paymentNumber(voided.number), status: "VOID" } };
  });
}
