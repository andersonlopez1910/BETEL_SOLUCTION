/**
 * Ruta /facturas-recurrentes/documento?id=… — Ver factura recurrente (components/recurring-document.tsx).
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { RecurringDocumentView } from "../../../../components/recurring-document";

export default function RecurringInvoicePage() {
  return (
    <AppShell title="Factura recurrente" subtitle="Programación, ítems y facturas generadas.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <RecurringDocumentView />
      </Suspense>
    </AppShell>
  );
}
