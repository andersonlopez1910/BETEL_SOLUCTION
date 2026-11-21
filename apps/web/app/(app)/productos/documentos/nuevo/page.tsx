/**
 * Ruta /productos/documentos/nuevo?tipo=INITIAL|ADJUSTMENT — saldo inicial o ajuste de inventario. El formulario
 * está en components/inventory-form.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../../components/app-shell";
import { InventoryForm } from "../../../../../components/inventory-form";

export default function NewInventoryDocumentPage() {
  return (
    <AppShell
      title="Nuevo documento de inventario"
      subtitle="Saldo inicial o ajuste: mueve el stock y se contabiliza al guardar."
    >
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <InventoryForm />
      </Suspense>
    </AppShell>
  );
}
