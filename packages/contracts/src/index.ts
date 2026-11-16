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

// ─── Reporte de facturación ─────────────────────────────────────────────────
// Los filtros llegan como query string (?from=2026-11-01&status=ISSUED&page=2).
// El frontend omite los parámetros vacíos; aquí un texto vacío también se trata como "sin filtro".

/** Estados de factura (mismo orden que el enum InvoiceStatus de schema.prisma). */
export const invoiceStatuses = ["DRAFT", "ISSUED", "ACCEPTED", "REJECTED", "VOID", "OVERDUE"] as const;

const optionalText = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform(value => value || undefined);

const reportPeriod = {
  from: z.coerce.date().optional(), // Fecha inicial (inclusive), formato AAAA-MM-DD
  to: z.coerce.date().optional(), // Fecha final (inclusive)
};

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

const periodInOrder = (value: { from?: Date; to?: Date }) => !value.from || !value.to || value.from <= value.to;
const periodMessage = { message: "La fecha inicial no puede ser posterior a la final.", path: ["to"] };

/** Filtros de la pestaña Ventas (y de su exportación, que ignora la paginación). */
export const salesReportQuerySchema = z
  .object({
    ...reportPeriod,
    customer: optionalText, // Nombre o identificación del cliente (contiene)
    number: optionalText, // Prefijo o número de factura (contiene)
    status: z.enum(invoiceStatuses).optional(),
    userId: z.string().uuid().optional(), // Usuario que creó la factura
    ...pagination,
  })
  .refine(periodInOrder, periodMessage);

/** Filtros de la pestaña Clientes y del detalle de un cliente. */
export const customerReportQuerySchema = z
  .object({
    ...reportPeriod,
    search: optionalText, // Nombre, nombre comercial o identificación (contiene)
    ...pagination,
  })
  .refine(periodInOrder, periodMessage);

/**
 * Medios de pago que se registran a mano en un recibo de caja. El enum CollectionMethod de
 * schema.prisma tiene además ONLINE, que solo usan los pagos en línea aprobados por la pasarela.
 */
export const collectionMethods = ["CASH", "BANK_TRANSFER", "CARD", "CHECK", "OTHER"] as const;
/** Documentos que aparecen en Recaudos y que se pueden enviar por correo. */
export const collectionDocumentTypes = ["Invoice", "CashReceipt"] as const;

/** Filtros de la pestaña Recaudos (y de su exportación). */
export const collectionReportQuerySchema = z
  .object({
    ...reportPeriod,
    search: optionalText, // Nombre o identificación del cliente (contiene)
    documentType: z.enum(collectionDocumentTypes).optional(), // Solo facturas de contado o solo recibos
    method: z.enum(collectionMethods).optional(), // Medio de pago (solo aplica a recibos de caja)
    email: z.enum(["SENT", "UNSENT"]).optional(), // Estado del correo
    ...pagination,
  })
  .refine(periodInOrder, periodMessage);

/** Valor con máximo 2 decimales (centavos). */
const amount = z.coerce
  .number()
  .positive("El valor debe ser mayor que cero.")
  .refine(value => Math.round(value * 100) === value * 100, "Máximo dos decimales.");

/**
 * Recibo de caja: dinero recibido de un cliente que abona a una o varias de sus facturas a crédito.
 * El total del recibo es la suma de los valores aplicados (lo calcula el servidor).
 */
export const createCashReceiptSchema = z
  .object({
    customerId: z.string().uuid(),
    date: z.coerce.date(),
    method: z.enum(collectionMethods),
    reference: optionalText, // Número de transferencia, voucher o cheque
    notes: z.string().trim().max(500).optional(),
    applications: z.array(z.object({ invoiceId: z.string().uuid(), amount })).min(1, "Abone al menos una factura."),
  })
  .refine(value => new Set(value.applications.map(item => item.invoiceId)).size === value.applications.length, {
    message: "Una factura aparece dos veces.",
    path: ["applications"],
  });

/** Anulación de un recibo de caja: el motivo queda en el recibo y en la auditoría. */
export const voidCashReceiptSchema = z.object({ reason: z.string().trim().min(3).max(300) });

/** Envío de un documento por correo. Sin `to` se usa el correo del cliente. */
export const sendDocumentEmailSchema = z.object({
  documentType: z.enum(collectionDocumentTypes),
  documentId: z.string().uuid(),
  to: z.string().trim().email("Correo inválido.").optional(),
});

/** Documento a consultar (Ver documento): GET /v1/collections/document?type=CashReceipt&id=… */
export const collectionDocumentQuerySchema = z.object({
  type: z.enum(collectionDocumentTypes),
  id: z.string().uuid(),
});

// ─── Gestión de cobro cartera Betel (pagos en línea) ─────────────────────────

export const onlinePaymentStatuses = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export const disbursementStatuses = ["PENDING", "DISBURSED"] as const;
/** Medios con los que el cliente paga en la pasarela. */
export const onlinePaymentMethods = ["CARD", "PSE", "NEQUI"] as const;

/** Filtros de la pestaña Gestión de cobro (y de su exportación). */
export const onlinePaymentQuerySchema = z
  .object({
    ...reportPeriod, // Fecha de creación del link
    search: optionalText, // Nombre o identificación del cliente
    status: z.enum(onlinePaymentStatuses).optional(),
    disbursement: z.enum(disbursementStatuses).optional(),
    page: pagination.page,
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(periodInOrder, periodMessage);

/** Generar un link de pago para una factura a crédito con saldo. Sin `amount` se cobra todo el saldo. */
export const createPaymentLinkSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: amount.optional(),
});

/** Resultado que informa la pasarela de PRUEBAS (en producción llega por el webhook del proveedor). */
export const sandboxPaymentResultSchema = z.object({
  result: z.enum(["APPROVED", "REJECTED"]),
  method: z.enum(onlinePaymentMethods),
});

// ─── Cotizaciones ─────────────────────────────────────────────────────────────

/** Estados visibles de una cotización. EXPIRED = abierta con validez vencida (se calcula, no se guarda). */
export const quoteStatuses = ["OPEN", "EXPIRED", "INVOICED", "VOID"] as const;

/** Cotización: mismas líneas que la factura. Se guarda abierta; no genera contabilidad. */
export const createQuoteSchema = z
  .object({
    customerId: z.string().uuid(), // Party con isCustomer = true
    issueDate: z.coerce.date(), // Fecha de elaboración
    validUntil: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).optional(),
    lines: z.array(invoiceLineSchema).min(1, "Agrega al menos un ítem."),
  })
  .refine(value => !value.validUntil || value.validUntil >= value.issueDate, {
    message: "La validez no puede ser anterior a la fecha de elaboración.",
    path: ["validUntil"],
  });

/** Filtros de la pestaña Cotizaciones (y de su descarga). */
export const quoteQuerySchema = z
  .object({
    ...reportPeriod, // Fecha de elaboración
    userId: z.string().uuid().optional(), // Usuario que elaboró la cotización
    customer: optionalText, // Nombre o identificación del cliente
    status: z.enum(quoteStatuses).optional(),
    page: pagination.page,
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(periodInOrder, periodMessage);

/** Convertir una cotización abierta en factura en borrador. */
export const convertQuoteSchema = z
  .object({
    paymentMethod: z.enum(["CASH", "CREDIT"]),
    issueDate: z.coerce.date(),
    dueDate: z.coerce.date().optional(),
  })
  .refine(value => value.paymentMethod === "CASH" || !!value.dueDate, {
    message: "Indica la fecha de vencimiento de la factura a crédito.",
    path: ["dueDate"],
  });

// ─── Remisiones ───────────────────────────────────────────────────────────────

/** Tipo de transacción de una remisión (mismo orden que el enum DeliveryType de schema.prisma). */
export const deliveryTypes = ["SALE", "CONSIGNMENT", "SAMPLE"] as const;
export const deliveryStatuses = ["OPEN", "INVOICED", "VOID"] as const;

/** Remisión: mercancía entregada al cliente. Mismas líneas que la factura; no genera contabilidad. */
export const createDeliverySchema = z.object({
  customerId: z.string().uuid(),
  issueDate: z.coerce.date(), // Fecha de elaboración
  transactionType: z.enum(deliveryTypes).default("SALE"),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(invoiceLineSchema).min(1, "Agrega al menos un ítem."),
});

/** Filtros de la pestaña Remisiones (y de su descarga). */
export const deliveryQuerySchema = z
  .object({
    ...reportPeriod, // Fecha de elaboración
    customer: optionalText, // Nombre o identificación del cliente
    userId: z.string().uuid().optional(), // Usuario que elaboró la remisión
    transactionType: z.enum(deliveryTypes).optional(),
    status: z.enum(deliveryStatuses).optional(),
    email: z.enum(["SENT", "UNSENT"]).optional(), // Estado del envío de correo
    page: pagination.page,
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(periodInOrder, periodMessage);

/** Convertir una cotización o remisión abierta en factura en borrador (mismo esquema). */
export const convertToInvoiceSchema = convertQuoteSchema;

// ─── Facturas recurrentes ─────────────────────────────────────────────────────

/** Frecuencias (mismo orden que el enum RecurrenceFrequency de schema.prisma). */
export const recurrenceFrequencies = [
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "BIMONTHLY",
  "QUARTERLY",
  "SEMIANNUAL",
  "ANNUAL",
] as const;

/** Plantilla de factura recurrente. Sin `occurrences` se repite sin límite. */
export const createRecurringInvoiceSchema = z
  .object({
    customerId: z.string().uuid(),
    frequency: z.enum(recurrenceFrequencies),
    startDate: z.coerce.date(), // Fecha de la primera factura
    occurrences: z.coerce.number().int().min(1).max(360).optional(), // "Número de veces"
    paymentMethod: z.enum(["CASH", "CREDIT"]),
    dueDays: z.coerce.number().int().min(1).max(365).optional(), // Plazo de las facturas a crédito
    notes: z.string().trim().max(2000).optional(),
    lines: z.array(invoiceLineSchema).min(1, "Agrega al menos un ítem."),
  })
  .refine(value => value.paymentMethod === "CASH" || !!value.dueDays, {
    message: "Indica el plazo en días de las facturas a crédito.",
    path: ["dueDays"],
  });

/** Filtros de la pestaña Facturas recurrentes (y de su descarga). */
export const recurringInvoiceQuerySchema = z
  .object({
    ...reportPeriod, // Fecha de inicio
    frequency: z.enum(recurrenceFrequencies).optional(),
    active: z.enum(["true", "false"]).optional(),
    customer: optionalText,
    page: pagination.page,
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(periodInOrder, periodMessage);

export const toggleRecurringInvoiceSchema = z.object({ active: z.boolean() });

// ─── Impresión y envío masivo de comprobantes ────────────────────────────────

/** Comprobantes que se pueden imprimir y enviar en lote. */
export const massSendDocumentTypes = ["Invoice", "CashReceipt", "Quote", "Delivery"] as const;
/** Estado de envío a la DIAN. NOT_SENT = PENDING; NOT_APPLICABLE = documentos que no van a la DIAN. */
export const massSendDianStatuses = [
  "NOT_SENT",
  "QUEUED",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "ERROR",
  "NOT_APPLICABLE",
] as const;

/** Lista separada por comas en la query (?types=Invoice,Quote). Vacía = todos. */
const csvOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform(value => (value ? value.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).min(1).optional());

/** Filtros de "Impresión y envío masivo de comprobantes". */
export const massSendQuerySchema = z
  .object({
    ...reportPeriod, // Fecha de elaboración
    customer: optionalText,
    types: csvOf(massSendDocumentTypes),
    dian: csvOf(massSendDianStatuses),
    email: z.enum(["SENT", "UNSENT"]).optional(),
    page: pagination.page,
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  })
  .refine(periodInOrder, periodMessage);

// ─── Clientes (cartera) ───────────────────────────────────────────────────────

/** Filtro "Saldo de cartera". */
export const portfolioBalanceFilters = ["ALL", "WITH_BALANCE", "OVERDUE", "NO_BALANCE"] as const;

/** Filtros de la pestaña Clientes (cartera por cliente) y de su descarga. */
export const portfolioQuerySchema = z.object({
  search: optionalText, // Nombre, nombre comercial o identificación
  balance: z.enum(portfolioBalanceFilters).default("ALL"),
  status: z.enum(["ACTIVE", "INACTIVE", "ALL"]).default("ACTIVE"), // Estado del cliente
  page: pagination.page,
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const toggleCustomerSchema = z.object({ active: z.boolean() });

export type PortfolioQuery = z.infer<typeof portfolioQuerySchema>;
export type MassSendQuery = z.infer<typeof massSendQuerySchema>;
export type CreateRecurringInvoiceInput = z.infer<typeof createRecurringInvoiceSchema>;
export type RecurringInvoiceQuery = z.infer<typeof recurringInvoiceQuerySchema>;
export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;
export type DeliveryQuery = z.infer<typeof deliveryQuerySchema>;
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export type QuoteQuery = z.infer<typeof quoteQuerySchema>;
export type OnlinePaymentQuery = z.infer<typeof onlinePaymentQuerySchema>;
export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;
export type CustomerReportQuery = z.infer<typeof customerReportQuerySchema>;
export type CollectionReportQuery = z.infer<typeof collectionReportQuerySchema>;
export type CreateCashReceiptInput = z.infer<typeof createCashReceiptSchema>;

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
