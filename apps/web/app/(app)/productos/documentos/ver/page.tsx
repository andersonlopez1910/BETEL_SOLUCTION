/**
 * Ruta /productos/documentos/ver?id=… — Ver documento de inventario. El contenido está en
 * components/inventory-document.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../../components/app-shell";
import { InventoryDocumentView } from "../../../../../components/inventory-document";

export default function InventoryDocumentPage() {
  return (
    <AppShell title="Documento de inventario" subtitle="Detalle, impresión y anulación.">
      <Suspense>
        <InventoryDocumentView />
      </Suspense>
    </AppShell>
  );
}
