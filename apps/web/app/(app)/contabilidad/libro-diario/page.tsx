/**
 * Ruta /contabilidad/libro-diario — Libro diario. El contenido está en components/ledger-reports.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { JournalBook } from "../../../../components/ledger-reports";

export default function Page() {
  return (
    <AppShell title="Libro diario" subtitle="Comprobantes contables del período.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <JournalBook />
      </Suspense>
    </AppShell>
  );
}
