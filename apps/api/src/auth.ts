import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@betel/db";

export type MembershipRole = "OWNER" | "ADMIN" | "ACCOUNTANT" | "SALES" | "SUPPORT" | "VIEWER";
export type BetelJwt = { sub: string; organizationId: string; role: MembershipRole; email: string };

declare module "@fastify/jwt" {
  interface FastifyJWT { payload: BetelJwt; user: BetelJwt }
}
declare module "fastify" {
  interface FastifyRequest { actor?: BetelJwt }
}

export async function requireActor(request: FastifyRequest, reply: FastifyReply) {
  try { await request.jwtVerify(); } catch { return reply.code(401).send({ error: "Sesión inválida o vencida." }); }
  const membership = await prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: request.user.organizationId, userId: request.user.sub } }, select: { role: true, user: { select: { active: true } } } });
  if (!membership || !membership.user.active) return reply.code(403).send({ error: "No tienes acceso a esta organización." });
  request.actor = { ...request.user, role: membership.role };
}

export function allowRoles(...roles: MembershipRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireActor(request, reply);
    if (reply.sent) return;
    if (!request.actor || !roles.includes(request.actor.role)) return reply.code(403).send({ error: "No tienes permiso para realizar esta acción." });
  };
}
