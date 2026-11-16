/**
 * Ruta /recaudos/nuevo — Crear recibo de caja (abona a facturas a crédito).
 * El formulario está en components/cash-receipt-form.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { CashReceiptForm } from "../../../../components/cash-receipt-form";

export default function NewCashReceiptPage() {
  return (
    <AppShell
      title="Crear recibo de caja"
      subtitle="Registra el dinero recibido de un cliente y abónalo a sus facturas a crédito."
    >
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <CashReceiptForm />
      </Suspense>
    </AppShell>
  );
}
