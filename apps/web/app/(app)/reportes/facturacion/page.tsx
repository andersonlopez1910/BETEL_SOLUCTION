/**
 * Ruta /reportes/facturacion — Reporte de facturación con nueve pestañas (?tab=ventas, ?tab=clientes, ...).
 * El contenido está en components/billing-report.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { BillingReport, CreateDocumentActions } from "../../../../components/billing-report";

export default function BillingReportPage() {
  return (
    <AppShell
      title="Reporte de facturación"
      subtitle="Consulta, analiza y exporta la información de facturación de tu organización."
      actions={<CreateDocumentActions />}
    >
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <BillingReport />
      </Suspense>
    </AppShell>
  );
}
