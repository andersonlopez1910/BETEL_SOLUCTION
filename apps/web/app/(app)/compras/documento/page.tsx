/**
 * Ruta /compras/documento?kind=Purchase|Support&id=… — Ver documento de compras y gastos.
 * El contenido está en components/purchase-document.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { PurchaseDocumentView } from "../../../../components/purchase-document";

export default function PurchaseDocumentPage() {
  return (
    <AppShell title="Documento de compras y gastos" subtitle="Detalle, impresión y anulación.">
      <Suspense>
        <PurchaseDocumentView />
      </Suspense>
    </AppShell>
  );
}
