/**
 * Documento equivalente electrónico POS: configuración de la resolución DIAN de la numeración, WhatsApp y mensaje de
 * la tirilla, cliente «Consumidor final» y la regla de numeración.
 *
 * Rutas:
 *   GET /v1/organization/pos-settings ........ configuración (cualquier usuario de la empresa)
 *   PUT /v1/organization/pos-settings ........ guardar (permiso settings.manage; auditado)
 *   POST /v1/parties/final-consumer .......... crea o devuelve el cliente «Consumidor final» (CC 222222222222)
 *
 * Numeración (nextPosNumber): consecutivo dentro del rango autorizado, empezando en el número inicial; no se emite
 * si no hay resolución, si venció (fecha + vigencia en meses) o si el rango se agotó.
 */
import type { FastifyInstance } from "fastify";
import { withOrganizationScope, type Prisma } from "@betel/db";
import { z } from "zod";
import { allowPermission, requireActor } from "./auth.js";

/** Identificación del consumidor final en documentos electrónicos (DIAN). */
export const FINAL_CONSUMER_ID = "222222222222";

export type PosSettings = {
  posPrefix: string;
  posResolutionNumber: string | null;
  posResolutionDate: Date | null;
  posRangeFrom: number | null;
  posRangeTo: number | null;
  posValidityMonths: number | null;
};

/** Fecha de vencimiento de la resolución (fecha + meses de vigencia). */
export function posExpiry(settings: PosSettings) {
  if (!settings.posResolutionDate || !settings.posValidityMonths) return null;
  const date = new Date(settings.posResolutionDate);
  date.setUTCMonth(date.getUTCMonth() + settings.posValidityMonths);
  return date;
}

/** Siguiente número POS o el motivo por el que no se puede emitir. */
export function nextPosNumber(
  settings: PosSettings,
  usedNumbers: number[],
  today: Date
): { number: number } | { error: string } {
  if (!settings.posResolutionNumber || !settings.posResolutionDate || !settings.posRangeFrom || !settings.posRangeTo)
    return {
      error: "Configura la resolución DIAN del documento equivalente POS en Configuración › DIAN y documentos.",
    };
  if (settings.posResolutionDate > today) return { error: "La resolución POS aún no está vigente." };
  const expiry = posExpiry(settings);
  if (expiry && today >= expiry) return { error: "La resolución POS está vencida. Registra la nueva resolución." };
  const inRange = usedNumbers.filter(number => number >= settings.posRangeFrom! && number <= settings.posRangeTo!);
  const next = inRange.length ? Math.max(...inRange) + 1 : settings.posRangeFrom;
  if (next > settings.posRangeTo) return { error: "Se agotó el rango de numeración POS autorizado." };
  return { number: next };
}

/** Texto de la resolución para la tirilla. */
export function posResolutionText(settings: PosSettings) {
  if (!settings.posResolutionNumber || !settings.posResolutionDate) return null;
  const date = settings.posResolutionDate.toISOString().slice(0, 10);
  const range =
    settings.posRangeFrom && settings.posRangeTo
      ? `, numeración ${settings.posPrefix}-${settings.posRangeFrom} al ${settings.posPrefix}-${settings.posRangeTo}`
      : "";
  const validity = settings.posValidityMonths ? `, vigencia ${settings.posValidityMonths} meses` : "";
  return `Resolución DIAN No. ${settings.posResolutionNumber} del ${date}${range}${validity}.`;
}

const settingsSchema = z
  .object({
    posPrefix: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{1,6}$/, "El prefijo lleva de 1 a 6 letras mayúsculas o números.")
      .default("POS"),
    posResolutionNumber: z
      .string()
      .trim()
      .regex(/^\d{6,20}$/, "Escribe el número de la resolución (solo dígitos)."),
    posResolutionDate: z.coerce.date(),
    posRangeFrom: z.coerce.number().int().min(1),
    posRangeTo: z.coerce.number().int().min(1),
    posValidityMonths: z.coerce.number().int().min(1).max(60),
    whatsapp: z
      .string()
      .trim()
      .transform(value => value.replace(/\D/g, ""))
      .refine(value => value === "" || value.length === 10, "El WhatsApp debe tener 10 dígitos.")
      .transform(value => value || null)
      .optional(),
    receiptFooter: z
      .string()
      .trim()
      .max(160)
      .transform(value => value || null)
      .optional(),
  })
  .refine(value => value.posRangeTo >= value.posRangeFrom, {
    message: "El número final del rango debe ser mayor o igual al inicial.",
    path: ["posRangeTo"],
  });

const settingsSelect = {
  posPrefix: true,
  posResolutionNumber: true,
  posResolutionDate: true,
  posRangeFrom: true,
  posRangeTo: true,
  posValidityMonths: true,
  whatsapp: true,
  receiptFooter: true,
} satisfies Prisma.OrganizationSelect;

export function registerPosRoutes(app: FastifyInstance, options: { auditIp: (ip: string) => string }) {
  const present = (settings: Prisma.OrganizationGetPayload<{ select: typeof settingsSelect }>, used: number) => ({
    ...settings,
    posResolutionDate: settings.posResolutionDate?.toISOString().slice(0, 10) ?? null,
    expiresOn: posExpiry(settings)?.toISOString().slice(0, 10) ?? null,
    used,
    resolutionText: posResolutionText(settings),
  });
  const usedCount = (tx: Prisma.TransactionClient) =>
    tx.invoice.count({ where: { documentType: "POS", status: { not: "DRAFT" } } });

  app.get("/v1/organization/pos-settings", { preHandler: requireActor }, async request => {
    const data = await withOrganizationScope(request.actor!.organizationId, async tx => {
      const settings = await tx.organization.findFirstOrThrow({
        where: { id: request.actor!.organizationId },
        select: settingsSelect,
      });
      return present(settings, await usedCount(tx));
    });
    return { data };
  });

  app.put(
    "/v1/organization/pos-settings",
    { preHandler: allowPermission("settings.manage") },
    async (request, reply) => {
      const parsed = settingsSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(422)
          .send({ error: parsed.error.issues[0]?.message ?? "Datos inválidos.", details: parsed.error.flatten() });
      const actor = request.actor!;
      const data = await withOrganizationScope(actor.organizationId, async tx => {
        const updated = await tx.organization.update({
          where: { id: actor.organizationId },
          data: parsed.data,
          select: settingsSelect,
        });
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.sub,
            entity: "Organization",
            entityId: actor.organizationId,
            action: "POS_SETTINGS",
            after: { ...parsed.data, posResolutionDate: parsed.data.posResolutionDate.toISOString().slice(0, 10) },
            ipHash: options.auditIp(request.ip),
          },
        });
        return present(updated, await usedCount(tx));
      });
      return { data };
    }
  );

  app.post("/v1/parties/final-consumer", { preHandler: allowPermission("invoices.create") }, async request => {
    const actor = request.actor!;
    const data = await withOrganizationScope(actor.organizationId, async tx => {
      const existing = await tx.party.findFirst({ where: { identificationNumber: FINAL_CONSUMER_ID } });
      if (existing) {
        if (!existing.isCustomer || !existing.active)
          return tx.party.update({ where: { id: existing.id }, data: { isCustomer: true, active: true } });
        return existing;
      }
      return tx.party.create({
        data: {
          organizationId: actor.organizationId,
          kind: "PERSON",
          identificationType: "CC",
          identificationNumber: FINAL_CONSUMER_ID,
          legalName: "Consumidor final",
          isCustomer: true,
        },
      });
    });
    return { data };
  });
}
