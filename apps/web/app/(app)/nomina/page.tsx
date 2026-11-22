/**
 * Ruta /nomina — Nómina: liquidaciones, empleados, nómina electrónica y parámetros. El contenido está en
 * components/payroll.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../components/app-shell";
import { PayrollModule } from "../../../components/payroll";

export default function PayrollPage() {
  return (
    <AppShell title="Nómina" subtitle="Empleados, liquidaciones, pagos y nómina electrónica.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <PayrollModule />
      </Suspense>
    </AppShell>
  );
}
