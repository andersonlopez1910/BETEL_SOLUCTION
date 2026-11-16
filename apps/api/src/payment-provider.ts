/**
 * Adaptador de pasarela de pagos (mismo patrón que src/dian.ts).
 *
 * Hoy solo existe el adaptador de PRUEBAS ("sandbox"): el link de pago abre la página /pago de Betel,
 * donde se simula la respuesta de la entidad (aprobado o rechazado), y la comisión usa una tarifa de
 * referencia. Ningún dinero se mueve. Para producción se agrega un adaptador real (Wompi, Mercado Pago,
 * PayU…) que cree el checkout en el proveedor y reciba su webhook; el resto del módulo no cambia.
 *
 * Variables: PAYMENT_PROVIDER (por defecto "sandbox"), WEB_ORIGIN (base del link de pago de pruebas).
 */
import { Prisma } from "@betel/db";

export type PaymentProvider = {
  /** Nombre guardado en OnlinePayment.provider. */
  name: string;
  /** "sandbox" = simulación sin dinero real. */
  mode: "sandbox" | "production";
  /** Comisión total que descuenta la pasarela (incluye IVA sobre la comisión). */
  fee(amount: Prisma.Decimal): Prisma.Decimal;
  /** URL que se envía al cliente para pagar. */
  checkoutUrl(token: string): string;
};

/** Tarifa de referencia del adaptador de pruebas: 2,99 % + $900 por transacción, más IVA 19 % sobre la comisión. */
export const SANDBOX_RATE = { percent: "0.0299", fixed: "900", vat: "0.19" } as const;

export function sandboxFee(amount: Prisma.Decimal) {
  const commission = amount.times(SANDBOX_RATE.percent).plus(SANDBOX_RATE.fixed);
  return commission.times(new Prisma.Decimal(1).plus(SANDBOX_RATE.vat)).toDecimalPlaces(2);
}

const sandbox: PaymentProvider = {
  name: "sandbox",
  mode: "sandbox",
  fee: sandboxFee,
  checkoutUrl: token => `${process.env.WEB_ORIGIN ?? "http://localhost:3000"}/pago?token=${encodeURIComponent(token)}`,
};

/**
 * Pasarela configurada. El adaptador de pruebas no se permite en producción: sin un proveedor real la
 * API responde 503 al generar links, en lugar de crear links que nadie puede pagar.
 */
export function getPaymentProvider(): PaymentProvider | null {
  const name = process.env.PAYMENT_PROVIDER ?? "sandbox";
  if (name === "sandbox" && process.env.NODE_ENV !== "production") return sandbox;
  return null; // PENDIENTE: adaptadores reales (ver docs/TAREAS.md).
}
