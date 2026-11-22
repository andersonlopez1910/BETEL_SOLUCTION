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
  sku: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform(value => value || undefined), // Código interno; vacío = se asigna el siguiente C-n
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres.").max(200),
  description: z.string().trim().max(1000).optional(),
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

// ─── Compras y gastos ─────────────────────────────────────────────────────────

/** Tipos de la lista "Documentos de compras y gastos". SUPPORT = documento soporte (no obligados a facturar). */
export const purchaseDocumentTypes = ["PURCHASE", "EXPENSE", "SUPPORT"] as const;

/** Compra o gasto con factura del proveedor. Totales los calcula el servidor. */
export const createPurchaseSchema = z
  .object({
    type: z.enum(["PURCHASE", "EXPENSE"]),
    supplierId: z.string().uuid(), // Party con isSupplier = true
    supplierInvoiceNumber: z.string().trim().min(1).max(40), // Número de la factura del proveedor
    issueDate: z.coerce.date(),
    paymentMethod: z.enum(["CASH", "CREDIT"]),
    dueDate: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).optional(),
    lines: z.array(invoiceLineSchema).min(1, "Agrega al menos un ítem."),
  })
  .refine(value => value.paymentMethod === "CASH" || !!value.dueDate, {
    message: "Indica la fecha de vencimiento de la compra a crédito.",
    path: ["dueDate"],
  });

/** Filtros de "Documentos de compras y gastos" (y de su descarga). */
export const purchaseQuerySchema = z
  .object({
    ...reportPeriod, // Fecha de elaboración
    type: z.enum(purchaseDocumentTypes).optional(), // Tipo de transacción
    supplier: optionalText, // Nombre o identificación del proveedor
    supplierInvoice: optionalText, // Número de factura del proveedor (contiene)
    page: pagination.page,
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(periodInOrder, periodMessage);

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type PurchaseQuery = z.infer<typeof purchaseQuerySchema>;

// ─── Registro de eventos de facturas electrónicas recibidas ───────────────────

/** Eventos que registra el comprador (Res. DIAN 000085 de 2022): 030, 032, 033 y 031. */
export const receivedInvoiceEventTypes = ["RECEIPT", "GOODS_RECEIPT", "ACCEPTANCE", "CLAIM"] as const;
/** Motivos de reclamo del anexo técnico DIAN. */
export const claimReasons = {
  "01": "Documento con inconsistencias",
  "02": "Mercancía no entregada totalmente",
  "03": "Mercancía no entregada parcialmente",
  "04": "Servicio no prestado",
} as const;

/** "Registrar nueva factura": datos de la factura del proveedor identificada por su CUFE. */
export const registerReceivedInvoiceSchema = z.object({
  cufe: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{96}$/, "El CUFE tiene 96 caracteres hexadecimales (0-9, a-f)."),
  supplierNit: z
    .string()
    .trim()
    .regex(/^\d{5,15}$/, "Escribe el NIT del proveedor sin dígito de verificación, solo números."),
  supplierName: z.string().trim().min(2, "Escribe el nombre del proveedor.").max(200),
  number: z.string().trim().min(1, "Escribe el número de la factura.").max(40),
  issueDate: z.coerce.date(),
  total: z.union([z.literal(""), z.coerce.number().positive()]).optional(),
});

/** Registrar un evento sobre una factura recibida. */
export const receivedInvoiceEventSchema = z
  .object({
    type: z.enum(receivedInvoiceEventTypes),
    // Persona que recibe: la DIAN la exige en el acuse (030) y en el recibo del bien (032).
    receiverName: z.string().trim().max(120).optional(),
    receiverDocument: z.string().trim().max(20).optional(),
    receiverRole: z.string().trim().max(80).optional(),
    claimReason: z.enum(Object.keys(claimReasons) as [keyof typeof claimReasons]).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .superRefine((value, context) => {
    if (value.type === "RECEIPT" || value.type === "GOODS_RECEIPT") {
      if (!value.receiverName || value.receiverName.length < 3)
        context.addIssue({ code: "custom", path: ["receiverName"], message: "Escribe el nombre de quien recibe." });
      if (!value.receiverDocument || !/^\d{5,15}$/.test(value.receiverDocument))
        context.addIssue({
          code: "custom",
          path: ["receiverDocument"],
          message: "Escribe el documento de quien recibe (solo números).",
        });
      if (!value.receiverRole)
        context.addIssue({ code: "custom", path: ["receiverRole"], message: "Escribe el cargo de quien recibe." });
    }
    if (value.type === "CLAIM" && !value.claimReason)
      context.addIssue({ code: "custom", path: ["claimReason"], message: "Elige el motivo del reclamo." });
  });

/** Pestañas "Eventos en proceso" y "Eventos finalizados" (lista paginada). */
export const receivedInvoiceQuerySchema = z
  .object({
    ...reportPeriod, // Fecha de registro
    status: z.enum(["processing", "finalized"]).default("processing"),
    cufe: optionalText,
    supplier: optionalText, // Nombre o NIT
    number: optionalText, // Comprobante (contiene)
    sort: z
      .enum(["createdAt", "cufe", "supplierNit", "number", "supplierName", "receiptAt", "goodsReceiptAt", "outcomeAt"])
      .default("createdAt"),
    direction: z.enum(["asc", "desc"]).default("desc"),
    page: pagination.page,
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  })
  .refine(periodInOrder, periodMessage);

export type RegisterReceivedInvoiceInput = z.infer<typeof registerReceivedInvoiceSchema>;
export type ReceivedInvoiceEventInput = z.infer<typeof receivedInvoiceEventSchema>;
export type ReceivedInvoiceQuery = z.infer<typeof receivedInvoiceQuerySchema>;

// ─── Proveedores (cuentas por pagar) y comprobantes de egreso ─────────────────

/** Pestaña "Proveedores": mismos filtros que la cartera de clientes, sobre cuentas por pagar. */
export const payablesQuerySchema = z.object({
  search: optionalText, // Nombre, nombre comercial o identificación
  balance: z.enum(portfolioBalanceFilters).default("ALL"), // Saldo de proveedor
  status: z.enum(["ACTIVE", "INACTIVE", "ALL"]).default("ACTIVE"), // Estado de proveedor
  page: pagination.page,
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

/** Comprobante de egreso: pago a un proveedor que abona a una o varias compras o gastos a crédito. */
export const createSupplierPaymentSchema = z
  .object({
    supplierId: z.string().uuid(),
    date: z.coerce.date(),
    method: z.enum(collectionMethods),
    reference: optionalText, // Número de transferencia o cheque
    notes: z.string().trim().max(500).optional(),
    applications: z
      .array(z.object({ purchaseDocumentId: z.string().uuid(), amount }))
      .min(1, "Abona al menos un documento."),
  })
  .refine(
    value => new Set(value.applications.map(item => item.purchaseDocumentId)).size === value.applications.length,
    { message: "Un documento aparece dos veces.", path: ["applications"] }
  );

export type PayablesQuery = z.infer<typeof payablesQuerySchema>;
export type CreateSupplierPaymentInput = z.infer<typeof createSupplierPaymentSchema>;

// ─── Soporte por legalizar (facturas de proveedores importadas desde XML) ─────

export const purchaseImportStatuses = ["PENDING", "LEGALIZED", "REJECTED"] as const;

/** "Importar nuevo documento": XML de la factura electrónica (UBL 2.1 o AttachedDocument). */
export const importPurchaseSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  xml: z.string().min(50, "El archivo está vacío.").max(2_000_000, "El XML supera 2 MB."),
  // Si es a crédito, registrar también la factura en "Registro de eventos" para enviar sus eventos DIAN.
  registerEvents: z.boolean().default(true),
});

/** Legalizar: convertir el soporte en compra o gasto (CG-n). */
export const legalizeImportSchema = z.object({
  type: z.enum(["PURCHASE", "EXPENSE"]),
  dueDate: z.coerce.date().optional(), // Solo si es a crédito y el XML no trae vencimiento
  notes: z.string().trim().max(2000).optional(),
});

/** Filtros de "Soporte por legalizar" (y de su descarga). */
export const purchaseImportQuerySchema = z
  .object({
    ...reportPeriod, // Fecha de elaboración de la factura
    search: optionalText, // Número, proveedor, NIT o CUFE
    status: z.enum(purchaseImportStatuses).optional(),
    page: pagination.page,
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine(periodInOrder, periodMessage);

export type PurchaseImportQuery = z.infer<typeof purchaseImportQuerySchema>;

// ─── Productos y servicios (Gestión de productos / servicios) ─────────────────

/** Filtros de la lista de productos y servicios (y de su descarga). */
export const productQuerySchema = z.object({
  search: optionalText, // Nombre, código o descripción
  kind: z.enum(["PRODUCT", "SERVICE"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ALL"]).default("ALL"),
  stock: z.enum(["NEGATIVE", "ZERO", "POSITIVE"]).optional(), // Solo productos (los servicios no manejan stock)
  page: pagination.page,
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

/** Activar o inactivar varios productos o servicios seleccionados. */
export const bulkProductActiveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Selecciona al menos uno.").max(500),
  active: z.boolean(),
});

/** Importar desde Excel o CSV: cada fila con los campos de productSchema (máx. 2.000 filas). */
export const importProductsSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, "El archivo no trae filas.")
    .max(2000, "Máximo 2.000 filas por archivo."),
});

/** Ver reportes › Productos más vendidos (período de las facturas). */
export const topProductsQuerySchema = z.object({ ...reportPeriod }).refine(periodInOrder, periodMessage);

export type ProductQuery = z.infer<typeof productQuerySchema>;

// ─── Documentos de productos / servicios (inventario) ─────────────────────────

export const inventoryDocumentTypes = ["INITIAL", "ADJUSTMENT"] as const;

const inventoryLineSchema = z.object({
  productId: z.string().uuid(),
  direction: z.enum(["IN", "OUT"]),
  quantity: z.coerce.number().positive("La cantidad debe ser mayor que cero."),
  unitCost: z.coerce
    .number()
    .nonnegative("El costo no puede ser negativo.")
    .refine(value => Math.round(value * 100) === value * 100, "El costo admite máximo dos decimales."),
});

/** Saldo inicial (solo entradas) o ajuste de inventario. Un producto aparece una sola vez por documento. */
export const createInventoryDocumentSchema = z
  .object({
    type: z.enum(inventoryDocumentTypes),
    date: z.coerce.date(),
    partyId: z.string().uuid().optional(),
    notes: z.string().trim().max(1000).optional(),
    lines: z.array(inventoryLineSchema).min(1, "Agrega al menos un producto.").max(2000),
  })
  .refine(value => new Set(value.lines.map(line => line.productId)).size === value.lines.length, {
    message: "Un producto aparece dos veces en el documento.",
    path: ["lines"],
  })
  .refine(value => value.type !== "INITIAL" || value.lines.every(line => line.direction === "IN"), {
    message: "El saldo inicial solo tiene entradas.",
    path: ["lines"],
  });

/** Importar un documento de inventario desde Excel o CSV (filas con Código, Cantidad, Costo y Movimiento). */
export const importInventoryDocumentSchema = z.object({
  type: z.enum(inventoryDocumentTypes),
  date: z.coerce.date(),
  notes: z.string().trim().max(1000).optional(),
  rows: z.array(z.record(z.string(), z.unknown())).min(1, "El archivo no trae filas.").max(2000, "Máximo 2.000 filas."),
});

/** Filtros de "Documentos de productos / servicios" (y de su descarga). */
export const inventoryDocumentQuerySchema = z
  .object({
    ...reportPeriod, // Fecha de elaboración
    search: optionalText, // Tercero (nombre o identificación) o comprobante
    type: z.enum(inventoryDocumentTypes).optional(),
    status: z.enum(["ACTIVE", "VOID"]).optional(),
    page: pagination.page,
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(periodInOrder, periodMessage);

export type CreateInventoryDocumentInput = z.infer<typeof createInventoryDocumentSchema>;
export type InventoryDocumentQuery = z.infer<typeof inventoryDocumentQuerySchema>;

// ─── Costeo mensual ───────────────────────────────────────────────────────────

/** Año consultado en Costeo mensual (por defecto, el actual). */
export const costingYearQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });

/** Mes a calcular o consultar: /v1/costing/:year/:month. */
export const costingMonthParamsSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

// ─── Cajas y bancos ───────────────────────────────────────────────────────────

/** Saldos de cajas y bancos a una fecha de corte (por defecto hoy). */
export const banksQuerySchema = z.object({ to: z.coerce.date().optional() });

/** Movimientos (auxiliar) de una cuenta de caja o banco en un período. */
export const bankMovementsQuerySchema = z
  .object({
    ...reportPeriod,
    page: pagination.page,
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(periodInOrder, periodMessage);

export type BankMovementsQuery = z.infer<typeof bankMovementsQuerySchema>;

// ─── Nómina ───────────────────────────────────────────────────────────────────

const percent = z.coerce.number().min(0, "No puede ser negativo.").max(100, "Máximo 100 %.");
const nonNegativeMoney = z.coerce
  .number()
  .nonnegative("No puede ser negativo.")
  .refine(value => Math.round(value * 100) === value * 100, "Máximo dos decimales.");

/** Parámetros legales de un año (Nómina › Parámetros). */
export const payrollSettingsSchema = z.object({
  minimumWage: nonNegativeMoney.refine(value => value > 0, "Indica el salario mínimo."),
  transportAllowance: nonNegativeMoney,
  monthlyHours: z.coerce.number().int().min(100).max(260),
  overtimeDayPct: percent,
  overtimeNightPct: percent,
  nightSurchargePct: percent,
  holidaySurchargePct: percent,
  healthEmployeePct: percent,
  pensionEmployeePct: percent,
  healthEmployerPct: percent,
  pensionEmployerPct: percent,
  compensationFundPct: percent,
  icbfPct: percent,
  senaPct: percent,
  exempt: z.boolean(),
  confirmed: z.boolean(),
});

/** Empleado (crear o editar). */
export const employeeSchema = z
  .object({
    identificationType: z.enum(["CC", "CE", "PA", "PPT", "TI"]),
    identificationNumber: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z]{4,20}$/, "Identificación inválida."),
    firstName: z.string().trim().min(2, "Escribe los nombres.").max(80),
    lastName: z.string().trim().min(2, "Escribe los apellidos.").max(80),
    email: z
      .string()
      .trim()
      .email("Correo inválido.")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    phone: optionalText,
    position: z.string().trim().min(2, "Escribe el cargo.").max(80),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    contractType: z.enum(["INDEFINITE", "FIXED", "WORK"]),
    salaryType: z.enum(["ORDINARY", "INTEGRAL"]).default("ORDINARY"),
    salary: nonNegativeMoney.refine(value => value > 0, "Indica el salario."),
    frequency: z.enum(["BIWEEKLY", "MONTHLY"]).default("MONTHLY"),
    riskClass: z.coerce.number().int().min(1).max(5).default(1),
    healthFund: z.string().trim().min(2, "Indica la EPS.").max(80),
    pensionFund: z.string().trim().min(2, "Indica el fondo de pensiones.").max(80),
    severanceFund: optionalText,
    bankName: optionalText,
    bankAccount: optionalText,
  })
  .refine(value => !value.endDate || value.endDate >= value.startDate, {
    message: "La fecha de retiro no puede ser anterior al ingreso.",
    path: ["endDate"],
  });

/** Nueva liquidación: frecuencia y período (quincena 1–15 / 16–fin de mes, o mes completo). */
export const createPayrollRunSchema = z.object({
  frequency: z.enum(["BIWEEKLY", "MONTHLY"]),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  half: z.coerce.number().int().min(1).max(2).optional(), // Quincena 1 o 2 (solo quincenal)
});

const hours = z.coerce.number().min(0).max(300);
/** Novedades de un empleado en una liquidación en borrador. */
export const payrollItemSchema = z.object({
  days: z.coerce.number().int().min(0).max(30),
  overtimeDay: hours.default(0),
  overtimeNight: hours.default(0),
  nightHours: hours.default(0),
  holidayHours: hours.default(0),
  salaryBonus: nonNegativeMoney.default(0),
  nonSalaryBonus: nonNegativeMoney.default(0),
  withholding: nonNegativeMoney.default(0),
  otherDeductions: nonNegativeMoney.default(0),
  notes: z.string().trim().max(300).optional(),
});

/** Pagar una liquidación aprobada. */
export const payPayrollSchema = z.object({
  date: z.coerce.date(),
  method: z.enum(["CASH", "BANK_TRANSFER", "CHECK", "OTHER"]),
});

export type PayrollSettingsInput = z.infer<typeof payrollSettingsSchema>;
export type EmployeeInput = z.infer<typeof employeeSchema>;
export type PayrollItemInput = z.infer<typeof payrollItemSchema>;

// ─── Seguimiento comercial ────────────────────────────────────────────────────

export const commitmentTypes = ["CALL", "MEETING", "VISIT", "EMAIL", "SEND_QUOTE", "FOLLOW_UP", "OTHER"] as const;
export const salesStages = ["PROSPECT", "CONTACTED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;
export const negotiationProgress = ["NONE", "INITIAL", "INTERMEDIATE", "ADVANCED", "CLOSED"] as const;
export const leadOrigins = ["REFERRAL", "WEBSITE", "SOCIAL", "CALL", "EVENT", "CUSTOMER", "OTHER"] as const;
export const companySizes = ["MICRO", "SMALL", "MEDIUM", "LARGE"] as const;
/** Rangos del filtro "Probabilidad de cierre". */
export const probabilityRanges = ["0-25", "26-50", "51-75", "76-100"] as const;

const optionalDate = z
  .union([z.literal(""), z.coerce.date()])
  .optional()
  .transform(value => (value === "" ? undefined : value));

/** Datos de una tarea comercial (crear y editar). */
export const commercialTaskSchema = z.object({
  partyId: z.string().uuid(), // Contacto (tercero)
  description: z.string().trim().min(3).max(1000),
  commitment: z.enum(commitmentTypes),
  dueDate: optionalDate, // Fecha de compromiso
  responsibleId: z.string().uuid(),
  stage: z.enum(salesStages).default("PROSPECT"),
  progress: z.enum(negotiationProgress).default("NONE"),
  probability: z.coerce.number().int().min(0).max(100).default(0),
  expectedValue: z
    .union([z.literal(""), z.coerce.number().nonnegative()])
    .optional()
    .transform(value => (value === "" ? undefined : value)),
  origin: z.enum(leadOrigins).optional(),
  companyType: z.enum(companySizes).optional(),
});

/** Completar una tarea: el resultado queda registrado. */
export const completeCommercialTaskSchema = z.object({ result: z.string().trim().min(3).max(1000) });

const uuidList = z
  .string()
  .optional()
  .transform(value => (value ? value.split(",").filter(Boolean) : undefined))
  .pipe(z.array(z.string().uuid()).optional());

/** Criterios de búsqueda de Seguimiento comercial (y de su exportación). */
export const commercialTaskQuerySchema = z
  .object({
    status: z.enum(["PENDING", "COMPLETED", "ALL"]).default("PENDING"),
    createdFrom: optionalDate,
    createdTo: optionalDate,
    updatedFrom: optionalDate,
    updatedTo: optionalDate,
    dueFrom: optionalDate,
    dueTo: optionalDate,
    responsibleIds: uuidList, // Usuarios responsables (varios, separados por coma)
    createdById: z.string().uuid().optional(),
    description: optionalText,
    allContacts: z.enum(["true", "false"]).default("false"), // false: solo contactos activos
    progress: z.enum(negotiationProgress).optional(),
    stage: z.enum(salesStages).optional(),
    probability: z.enum(probabilityRanges).optional(),
    minExpectedValue: z.coerce.number().nonnegative().optional(),
    commitment: z.enum(commitmentTypes).optional(),
    origin: z.enum(leadOrigins).optional(),
    companyType: z.enum(companySizes).optional(),
    page: pagination.page,
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(value => !value.createdFrom || !value.createdTo || value.createdFrom <= value.createdTo, {
    message: "La fecha de creación inicial no puede ser posterior a la final.",
    path: ["createdTo"],
  })
  .refine(value => !value.dueFrom || !value.dueTo || value.dueFrom <= value.dueTo, {
    message: "La fecha de compromiso inicial no puede ser posterior a la final.",
    path: ["dueTo"],
  });

export type CommercialTaskInput = z.infer<typeof commercialTaskSchema>;
export type CommercialTaskQuery = z.infer<typeof commercialTaskQuerySchema>;
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
