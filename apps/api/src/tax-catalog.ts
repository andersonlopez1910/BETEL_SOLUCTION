import type { FastifyInstance } from "fastify";
import { Prisma, prisma, withOrganizationScope } from "@betel/db";
import { customTaxCatalogItemSchema, replaceOrganizationTaxConfigurationsSchema } from "@betel/contracts";
import { allowPermission, requireActor } from "./auth.js";

/** Valores iniciales administrables: se guardan en BD y nunca se declaran en la interfaz. */
const DEFAULT_TAX_CATALOG = [
  ["IVA", "IVA", "Impuesto al Valor Agregado", "TAX", "DOCUMENT_INCREASE", true, false, true, false, false],
  ["INC", "INC", "Impuesto Nacional al Consumo", "TAX", "DOCUMENT_INCREASE", true, false, true, false, false],
  ["ICA", "ICA", "Impuesto de Industria y Comercio", "TAX", "DOCUMENT_INCREASE", true, false, true, true, true],
  ["IC_PERCENTUAL", "IC Porcentual", "IC Porcentual", "TAX", "DOCUMENT_INCREASE", true, false, true, false, true],
  ["RETE_IVA", "ReteIVA", "Retención de IVA", "WITHHOLDING", "DOCUMENT_DECREASE", false, true, true, false, true],
  [
    "RETE_RENTA",
    "ReteRenta",
    "Retención en la fuente a título de renta",
    "WITHHOLDING",
    "DOCUMENT_DECREASE",
    false,
    true,
    true,
    false,
    true,
  ],
  [
    "RETE_ICA",
    "ReteICA",
    "Retención de Industria y Comercio",
    "WITHHOLDING",
    "DOCUMENT_DECREASE",
    false,
    true,
    true,
    true,
    true,
  ],
  [
    "IN_CARBONO",
    "IN Carbono",
    "Impuesto Nacional al Carbono",
    "TAX",
    "DOCUMENT_INCREASE",
    true,
    false,
    true,
    false,
    true,
  ],
  [
    "IN_COMBUSTIBLES",
    "IN Combustibles",
    "Impuesto Nacional a los Combustibles",
    "TAX",
    "DOCUMENT_INCREASE",
    true,
    false,
    true,
    false,
    true,
  ],
  [
    "SOBRETASA_COMBUSTIBLES",
    "Sobretasa Combustibles",
    "Sobretasa a los Combustibles",
    "SURCHARGE",
    "DOCUMENT_INCREASE",
    true,
    false,
    true,
    false,
    true,
  ],
  [
    "SORDICOM",
    "Sordicom",
    "Contribución Sordicom",
    "CONTRIBUTION",
    "DOCUMENT_INCREASE",
    true,
    false,
    true,
    false,
    true,
  ],
  [
    "FOMENTO_HORTIFRUTICOLA",
    "Fomento Hortifrutícola",
    "Fondo de Fomento Hortifrutícola",
    "CONTRIBUTION",
    "DOCUMENT_INCREASE",
    true,
    false,
    true,
    false,
    true,
  ],
  ["TIMBRE", "Timbre", "Impuesto de Timbre", "TAX", "DOCUMENT_INCREASE", true, false, true, false, true],
  [
    "INC_BOLSAS",
    "INC Bolsas",
    "Impuesto Nacional al Consumo de Bolsas Plásticas",
    "TAX",
    "DOCUMENT_INCREASE",
    true,
    false,
    true,
    false,
    true,
  ],
] as const;

/** Opciones que el catálogo entrega a la interfaz al configurar IVA. */
const IVA_CONFIGURATION_OPTIONS = {
  vatOptions: [
    { value: "19", label: "19 %", responsibilityCode: "O-48" },
    { value: "5", label: "5 %", responsibilityCode: "O-48" },
    { value: "EXEMPT", label: "Exento", responsibilityCode: "O-48" },
    { value: "EXCLUDED", label: "Excluido", responsibilityCode: "O-48" },
    { value: "NOT_RESPONSIBLE", label: "No responsable de IVA", responsibilityCode: "O-49" },
  ],
};

async function ensureTaxCatalog() {
  await Promise.all(
    DEFAULT_TAX_CATALOG.map(
      ([
        code,
        shortName,
        name,
        category,
        behavior,
        increasesDocument,
        representsWithholding,
        requiresRate,
        requiresMunicipality,
        requiresConfiguration,
      ]) =>
        prisma.taxCatalogItem.upsert({
          where: { code },
          update: code === "IVA" ? { configurationOptions: IVA_CONFIGURATION_OPTIONS } : {},
          create: {
            code,
            shortName,
            name,
            category,
            behavior,
            increasesDocument,
            representsWithholding,
            calculationType: "PERCENTAGE",
            requiresRate,
            requiresMunicipality,
            requiresConfiguration,
            configurationOptions: code === "IVA" ? IVA_CONFIGURATION_OPTIONS : undefined,
          },
        })
    )
  );
}

const serialize = (item: {
  rate: Prisma.Decimal | null;
  fixedValue: Prisma.Decimal | null;
  [key: string]: unknown;
}) => ({ ...item, rate: item.rate?.toString() ?? null, fixedValue: item.fixedValue?.toString() ?? null });

export function registerTaxCatalogRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  app.get("/v1/tax-catalog", { preHandler: requireActor }, async request => {
    await ensureTaxCatalog();
    const actor = request.actor!;
    const data = await prisma.taxCatalogItem.findMany({
      where: { active: true, OR: [{ organizationId: null }, { organizationId: actor.organizationId }] },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return { data };
  });

  app.get("/v1/organization/tax-configurations", { preHandler: requireActor }, async request => {
    await ensureTaxCatalog();
    const data = await withOrganizationScope(request.actor!.organizationId, tx =>
      tx.organizationTaxConfiguration.findMany({
        where: { organizationId: request.actor!.organizationId },
        include: { taxCatalogItem: true },
        orderBy: { createdAt: "asc" },
      })
    );
    return { data: data.map(serialize) };
  });

  app.put(
    "/v1/organization/tax-configurations",
    { preHandler: allowPermission("settings.manage") },
    async (request, reply) => {
      const parsed = replaceOrganizationTaxConfigurationsSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(422).send({
          error: parsed.error.issues[0]?.message ?? "Configuración tributaria inválida.",
          details: parsed.error.flatten(),
        });
      await ensureTaxCatalog();
      const actor = request.actor!;
      // Una selección repetida no puede crear dos configuraciones. Esto también protege
      // la API ante pestañas abiertas antes de una actualización del catálogo.
      const configurations = [
        ...new Map(parsed.data.configurations.map(item => [item.taxCatalogItemId, item])).values(),
      ];
      const selectedIds = configurations.map(item => item.taxCatalogItemId);
      const data = await withOrganizationScope(actor.organizationId, async tx => {
        const catalogItems = await tx.taxCatalogItem.findMany({
          where: {
            id: { in: selectedIds },
            active: true,
            OR: [{ organizationId: null }, { organizationId: actor.organizationId }],
          },
        });
        if (catalogItems.length !== selectedIds.length)
          throw Object.assign(new Error("Uno de los tributos seleccionados no está disponible."), { statusCode: 422 });
        const catalog = new Map(catalogItems.map(item => [item.id, item]));
        await tx.organizationTaxConfiguration.deleteMany({
          where:
            selectedIds.length > 0
              ? { organizationId: actor.organizationId, taxCatalogItemId: { notIn: selectedIds } }
              : { organizationId: actor.organizationId },
        });
        for (const config of configurations) {
          const tax = catalog.get(config.taxCatalogItemId)!;
          const vatOptions = Array.isArray(config.additionalConfig?.vatOptions)
            ? config.additionalConfig.vatOptions
            : [];
          const missingRequired =
            (tax.code === "IVA" && config.active && !vatOptions.length) ||
            (tax.code !== "IVA" && tax.requiresRate && config.active && config.rate === undefined) ||
            (tax.requiresMunicipality && config.active && !config.municipalityCode);
          const status = !config.active ? "INACTIVE" : missingRequired ? "PENDING" : "ACTIVE";
          const configurationData = {
            ...config,
            additionalConfig: config.additionalConfig as Prisma.InputJsonValue | undefined,
            rate: config.rate,
            fixedValue: config.fixedValue,
            validFrom: config.validFrom ? new Date(config.validFrom) : null,
            validTo: config.validTo ? new Date(config.validTo) : null,
            status,
          };
          await tx.organizationTaxConfiguration.upsert({
            where: {
              organizationId_taxCatalogItemId: {
                organizationId: actor.organizationId,
                taxCatalogItemId: config.taxCatalogItemId,
              },
            },
            create: {
              ...configurationData,
              organizationId: actor.organizationId,
            },
            update: {
              ...configurationData,
            },
          });
        }
        const saved = await tx.organizationTaxConfiguration.findMany({
          where: { organizationId: actor.organizationId },
          include: { taxCatalogItem: true },
          orderBy: { createdAt: "asc" },
        });
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.sub,
            entity: "OrganizationTaxConfiguration",
            entityId: actor.organizationId,
            action: "UPDATE_TAX_CONFIGURATION",
            after: { selectedTaxCatalogItemIds: selectedIds },
            ipHash: options.auditIp(request.ip),
          },
        });
        return saved;
      });
      return { data: data.map(serialize) };
    }
  );

  app.post("/v1/tax-catalog/custom", { preHandler: allowPermission("settings.manage") }, async (request, reply) => {
    const parsed = customTaxCatalogItemSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({
        error: parsed.error.issues[0]?.message ?? "Figura tributaria inválida.",
        details: parsed.error.flatten(),
      });
    const actor = request.actor!;
    try {
      const data = await withOrganizationScope(actor.organizationId, async tx => {
        const item = await tx.taxCatalogItem.create({
          data: {
            ...parsed.data,
            organizationId: actor.organizationId,
            behavior: parsed.data.category === "WITHHOLDING" ? "DOCUMENT_DECREASE" : "DOCUMENT_INCREASE",
            increasesDocument: parsed.data.category !== "WITHHOLDING",
            representsWithholding: parsed.data.category === "WITHHOLDING",
            requiresRate: parsed.data.calculationType === "PERCENTAGE",
            requiresFixedValue: parsed.data.calculationType === "FIXED",
            requiresConfiguration: true,
            validFrom: parsed.data.validFrom ? new Date(parsed.data.validFrom) : null,
            validTo: parsed.data.validTo ? new Date(parsed.data.validTo) : null,
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.sub,
            entity: "TaxCatalogItem",
            entityId: item.id,
            action: "CREATE_CUSTOM_TAX",
            after: { code: item.code, category: item.category },
            ipHash: options.auditIp(request.ip),
          },
        });
        return item;
      });
      return reply.code(201).send({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: "Ya existe un tributo con ese código." });
      throw error;
    }
  });
}
