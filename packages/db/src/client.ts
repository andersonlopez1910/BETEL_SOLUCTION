import { Prisma, PrismaClient } from "@prisma/client";
export type { Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Ejecuta lecturas o escrituras dentro del contexto de una organización.
 * La variable se limita a la transacción (`is_local = true`) y activa las
 * políticas RLS de PostgreSQL para impedir lecturas entre empresas.
 */
export async function withOrganizationScope<T>(organizationId: string, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
    return operation(tx);
  });
}
