/**
 * Configuración › Usuarios y permisos: usuarios de la organización y su rol.
 *
 * Rutas (solo OWNER y ADMIN):
 *   GET  /v1/organization/users ............ usuarios de la organización con su rol y estado
 *   POST /v1/organization/users ............ crea el usuario (o vincula uno existente por correo) con un rol
 *   PUT  /v1/organization/users/:userId .... cambia nombre, celular, rol o estado (activo / desactivado)
 *   GET  /v1/organization/permissions ...... tabla rol × permiso (lectura: quien gestiona usuarios)
 *   PUT  /v1/organization/permissions ...... guarda la tabla editada (solo OWNER; OWNER siempre tiene todo)
 *
 * Reglas (canManage, en pruebas unitarias):
 *   - Solo un OWNER asigna el rol OWNER o modifica a otro OWNER.
 *   - Nadie cambia su propio rol ni se desactiva a sí mismo.
 *   - Siempre queda al menos un OWNER activo.
 * Desactivar quita el acceso de inmediato (requireActor revisa Membership.active en cada petición) y conserva el
 * historial. Los permisos de cada rol los aplica la API en cada ruta (allowRoles); la tabla de la pantalla los resume.
 *
 * LIMITACIÓN: aún no hay inicio de sesión con contraseña (OIDC + MFA pendiente). En desarrollo, «Probar como este
 * usuario» usa POST /v1/auth/dev/session con su correo.
 */
import type { FastifyInstance } from "fastify";
import { Prisma, prisma, withOrganizationScope } from "@betel/db";
import { z } from "zod";
import {
  overridesFromMatrix,
  PERMISSIONS,
  permissionMatrix,
  ROLES_WITH_EDITABLE_PERMISSIONS,
  type PermissionOverrides,
} from "./permissions.js";
import { allowPermission, type MembershipRole } from "./auth.js";

export const ROLES = [
  "OWNER",
  "ADMIN",
  "ACCOUNTANT",
  "SALES",
  "SUPPORT",
  "VIEWER",
] as const satisfies readonly MembershipRole[];

const phone = z
  .string()
  .trim()
  .transform(value => value.replace(/\D/g, ""))
  .refine(value => value === "" || value.length === 10, "El celular debe tener 10 dígitos.")
  .transform(value => value || null);

export const createUserSchema = z.object({
  displayName: z.string().trim().min(3, "Escribe el nombre completo.").max(120),
  email: z.string().trim().toLowerCase().email("Correo inválido.").max(160),
  phone: phone.optional(),
  role: z.enum(ROLES),
});
export const updateUserSchema = z
  .object({
    displayName: z.string().trim().min(3, "Escribe el nombre completo.").max(120).optional(),
    phone: phone.optional(),
    role: z.enum(ROLES).optional(),
    active: z.boolean().optional(),
  })
  .refine(value => Object.keys(value).length > 0, "No hay cambios.");

type Change = { role?: MembershipRole; active?: boolean };

/**
 * ¿Puede `actor` aplicar `change` sobre el usuario `target`? Devuelve el motivo si no.
 * `activeOwners`: OWNER activos de la organización antes del cambio.
 */
export function canManage(
  actor: { userId: string; role: MembershipRole },
  target: { userId: string; role: MembershipRole; active: boolean } | null,
  change: Change,
  activeOwners: number
): string | null {
  // Quién puede gestionar usuarios lo decide el permiso «users.manage» (preHandler); aquí, las reglas fijas.
  if (target && target.userId === actor.userId) {
    if (change.role && change.role !== target.role) return "No puedes cambiar tu propio rol.";
    if (change.active === false) return "No puedes desactivar tu propio usuario.";
  }
  const touchesOwner = change.role === "OWNER" || target?.role === "OWNER";
  if (touchesOwner && actor.role !== "OWNER")
    return "Solo un propietario puede asignar o modificar el rol Propietario.";
  const losesOwner =
    target?.role === "OWNER" && target.active && ((change.role && change.role !== "OWNER") || change.active === false);
  if (losesOwner && activeOwners <= 1) return "Debe quedar al menos un propietario activo.";
  return null;
}

const userSelect = {
  role: true,
  active: true,
  createdAt: true,
  user: { select: { id: true, displayName: true, email: true, phone: true, active: true } },
} satisfies Prisma.MembershipSelect;

const present = (membership: Prisma.MembershipGetPayload<{ select: typeof userSelect }>) => ({
  id: membership.user.id,
  displayName: membership.user.displayName,
  email: membership.user.email,
  phone: membership.user.phone,
  role: membership.role,
  // Activo en esta organización y en el sistema.
  active: membership.active && membership.user.active,
  createdAt: membership.createdAt.toISOString(),
});

export function registerUserRoutes(
  app: FastifyInstance,
  options: { auditIp: (ip: string) => string; devLogin: boolean }
) {
  const can = { preHandler: allowPermission("users.manage") };
  const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
  const audit = (
    tx: Prisma.TransactionClient,
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
        entity: "User",
        entityId,
        action,
        before,
        after,
        ipHash: options.auditIp(request.ip),
      },
    });
  const activeOwners = (tx: Prisma.TransactionClient, organizationId: string) =>
    tx.membership.count({ where: { organizationId, role: "OWNER", active: true, user: { active: true } } });

  app.get("/v1/organization/users", can, async request => {
    const memberships = await prisma.membership.findMany({
      where: { organizationId: request.actor!.organizationId },
      select: userSelect,
      orderBy: [{ active: "desc" }, { user: { displayName: "asc" } }],
    });
    return { data: memberships.map(present), currentUserId: request.actor!.sub, devLogin: options.devLogin };
  });

  app.post("/v1/organization/users", can, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(422)
        .send({ error: parsed.error.issues[0]?.message ?? "Datos inválidos.", details: parsed.error.flatten() });
    const actor = request.actor!;
    const input = parsed.data;
    const data = await withOrganizationScope(actor.organizationId, async tx => {
      const denied = canManage({ userId: actor.sub, role: actor.role }, null, { role: input.role }, 0);
      if (denied) throw httpError(403, denied);
      // Un correo es una persona: si ya usa Betel en otra empresa, se vincula el mismo usuario.
      const user =
        (await tx.user.findUnique({ where: { email: input.email } })) ??
        (await tx.user.create({
          data: { email: input.email, displayName: input.displayName, phone: input.phone ?? null },
        }));
      const existing = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId: actor.organizationId, userId: user.id } },
      });
      if (existing) throw httpError(409, "Ese correo ya es usuario de esta empresa.");
      const membership = await tx.membership.create({
        data: { organizationId: actor.organizationId, userId: user.id, role: input.role },
        select: userSelect,
      });
      await audit(tx, request, user.id, "CREATE", { email: input.email, role: input.role });
      return present(membership);
    });
    return reply.code(201).send({ data });
  });

  app.put<{ Params: { userId: string } }>("/v1/organization/users/:userId", can, async (request, reply) => {
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(422)
        .send({ error: parsed.error.issues[0]?.message ?? "Datos inválidos.", details: parsed.error.flatten() });
    const actor = request.actor!;
    const change = parsed.data;
    const data = await withOrganizationScope(actor.organizationId, async tx => {
      const membership = await tx.membership.findFirst({
        where: { organizationId: actor.organizationId, userId: request.params.userId },
        select: userSelect,
      });
      if (!membership) throw httpError(404, "El usuario no pertenece a esta empresa.");
      const denied = canManage(
        { userId: actor.sub, role: actor.role },
        { userId: membership.user.id, role: membership.role, active: membership.active },
        { role: change.role, active: change.active },
        await activeOwners(tx, actor.organizationId)
      );
      if (denied) throw httpError(403, denied);
      // Nombre y celular son del usuario (se comparten si pertenece a varias empresas); rol y estado, de la membresía.
      if (change.displayName !== undefined || change.phone !== undefined)
        await tx.user.update({
          where: { id: membership.user.id },
          data: { displayName: change.displayName, phone: change.phone },
        });
      const updated = await tx.membership.update({
        where: { organizationId_userId: { organizationId: actor.organizationId, userId: membership.user.id } },
        data: { role: change.role, active: change.active },
        select: userSelect,
      });
      await audit(
        tx,
        request,
        membership.user.id,
        change.active === false ? "DEACTIVATE" : change.active === true ? "ACTIVATE" : "UPDATE",
        { role: updated.role, active: updated.active, displayName: updated.user.displayName },
        { role: membership.role, active: membership.active, displayName: membership.user.displayName }
      );
      return present(updated);
    });
    return { data };
  });

  const permissionsResponse = (overrides: PermissionOverrides | null, actorRole: MembershipRole) => ({
    data: {
      permissions: PERMISSIONS.map(({ key, area, action, defaults }) => ({ key, area, action, defaults })),
      matrix: permissionMatrix(overrides),
      customized: !!overrides && Object.keys(overrides).length > 0,
      canEdit: actorRole === "OWNER",
    },
  });

  app.get("/v1/organization/permissions", can, async request =>
    permissionsResponse(request.permissionOverrides ?? null, request.actor!.role)
  );

  const matrixSchema = z.object({
    matrix: z.record(z.string(), z.record(z.string(), z.boolean())),
  });
  app.put("/v1/organization/permissions", can, async (request, reply) => {
    const actor = request.actor!;
    if (actor.role !== "OWNER")
      return reply.code(403).send({ error: "Solo un propietario puede editar los permisos." });
    const parsed = matrixSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Tabla de permisos inválida." });
    const unknownRole = Object.keys(parsed.data.matrix).find(
      role => !(ROLES_WITH_EDITABLE_PERMISSIONS as string[]).includes(role)
    );
    if (unknownRole && unknownRole !== "OWNER")
      return reply.code(422).send({ error: `Rol desconocido: ${unknownRole}.` });
    const overrides = overridesFromMatrix(parsed.data.matrix);
    const before = request.permissionOverrides ?? null;
    await withOrganizationScope(actor.organizationId, async tx => {
      await tx.organization.update({
        where: { id: actor.organizationId },
        data: { rolePermissions: Object.keys(overrides).length ? (overrides as Prisma.InputJsonValue) : Prisma.DbNull },
      });
      await audit(
        tx,
        request,
        actor.organizationId,
        "PERMISSIONS",
        overrides as Prisma.InputJsonValue,
        (before ?? {}) as Prisma.InputJsonValue
      );
    });
    return permissionsResponse(Object.keys(overrides).length ? overrides : null, actor.role);
  });
}
