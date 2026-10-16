/**
 * Puerto DIAN: el proveedor tecnológico real implementa esta interfaz.
 * Ninguna clave, certificado o PIN llega al navegador ni se persiste en tablas de negocio.
 */
export type DianSubmission = { accepted: boolean; status: "QUEUED" | "SENT" | "ACCEPTED" | "REJECTED"; providerResponse: Record<string, unknown> };

export interface DianProvider {
  submitSalesInvoice(input: { invoiceId: string; organizationId: string }): Promise<DianSubmission>;
}

class SandboxDianProvider implements DianProvider {
  async submitSalesInvoice(input: { invoiceId: string; organizationId: string }): Promise<DianSubmission> {
    return { accepted: false, status: "QUEUED", providerResponse: { mode: "sandbox", invoiceId: input.invoiceId, queuedAt: new Date().toISOString(), message: "Pendiente de proveedor tecnológico y credenciales de habilitación." } };
  }
}

export function getDianProvider(): DianProvider {
  if (process.env.DIAN_MODE && process.env.DIAN_MODE !== "sandbox") throw new Error("No hay proveedor DIAN de producción configurado.");
  return new SandboxDianProvider();
}
