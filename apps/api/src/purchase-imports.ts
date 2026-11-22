/**
 * Compras y gastos › Soporte de compras o gastos por legalizar.
 *
 * Se importa el XML de la factura electrónica que envió el proveedor (UBL 2.1 o AttachedDocument, ver ubl.ts) y
 * después se "legaliza": se convierte en compra o gasto (CG-n) con su asiento, igual que "Nueva compra".
 *
 * Rutas:
 *   GET  /v1/reports/purchases/imports ............ lista paginada (search, status, from, to)
 *   GET  /v1/reports/purchases/imports/export ..... todas las filas filtradas (descarga Excel)
 *   GET  /v1/purchases/imports/:id ................ detalle (ítems, advertencias, proveedor encontrado)
 *   POST /v1/purchases/imports .................... "Importar nuevo documento" (XML hasta 2 MB)
 *   POST /v1/purchases/imports/:id/legalize ....... crear la compra o gasto
 *   POST /v1/purchases/imports/:id/reject ......... descartar con motivo
 *   POST /v1/purchases/imports/:id/restore ........ volver a "Por legalizar" un soporte rechazado
 *
 * REGLAS (también en docs/compras-y-gastos.md):
 *   - La factura debe estar dirigida al NIT de la organización y su CUFE no puede estar ya importado.
 *   - Los ítems deben sumar el total de la factura (tolerancia de $1 por redondeo). Impuestos distintos al IVA,
 *     cargos o descuentos globales y otra moneda impiden legalizar (Betel no los registra en compras).
 *   - Al legalizar, el proveedor se busca por su identificación; si no existe se crea como proveedor.
 *   - Si es a crédito y se marca, la factura también queda en "Registro de eventos" para enviar sus eventos DIAN.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import {
  importPurchaseSchema,
  legalizeImportSchema,
  purchaseImportQuerySchema,
  voidCashReceiptSchema,
  type PurchaseImportQuery,
} from "@betel/contracts";
import { allowRoles } from "./auth.js";
import { calculateDocumentTotals } from "./accounting.js";
import { RECEIPT_ROLES } from "./collections.js";
import { createPurchaseDocument, purchaseNumber, purchaseTypeLabels } from "./purchases.js";
import { EXPORT_LIMIT, REPORT_EXPORT_ROLES, REPORT_VIEW_ROLES } from "./reports.js";
import { MAX_XML_LENGTH, parseElectronicInvoice, type ParsedInvoice } from "./ubl.js";

type Tx = Prisma.TransactionClient;
type Warning = { message: string; blocking: boolean };
type ImportLine = ParsedInvoice["lines"][number];

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

// ─── Cálculos puros (probados en test/purchase-imports.test.ts) ──────────────

/** Advertencia si los ítems, calculados como los calcula Betel, no suman el total de la factura. */
export function totalsWarning(lines: ImportLine[], total: number): Warning | null {
  const computed = calculateDocumentTotals(lines).total;
  return Math.abs(computed - total) > 1
    ? {
        message: `Los ítems suman ${computed.toFixed(2)} y la factura dice ${total.toFixed(2)}: no se puede legalizar sin descuadre.`,
        blocking: true,
      }
    : null;
}

/** ¿La factura va dirigida a la organización? Compara solo dígitos y acepta el NIT con o sin dígito de verificación. */
export function addressedTo(customerNit: string, organization: { nit: string; verificationDigit: string | null }) {
  const nit = organization.nit.replace(/\D/g, "");
  return customerNit === nit || customerNit === `${nit}${organization.verificationDigit ?? ""}`;
}

// ─── Consultas ────────────────────────────────────────────────────────────────

function where(query: PurchaseImportQuery): Prisma.PurchaseImportWhereInput {
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  return {
    ...(query.status && { status: query.status }),
    ...((query.from || query.to) && {
      issueDate: { ...(query.from && { gte: query.from }), ...(query.to && { lte: query.to }) },
    }),
    ...(query.search && {
      OR: [
        { number: contains(query.search) },
        { supplierName: contains(query.search) },
        { supplierNit: { contains: query.search } },
        { cufe: { contains: query.search.toLowerCase() } },
        { fileName: contains(query.search) },
      ],
    }),
  };
}

const rowSelect = {
  id: true,
  fileName: true,
  cufe: true,
  number: true,
  supplierName: true,
  supplierNit: true,
  supplierIdType: true,
  issueDate: true,
  dueDate: true,
  paymentTerm: true,
  currency: true,
  subtotal: true,
  taxTotal: true,
  total: true,
  warnings: true,
  status: true,
  rejectReason: true,
  createdAt: true,
  purchaseDocument: { select: { id: true, number: true, type: true, status: true } },
} satisfies Prisma.PurchaseImportSelect;

function present(row: Prisma.PurchaseImportGetPayload<{ select: typeof rowSelect }>) {
  const warnings = (row.warnings as Warning[]) ?? [];
  return {
    id: row.id,
    fileName: row.fileName,
    cufe: row.cufe,
    number: row.number,
    supplierName: row.supplierName,
    supplierNit: row.supplierNit,
    supplierIdType: row.supplierIdType,
    issueDate: dateOnly(row.issueDate),
    dueDate: row.dueDate ? dateOnly(row.dueDate) : null,
    paymentTerm: row.paymentTerm,
    currency: row.currency,
    subtotal: row.subtotal.toFixed(2),
    taxTotal: row.taxTotal.toFixed(2),
    total: row.total.toFixed(2),
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    rejectReason: row.rejectReason,
    warnings,
    blocked: warnings.some(warning => warning.blocking),
    // "Nombre Comprobante" y "Número de comprobante" de la compra o gasto creada al legalizar.
    voucher: row.purchaseDocument
      ? {
          id: row.purchaseDocument.id,
          name: purchaseTypeLabels[row.purchaseDocument.type]!,
          number: purchaseNumber(row.purchaseDocument.number),
          void: row.purchaseDocument.status === "VOID",
        }
      : null,
  };
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerPurchaseImportRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowRoles(...REPORT_VIEW_ROLES) };
  const canExport = { preHandler: allowRoles(...REPORT_EXPORT_ROLES) };
  const canRegister = { preHandler: allowRoles(...RECEIPT_ROLES) };
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
        entity: "PurchaseImport",
        entityId,
        action,
        after,
        ipHash: options.auditIp(request.ip),
      },
    });

  /** GET /v1/reports/purchases/imports — Query: purchaseImportQuerySchema. */
  app.get("/v1/reports/purchases/imports", canView, async (request, reply) => {
    const parsed = purchaseImportQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const { page, pageSize } = parsed.data;
    const filter = where(parsed.data);
    const [rows, total] = await withOrganizationScope(request.actor!.organizationId, tx =>
      Promise.all([
        tx.purchaseImport.findMany({
          where: filter,
          select: rowSelect,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.purchaseImport.count({ where: filter }),
      ])
    );
    return { data: rows.map(present), pagination: { page, pageSize, total } };
  });

  /** GET /v1/reports/purchases/imports/export — todas las filas filtradas (auditado). */
  app.get("/v1/reports/purchases/imports/export", canExport, async (request, reply) => {
    const parsed = purchaseImportQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const rows = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const found = await tx.purchaseImport.findMany({
        where: where(parsed.data),
        select: rowSelect,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: EXPORT_LIMIT + 1,
      });
      if (found.length <= EXPORT_LIMIT)
        await audit(tx, request, "list", "EXPORT", {
          filters: request.query,
          rows: found.length,
        } as Prisma.InputJsonValue);
      return found;
    });
    if (rows.length > EXPORT_LIMIT)
      return reply.code(413).send({ error: `La consulta supera ${EXPORT_LIMIT} filas. Acota los filtros.` });
    return { data: rows.map(present), total: rows.length };
  });

  /** GET /v1/purchases/imports/:id — detalle con ítems y el proveedor que se usará al legalizar. */
  app.get<{ Params: { id: string } }>("/v1/purchases/imports/:id", canView, async (request, reply) => {
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Soporte no encontrado." });
    const found = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const row = await tx.purchaseImport.findFirst({
        where: { id: request.params.id },
        select: { ...rowSelect, lines: true, createdBy: { select: { displayName: true, email: true } } },
      });
      if (!row) return null;
      const supplier = await tx.party.findFirst({
        where: { identificationNumber: row.supplierNit },
        select: { id: true, legalName: true, isSupplier: true, active: true },
      });
      return { row, supplier };
    });
    if (!found) return reply.code(404).send({ error: "Soporte no encontrado." });
    return {
      data: {
        ...present(found.row),
        lines: found.row.lines as ImportLine[],
        createdBy: found.row.createdBy?.displayName ?? found.row.createdBy?.email ?? null,
        supplier: found.supplier,
      },
    };
  });

  /** POST /v1/purchases/imports — Body: importPurchaseSchema (el XML viaja como texto). */
  app.post("/v1/purchases/imports", { ...canRegister, bodyLimit: MAX_XML_LENGTH * 2 }, async (request, reply) => {
    const parsed = importPurchaseSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(422)
        .send({ error: parsed.error.issues[0]?.message ?? "Archivo inválido", details: parsed.error.flatten() });
    let invoice: ParsedInvoice;
    try {
      invoice = parseElectronicInvoice(parsed.data.xml);
    } catch (error) {
      return reply.code(422).send({ error: (error as Error).message });
    }
    const actor = request.actor!;
    try {
      const created = await withOrganizationScope(actor.organizationId, async tx => {
        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: actor.organizationId },
          select: { nit: true, verificationDigit: true },
        });
        if (!addressedTo(invoice.customerNit, organization))
          throw httpError(
            422,
            `La factura está dirigida al NIT ${invoice.customerNit}, no al de tu empresa (${organization.nit}).`
          );
        const warnings = [...invoice.warnings, ...[totalsWarning(invoice.lines, invoice.total)].filter(Boolean)];
        const row = await tx.purchaseImport.create({
          data: {
            organizationId: actor.organizationId,
            cufe: invoice.cufe,
            fileName: parsed.data.fileName,
            supplierNit: invoice.supplier.nit,
            supplierIdType: invoice.supplier.idType,
            supplierName: invoice.supplier.name,
            number: invoice.number,
            issueDate: new Date(`${invoice.issueDate}T00:00:00Z`),
            dueDate: invoice.dueDate ? new Date(`${invoice.dueDate}T00:00:00Z`) : null,
            paymentTerm: invoice.paymentTerm,
            currency: invoice.currency,
            subtotal: invoice.subtotal,
            taxTotal: invoice.taxTotal,
            total: invoice.total,
            lines: invoice.lines as Prisma.InputJsonValue,
            warnings: warnings as Prisma.InputJsonValue,
            xml: parsed.data.xml,
            createdById: actor.sub,
          },
        });
        // A crédito: también en "Registro de eventos" (si el CUFE aún no está registrado).
        let events = false;
        if (parsed.data.registerEvents && invoice.paymentTerm === "CREDIT") {
          const exists = await tx.receivedInvoice.findFirst({ where: { cufe: invoice.cufe }, select: { id: true } });
          if (!exists) {
            const supplier = await tx.party.findFirst({
              where: { identificationNumber: invoice.supplier.nit, isSupplier: true },
              select: { id: true },
            });
            await tx.receivedInvoice.create({
              data: {
                organizationId: actor.organizationId,
                cufe: invoice.cufe,
                supplierId: supplier?.id ?? null,
                supplierNit: invoice.supplier.nit,
                supplierName: invoice.supplier.name,
                number: invoice.number,
                issueDate: new Date(`${invoice.issueDate}T00:00:00Z`),
                total: invoice.total,
                createdById: actor.sub,
              },
            });
            events = true;
          }
        }
        await audit(tx, request, row.id, "IMPORT", {
          cufe: invoice.cufe,
          number: invoice.number,
          total: invoice.total.toFixed(2),
          registeredEvents: events,
        });
        return { id: row.id, events, warnings };
      });
      return reply.code(201).send({ data: created });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: "Esta factura (CUFE) ya fue importada." });
      throw error;
    }
  });

  /** POST /v1/purchases/imports/:id/legalize — Body: legalizeImportSchema. Crea la compra o gasto. */
  app.post<{ Params: { id: string } }>("/v1/purchases/imports/:id/legalize", canRegister, async (request, reply) => {
    const parsed = legalizeImportSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Datos inválidos", details: parsed.error.flatten() });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Soporte no encontrado." });
    const body = parsed.data;
    const actor = request.actor!;
    try {
      const result = await withOrganizationScope(actor.organizationId, async tx => {
        await tx.$queryRaw`SELECT id FROM "PurchaseImport" WHERE id = ${request.params.id} FOR UPDATE`;
        const row = await tx.purchaseImport.findFirst({ where: { id: request.params.id } });
        if (!row) throw httpError(404, "Soporte no encontrado.");
        if (row.status !== "PENDING")
          throw httpError(
            409,
            row.status === "LEGALIZED" ? "Este soporte ya fue legalizado." : "Este soporte está rechazado."
          );
        const blocking = (row.warnings as Warning[]).find(warning => warning.blocking);
        if (blocking) throw httpError(422, blocking.message);
        const dueDate = row.dueDate ?? body.dueDate;
        if (row.paymentTerm === "CREDIT" && !dueDate)
          throw httpError(422, "Indica la fecha de vencimiento: la factura es a crédito y no la trae.");
        if (row.paymentTerm === "CREDIT" && dueDate! < row.issueDate)
          throw httpError(422, "El vencimiento no puede ser anterior a la fecha de la factura.");

        // Proveedor por identificación; si no existe, se crea con los datos del XML.
        let supplier = await tx.party.findFirst({
          where: { identificationNumber: row.supplierNit },
          select: { id: true, legalName: true, isSupplier: true, active: true },
        });
        let createdSupplier = false;
        if (supplier && !supplier.active)
          throw httpError(
            409,
            `El proveedor ${supplier.legalName} está inactivo. Actívalo en Proveedores para legalizar.`
          );
        if (supplier && !supplier.isSupplier)
          await tx.party.update({ where: { id: supplier.id }, data: { isSupplier: true } });
        if (!supplier) {
          supplier = await tx.party.create({
            data: {
              organizationId: actor.organizationId,
              kind: row.supplierIdType === "NIT" ? "COMPANY" : "PERSON",
              identificationType: row.supplierIdType,
              identificationNumber: row.supplierNit,
              legalName: row.supplierName,
              taxResponsibilities: [],
              isSupplier: true,
            },
            select: { id: true, legalName: true, isSupplier: true, active: true },
          });
          createdSupplier = true;
        }

        const document = await createPurchaseDocument(tx, actor, {
          type: body.type,
          supplierId: supplier.id,
          supplierInvoiceNumber: row.number,
          issueDate: row.issueDate,
          paymentMethod: row.paymentTerm,
          dueDate: row.paymentTerm === "CREDIT" ? dueDate! : undefined,
          notes:
            body.notes || `Legalizado desde el soporte importado ${row.fileName} (CUFE ${row.cufe.slice(0, 12)}…).`,
          lines: (row.lines as ImportLine[]).map(line => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountRate: line.discountRate,
            taxRate: line.taxRate,
          })),
        });
        if (document.total.minus(row.total).abs().greaterThan(1))
          throw httpError(422, "La compra calculada no coincide con el total de la factura.");
        await tx.purchaseImport.update({
          where: { id: row.id },
          data: { status: "LEGALIZED", purchaseDocumentId: document.id },
        });
        await audit(tx, request, row.id, "LEGALIZE", {
          purchaseDocument: purchaseNumber(document.number),
          type: body.type,
          createdSupplier,
        });
        return { purchaseDocumentId: document.id, number: purchaseNumber(document.number), createdSupplier };
      });
      return reply.code(201).send({ data: result });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply
          .code(409)
          .send({ error: "Se tomó el mismo consecutivo o el proveedor ya existe. Intenta de nuevo." });
      throw error;
    }
  });

  /** POST /v1/purchases/imports/:id/reject — Body: { reason }. */
  app.post<{ Params: { id: string } }>("/v1/purchases/imports/:id/reject", canRegister, async (request, reply) => {
    const parsed = voidCashReceiptSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(422)
        .send({ error: "Indica el motivo (mínimo 3 caracteres).", details: parsed.error.flatten() });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Soporte por legalizar no encontrado." });
    const updated = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await tx.purchaseImport.updateMany({
        where: { id: request.params.id, status: "PENDING" },
        data: { status: "REJECTED", rejectReason: parsed.data.reason },
      });
      if (result.count) await audit(tx, request, request.params.id, "REJECT", { reason: parsed.data.reason });
      return result.count;
    });
    if (!updated) return reply.code(404).send({ error: "Soporte por legalizar no encontrado." });
    return { data: { id: request.params.id, status: "REJECTED" } };
  });

  /** POST /v1/purchases/imports/:id/restore — un soporte rechazado vuelve a "Por legalizar". */
  app.post<{ Params: { id: string } }>("/v1/purchases/imports/:id/restore", canRegister, async (request, reply) => {
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Soporte rechazado no encontrado." });
    const updated = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await tx.purchaseImport.updateMany({
        where: { id: request.params.id, status: "REJECTED" },
        data: { status: "PENDING", rejectReason: null },
      });
      if (result.count) await audit(tx, request, request.params.id, "RESTORE", { status: "PENDING" });
      return result.count;
    });
    if (!updated) return reply.code(404).send({ error: "Soporte rechazado no encontrado." });
    return { data: { id: request.params.id, status: "PENDING" } };
  });
}
