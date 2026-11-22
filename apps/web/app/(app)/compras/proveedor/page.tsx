/**
 * Ruta /compras/proveedor?id=… — Cuentas por pagar de un proveedor. El contenido está en
 * components/supplier-statement.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { SupplierStatement } from "../../../../components/supplier-statement";

export default function SupplierStatementPage() {
  return (
    <AppShell title="Cuentas por pagar" subtitle="Saldos, documentos pendientes y pagos del proveedor.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <SupplierStatement />
      </Suspense>
    </AppShell>
  );
}
