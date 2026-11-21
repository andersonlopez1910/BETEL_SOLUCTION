/**
 * Ruta /compras — Compras y gastos, con sus submenús (?tab=documentos, eventos, proveedores,
 * soporte-por-legalizar). El contenido está en components/purchases.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../components/app-shell";
import { PurchasesModule } from "../../../components/purchases";

export default function PurchasesPage() {
  return (
    <AppShell
      title="Compras y gastos"
      subtitle="Registra y consulta compras, gastos y documentos soporte de tus proveedores."
    >
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <PurchasesModule />
      </Suspense>
    </AppShell>
  );
}
