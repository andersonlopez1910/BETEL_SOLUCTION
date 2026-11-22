/**
 * Ruta /contabilidad/certificado-ingresos — Certificado de ingresos y retenciones. El contenido está en components/ledger-processes.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { IncomeCertificates } from "../../../../components/ledger-processes";

export default function Page() {
  return (
    <AppShell title="Certificado de ingresos y retenciones" subtitle="Formato 220 por empleado a partir de la nómina.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <IncomeCertificates />
      </Suspense>
    </AppShell>
  );
}
