import { apiGetBlob } from "./api";

/** Abre el PDF autenticado en otra pestaña sin abandonar la pantalla actual. */
export async function openInvoicePdf(invoiceId: string) {
  // Debe ocurrir de forma síncrona dentro del clic para que el navegador no lo bloquee como popup.
  const tab = window.open("", "_blank");
  if (!tab) throw new Error("El navegador bloqueó la nueva pestaña. Permite las ventanas emergentes para Betel.");
  try {
    const blob = await apiGetBlob(`/v1/invoices/${invoiceId}/pdf`);
    const url = URL.createObjectURL(blob);
    tab.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab.close();
    throw error;
  }
}
