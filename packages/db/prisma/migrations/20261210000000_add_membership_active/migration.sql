-- Usuarios y permisos: desactivar el acceso de un usuario a una organización sin borrar su historial.
-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

