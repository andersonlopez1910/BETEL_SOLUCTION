/**
 * Ruta /cotizaciones/documento?id=… — Ver cotización. El contenido está en components/quote-document.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { QuoteDocumentView } from "../../../../components/quote-document";

export default function QuoteDocumentPage() {
  return (
    <AppShell title="Cotización" subtitle="Detalle, impresión, envío por correo y conversión en factura.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <QuoteDocumentView />
      </Suspense>
    </AppShell>
  );
}
