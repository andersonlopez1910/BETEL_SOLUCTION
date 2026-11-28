/**
 * Ruta /productos/kardex?producto=<id> — Kárdex valorizado de un producto. El contenido está en components/kardex.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { ProductKardex } from "../../../../components/kardex";

export default function KardexPage() {
  return (
    <AppShell title="Kárdex" subtitle="Entradas, salidas, saldo y costo unitario de cada producto.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <ProductKardex />
      </Suspense>
    </AppShell>
  );
}
