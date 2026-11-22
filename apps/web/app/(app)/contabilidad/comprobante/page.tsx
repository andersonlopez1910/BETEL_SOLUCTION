/**
 * Ruta /contabilidad/comprobante — Comprobante contable. El contenido está en components/ledger-reports.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { JournalEntryView } from "../../../../components/ledger-reports";

export default function Page() {
  return (
    <AppShell title="Comprobante contable" subtitle="Detalle del comprobante.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <JournalEntryView />
      </Suspense>
    </AppShell>
  );
}
