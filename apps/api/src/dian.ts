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
  /** Evento de una factura electrónica recibida (030, 031, 032 o 033; Res. DIAN 000085 de 2022). */
  submitDocumentEvent(input: {
    eventId: string;
    organizationId: string;
    cufe: string;
    code: string;
  }): Promise<DianSubmission>;
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

  async submitDocumentEvent(input: {
    eventId: string;
    organizationId: string;
    cufe: string;
    code: string;
  }): Promise<DianSubmission> {
    return {
      accepted: false,
      status: "QUEUED",
      providerResponse: {
        mode: "sandbox",
        eventId: input.eventId,
        code: input.code,
        queuedAt: new Date().toISOString(),
        message: "Evento registrado en pruebas: no se transmite a la DIAN sin proveedor tecnológico.",
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

/** true mientras se use el proveedor de pruebas (DIAN_MODE vacío o "sandbox"). */
export const dianIsSandbox = () => !process.env.DIAN_MODE || process.env.DIAN_MODE === "sandbox";

/**
 * Una factura electrónica solo se entrega al cliente cuando la DIAN la aprobó. Con el proveedor de pruebas
 * (que nunca aprueba) se permite, para poder probar el envío. Devuelve el motivo si no se puede enviar.
 */
export function invoiceEmailBlocked(invoice: { status: string; dianStatus: string }) {
  if (invoice.status === "DRAFT") return "La factura está en borrador.";
  if (!dianIsSandbox() && invoice.dianStatus !== "ACCEPTED") return "La DIAN todavía no ha aprobado la factura.";
  return null;
}
