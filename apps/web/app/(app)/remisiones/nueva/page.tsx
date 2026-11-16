/**
 * Ruta /remisiones/nueva — Crear remisión. El formulario está en components/quote-form.tsx (DeliveryForm).
 */
import { AppShell } from "../../../../components/app-shell";
import { DeliveryForm } from "../../../../components/quote-form";

export default function NewDeliveryPage() {
  return (
    <AppShell title="Crear remisión" subtitle="Registra la mercancía entregada a un cliente.">
      <DeliveryForm />
    </AppShell>
  );
}
