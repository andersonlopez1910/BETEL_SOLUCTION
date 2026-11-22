/**
 * Ruta /cotizaciones/nueva — Crear cotización. El formulario está en components/quote-form.tsx.
 */
import { AppShell } from "../../../../components/app-shell";
import { QuoteForm } from "../../../../components/quote-form";

export default function NewQuotePage() {
  return (
    <AppShell title="Crear cotización" subtitle="Prepara una propuesta de venta para un cliente.">
      <QuoteForm />
    </AppShell>
  );
}
