/**
 * Contratos compartidos (@betel/contracts).
 *
 * Esquemas Zod que validan los datos que entran a la API. Se comparten entre `apps/api` y
 * `apps/web` para que el formulario y el servidor apliquen exactamente las mismas reglas.
 *
 * Si agregas un campo:
 *   1. Agrégalo aquí.
 *   2. Agrégalo al modelo correspondiente en packages/db/prisma/schema.prisma (+ migración).
 *   3. Actualiza el formulario en apps/web.
 *
 * Nota: `z.coerce.number()` convierte textos de formularios ("1500") a número.
 */
import { z } from "zod";

/** Tipos de documento de identificación en Colombia: CC, CE, NIT, Pasaporte, TI, PPT. */
export const colombianIdentificationTypes = ["CC", "CE", "NIT", "PA", "TI", "PPT"] as const;

/** Tercero: cliente, proveedor y/o pagador. Una misma persona puede tener varios roles. */
export const partySchema = z.object({
  kind: z.enum(["PERSON", "COMPANY"]), // Persona natural o jurídica
  identificationType: z.enum(colombianIdentificationTypes),
  identificationNumber: z.string().min(3).max(30),
  verificationDigit: z.string().max(1).optional(), // Dígito de verificación (DV) del NIT
  legalName: z.string().min(2).max(200), // Razón social o nombre completo
  tradeName: z.string().max(200).optional(), // Nombre comercial
  email: z.string().email().optional(), // Correo para envío de factura electrónica
  phone: z.string().max(30).optional(),
  municipalityCode: z.string().max(10).optional(), // Código DANE del municipio
  postalCode: z
    .string()
    .regex(/^\d{6}$/, "El código postal debe tener seis dígitos.")
    .optional(),
  address: z.string().max(250).optional(),
  taxResponsibilities: z.array(z.string()).default([]), // Responsabilidades fiscales del RUT (p. ej. "O-13")
  isCustomer: z.boolean().default(true),
  isSupplier: z.boolean().default(false),
  isPayer: z.boolean().default(false),
});

/** Línea de factura. Tasas en porcentaje (19 = 19 %). IVA por defecto 19 %. */
export const invoiceLineSchema = z.object({
  productId: z.string().uuid().optional(), // Opcional: se puede facturar sin producto del catálogo
  description: z.string().min(1).max(500),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  discountRate: z.coerce.number().min(0).max(100).default(0),
  taxRate: z.coerce.number().min(0).max(100).default(19),
});

/** Factura de venta (se crea en borrador; la emisión DIAN es un paso aparte). */
export const createInvoiceSchema = z.object({
  customerId: z.string().uuid(), // Party con isCustomer = true
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date().optional(), // Requerido en la práctica cuando paymentMethod = CREDIT
  paymentMethod: z.enum(["CASH", "CREDIT"]),
  notes: z.string().max(2000).optional(),
  lines: z.array(invoiceLineSchema).min(1),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type PartyInput = z.infer<typeof partySchema>;

/** Producto o servicio del catálogo de la organización. */
export const productSchema = z.object({
  sku: z.string().max(80).optional(), // Código interno
  name: z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
  kind: z.enum(["PRODUCT", "SERVICE"]).default("PRODUCT"),
  unit: z.string().min(1).max(10).default("UND"), // Unidad de medida
  unitPrice: z.coerce.number().nonnegative(),
  taxRate: z.coerce.number().min(0).max(100).default(19),
});

/**
 * Documento soporte: compras a personas NO obligadas a facturar.
 * IVA por defecto 0 % porque normalmente esos proveedores no lo cobran.
 */
export const createSupportDocumentSchema = z.object({
  supplierId: z.string().uuid(), // Party con isSupplier = true
  issueDate: z.coerce.date(),
  lines: z
    .array(
      z.object({
        description: z.string().min(1).max(500),
        quantity: z.coerce.number().positive(),
        unitPrice: z.coerce.number().nonnegative(),
        taxRate: z.coerce.number().min(0).max(100).default(0),
      })
    )
    .min(1),
});

/** Evento del calendario (tareas, reuniones y vencimientos tributarios). */
export const calendarEventSchema = z
  .object({
    title: z.string().min(2).max(160),
    description: z.string().max(1000).optional(),
    eventType: z.enum(["TASK", "MEETING", "DEADLINE", "DIAN_DUE_DATE"]),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    allDay: z.boolean().default(false),
    recurrenceRule: z.string().max(200).optional(), // Formato RRULE (iCalendar), p. ej. "FREQ=MONTHLY"
    reminderAt: z.coerce.date().optional(),
  })
  .refine(value => value.endsAt >= value.startsAt, {
    message: "La fecha de finalización debe ser posterior al inicio.",
    path: ["endsAt"],
  });
