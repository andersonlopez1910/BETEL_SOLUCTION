/**
 * Ruta /compras/pago/nuevo?proveedor=… — Registrar pago a proveedor (comprobante de egreso). El formulario
 * está en components/supplier-payment-form.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../../components/app-shell";
import { SupplierPaymentForm } from "../../../../../components/supplier-payment-form";

export default function NewSupplierPaymentPage() {
  return (
    <AppShell
      title="Registrar pago a proveedor"
      subtitle="Comprobante de egreso que abona a compras y gastos a crédito."
    >
      <Suspense>
        <SupplierPaymentForm />
      </Suspense>
    </AppShell>
  );
}
