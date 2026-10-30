/**
 * Puerto DIAN (patrón "puerto y adaptador").
 *
 * La API nunca habla directamente con la DIAN: llama a la interfaz `DianProvider`. Así, para pasar
 * a producción solo hay que crear una nueva clase (p. ej. `ProveedorXDianProvider`) que implemente
 * la interfaz y devolverla en `getDianProvider()`, sin tocar las rutas.
 *
 * Seguridad: ninguna clave, certificado o PIN llega al navegador ni se persiste en tablas de negocio.
 * Deben leerse desde un gestor de secretos dentro del adaptador real.
 */

/** Resultado de enviar un documento al proveedor tecnológico. */
export type DianSubmission = {
  accepted: boolean;
  status: "QUEUED" | "SENT" | "ACCEPTED" | "REJECTED";
  /** Respuesta cruda del proveedor; se guarda en ElectronicEvent para trazabilidad. */
  providerResponse: Record<string, unknown>;
};

/** Contrato que debe cumplir cualquier proveedor DIAN (sandbox o real). */
export interface DianProvider {
  submitSalesInvoice(input: { invoiceId: string; organizationId: string }): Promise<DianSubmission>;
}

/**
 * Adaptador de pruebas: NO transmite nada. Deja la factura en estado QUEUED.
 * Es el único disponible en esta versión.
 */
class SandboxDianProvider implements DianProvider {
  async submitSalesInvoice(input: { invoiceId: string; organizationId: string }): Promise<DianSubmission> {
    return {
      accepted: false,
      status: "QUEUED",
      providerResponse: {
        mode: "sandbox",
        invoiceId: input.invoiceId,
        queuedAt: new Date().toISOString(),
        message: "Pendiente de proveedor tecnológico y credenciales de habilitación.",
      },
    };
  }
}

/**
 * Devuelve el proveedor según la variable de entorno `DIAN_MODE` (por defecto "sandbox").
 * Cualquier otro valor falla a propósito hasta que exista un adaptador real, para evitar
 * creer que se está facturando ante la DIAN cuando no es así.
 */
export function getDianProvider(): DianProvider {
  if (process.env.DIAN_MODE && process.env.DIAN_MODE !== "sandbox")
    throw new Error("No hay proveedor DIAN de producción configurado.");
  return new SandboxDianProvider();
}
