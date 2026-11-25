-- Un tercero es único por empresa, tipo y número de identificación.
-- Es la barrera final ante intentos simultáneos de creación.
CREATE UNIQUE INDEX IF NOT EXISTS "Party_organizationId_identificationType_identificationNumber_key"
  ON "Party"("organizationId", "identificationType", "identificationNumber");
