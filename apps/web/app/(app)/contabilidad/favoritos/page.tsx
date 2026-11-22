/**
 * Ruta /contabilidad/favoritos — Comprobantes favoritos. El contenido está en components/ledger-processes.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { FavoriteEntries } from "../../../../components/ledger-processes";

export default function Page() {
  return (
    <AppShell title="Comprobantes favoritos" subtitle="Plantillas para crear comprobantes manuales repetidos.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <FavoriteEntries />
      </Suspense>
    </AppShell>
  );
}
