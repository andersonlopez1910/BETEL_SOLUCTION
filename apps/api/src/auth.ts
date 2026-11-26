/**
 * Autenticación y autorización de la API.
 *
 * Flujo de cada petición protegida:
 *   1. `requireActor` verifica el JWT enviado en `Authorization: Bearer <token>`.
 *   2. Se consulta la membresía en base de datos para obtener el rol REAL del usuario
 *      en esa organización (no se confía solo en el rol que viene en el token, porque
 *      pudo cambiar o revocarse después de emitirlo).
 *   3. El resultado queda en `request.actor`, que es lo que deben usar las rutas.
 *
 * Uso en una ruta:
 *   app.get("/ruta", { preHandler: requireActor }, ...)                 // cualquier usuario válido
 *   app.post("/ruta", { preHandler: allowRoles("OWNER", "ADMIN") }, ...) // solo ciertos roles
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@betel/db";
import { hasPermission, type PermissionKey, type PermissionOverrides } from "./permissions.js";

/** Roles posibles de un usuario dentro de una organización (ver enum MembershipRole en schema.prisma). */
export type MembershipRole = "OWNER" | "ADMIN" | "ACCOUNTANT" | "SALES" | "SUPPORT" | "VIEWER";

/**
 * Contenido (payload) del JWT de Betel.
 * - sub: id del usuario.
 * - organizationId: empresa con la que inició sesión (límite de multitenencia).
 * - role: rol al momento de emitir el token (se revalida en cada petición).
 */
export type BetelJwt = { sub: string; organizationId: string; role: MembershipRole; email: string };

// Tipado de @fastify/jwt: `request.user` y `jwt.sign()` usan BetelJwt.
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: BetelJwt;
    user: BetelJwt;
  }
}

// Agrega `request.actor` (usuario ya validado contra la base de datos).
declare module "fastify" {
  interface FastifyRequest {
    actor?: BetelJwt;
    /** Permisos editados de la organización (null = valores por defecto). Ver permissions.ts. */
    permissionOverrides?: PermissionOverrides | null;
  }
}

/**
 * preHandler: exige una sesión válida y una membresía activa en la organización del token.
 * Responde 401 si el token es inválido/vencido y 403 si el usuario no pertenece a la organización
 * o fue desactivado.
 */
export async function requireActor(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "Sesión inválida o vencida." });
  }

  // Rol vigente desde la BD: si un administrador cambia o quita el rol, aplica de inmediato.
  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId: request.user.organizationId, userId: request.user.sub } },
    select: {
      role: true,
      active: true,
      user: { select: { active: true } },
      organization: { select: { rolePermissions: true } },
    },
  });
  // Usuario desactivado en el sistema o en esta organización (Configuración › Usuarios y permisos).
  if (!membership || !membership.active || !membership.user.active)
    return reply.code(403).send({ error: "No tienes acceso a esta organización." });

  request.actor = { ...request.user, role: membership.role };
  request.permissionOverrides = membership.organization.rolePermissions as PermissionOverrides | null;
}

/**
 * Crea un preHandler que, además de `requireActor`, restringe la ruta a los roles indicados.
 * Ejemplo: `allowRoles("OWNER", "ADMIN", "ACCOUNTANT")`.
 */
export function allowRoles(...roles: MembershipRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireActor(request, reply);
    if (reply.sent) return; // requireActor ya respondió con 401/403.
    if (!request.actor || !roles.includes(request.actor.role))
      return reply.code(403).send({ error: "No tienes permiso para realizar esta acción." });
  };
}

/**
 * preHandler: exige sesión y el permiso indicado según la tabla de permisos de la organización
 * (Configuración › Usuarios y permisos; valores por defecto en permissions.ts). OWNER siempre pasa.
 */
export function allowPermission(key: PermissionKey) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireActor(request, reply);
    if (reply.sent) return;
    if (!request.actor || !hasPermission(request.actor.role, key, request.permissionOverrides))
      return reply.code(403).send({ error: "No tienes permiso para realizar esta acción." });
  };
}

/** Para comprobaciones dentro de una ruta (p. ej. reportes del catálogo con permisos distintos). */
export const actorCan = (request: FastifyRequest, key: PermissionKey) =>
  !!request.actor && hasPermission(request.actor.role, key, request.permissionOverrides);
