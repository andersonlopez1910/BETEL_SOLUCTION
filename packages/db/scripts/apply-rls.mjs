import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const migrationUrl = new URL("../prisma/migrations/20261016000000_enable_tenant_rls/migration.sql", import.meta.url);
const statements = (await readFile(fileURLToPath(migrationUrl), "utf8"))
  .split(";")
  .map(statement => statement.replace(/--[^\n]*/g, "").trim())
  .filter(Boolean);
const prisma = new PrismaClient();
try {
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  console.log(`RLS aplicado: ${statements.length} sentencias ejecutadas.`);
} finally {
  await prisma.$disconnect();
}
