/**
 * Cliente de base de datos compartido (@betel/db).
 *
 * - `prisma`: instancia única de PrismaClient para todo el proceso.
 * - `withOrganizationScope`: forma OBLIGATORIA de leer/escribir datos de una organización.
 *
 * Regla del equipo: las tablas que pertenecen a una empresa (terceros, facturas, productos, etc.)
 * se consultan SIEMPRE dentro de `withOrganizationScope`. Fuera de ella, las políticas RLS de
 * PostgreSQL no devolverán filas.
 */
import { Prisma, PrismaClient } from "@prisma/client";
export type { Prisma } from "@prisma/client";

// En desarrollo, `tsx watch` recarga el código en cada cambio. Guardar la instancia en globalThis
// evita abrir una nueva conexión a PostgreSQL en cada recarga.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Ejecuta lecturas o escrituras dentro del contexto de una organización.
 * La variable se limita a la transacción (`is_local = true`) y activa las
 * políticas RLS de PostgreSQL para impedir lecturas entre empresas.
 *
 * Ejemplo:
 *   const terceros = await withOrganizationScope(actor.organizationId, tx => tx.party.findMany());
 *
 * Todo lo que se haga con `tx` ocurre en UNA transacción: si algo falla, se revierte todo.
 */
export async function withOrganizationScope<T>(
  organizationId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
) {
  return prisma.$transaction(async tx => {
    // Ver packages/db/prisma/migrations/*_enable_tenant_rls: las políticas leen esta variable.
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
    return operation(tx);
  });
}
