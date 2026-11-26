import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

// Migraciones con políticas RLS. De la primera se ejecuta todo; de las demás solo las sentencias
// de RLS (las tablas ya las crea `db push`).
const migrations = [
  ["20261016000000_enable_tenant_rls", false],
  ["20261116000000_add_cash_receipts_and_document_emails", true],
  ["20261116100000_add_online_payments", true],
  ["20261116200000_add_quotes", true],
  ["20261116300000_add_deliveries", true],
  ["20261116400000_add_recurring_invoices", true],
  ["20261116600000_add_commercial_tasks", true],
  ["20261120000000_add_purchase_documents", true],
  ["20261121000000_add_received_invoice_events", true],
  ["20261122000000_add_supplier_payments", true],
  ["20261123000000_add_purchase_imports", true],
  ["20261124000000_add_inventory_documents", true],
  ["20261125000000_add_monthly_costing", true],
  ["20261126000000_add_payroll", true],
  ["20261127000000_add_journal_templates", true],
  ["20261128000000_add_product_master_configuration", true],
  ["20261129000000_add_electronic_invoice_tax_engine", true],
  ["20261208000000_isolate_organization_tax_configurations", true],
];
const statements = [];
for (const [name, onlyRls] of migrations) {
  const migrationUrl = new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url);
  statements.push(
    ...(await readFile(fileURLToPath(migrationUrl), "utf8"))
      // Comentarios fuera antes de partir: un ";" dentro de un comentario no debe cortar la sentencia.
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map(statement => statement.trim())
      .filter(Boolean)
      .filter(statement => !onlyRls || /ROW LEVEL SECURITY|POLICY/.test(statement))
  );
}
const prisma = new PrismaClient();
try {
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  console.log(`RLS aplicado: ${statements.length} sentencias ejecutadas.`);
} finally {
  await prisma.$disconnect();
}
