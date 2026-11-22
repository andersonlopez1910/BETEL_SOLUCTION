/**
 * Ruta /nomina/liquidacion?id=… — Detalle de una liquidación de nómina. El contenido está en
 * components/payroll-run.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { PayrollRunView } from "../../../../components/payroll-run";

export default function PayrollRunPage() {
  return (
    <AppShell title="Liquidación de nómina" subtitle="Novedades, aprobación, pago y desprendibles.">
      <Suspense>
        <PayrollRunView />
      </Suspense>
    </AppShell>
  );
}
