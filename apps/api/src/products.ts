/**
 * Productos y servicios › Gestión de productos / servicios.
 *
 * Rutas:
 *   GET    /v1/products ........................ catálogo activo (máx. 100; ?search=, ?kind=) para los formularios
 *   POST   /v1/products ........................ crear producto o servicio (código vacío = siguiente C-n)
 *   PUT    /v1/products/:id .................... editar
 *   POST   /v1/products/:id/active ............. activar o inactivar
 *   POST   /v1/products/bulk-active ............ activar o inactivar los seleccionados
 *   DELETE /v1/products/:id .................... eliminar (solo si ningún documento lo usa)
 *   POST   /v1/products/import ................. importar filas leídas de Excel o CSV
 *   GET    /v1/reports/products ................ lista paginada con stock
 *   GET    /v1/reports/products/export ......... todas las filas filtradas (descarga Excel)
 *   GET    /v1/reports/products/top ............ Ver reportes › Productos más vendidos
 *
 * DEFINICIONES (también en docs/productos-y-servicios.md):
 *   - Stock (solo productos) = entradas − salidas, calculado de los documentos:
 *       entradas: cantidades de las COMPRAS vigentes (CG-n tipo compra) con el producto y las entradas de
 *         saldo inicial y ajustes de inventario vigentes (inventory.ts);
 *       salidas: cantidades de las facturas de venta emitidas, aceptadas o vencidas con el producto y las salidas
 *         de los ajustes de inventario vigentes.
 *     Puede ser negativo si se vendió más de lo que se ha registrado como comprado (igual que la referencia).
 *     Las remisiones no descuentan hasta facturarse.
 *   - Los servicios no manejan stock.
 *   - Un producto inactivo no se ofrece al crear documentos nuevos; su historial se conserva.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma, withOrganizationScope } from "@betel/db";
import {
  bulkProductActiveSchema,
  importProductsSchema,
  productQuerySchema,
  productSchema,
  toggleCustomerSchema,
  topProductsQuerySchema,
  type ProductQuery,
  computeCost,
  computeSale,
  saleTreatmentFromLegacy,
  grossProfit,
} from "@betel/contracts";
import { actorCan, allowPermission, requireActor, type MembershipRole } from "./auth.js";
import { createInventoryDocument } from "./inventory.js";
import { ensureDefaultAccounts } from "./accounting.js";
import { analyzeImport, IMPORT_COLUMNS } from "./product-import.js";
import { BILLED_STATUSES, EXPORT_LIMIT, REPORT_EXPORT_ROLES, REPORT_VIEW_ROLES, resolvePeriod, todayIn } from "./reports.js";

type Tx = Prisma.TransactionClient;
const ZERO = new Prisma.Decimal(0);

/** Crean, editan, activan e importan productos (los vendedores también, como hasta ahora). */
export const PRODUCT_ROLES: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT", "SALES"];
/** Eliminar es irreversible: solo administración y contabilidad. */
const DELETE_ROLES: MembershipRole[] = ["OWNER", "ADMIN", "ACCOUNTANT"];

// ─── Cálculos puros (probados en test/products.test.ts) ──────────────────────

/** Siguiente código automático C-n a partir de los códigos existentes. */
export function nextProductCode(codes: (string | null)[]) {
  const max = codes.reduce((top, code) => {
    const match = code?.match(/^C-(\d+)$/i);
    return match ? Math.max(top, Number(match[1])) : top;
  }, 0);
  return `C-${max + 1}`;
}

/** Estado del stock para el indicador y el filtro. */
export const stockState = (stock: Prisma.Decimal) =>
  stock.isNegative() ? "NEGATIVE" : stock.isZero() ? "ZERO" : "POSITIVE";

const KIND_WORDS: Record<string, "PRODUCT" | "SERVICE"> = {
  producto: "PRODUCT",
  product: "PRODUCT",
  servicio: "SERVICE",
  service: "SERVICE",
};
const UNIT_WORDS: Record<string, string> = {
  unidad: "UND",
  und: "UND",
  un: "UND",
  servicio: "SERV",
  serv: "SERV",
  kilogramo: "KG",
  kg: "KG",
  metro: "M",
  m: "M",
  litro: "L",
  l: "L",
  caja: "CAJA",
  hora: "HORA",
  galon: "GAL",
  galón: "GAL",
  paquete: "PAQ",
  m2: "M2",
  m3: "M3",
};
const pick = (row: Record<string, unknown>, ...keys: string[]) => {
  for (const key of Object.keys(row)) {
    const normalized = key.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
    if (keys.includes(normalized)) {
      const value = row[key];
      return value === null || value === undefined ? "" : String(value).trim();
    }
  }
  return "";
};
const number = (value: string) => {
  // Acepta 1.234,56 · 1,234.56 · 1234.56 · $ 5.500
  const clean = value.replace(/[^\d.,-]/g, "");
  if (!clean) return NaN;
  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  const decimal = lastComma > lastDot ? "," : ".";
  const thousands = decimal === "," ? "." : ",";
  const decimals = clean.length - Math.max(lastComma, lastDot) - 1;
  // "5.500" (punto y 3 dígitos, sin coma) se lee como miles, como se escribe en Colombia.
  if (decimal === "." && lastComma < 0 && decimals === 3 && clean.split(".").length === 2)
    return Number(clean.replace(".", ""));
  return Number(clean.split(thousands).join("").replace(decimal, "."));
};

/**
 * Convierte una fila de Excel/CSV (encabezados en español o inglés) en un producto. Columnas: Nombre (obligatoria),
 * Código, Tipo (Producto/Servicio), Unidad, Precio, IVA, Descripción. Devuelve el producto o el error.
 */
export function productFromRow(row: Record<string, unknown>) {
  const kindText = pick(row, "tipo", "type", "kind").toLowerCase();
  const unitText = pick(row, "unidad", "unidad de medida", "unit").toLowerCase();
  const tax = pick(row, "iva", "iva %", "impuesto", "tax", "taxrate").replace("%", "");
  const parsed = productSchema.safeParse({
    sku: pick(row, "codigo", "code", "sku", "referencia") || undefined,
    name: pick(row, "nombre", "name", "producto", "producto o servicio"),
    description: pick(row, "descripcion", "description") || undefined,
    kind: kindText ? (KIND_WORDS[kindText] ?? kindText.toUpperCase()) : undefined,
    // Sin unidad: "servicio" para los servicios y "unidad" para los productos (como al crearlos en pantalla).
    unit: unitText
      ? (UNIT_WORDS[unitText] ?? unitText.toUpperCase()).slice(0, 10)
      : KIND_WORDS[kindText] === "SERVICE"
        ? "SERV"
        : undefined,
    unitPrice: number(pick(row, "precio", "precio de venta", "valor", "price", "unitprice")),
    taxRate: tax ? number(tax) : undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const field = { name: "Nombre", unitPrice: "Precio", taxRate: "IVA", kind: "Tipo", unit: "Unidad", sku: "Código" }[
      String(issue.path[0])
    ];
    return {
      error: `${field ?? "Fila"}: ${issue.path[0] === "unitPrice" ? "precio inválido o vacío" : issue.message}`,
    };
  }
  return { product: parsed.data };
}

// ─── Consultas ────────────────────────────────────────────────────────────────

/** Entradas, salidas y stock por producto (ver DEFINICIONES). */
export async function stockByProduct(tx: Tx, productIds?: string[]) {
  const product = productIds ? { in: productIds } : { not: null };
  const [purchases, sales, adjustments] = await Promise.all([
    tx.purchaseLine.groupBy({
      by: ["productId"],
      where: { productId: product, purchaseDocument: { status: "ACTIVE", type: "PURCHASE" } },
      _sum: { quantity: true },
    }),
    tx.invoiceLine.groupBy({
      by: ["productId"],
      where: { productId: product, invoice: { status: { in: [...BILLED_STATUSES] } } },
      _sum: { quantity: true },
    }),
    // Saldo inicial y ajustes de inventario vigentes (inventory.ts): entradas y salidas.
    tx.inventoryLine.groupBy({
      by: ["productId", "direction"],
      where: { productId: productIds ? { in: productIds } : undefined, document: { status: "ACTIVE" } },
      _sum: { quantity: true },
    }),
  ]);
  const result = new Map<string, { inflow: Prisma.Decimal; outflow: Prisma.Decimal; stock: Prisma.Decimal }>();
  const entry = (id: string) => result.get(id) ?? { inflow: ZERO, outflow: ZERO, stock: ZERO };
  for (const row of purchases) {
    const current = entry(row.productId!);
    const inflow = current.inflow.plus(row._sum.quantity ?? ZERO);
    result.set(row.productId!, { ...current, inflow, stock: inflow.minus(current.outflow) });
  }
  for (const row of sales) {
    const current = entry(row.productId!);
    const outflow = current.outflow.plus(row._sum.quantity ?? ZERO);
    result.set(row.productId!, { ...current, outflow, stock: current.inflow.minus(outflow) });
  }
  for (const row of adjustments) {
    const current = entry(row.productId);
    const quantity = row._sum.quantity ?? ZERO;
    const inflow = row.direction === "IN" ? current.inflow.plus(quantity) : current.inflow;
    const outflow = row.direction === "OUT" ? current.outflow.plus(quantity) : current.outflow;
    result.set(row.productId, { inflow, outflow, stock: inflow.minus(outflow) });
  }
  return result;
}

async function loadProducts(tx: Tx, query: ProductQuery, rows: { skip: number; take: number }) {
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  const stock = await stockByProduct(tx);
  const conditions: Prisma.ProductWhereInput[] = [];
  if (query.kind) conditions.push({ kind: query.kind });
  if (query.status !== "ALL") conditions.push({ active: query.status === "ACTIVE" });
  if (query.search)
    conditions.push({
      OR: [{ name: contains(query.search) }, { sku: contains(query.search) }, { description: contains(query.search) }],
    });
  if (query.stock) {
    // El stock se calcula: se filtra por los ids que cumplen (los productos sin movimientos tienen stock 0).
    const matching = [...stock].filter(([, value]) => stockState(value.stock) === query.stock).map(([id]) => id);
    conditions.push({ kind: "PRODUCT" });
    conditions.push(
      query.stock === "ZERO"
        ? { OR: [{ id: { in: matching } }, { id: { notIn: [...stock.keys()] } }] }
        : { id: { in: matching } }
    );
  }
  const where: Prisma.ProductWhereInput = { AND: conditions };
  const [count, products] = await Promise.all([
    tx.product.count({ where }),
    tx.product.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: rows.skip,
      take: rows.take,
      include: { inventoryConfig: true, accountingConfig: true },
    }),
  ]);
  return {
    count,
    rows: products.map(product => {
      const moves = stock.get(product.id) ?? { inflow: ZERO, outflow: ZERO, stock: ZERO };
      const service = product.kind === "SERVICE";
      return {
        id: product.id,
        kind: product.kind,
        name: product.name,
        sku: product.sku,
        description: product.description,
        unit: product.unit,
        unitPrice: product.unitPrice.toFixed(2),
        taxRate: product.taxRate.toFixed(2),
        taxTreatment: product.taxTreatment,
        inventoryControlled: product.inventoryConfig?.controlled ?? false,
        configurationStatus:
          !product.unit || !product.taxTreatment || product.unitPrice.isNegative() ||
          (product.inventoryConfig?.controlled && (!product.accountingConfig?.inventoryAccountId || !product.accountingConfig?.costOfSalesAccountId))
            ? "INCOMPLETE"
            : "READY",
        // Precio final calculado por el motor tributario (incluye IVA e INC).
        priceWithTax: product.finalPrice.isZero() && !product.unitPrice.isZero() ? product.unitPrice.times(product.taxRate.dividedBy(100).plus(1)).toDecimalPlaces(2).toFixed(2) : product.finalPrice.toFixed(2),
        active: product.active,
        // Parametrización tributaria: lo digitado y lo calculado por el motor único (exportación y detalle).
        tax: {
          gtin: product.gtin,
          category: product.category,
          unspscCode: product.unspscCode,
          billingChannel: product.billingChannel,
          costEntered: product.costEntered.toFixed(2),
          costIncludesVat: product.costIncludesVat,
          purchaseVatTreatment: product.purchaseVatTreatment,
          purchaseVatRate: product.purchaseVatRate.toFixed(2),
          costBase: product.costBase.toFixed(2),
          purchaseVat: product.purchaseVat.toFixed(2),
          vatDeductible: product.vatDeductible.toFixed(2),
          vatNonDeductible: product.vatNonDeductible.toFixed(2),
          accountingCost: product.accountingCost.toFixed(2),
          priceEntered: product.priceEntered.toFixed(2),
          priceIncludesTaxes: product.priceIncludesTaxes,
          saleTaxTreatment: product.saleTaxTreatment,
          saleVatRate: product.taxRate.toFixed(2),
          priceBase: product.unitPrice.toFixed(2),
          saleVat: product.saleVat.toFixed(2),
          incRate: product.incRate.toFixed(2),
          saleInc: product.saleInc.toFixed(2),
          finalPrice: product.finalPrice.toFixed(2),
          ...(() => {
            const profit = grossProfit(product.unitPrice.toNumber(), product.accountingCost.toNumber());
            return { profit: profit.profit.toFixed(2), margin: profit.margin.toFixed(2) };
          })(),
        },
        stock: service
          ? null
          : {
              inflow: moves.inflow.toFixed(2),
              outflow: moves.outflow.toFixed(2),
              quantity: moves.stock.toFixed(2),
              state: stockState(moves.stock),
            },
      };
    }),
  };
}

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

type ProductPayload = ReturnType<typeof productSchema.parse>;
const accountKeys = [
  "inventoryAccountId",
  "incomeAccountId",
  "costOfSalesAccountId",
  "vatSalesAccountId",
  "vatPurchaseAccountId",
  "incAccountId",
  "returnsAccountId",
  "discountsAccountId",
] as const;

/**
 * Separa el dato comercial de sus reglas y calcula la parametrización tributaria con el MOTOR ÚNICO
 * (@betel/contracts tax-engine): costo base, IVA de compra, IVA descontable y no descontable, costo contable, y
 * base, IVA, INC y precio final de venta. Se guardan los valores digitados y los calculados.
 * Cero sin clasificación explícita conserva compatibilidad como EXENTO.
 */
function masterData(input: ProductPayload) {
  const { taxConfig, inventoryConfig, accountingConfig, taxTreatment, cost, sale, initialQuantity: _q, ...product } = input;
  const legacyTreatment = taxTreatment ?? (input.taxRate === 0 ? "EXEMPT" : "TAXED");
  // Sin la sección nueva (formato anterior o importación vieja): el precio recibido es la base, sin impuestos.
  const saleTreatment = sale?.treatment ?? saleTreatmentFromLegacy(legacyTreatment, input.taxRate, taxConfig?.appliesInc);
  const computedSale = computeSale({
    amount: sale?.amount ?? input.unitPrice,
    includesTax: sale?.includesTax ?? false,
    treatment: saleTreatment,
    incRate: sale?.incRate ?? taxConfig?.incRate,
  });
  const computedCost = cost && computeCost(cost);
  return {
    product: {
      ...product,
      taxTreatment: legacyTreatment,
      priceEntered: computedSale.entered,
      saleTaxTreatment: saleTreatment,
      incRate: computedSale.incRate,
      saleVat: computedSale.vat,
      saleInc: computedSale.inc,
      finalPrice: computedSale.total,
      ...(computedCost && {
        costEntered: computedCost.entered,
        costIncludesVat: computedCost.includesVat,
        purchaseVatTreatment: computedCost.treatment,
        purchaseVatRate: computedCost.rate,
        deductibleTreatment: cost!.deductible,
        deductiblePct: computedCost.deductiblePct,
        costBase: computedCost.base,
        purchaseVat: computedCost.vat,
        costTotal: computedCost.total,
        vatDeductible: computedCost.vatDeductible,
        vatNonDeductible: computedCost.vatNonDeductible,
        accountingCost: computedCost.accountingCost,
      }),
    },
    taxConfig,
    inventoryConfig,
    accountingConfig,
  };
}

async function validateConfiguredAccounts(tx: Tx, config: ProductPayload["accountingConfig"]) {
  if (!config) return;
  const ids = accountKeys.map(key => config[key]).filter((id): id is string => Boolean(id));
  if (!ids.length) return;
  const accounts = await tx.account.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, code: true } });
  if (accounts.length !== new Set(ids).size)
    throw httpError(422, "Selecciona únicamente cuentas activas pertenecientes al plan contable de la empresa.");
}

async function saveConfiguration(tx: Tx, productId: string, input: ProductPayload, actorId: string, recordPrice = true) {
  const { product, taxConfig, inventoryConfig, accountingConfig } = masterData(input);
  await validateConfiguredAccounts(tx, accountingConfig);
  // Siempre existe la regla de impuestos: conserva la diferencia fiscal entre exento y excluido.
  await tx.productTaxConfig.upsert({
    where: { productId },
    create: {
      productId,
      taxTreatment: product.taxTreatment,
      vatRate: product.taxRate,
      appliesInc: taxConfig?.appliesInc ?? false,
      incCode: taxConfig?.incCode,
      incRate: taxConfig?.incRate,
      withholdingHints: taxConfig?.withholdingHints ?? [],
      standardCodeType: taxConfig?.standardCodeType,
      standardCode: taxConfig?.standardCode,
    },
    update: {
      taxTreatment: product.taxTreatment,
      vatRate: product.taxRate,
      ...(taxConfig && {
        appliesInc: taxConfig.appliesInc,
        incCode: taxConfig.incCode,
        incRate: taxConfig.incRate,
        withholdingHints: taxConfig.withholdingHints,
        standardCodeType: taxConfig.standardCodeType,
        standardCode: taxConfig.standardCode,
      }),
    },
  });
  if (inventoryConfig) {
    await tx.productInventoryConfig.upsert({
      where: { productId },
      create: { productId, ...inventoryConfig, controlled: input.kind === "SERVICE" ? false : inventoryConfig.controlled },
      update: { ...inventoryConfig, controlled: input.kind === "SERVICE" ? false : inventoryConfig.controlled },
    });
  }
  if (accountingConfig)
    await tx.productAccountingConfig.upsert({
      where: { productId },
      create: { productId, ...accountingConfig },
      update: accountingConfig,
    });
  if (recordPrice)
    await tx.productPrice.create({ data: { productId, amount: product.unitPrice, includesTaxes: product.priceIncludesTaxes, createdById: actorId } });
}

/** Código libre: si viene vacío se asigna el siguiente C-n; si ya existe en otro producto, 409. */
async function resolveCode(tx: Tx, sku: string | undefined, exceptId?: string) {
  if (!sku) {
    const codes = await tx.product.findMany({ where: { sku: { startsWith: "C-" } }, select: { sku: true } });
    return nextProductCode(codes.map(item => item.sku));
  }
  const taken = await tx.product.findFirst({
    where: { sku: { equals: sku, mode: "insensitive" }, ...(exceptId && { id: { not: exceptId } }) },
    select: { name: true },
  });
  if (taken) throw httpError(409, `El código ${sku} ya lo usa "${taken.name}".`);
  return sku;
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export function registerProductRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const canView = { preHandler: allowPermission("reports.view") };
  const canExport = { preHandler: allowPermission("reports.export") };
  const canEdit = { preHandler: allowPermission("parties.edit") };
  const canDelete = { preHandler: allowPermission("products.delete") };
  const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
  const audit = (
    tx: Tx,
    request: { ip: string; actor?: { organizationId: string; sub: string } },
    entityId: string,
    action: string,
    after: Prisma.InputJsonValue,
    before?: Prisma.InputJsonValue
  ) =>
    tx.auditLog.create({
      data: {
        organizationId: request.actor!.organizationId,
        userId: request.actor!.sub,
        entity: "Product",
        entityId,
        action,
        after,
        ...(before && { before }),
        ipHash: options.auditIp(request.ip),
      },
    });
  const conflict = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

  /** GET /v1/products — catálogo activo de la organización (máx. 100), para los editores de ítems. */
  app.get<{ Querystring: { search?: string; kind?: string } }>(
    "/v1/products",
    { preHandler: requireActor },
    async request => {
      // ?search= (nombre o código) y ?kind=PRODUCT|SERVICE para los buscadores de los formularios.
      const search = request.query.search?.trim().slice(0, 120);
      const kind =
        request.query.kind === "PRODUCT" || request.query.kind === "SERVICE" ? request.query.kind : undefined;
      return {
        data: await withOrganizationScope(request.actor!.organizationId, tx =>
          tx.product.findMany({
            where: {
              active: true,
              ...(kind && { kind }),
              ...(search && {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { sku: { contains: search, mode: "insensitive" } },
                ],
              }),
            },
            orderBy: { name: "asc" },
            take: 100,
          })
        ),
      };
    }
  );

  /** Configuración avanzada e historial: el formulario lo consulta al editar; nunca expone datos de otra empresa. */
  app.get<{ Params: { id: string } }>("/v1/products/:id/configuration", canView, async (request, reply) => {
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Producto no encontrado." });
    const data = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const product = await tx.product.findFirst({
        where: { id: request.params.id },
        include: {
          taxConfig: true,
          inventoryConfig: true,
          accountingConfig: true,
          prices: { orderBy: { validFrom: "desc" }, take: 20 },
        },
      });
      if (!product) return null;
      const history = await tx.auditLog.findMany({
        where: { entity: "Product", entityId: product.id },
        select: { action: true, before: true, after: true, createdAt: true, userId: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return { product, history };
    });
    if (!data) return reply.code(404).send({ error: "Producto no encontrado." });
    return { data };
  });

  /**
   * Crea un producto o servicio: código, parametrización tributaria (motor único), configuración, saldo inicial
   * (cantidad inicial de un inventariable) y auditoría. Lo usan la creación manual y la importación.
   */
  const createProduct = async (tx: Tx, request: FastifyRequest, data: ProductPayload, action = "CREATE") => {
    const actor = request.actor!;
    const sku = await resolveCode(tx, data.sku);
    const { product: master } = masterData(data);
    const created = await tx.product.create({ data: { ...master, sku, organizationId: actor.organizationId } });
    await saveConfiguration(tx, created.id, data, actor.sub);
    // Cantidad inicial: documento de saldo inicial (SI-n) valorado al costo contable, con su asiento.
    const quantity = data.initialQuantity ?? 0;
    if (quantity > 0) {
      if (data.kind !== "PRODUCT" || !data.inventoryConfig?.controlled)
        throw httpError(422, "La cantidad inicial solo aplica a productos inventariables.");
      if (!actorCan(request, "inventory.manage"))
        throw httpError(403, "Tu rol no puede registrar saldos iniciales de inventario.");
      await createInventoryDocument(tx, actor, {
        type: "INITIAL",
        date: todayIn("America/Bogota"),
        notes: `Saldo inicial al crear ${created.name}`,
        lines: [{ productId: created.id, direction: "IN", quantity, unitCost: Number(master.accountingCost ?? 0) }],
      });
    }
    await audit(tx, request, created.id, action, { ...master, sku, configuration: true });
    return created;
  };

  /** POST /v1/products — Body: productSchema. */
  app.post("/v1/products", canEdit, async (request, reply) => {
    const parsed = productSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: "Producto o servicio inválido", details: parsed.error.flatten() });
    const actor = request.actor!;
    try {
      const product = await withOrganizationScope(actor.organizationId, tx => createProduct(tx, request, parsed.data));
      return reply.code(201).send({ data: product });
    } catch (error) {
      if (conflict(error)) return reply.code(409).send({ error: "Ese código ya existe. Intenta de nuevo." });
      throw error;
    }
  });

  /** PUT /v1/products/:id — Body: productSchema. */
  app.put<{ Params: { id: string } }>("/v1/products/:id", canEdit, async (request, reply) => {
    const parsed = productSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: "Producto o servicio inválido", details: parsed.error.flatten() });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Producto no encontrado." });
    try {
      const product = await withOrganizationScope(request.actor!.organizationId, async tx => {
        const current = await tx.product.findFirst({ where: { id: request.params.id } });
        if (!current) throw httpError(404, "Producto no encontrado.");
        const sku = await resolveCode(tx, parsed.data.sku ?? current.sku ?? undefined, current.id);
        const { product: master } = masterData(parsed.data);
        // Un producto con movimientos no puede pasar a servicio: perdería su stock.
        if (current.kind === "PRODUCT" && parsed.data.kind === "SERVICE") {
          const moves = (await stockByProduct(tx, [current.id])).get(current.id);
          if (moves && (!moves.inflow.isZero() || !moves.outflow.isZero()))
            throw httpError(409, "Este producto ya tiene compras o ventas: no se puede convertir en servicio.");
        }
        const updated = await tx.product.update({ where: { id: current.id }, data: { ...master, sku } });
        await saveConfiguration(
          tx,
          current.id,
          parsed.data,
          request.actor!.sub,
          !current.unitPrice.equals(master.unitPrice) || current.priceIncludesTaxes !== master.priceIncludesTaxes
        );
        await audit(
          tx,
          request,
          current.id,
          "UPDATE",
          { ...master, sku, configuration: true },
          {
            sku: current.sku,
            name: current.name,
            kind: current.kind,
            unit: current.unit,
            unitPrice: current.unitPrice.toFixed(2),
            taxRate: current.taxRate.toFixed(2),
          }
        );
        return updated;
      });
      return { data: product };
    } catch (error) {
      if (conflict(error)) return reply.code(409).send({ error: "Ese código ya existe." });
      throw error;
    }
  });

  /** POST /v1/products/:id/active — Body: { active }. */
  app.post<{ Params: { id: string } }>("/v1/products/:id/active", canEdit, async (request, reply) => {
    const parsed = toggleCustomerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Indica si queda activo." });
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Producto no encontrado." });
    const count = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await tx.product.updateMany({
        where: { id: request.params.id },
        data: { active: parsed.data.active },
      });
      if (result.count)
        await audit(tx, request, request.params.id, parsed.data.active ? "ACTIVATE" : "DEACTIVATE", {
          active: parsed.data.active,
        });
      return result.count;
    });
    if (!count) return reply.code(404).send({ error: "Producto no encontrado." });
    return { data: { id: request.params.id, active: parsed.data.active } };
  });

  /** POST /v1/products/bulk-active — Body: { ids, active }. */
  app.post("/v1/products/bulk-active", canEdit, async (request, reply) => {
    const parsed = bulkProductActiveSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: parsed.error.issues[0]?.message ?? "Selección inválida." });
    const updated = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await tx.product.updateMany({
        where: { id: { in: parsed.data.ids } },
        data: { active: parsed.data.active },
      });
      await audit(tx, request, "bulk", parsed.data.active ? "ACTIVATE" : "DEACTIVATE", {
        ids: parsed.data.ids,
        updated: result.count,
      });
      return result.count;
    });
    return { data: { updated } };
  });

  /** DELETE /v1/products/:id — solo si ningún documento (factura, cotización, remisión, compra…) lo usa. */
  app.delete<{ Params: { id: string } }>("/v1/products/:id", canDelete, async (request, reply) => {
    if (!validId(request.params.id)) return reply.code(404).send({ error: "Producto no encontrado." });
    const deleted = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const product = await tx.product.findFirst({
        where: { id: request.params.id },
        select: {
          id: true,
          name: true,
          sku: true,
          _count: {
            select: {
              invoiceLines: true,
              quoteLines: true,
              deliveryLines: true,
              recurringLines: true,
              purchaseLines: true,
            },
          },
        },
      });
      if (!product) return null;
      const uses = Object.values(product._count).reduce((sum, value) => sum + value, 0);
      if (uses)
        throw httpError(
          409,
          `"${product.name}" aparece en ${uses} documento(s): no se puede eliminar. Puedes inactivarlo.`
        );
      await tx.product.delete({ where: { id: product.id } });
      await audit(tx, request, product.id, "DELETE", { name: product.name, sku: product.sku });
      return product;
    });
    if (!deleted) return reply.code(404).send({ error: "Producto no encontrado." });
    return { data: { id: deleted.id } };
  });

  /**
   * POST /v1/products/import — Body: { rows } (filas ya leídas del Excel o CSV en el navegador). Crea los productos
   * válidos; las filas con error o con un código que ya existe se informan y no se crean.
   */
  /** Contexto de la importación: códigos y códigos de barras ya registrados en la empresa. */
  const importContext = async (tx: Tx) => {
    const existing = await tx.product.findMany({ select: { sku: true, gtin: true } });
    return {
      existingCodes: new Set(existing.map(item => item.sku?.toLowerCase()).filter((value): value is string => !!value)),
      existingBarcodes: new Set(existing.map(item => item.gtin).filter((value): value is string => !!value)),
    };
  };

  /** POST /v1/products/import/preview — Body: { rows }. Analiza sin escribir: estado, mensajes y valores calculados. */
  app.post("/v1/products/import/preview", { ...canEdit, bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
    const parsed = importProductsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: parsed.error.issues[0]?.message ?? "Archivo inválido." });
    const rows = await withOrganizationScope(request.actor!.organizationId, async tx =>
      analyzeImport(parsed.data.rows, await importContext(tx))
    );
    return {
      data: rows.map(({ payload: _payload, ...row }) => row),
      summary: {
        total: rows.length,
        ok: rows.filter(row => row.status === "OK").length,
        warnings: rows.filter(row => row.status === "WARNING").length,
        errors: rows.filter(row => row.status === "ERROR").length,
      },
    };
  });

  /**
   * POST /v1/products/import — Body: { rows }. Vuelve a analizar en el servidor e importa SOLO las filas sin error,
   * por el mismo camino que la creación manual (createProduct). Los inventariables usan las cuentas por defecto de
   * inventario (143505) y costo de ventas (613505).
   */
  app.post("/v1/products/import", { ...canEdit, bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
    const parsed = importProductsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: parsed.error.issues[0]?.message ?? "Archivo inválido." });
    const result = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const analyzed = analyzeImport(parsed.data.rows, await importContext(tx));
      const controlled = (row: (typeof analyzed)[number]) =>
        !!(row.payload?.inventoryConfig as { controlled?: boolean } | undefined)?.controlled;
      const accounts = analyzed.some(controlled) ? await ensureDefaultAccounts(tx, request.actor!.organizationId) : null;
      const errors = analyzed
        .filter(row => row.status === "ERROR")
        .map(row => ({ row: row.row, message: row.messages.join(" ") }));
      let created = 0;
      for (const row of analyzed) {
        if (!row.payload) continue;
        const product = productSchema.safeParse({
          ...row.payload,
          ...(controlled(row) &&
            accounts && {
              accountingConfig: { inventoryAccountId: accounts["143505"].id, costOfSalesAccountId: accounts["613505"].id },
            }),
        });
        if (!product.success) {
          errors.push({ row: row.row, message: product.error.issues[0]?.message ?? "Fila inválida." });
          continue;
        }
        await createProduct(tx, request, product.data, "IMPORT_ROW");
        created++;
      }
      await audit(tx, request, "import", "IMPORT", { rows: parsed.data.rows.length, created, errors: errors.length });
      return { created, errors: errors.slice(0, 200), errorCount: errors.length };
    });
    return reply.code(201).send({ data: result });
  });

  /** GET /v1/products/import/template — columnas de la plantilla de importación. */
  app.get("/v1/products/import/template", canView, async () => ({ columns: IMPORT_COLUMNS }));

  /** GET /v1/reports/products — Query: productQuerySchema. */
  app.get("/v1/reports/products", canView, async (request, reply) => {
    const parsed = productQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const { page, pageSize } = parsed.data;
    const { rows, count } = await withOrganizationScope(request.actor!.organizationId, tx =>
      loadProducts(tx, parsed.data, { skip: (page - 1) * pageSize, take: pageSize })
    );
    return { data: rows, pagination: { page, pageSize, total: count } };
  });

  /** GET /v1/reports/products/export — todas las filas filtradas (auditado). */
  app.get("/v1/reports/products/export", canExport, async (request, reply) => {
    const parsed = productQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Filtros inválidos", details: parsed.error.flatten() });
    const report = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const result = await loadProducts(tx, parsed.data, { skip: 0, take: EXPORT_LIMIT + 1 });
      if (result.count <= EXPORT_LIMIT)
        await audit(tx, request, "list", "EXPORT", {
          filters: request.query,
          rows: result.count,
        } as Prisma.InputJsonValue);
      return result;
    });
    if (report.count > EXPORT_LIMIT)
      return reply.code(413).send({ error: `La consulta supera ${EXPORT_LIMIT} filas. Acota los filtros.` });
    return { data: report.rows, total: report.count };
  });

  /** GET /v1/reports/products/top — más vendidos en el período (facturas emitidas); total = valor de las líneas con IVA. */
  app.get("/v1/reports/products/top", canView, async (request, reply) => {
    const parsed = topProductsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "Período inválido", details: parsed.error.flatten() });
    const period = resolvePeriod(parsed.data);
    const data = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const sales = await tx.invoiceLine.groupBy({
        by: ["productId"],
        where: {
          productId: { not: null },
          invoice: { status: { in: [...BILLED_STATUSES] }, issueDate: { gte: period.from, lte: period.to } },
        },
        _sum: { quantity: true, lineTotal: true },
        _count: { _all: true },
        orderBy: { _sum: { lineTotal: "desc" } },
        take: 20,
      });
      const products = await tx.product.findMany({
        where: { id: { in: sales.map(item => item.productId!) } },
        select: { id: true, name: true, sku: true, kind: true, unit: true },
      });
      const byId = new Map(products.map(product => [product.id, product]));
      return sales.map(item => ({
        ...byId.get(item.productId!)!,
        quantity: (item._sum.quantity ?? ZERO).toFixed(2),
        total: (item._sum.lineTotal ?? ZERO).toFixed(2),
        lines: item._count._all,
      }));
    });
    return {
      data,
      period: { from: period.from.toISOString().slice(0, 10), to: period.to.toISOString().slice(0, 10) },
    };
  });
}
