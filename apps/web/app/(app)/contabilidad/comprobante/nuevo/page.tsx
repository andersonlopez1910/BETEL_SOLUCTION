/**
 * Ruta /contabilidad/comprobante/nuevo — Nuevo comprobante contable. El contenido está en components/ledger-reports.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../../components/app-shell";
import { ManualEntryForm } from "../../../../../components/ledger-reports";

export default function Page() {
  return (
    <AppShell title="Nuevo comprobante contable" subtitle="Comprobante manual: débitos iguales a créditos.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <ManualEntryForm />
      </Suspense>
    </AppShell>
  );
}
