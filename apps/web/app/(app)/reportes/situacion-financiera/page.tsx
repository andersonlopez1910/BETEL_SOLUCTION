/**
 * Ruta /reportes/situacion-financiera — Estado de situación financiera. El contenido está en components/financial-reports.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { BalanceSheet } from "../../../../components/financial-reports";

export default function Page() {
  return (
    <AppShell title="Estado de situación financiera" subtitle="Activo, pasivo y patrimonio a una fecha.">
      <Suspense>
        <BalanceSheet />
      </Suspense>
    </AppShell>
  );
}
