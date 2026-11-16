/**
 * Ruta /facturas-recurrentes/nueva — Crear factura recurrente (components/quote-form.tsx, RecurringInvoiceForm).
 */
import { AppShell } from "../../../../components/app-shell";
import { RecurringInvoiceForm } from "../../../../components/quote-form";

export default function NewRecurringInvoicePage() {
  return (
    <AppShell
      title="Crear factura recurrente"
      subtitle="Programa una factura que se genera automáticamente cada período."
    >
      <RecurringInvoiceForm />
    </AppShell>
  );
}
