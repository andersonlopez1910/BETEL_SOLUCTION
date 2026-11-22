/**
 * Ruta /recaudos/documento?type=CashReceipt|Invoice&id=… — "Ver documento" de Recaudos.
 * El contenido está en components/collection-document.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { CollectionDocumentView } from "../../../../components/collection-document";

export default function CollectionDocumentPage() {
  return (
    <AppShell title="Documento de recaudo" subtitle="Detalle, impresión y envío por correo.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <CollectionDocumentView />
      </Suspense>
    </AppShell>
  );
}
