/**
 * Ruta /configuracion/pos — Documento equivalente POS. El contenido está en components/pos-settings.tsx.
 */
import { AppShell } from "../../../../components/app-shell";
import { PosSettings } from "../../../../components/pos-settings";

export default function Page() {
  return (
    <AppShell title="Documento equivalente POS" subtitle="Resolución DIAN de la numeración POS y datos de la tirilla.">
      <PosSettings />
    </AppShell>
  );
}
