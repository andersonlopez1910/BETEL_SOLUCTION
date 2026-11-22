/**
 * Ruta /contabilidad/borrado-masivo — Borrado masivo de comprobantes. El contenido está en components/ledger-processes.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { BulkVoid } from "../../../../components/ledger-processes";

export default function Page() {
  return (
    <AppShell title="Borrado masivo de comprobantes" subtitle="Anula varios comprobantes manuales a la vez.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <BulkVoid />
      </Suspense>
    </AppShell>
  );
}
