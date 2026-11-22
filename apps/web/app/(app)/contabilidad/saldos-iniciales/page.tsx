/**
 * Ruta /contabilidad/saldos-iniciales — Saldos iniciales de otras cuentas. El contenido está en components/ledger-reports.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { ManualEntryForm } from "../../../../components/ledger-reports";

export default function Page() {
  return (
    <AppShell title="Saldos iniciales de otras cuentas" subtitle="Saldos de apertura de las cuentas de balance.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <ManualEntryForm kind="OPENING" />
      </Suspense>
    </AppShell>
  );
}
