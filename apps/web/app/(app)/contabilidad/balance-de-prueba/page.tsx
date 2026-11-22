/**
 * Ruta /contabilidad/balance-de-prueba — Balance de prueba. El contenido está en components/ledger-reports.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { TrialBalance } from "../../../../components/ledger-reports";

export default function Page() {
  return (
    <AppShell title="Balance de prueba" subtitle="Saldos por cuenta en el período.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <TrialBalance />
      </Suspense>
    </AppShell>
  );
}
