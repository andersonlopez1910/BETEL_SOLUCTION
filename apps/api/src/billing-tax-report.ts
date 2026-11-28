/**
 * Reporte de facturación › Detalle tributario: un renglón por producto o servicio vendido, con los valores que
 * calculó el MOTOR TRIBUTARIO ÚNICO al facturar (fotografía del renglón; no se recalcula).
 *
 * Rutas:
 *   GET /v1/reports/billing/tax-detail ............. filas paginadas + KPI del período (permiso reports.view)
 *   GET /v1/reports/billing/tax-detail?export=1 .... todas las filas (permiso reports.export; auditado)
 * Filtros: from, to, customerId, productId, category, sellerId, documentType (FE|POS), vatRate, status.
 *
 * Costo: costo contable unitario guardado en el renglón al facturar (unitAccountingCost); en renglones anteriores a
 * la parametrización, el costo contable actual del producto. Utilidad bruta = base − costo total.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import { z } from "zod";
import { actorCan, allowPermission } from "./auth.js";
import { BILLED_STATUSES, EXPORT_LIMIT, resolvePeriod } from "./reports.js";

const ZERO = new Prisma.Decimal(0);
const statusLabels: Record<string, string> = {
  ISSUED: "Emitida",
  ACCEPTED: "Aceptada",
  OVERDUE: "Vencida",
  VOID: "Anulada",
  REJECTED: "Rechazada",
};
const documentLabels: Record<string, string> = { FE: "Factura electrónica", POS: "Documento equivalente POS" };

export const taxDetailQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  customerId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  category: z.string().trim().max(80).optional(),
  sellerId: z.string().uuid().optional(),
  documentType: z.enum(["FE", "POS"]).optional(),
  vatRate: z.coerce.number().min(0).max(100).optional(),
  status: z.enum(["BILLED", "ISSUED", "ACCEPTED", "OVERDUE", "VOID"]).default("BILLED"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  export: z.enum(["1"]).optional(),
});

export type TaxDetailRow = {
  base: Prisma.Decimal;
  vat: Prisma.Decimal;
  inc: Prisma.Decimal;
  discount: Prisma.Decimal;
  total: Prisma.Decimal;
  costTotal: Prisma.Decimal;
};

/** KPI del reporte: ventas antes de impuestos, IVA, INC, descuentos, ventas totales, costo, utilidad y margen. */
export function taxDetailSummary(rows: TaxDetailRow[]) {
  const sum = (key: keyof TaxDetailRow) => rows.reduce((total, row) => total.plus(row[key]), ZERO);
  const base = sum("base");
  const cost = sum("costTotal");
  const profit = base.minus(cost);
  return {
    salesBeforeTaxes: base.toFixed(2),
    vat: sum("vat").toFixed(2),
    inc: sum("inc").toFixed(2),
    discounts: sum("discount").toFixed(2),
    totalSales: sum("total").toFixed(2),
    cost: cost.toFixed(2),
    grossProfit: profit.toFixed(2),
    grossMargin: base.isZero() ? "0.00" : profit.dividedBy(base).times(100).toFixed(2),
  };
}

export function registerBillingTaxReportRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  app.get("/v1/reports/billing/tax-detail", { preHandler: allowPermission("reports.view") }, async (request, reply) => {
    const parsed = taxDetailQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos.", details: parsed.error.flatten() });
    const query = parsed.data;
    const exporting = query.export === "1";
    if (exporting && !actorCan(request, "reports.export"))
      return reply.code(403).send({ error: "No tienes permiso para descargar reportes." });
    const period = resolvePeriod(query);
    const actor = request.actor!;

    const result = await withOrganizationScope(actor.organizationId, async tx => {
      // Vendedor = usuario que creó la factura (AuditLog CREATE_DRAFT), como en el resto de reportes.
      const sellerInvoices = query.sellerId
        ? (
            await tx.auditLog.findMany({
              where: { entity: "Invoice", action: "CREATE_DRAFT", userId: query.sellerId },
              select: { entityId: true },
            })
          ).map(log => log.entityId)
        : undefined;
      const where: Prisma.InvoiceLineWhereInput = {
        invoice: {
          issueDate: { gte: period.from, lte: period.to },
          status: query.status === "BILLED" ? { in: [...BILLED_STATUSES] } : query.status,
          ...(query.customerId && { customerId: query.customerId }),
          ...(query.documentType && { documentType: query.documentType }),
          ...(sellerInvoices && { id: { in: sellerInvoices } }),
        },
        ...(query.productId && { productId: query.productId }),
        ...(query.category && { product: { category: query.category } }),
        ...(query.vatRate !== undefined && { taxRate: query.vatRate }),
      };
      const lines = await tx.invoiceLine.findMany({
        where,
        select: {
          id: true,
          description: true,
          quantity: true,
          unitPrice: true,
          priceIncludesTax: true,
          grossAmount: true,
          discountAmount: true,
          taxableBase: true,
          taxRate: true,
          taxAmount: true,
          incRate: true,
          incAmount: true,
          lineTotal: true,
          unitAccountingCost: true,
          internalCode: true,
          product: { select: { sku: true, name: true, category: true, accountingCost: true } },
          invoice: {
            select: {
              id: true,
              issueDate: true,
              documentType: true,
              prefix: true,
              number: true,
              status: true,
              customer: { select: { legalName: true, identificationNumber: true } },
            },
          },
        },
        orderBy: [{ invoice: { issueDate: "desc" } }, { invoice: { createdAt: "desc" } }],
      });
      if (exporting)
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.sub,
            entity: "BillingReport",
            entityId: "tax-detail",
            action: "EXPORT",
            after: { rows: lines.length, filters: request.query as Prisma.InputJsonValue },
            ipHash: options.auditIp(request.ip),
          },
        });
      return lines;
    });

    const rows = result.map(line => {
      const unitCost = line.unitAccountingCost ?? line.product?.accountingCost ?? ZERO;
      const costTotal = unitCost.times(line.quantity).toDecimalPlaces(2);
      const profit = line.taxableBase.minus(costTotal);
      return {
        id: line.id,
        date: line.invoice.issueDate.toISOString().slice(0, 10),
        documentType: documentLabels[line.invoice.documentType] ?? line.invoice.documentType,
        documentNumber: `${line.invoice.prefix ?? ""}${line.invoice.number ?? ""}` || "Sin numerar",
        invoiceId: line.invoice.id,
        customer: line.invoice.customer.legalName,
        nit: line.invoice.customer.identificationNumber,
        product: line.product?.name ?? line.description,
        productCode: line.internalCode ?? line.product?.sku ?? "",
        category: line.product?.category ?? "",
        quantity: line.quantity.toDecimalPlaces(4).toString(),
        unitPrice: line.unitPrice.toFixed(2),
        priceIncludesTax: line.priceIncludesTax,
        base: line.taxableBase.toFixed(2),
        vatRate: line.taxRate.toFixed(2),
        vat: line.taxAmount.toFixed(2),
        incRate: line.incRate.toFixed(2),
        inc: line.incAmount.toFixed(2),
        discount: line.discountAmount.toFixed(2),
        subtotal: line.grossAmount.toFixed(2),
        total: line.lineTotal.toFixed(2),
        unitCost: unitCost.toFixed(2),
        costTotal: costTotal.toFixed(2),
        grossProfit: profit.toFixed(2),
        grossMargin: line.taxableBase.isZero() ? "0.00" : profit.dividedBy(line.taxableBase).times(100).toFixed(2),
        status: statusLabels[line.invoice.status] ?? line.invoice.status,
        _totals: {
          base: line.taxableBase,
          vat: line.taxAmount,
          inc: line.incAmount,
          discount: line.discountAmount,
          total: line.lineTotal,
          costTotal,
        },
      };
    });
    if (exporting && rows.length > EXPORT_LIMIT)
      return reply.code(413).send({ error: `La consulta supera ${EXPORT_LIMIT} filas. Acota los filtros.` });
    const summary = taxDetailSummary(rows.map(row => row._totals));
    const clean = (list: typeof rows) => list.map(({ _totals, ...row }) => row);
    const start = (query.page - 1) * query.pageSize;
    return {
      data: clean(exporting ? rows : rows.slice(start, start + query.pageSize)),
      summary,
      pagination: { page: query.page, pageSize: query.pageSize, total: rows.length },
      period: { from: period.from.toISOString().slice(0, 10), to: period.to.toISOString().slice(0, 10) },
    };
  });
}
