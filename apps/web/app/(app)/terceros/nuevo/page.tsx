/**
 * Ruta /terceros/nuevo — Crear tercero (usa PartyForm).
 */
import { AppShell } from "../../../../components/app-shell";
import { ThirdPartyForm } from "../../../../components/third-party-form";
export default function NewParty() {
  return (
    <AppShell title="Crear tercero" subtitle="Los campos con asterisco son obligatorios para facturación electrónica.">
      <div className="page-content">
        <ThirdPartyForm />
      </div>
    </AppShell>
  );
}
