/**
 * Ruta /envio-masivo/imprimir?docs=… — impresión masiva de comprobantes (components/mass-print.tsx).
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { MassPrint } from "../../../../components/mass-print";

export default function MassPrintPage() {
  return (
    <AppShell
      title="Impresión de comprobantes"
      subtitle="Un comprobante por página. Usa “Guardar como PDF” para obtener el archivo."
    >
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <MassPrint />
      </Suspense>
    </AppShell>
  );
}
