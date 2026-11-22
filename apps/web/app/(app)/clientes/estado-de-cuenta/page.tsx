/**
 * Ruta /clientes/estado-de-cuenta?id=… — estado de cuenta de un cliente (components/customer-statement.tsx).
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { CustomerStatement } from "../../../../components/customer-statement";

export default function CustomerStatementPage() {
  return (
    <AppShell title="Estado de cuenta" subtitle="Saldos, facturas pendientes y recibos del cliente.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <CustomerStatement />
      </Suspense>
    </AppShell>
  );
}
