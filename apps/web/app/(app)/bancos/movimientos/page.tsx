/**
 * Ruta /bancos/movimientos?cuenta=… — Movimientos (auxiliar) de una caja o cuenta bancaria. El contenido está en
 * components/banks.tsx.
 */
import { Suspense } from "react";
import { AppShell } from "../../../../components/app-shell";
import { BankMovements } from "../../../../components/banks";

export default function BankMovementsPage() {
  return (
    <AppShell title="Movimientos de caja y bancos" subtitle="Saldo anterior, entradas, salidas y saldo acumulado.">
      {/* useSearchParams exige Suspense en la exportación estática. */}
      <Suspense>
        <BankMovements />
      </Suspense>
    </AppShell>
  );
}
