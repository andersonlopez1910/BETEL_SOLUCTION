/**
 * Ruta /productos — Productos y servicios, con sus submenús (?tab=gestion, documentos, costeo). El contenido está
 * en components/products.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../components/app-shell";
import { ProductsModule } from "../../../components/products";

export default function ProductsPage() {
  return (
    <AppShell title="Productos y servicios" subtitle="Catálogo, precios, impuestos y stock de lo que compras y vendes.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <ProductsModule />
      </Suspense>
    </AppShell>
  );
}
