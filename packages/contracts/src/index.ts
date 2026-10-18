import { z } from "zod";

export const colombianIdentificationTypes = ["CC", "CE", "NIT", "PA", "TI", "PPT"] as const;
export const partySchema = z.object({
  kind: z.enum(["PERSON", "COMPANY"]),
  identificationType: z.enum(colombianIdentificationTypes),
  identificationNumber: z.string().min(3).max(30),
  verificationDigit: z.string().max(1).optional(),
  legalName: z.string().min(2).max(200),
  tradeName: z.string().max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  municipalityCode: z.string().max(10).optional(),
  postalCode: z.string().regex(/^\d{6}$/, "El código postal debe tener seis dígitos.").optional(),
  address: z.string().max(250).optional(),
  taxResponsibilities: z.array(z.string()).default([]),
  isCustomer: z.boolean().default(true),
  isSupplier: z.boolean().default(false),
  isPayer: z.boolean().default(false)
});

export const invoiceLineSchema = z.object({
  productId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  discountRate: z.coerce.number().min(0).max(100).default(0),
  taxRate: z.coerce.number().min(0).max(100).default(19)
});

export const createInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date().optional(),
  paymentMethod: z.enum(["CASH", "CREDIT"]),
  notes: z.string().max(2000).optional(),
  lines: z.array(invoiceLineSchema).min(1)
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type PartyInput = z.infer<typeof partySchema>;

export const productSchema = z.object({
  sku: z.string().max(80).optional(),
  name: z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
  kind: z.enum(["PRODUCT", "SERVICE"]).default("PRODUCT"),
  unit: z.string().min(1).max(10).default("UND"),
  unitPrice: z.coerce.number().nonnegative(),
  taxRate: z.coerce.number().min(0).max(100).default(19)
});

export const createSupportDocumentSchema = z.object({
  supplierId: z.string().uuid(),
  issueDate: z.coerce.date(),
  lines: z.array(z.object({ description: z.string().min(1).max(500), quantity: z.coerce.number().positive(), unitPrice: z.coerce.number().nonnegative(), taxRate: z.coerce.number().min(0).max(100).default(0) })).min(1)
});

export const calendarEventSchema = z.object({
  title: z.string().min(2).max(160),
  description: z.string().max(1000).optional(),
  eventType: z.enum(["TASK", "MEETING", "DEADLINE", "DIAN_DUE_DATE"]),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  allDay: z.boolean().default(false),
  recurrenceRule: z.string().max(200).optional(),
  reminderAt: z.coerce.date().optional()
}).refine(value => value.endsAt >= value.startsAt, { message: "La fecha de finalización debe ser posterior al inicio.", path: ["endsAt"] });
