/**
 * Impresión de una factura emitida: tirilla POS (80 o 58 mm) o tamaño carta. La web arma el formato
 * (apps/web/components/invoice-print.tsx); aquí se entregan los datos y el texto del código QR.
 *
 * GET /v1/invoices/:id/print-data — cualquier usuario de la empresa (igual que el PDF). 409 si es un borrador.
 *
 * QR: campos de la representación gráfica de la factura electrónica (Anexo técnico DIAN): número, fecha y hora,
 * NIT del facturador y del adquiriente, valor, IVA, otros impuestos, total, CUFE y la URL de consulta en la DIAN.
 * Sin CUFE (ambiente de pruebas) el QR lleva los datos sin la URL de consulta.
 */
import type { FastifyInstance } from "fastify";
import { withOrganizationScope } from "@betel/db";
import { requireActor } from "./auth.js";
import { FINAL_CONSUMER_ID, posResolutionText } from "./pos.js";

const DIAN_QR_URL = "https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=";
const fixed = (value: { toFixed: (digits: number) => string }) => value.toFixed(2);

export function invoiceQrText(data: {
  number: string;
  issuedAt: Date;
  sellerNit: string;
  buyerId: string;
  base: string;
  vat: string;
  otherTaxes: string;
  total: string;
  cufe: string | null;
}) {
  const bogota = new Date(data.issuedAt.getTime() - 5 * 3_600_000).toISOString();
  return [
    `NumFac: ${data.number}`,
    `FecFac: ${bogota.slice(0, 10)}`,
    `HorFac: ${bogota.slice(11, 19)}-05:00`,
    `NitFac: ${data.sellerNit}`,
    `DocAdq: ${data.buyerId}`,
    `ValFac: ${data.base}`,
    `ValIva: ${data.vat}`,
    `ValOtroIm: ${data.otherTaxes}`,
    `ValTolFac: ${data.total}`,
    `CUFE: ${data.cufe ?? "Pendiente (ambiente de pruebas)"}`,
    ...(data.cufe ? [`QRCode: ${DIAN_QR_URL}${data.cufe}`] : []),
  ].join("\n");
}

export function registerInvoicePrintRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    "/v1/invoices/:id/print-data",
    { preHandler: requireActor },
    async (request, reply) => {
      const result = await withOrganizationScope(request.actor!.organizationId, async tx => {
        const invoice = await tx.invoice.findFirst({
          where: { id: request.params.id },
          include: {
            organization: true,
            customer: true,
            lines: true, // En el orden en que se registraron (igual que el PDF).
          },
        });
        if (!invoice) return null;
        const created = await tx.auditLog.findFirst({
          where: { entity: "Invoice", entityId: invoice.id, action: "CREATE_DRAFT" },
          select: { user: { select: { displayName: true } } },
        });
        const issued = await tx.auditLog.findFirst({
          where: { entity: "Invoice", entityId: invoice.id, action: "ISSUE" },
          select: { createdAt: true },
        });
        return {
          invoice,
          seller: created?.user?.displayName ?? null,
          issuedAt: issued?.createdAt ?? invoice.updatedAt,
        };
      });
      if (!result) return reply.code(404).send({ error: "Factura no encontrada en esta empresa." });
      const { invoice, seller, issuedAt } = result;
      if (invoice.status === "DRAFT")
        return reply.code(409).send({ error: "La factura está en borrador: se imprime después de enviarla." });
      const organization = invoice.organization;
      const number = `${invoice.prefix ?? ""}${invoice.number ?? ""}` || "Sin numerar";
      const base = invoice.total.minus(invoice.taxTotal).minus(invoice.incTotal);
      return {
        data: {
          organization: {
            legalName: organization.legalName,
            tradeName: organization.tradeName,
            nit: organization.nit,
            verificationDigit: organization.verificationDigit,
            address: [organization.address, organization.addressComplement].filter(Boolean).join(" "),
            phone: organization.phone ?? null,
            email: organization.electronicInvoiceEmail ?? organization.email,
            vatResponsibility: organization.vatResponsibility,
          // Régimen para la tirilla: banderas tributarias del perfil (Responsable de IVA o Régimen SIMPLE).
          regime: (() => {
            const flags = (organization.taxFlags ?? {}) as Record<string, unknown>;
            if (flags.simpleRegime === true) return "Régimen SIMPLE";
            if (flags.vatResponsible === true) return "Responsable de IVA";
            return organization.vatResponsibility || null;
          })(),
          municipalityCode: organization.municipalityCode,
          whatsapp: organization.whatsapp,
          receiptFooter: organization.receiptFooter,
          // Resolución DIAN de la numeración POS (solo documento equivalente POS).
          posResolutionText: invoice.documentType === "POS" ? posResolutionText(organization) : null,
            logoData: organization.logoData,
          },
          customer: {
            legalName: invoice.customer.legalName,
          finalConsumer: invoice.customer.identificationNumber === FINAL_CONSUMER_ID,
            identificationType: invoice.customer.identificationType,
            identificationNumber: invoice.customer.identificationNumber,
            verificationDigit: invoice.customer.verificationDigit,
            address: invoice.customer.address,
            phone: invoice.customer.phone,
            email: invoice.customer.email,
          },
          invoice: {
            id: invoice.id,
            number,
            documentType: invoice.documentType,
          orderReference: invoice.orderReference,
            status: invoice.status,
            dianStatus: invoice.dianStatus,
            cufe: invoice.cufe,
            issueDate: invoice.issueDate.toISOString().slice(0, 10),
            issuedAt: issuedAt.toISOString(),
            dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
            paymentTerm: invoice.paymentTerm,
            paymentMethodCode: invoice.paymentMethodCode,
            notes: invoice.notes,
            seller,
            subtotal: fixed(invoice.subtotal),
            discountTotal: fixed(invoice.discountTotal),
            taxTotal: fixed(invoice.taxTotal),
            incTotal: fixed(invoice.incTotal),
            withholdingTotal: fixed(invoice.withholdingTotal),
            total: fixed(invoice.total),
            aiu: invoice.aiuModel
              ? {
                  model: invoice.aiuModel,
                  administrationRate: invoice.aiuAdministrationRate?.toFixed(2) ?? "0.00",
                  contingencyRate: invoice.aiuContingencyRate?.toFixed(2) ?? "0.00",
                  profitRate: invoice.aiuProfitRate?.toFixed(2) ?? "0.00",
                  administration: fixed(invoice.aiuAdministration),
                  contingency: fixed(invoice.aiuContingency),
                  profit: fixed(invoice.aiuProfit),
                }
              : null,
          },
          lines: invoice.lines.map(line => ({
            code: line.internalCode,
            description: line.description,
            unit: line.unitName,
            quantity: line.quantity.toDecimalPlaces(4).toString(),
            unitPrice: fixed(line.unitPrice),
            discountAmount: fixed(line.discountAmount),
            taxRate: line.taxRate.toFixed(0),
            lineTotal: fixed(line.lineTotal),
            vatAmount: fixed(line.taxAmount),
            incRate: line.incRate.toFixed(0),
            incAmount: fixed(line.incAmount),
          })),
          qrText: invoiceQrText({
            number,
            issuedAt,
            sellerNit: organization.nit,
            buyerId: invoice.customer.identificationNumber,
            base: fixed(base),
            vat: fixed(invoice.taxTotal),
            otherTaxes: fixed(invoice.incTotal),
            total: fixed(invoice.total),
            cufe: invoice.cufe,
          }),
        },
      };
    }
  );
}
