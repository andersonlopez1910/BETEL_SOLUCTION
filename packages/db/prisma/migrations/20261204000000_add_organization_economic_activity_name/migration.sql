-- Se conserva el título oficial del CIIU seleccionado para trazabilidad documental.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "economicActivityName" TEXT;
