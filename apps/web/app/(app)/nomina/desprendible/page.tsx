/**
 * Ruta /nomina/desprendible?run=…&empleado=… — Desprendibles de pago de nómina. El contenido está en
 * components/payroll-slip.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { PayrollSlips } from "../../../../components/payroll-slip";

export default function PayrollSlipPage() {
  return (
    <AppShell title="Desprendibles de nómina" subtitle="Comprobante de pago por empleado.">
      <Suspense>
        <PayrollSlips />
      </Suspense>
    </AppShell>
  );
}
