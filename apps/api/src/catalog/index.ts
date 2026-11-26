/**
 * Catálogo de reportes del menú Reportes.
 *
 * Rutas:
 *   GET /v1/reports/catalog ..................... reportes disponibles para el rol de la sesión (id, título, filtros)
 *   GET /v1/reports/catalog/:id?from&to&date&year&search&partyKind&account&product&export=1
 *       Ejecuta un reporte. Los permisos se validan por reporte (403 si el rol no está). `export=1` (descarga en PDF,
 *       Excel o CSV) exige además OWNER, ADMIN o ACCOUNTANT y queda en el AuditLog (ReportCatalog EXPORT).
 *   GET /v1/reports/catalog-options/products .... productos (no servicios) para el filtro del kárdex
 *
 * Límite: 5.000 filas por consulta (`truncated: true` si hay más); se pide acotar el período.
 */
import type { FastifyInstance } from "fastify";
import { withOrganizationScope } from "@betel/db";
import { z } from "zod";
import { actorCan, requireActor } from "../auth.js";
import { resolvePeriod, todayIn } from "../reports.js";
import { accountingReports, auditReports, taxReports } from "./accounting.js";
import { type CatalogReport, columnTotals, iso, type Params } from "./common.js";
import { payrollReports, productReports } from "./inventory.js";
import { partyReports, purchaseReports } from "./parties.js";
import { salesReports } from "./sales.js";

export const catalogReports: CatalogReport[] = [
  ...salesReports,
  ...partyReports,
  ...purchaseReports,
  ...productReports,
  ...payrollReports,
  ...accountingReports,
  ...taxReports,
  ...auditReports,
];
const byId = new Map(catalogReports.map(report => [report.id, report]));
/**
 * Permiso de cada reporte: los que por defecto ven también Ventas y Solo lectura usan «reports.view»; los
 * contables, de cartera, compras, nómina y auditoría, «reports.financial» (editables en Usuarios y permisos).
 */
export const permissionOf = (report: CatalogReport) =>
  report.roles.includes("SALES") ? ("reports.view" as const) : ("reports.financial" as const);
const ROW_LIMIT = 5000;

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  date: z.coerce.date().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  search: z.string().trim().max(120).optional(),
  partyKind: z.enum(["CUSTOMER", "SUPPLIER"]).default("CUSTOMER"),
  account: z
    .string()
    .trim()
    .regex(/^\d{1,10}$/)
    .optional(),
  product: z.string().uuid().optional(),
  export: z.enum(["1"]).optional(),
});

/** Filtros con sus valores por defecto: mes en curso, hoy y año en curso (hora de Colombia). */
export function resolveParams(query: z.infer<typeof querySchema>, now = new Date()): Params {
  const today = todayIn("America/Bogota", now);
  const period = resolvePeriod({ from: query.from, to: query.to }, now);
  return {
    from: period.from,
    to: period.to,
    date: query.date ?? today,
    year: query.year ?? today.getUTCFullYear(),
    search: query.search || undefined,
    partyKind: query.partyKind,
    account: query.account,
    product: query.product,
  };
}

export function registerCatalogRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const auth = { preHandler: requireActor };

  app.get("/v1/reports/catalog", auth, async request => ({
    data: catalogReports
      .filter(report => actorCan(request, permissionOf(report)))
      .map(({ id, title, params }) => ({ id, title, params })),
  }));

  app.get("/v1/reports/catalog-options/products", auth, async request => {
    const data = await withOrganizationScope(request.actor!.organizationId, tx =>
      tx.product.findMany({
        where: { kind: "PRODUCT" },
        select: { id: true, sku: true, name: true },
        orderBy: { name: "asc" },
      })
    );
    return { data };
  });

  app.get<{ Params: { id: string } }>("/v1/reports/catalog/:id", auth, async (request, reply) => {
    const report = byId.get(request.params.id);
    if (!report) return reply.code(404).send({ error: "El reporte no existe." });
    const actor = request.actor!;
    if (!actorCan(request, permissionOf(report)))
      return reply.code(403).send({ error: "Tu rol no tiene acceso a este reporte." });
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos.", details: parsed.error.flatten() });
    const exporting = parsed.data.export === "1";
    if (exporting && !actorCan(request, "reports.export"))
      return reply.code(403).send({ error: "Tu rol no puede descargar reportes." });
    const params = resolveParams(parsed.data);
    if (report.params.includes("period") && params.from > params.to)
      return reply.code(422).send({ error: "La fecha inicial no puede ser posterior a la final." });

    const result = await withOrganizationScope(actor.organizationId, async tx => {
      const output = await report.run(tx, params);
      if (exporting)
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.sub,
            entity: "ReportCatalog",
            entityId: report.id,
            action: "EXPORT",
            after: { rows: output.rows.length, from: iso(params.from), to: iso(params.to), date: iso(params.date) },
            ipHash: options.auditIp(request.ip),
          },
        });
      return output;
    });
    const truncated = result.rows.length > ROW_LIMIT;
    return {
      id: report.id,
      title: report.title,
      columns: result.columns,
      data: truncated ? result.rows.slice(0, ROW_LIMIT) : result.rows,
      totals: result.totals ?? columnTotals(result.columns, result.rows),
      notes: result.notes ?? [],
      truncated,
      period: report.params.includes("period")
        ? { from: iso(params.from), to: iso(params.to) }
        : report.params.includes("date")
          ? { from: null, to: iso(params.date) }
          : report.params.includes("year")
            ? { from: `${params.year}-01-01`, to: `${params.year}-12-31` }
            : { from: null, to: null },
      filters: {
        partyKind: report.params.includes("partyKind") ? params.partyKind : undefined,
        account: params.account,
        search: params.search,
      },
    };
  });
}
