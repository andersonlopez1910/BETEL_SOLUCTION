-- Terceros: identidad estructurada de persona natural e historial verificable de datos sugeridos.
ALTER TABLE "Party"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "middleName" TEXT,
  ADD COLUMN "firstSurname" TEXT,
  ADD COLUMN "secondSurname" TEXT,
  ADD COLUMN "vatResponsibility" TEXT,
  ADD COLUMN "chamberOfCommerce" TEXT,
  ADD COLUMN "commercialRegistration" TEXT,
  ADD COLUMN "economicActivityCode" TEXT,
  ADD COLUMN "enrichmentMetadata" JSONB;
