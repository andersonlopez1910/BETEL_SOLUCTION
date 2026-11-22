/**
 * Ruta /reportes — Reportes. El contenido está en components/financial-reports.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../components/app-shell";
import { ReportsHub } from "../../../components/financial-reports";

export default function Page() {
  return (
    <AppShell title="Reportes" subtitle="Todos los reportes de la empresa, agrupados por área.">
      <Suspense>
        <ReportsHub />
      </Suspense>
    </AppShell>
  );
}
