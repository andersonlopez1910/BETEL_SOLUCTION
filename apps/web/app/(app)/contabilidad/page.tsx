/**
 * Ruta /contabilidad — Contabilidad. El contenido está en components/accounting.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../components/app-shell";
import { AccountingModule } from "../../../components/accounting";

export default function Page() {
  return (
    <AppShell title="Contabilidad" subtitle="Plan de cuentas y procesos contables.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <AccountingModule />
      </Suspense>
    </AppShell>
  );
}
