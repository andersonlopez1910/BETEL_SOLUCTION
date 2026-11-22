/**
 * Ruta /remisiones/documento?id=… — Ver remisión. El contenido está en components/quote-document.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { DeliveryDocumentView } from "../../../../components/quote-document";

export default function DeliveryDocumentPage() {
  return (
    <AppShell title="Remisión" subtitle="Detalle, impresión, envío por correo y conversión en factura.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <DeliveryDocumentView />
      </Suspense>
    </AppShell>
  );
}
