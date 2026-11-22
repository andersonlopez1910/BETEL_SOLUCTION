/**
 * Ruta /productos/costeo/mes?anio=&mes= — Detalle del costeo mensual por producto. El contenido está en
 * components/costing.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../../components/app-shell";
import { CostingDetail } from "../../../../../components/costing";

export default function CostingDetailPage() {
  return (
    <AppShell title="Costeo mensual" subtitle="Costo promedio ponderado y costo de ventas por producto.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <CostingDetail />
      </Suspense>
    </AppShell>
  );
}
