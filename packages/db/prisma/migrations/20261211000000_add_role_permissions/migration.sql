-- Permisos editables por rol: solo se guardan los cambios frente a los valores por defecto.
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "rolePermissions" JSONB;

