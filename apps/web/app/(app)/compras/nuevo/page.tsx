/**
 * Ruta /compras/nuevo?tipo=PURCHASE|EXPENSE|SUPPORT — Nueva compra, gasto o documento soporte.
 * El formulario está en components/purchase-form.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { PurchaseForm } from "../../../../components/purchase-form";

export default function NewPurchasePage() {
  return (
    <AppShell
      title="Nueva compra / gasto / documento soporte"
      subtitle="Registra el documento del proveedor; se contabiliza al guardar."
    >
      <Suspense>
        <PurchaseForm />
      </Suspense>
    </AppShell>
  );
}
