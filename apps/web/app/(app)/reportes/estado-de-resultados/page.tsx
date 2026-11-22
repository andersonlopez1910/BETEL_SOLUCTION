/**
 * Ruta /reportes/estado-de-resultados — Estado de resultados. El contenido está en components/financial-reports.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { IncomeStatement } from "../../../../components/financial-reports";

export default function Page() {
  return (
    <AppShell title="Estado de resultados" subtitle="Ingresos, costos, gastos y utilidad del período.">
      <Suspense>
        <IncomeStatement />
      </Suspense>
    </AppShell>
  );
}
