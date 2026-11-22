/**
 * Ruta /contabilidad/cierre-de-ano — Cierre de año. El contenido está en components/ledger-processes.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { YearCloseView } from "../../../../components/ledger-processes";

export default function Page() {
  return (
    <AppShell
      title="Cierre de año"
      subtitle="Cierra las cuentas de resultado del año contra la utilidad o pérdida del ejercicio."
    >
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <YearCloseView />
      </Suspense>
    </AppShell>
  );
}
