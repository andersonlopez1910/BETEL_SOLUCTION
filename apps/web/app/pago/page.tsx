/**
 * Ruta pública /pago?token=… — página donde el cliente paga una factura con el link de pago.
 * No usa AppShell ni sesión. El contenido está en components/payment-checkout.tsx.
 */
import { Suspense } from "react";
import { PaymentCheckout } from "../../components/payment-checkout";

export default function PaymentPage() {
  return (
    // useSearchParams exige Suspense en la exportación estática.
    <Suspense>
      <PaymentCheckout />
    </Suspense>
  );
}
