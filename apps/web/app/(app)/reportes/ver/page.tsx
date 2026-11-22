/**
 * Ruta /reportes/ver?id=... — reporte del catálogo. El contenido está en components/catalog-report.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { CatalogReportPage } from "../../../../components/catalog-report";

export default function Page() {
  return (
    <AppShell title="Reporte" subtitle="Filtra, consulta y descarga el reporte.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <CatalogReportPage />
      </Suspense>
    </AppShell>
  );
}
