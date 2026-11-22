/**
 * Ruta /bancos — Cajas y bancos: saldo de cada cuenta de caja y bancos. El contenido está en components/banks.tsx.
 */
import { AppShell } from "../../../components/app-shell";
import { BanksModule } from "../../../components/banks";

export default function BanksPage() {
  return (
    <AppShell title="Cajas y bancos" subtitle="Saldo de cada caja y cuenta bancaria según la contabilidad.">
      <BanksModule />
    </AppShell>
  );
}
