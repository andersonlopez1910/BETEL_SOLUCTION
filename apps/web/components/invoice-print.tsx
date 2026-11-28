/**
 * Impresión de una factura emitida, a elección después de la venta:
 *   - Factura POS: tirilla para impresora térmica de 80 mm o 58 mm.
 *   - Factura electrónica: hoja tamaño carta (8,5 × 11 pulgadas).
 * Ambas son representaciones impresas de la MISMA factura electrónica (mismo número, CUFE y QR); no es el
 * «documento equivalente POS electrónico» de la DIAN, que tiene su propia resolución y numeración.
 * Datos: GET /v1/invoices/:id/print-data (apps/api/src/invoice-print.ts). El QR es real (qrcode-generator) y lleva
 * los campos de la representación gráfica de la DIAN.
 */
"use client";

import qrcode from "qrcode-generator";
import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { Modal } from "./collection-dialogs";

type PrintData = {
  organization: {
    legalName: string;
    tradeName: string | null;
    nit: string;
    verificationDigit: string | null;
    address: string;
    phone: string | null;
    email: string | null;
    vatResponsibility: string | null;
    logoData: string | null;
    regime?: string | null;
    municipalityCode?: string | null;
    /** Nombre del municipio (catálogo DANE), se completa en el navegador. */
    cityName?: string | null;
    whatsapp?: string | null;
    receiptFooter?: string | null;
    posResolutionText?: string | null;
  };
  customer: {
    legalName: string;
    identificationType: string;
    identificationNumber: string;
    verificationDigit: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    finalConsumer?: boolean;
  };
  invoice: {
    number: string;
    documentType?: "FE" | "POS";
    orderReference?: string | null;
    dianStatus: string;
    cufe: string | null;
    issueDate: string;
    issuedAt: string;
    dueDate: string | null;
    paymentTerm: "CASH" | "CREDIT";
    paymentMethodCode: string | null;
    notes: string | null;
    seller: string | null;
    subtotal: string;
    discountTotal: string;
    taxTotal: string;
    incTotal: string;
    withholdingTotal: string;
    total: string;
    aiu: {
      model: string;
      administrationRate: string;
      contingencyRate: string;
      profitRate: string;
      administration: string;
      contingency: string;
      profit: string;
    } | null;
  };
  lines: {
    code: string | null;
    description: string;
    unit: string | null;
    quantity: string;
    unitPrice: string;
    discountAmount: string;
    taxRate: string;
    lineTotal: string;
    vatAmount?: string;
    incRate?: string;
    incAmount?: string;
  }[];
  qrText: string;
};

export type PrintFormat = "POS" | "LETTER";
export type PaperWidth = "80" | "58";

const moneyFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 2 });
const money = (value: string | number) => moneyFormat.format(Number(value));
const qty = (value: string) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 }).format(Number(value));
const esc = (value: string | null | undefined) =>
  (value ?? "").replace(
    /[&<>"']/g,
    char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!
  );
const methods: Record<string, string> = {
  "10": "Efectivo",
  "42": "Transferencia bancaria",
  "48": "Tarjeta",
  "20": "Cheque",
};
const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso)
  );
const shortDate = (value: string) => value.split("-").reverse().join("/");
/** NIT o documento con puntos de miles y dígito de verificación: 900.000.000-0. */
const nit = (number: string, dv: string | null) => {
  const formatted = /^\d+$/.test(number) ? Number(number).toLocaleString("es-CO") : number;
  return dv ? `${formatted}-${dv}` : formatted;
};

function qrSvg(text: string, cellSize: number) {
  // UTF-8 para que tildes y ñ no dañen el código.
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"]!;
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  return qr.createSvgTag({ cellSize, margin: 0, scalable: true });
}

function paymentLabel(data: PrintData) {
  if (data.invoice.paymentTerm === "CREDIT")
    return `Crédito${data.invoice.dueDate ? ` · vence ${shortDate(data.invoice.dueDate)}` : ""}`;
  return `Contado · ${methods[data.invoice.paymentMethodCode ?? ""] ?? "Otro medio"}`;
}

function totalsRows(data: PrintData) {
  const rows: [string, string][] = [["Subtotal", money(data.invoice.subtotal)]];
  if (Number(data.invoice.discountTotal)) rows.push(["Descuentos", `−${money(data.invoice.discountTotal)}`]);
  const aiu = data.invoice.aiu;
  if (aiu) {
    const note = aiu.model === "INCLUDED" ? " (incluido)" : "";
    rows.push(
      [`Administración ${Number(aiu.administrationRate)}%${note}`, money(aiu.administration)],
      [`Imprevistos ${Number(aiu.contingencyRate)}%${note}`, money(aiu.contingency)],
      [`Utilidad ${Number(aiu.profitRate)}%${note}`, money(aiu.profit)]
    );
  }
  rows.push(["IVA", money(data.invoice.taxTotal)]);
  if (Number(data.invoice.incTotal)) rows.push(["INC", money(data.invoice.incTotal)]);
  return rows;
}

const lineTaxes = (line: PrintData["lines"][number]) => Number(line.vatAmount ?? 0) + Number(line.incAmount ?? 0);
const paymentMethodName = (data: PrintData) =>
  data.invoice.paymentTerm === "CREDIT" ? "Crédito" : (methods[data.invoice.paymentMethodCode ?? ""] ?? "Otro medio");

/** Pesos enteros para la tirilla: $94.000, $87.037. */
const peso = (value: string | number) => {
  const amount = Number(value);
  // Pesos enteros, como en las tirillas en Colombia (los valores se guardan con centavos).
  return `${amount < 0 ? "−" : ""}$${Math.round(Math.abs(amount)).toLocaleString("es-CO")}`;
};
/** Iniciales para el círculo cuando la empresa no tiene logo: «Bistró La Esquina» → «BE». */
export function initials(name: string) {
  const skip = new Set(["la", "el", "los", "las", "de", "del", "y", "sas", "s.a.s.", "s.a.s", "ltda", "sa", "s.a."]);
  const words = name.split(/\s+/).filter(word => word && !skip.has(word.toLowerCase()));
  return words
    .slice(0, 2)
    .map(word => word[0]!.toUpperCase())
    .join("");
}
const phone10 = (value: string) => value.replace(/\D/g, "").replace(/^(\d{3})(\d{3})(\d{4})$/, "$1 $2 $3");

/**
 * Tirilla POS (80 o 58 mm): documento equivalente electrónico POS o factura electrónica en tirilla.
 * Encabezado con logo (o iniciales), nombre comercial, razón social, NIT y régimen, dirección y ciudad, teléfono y
 * WhatsApp; tipo y número del documento con la resolución DIAN; fecha, pedido y cliente; tabla Cant / Descripción /
 * Valor; subtotal, base gravable, impuestos por tarifa y total; forma de pago; mensaje y software.
 */
export function posReceiptHtml(data: PrintData, width: PaperWidth) {
  const { organization: org, customer, invoice } = data;
  const small = width === "58";
  const isPos = invoice.documentType === "POS";
  const name = org.tradeName || org.legalName;
  const subtotal = data.lines.reduce((sum, line) => sum + Number(line.lineTotal) + Number(line.discountAmount), 0);
  const base = data.lines.reduce((sum, line) => sum + (Number(line.lineTotal) - lineTaxes(line)), 0);
  // Impuestos agrupados por tipo y tarifa (IVA 19 %, IVA 5 %, INC 8 %…).
  const taxes = new Map<string, number>();
  for (const line of data.lines) {
    if (Number(line.vatAmount ?? 0))
      taxes.set(
        `IVA ${Number(line.taxRate)}%`,
        (taxes.get(`IVA ${Number(line.taxRate)}%`) ?? 0) + Number(line.vatAmount)
      );
    if (Number(line.incAmount ?? 0))
      taxes.set(
        `Impoconsumo (INC) ${Number(line.incRate)}%`,
        (taxes.get(`Impoconsumo (INC) ${Number(line.incRate)}%`) ?? 0) + Number(line.incAmount)
      );
  }
  const rows = data.lines
    .map(
      line =>
        `<tr><td class="qty">${qty(line.quantity)}</td><td>${esc(line.description)}${Number(line.discountAmount) ? `<small>Desc. −${peso(line.discountAmount)}</small>` : ""}</td><td class="num">${peso(Number(line.lineTotal) + Number(line.discountAmount))}</td></tr>`
    )
    .join("");
  const contact = [
    org.phone ? `Tel. ${esc(phone10(org.phone))}` : "",
    org.whatsapp ? `WhatsApp +57 ${esc(phone10(org.whatsapp))}` : "",
  ].filter(Boolean);
  const location = [org.address, org.cityName].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${isPos ? "POS" : "Factura"} ${esc(invoice.number)}</title><style>
@page { size: ${width}mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; width: ${width}mm; padding: 4mm ${small ? 2.5 : 4}mm 6mm; font: ${small ? 10 : 11.5}px/1.45 Arial, Helvetica, sans-serif; color: #111; }
.center { text-align: center; }
.logo { display: block; max-width: 55%; max-height: 24mm; margin: 0 auto 2.5mm; }
.badge { display: grid; place-items: center; width: ${small ? 17 : 20}mm; height: ${small ? 17 : 20}mm; margin: 0 auto 2.5mm; border-radius: 50%; background: #5b5b5b; color: #fff; font: 700 ${small ? 18 : 22}px Georgia, "Times New Roman", serif; letter-spacing: 1px; }
.brand { font-size: ${small ? 12.5 : 14.5}px; font-weight: 700; margin-bottom: 0.5mm; }
.line { margin: 0.4mm 0; }
hr { border: 0; border-top: 1px dashed #555; margin: 2.6mm 0; }
.doc { font-size: ${small ? 11 : 12.5}px; font-weight: 700; }
.number { font-size: ${small ? 13.5 : 16}px; font-weight: 700; }
.resolution { font-size: ${small ? 8.5 : 9.5}px; color: #333; }
.row { display: flex; justify-content: space-between; gap: 2mm; margin: 0.6mm 0; }
.row span:last-child { text-align: right; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-weight: 700; padding: 0 0 1.2mm; border-bottom: 1.5px solid #111; }
td { padding: 1mm 0; vertical-align: top; }
td small { display: block; color: #444; font-size: ${small ? 8.5 : 9.5}px; }
.qty { width: ${small ? 7 : 9}mm; }
.num { text-align: right; white-space: nowrap; }
.muted { font-size: ${small ? 9 : 10}px; color: #333; }
.total { font-size: ${small ? 13.5 : 16}px; font-weight: 700; margin-top: 1mm; }
.qr { width: ${small ? 26 : 30}mm; margin: 2mm auto 1mm; }
.qr svg { width: 100%; height: auto; display: block; }
.cufe { font-size: ${small ? 7 : 8}px; word-break: break-all; color: #333; }
.thanks { margin: 0 0 1mm; }
</style></head><body>
<div class="center">
${org.logoData ? `<img class="logo" src="${esc(org.logoData)}" alt="">` : `<div class="badge">${esc(initials(name))}</div>`}
<div class="brand">${esc(name)}</div>
${org.tradeName ? `<div class="line">${esc(org.legalName)}</div>` : ""}
<div class="line">NIT ${esc(nit(org.nit, org.verificationDigit))}${org.regime ? ` · ${esc(org.regime)}` : ""}</div>
${location ? `<div class="line">${esc(location)}</div>` : ""}
${contact.map(item => `<div class="line">${item}</div>`).join("")}
</div>
<hr>
<div class="center">
<div class="doc">${isPos ? "DOCUMENTO EQUIVALENTE POS" : "FACTURA ELECTRÓNICA DE VENTA"}</div>
<div class="number">No. ${esc(invoice.number)}</div>
${org.posResolutionText ? `<div class="resolution">${esc(org.posResolutionText)}</div>` : ""}
</div>
<hr>
<div class="row"><span>Fecha</span><span>${esc(dateTime(invoice.issuedAt))}</span></div>
${invoice.orderReference ? `<div class="row"><span>Pedido</span><span>${esc(invoice.orderReference)}</span></div>` : ""}
${invoice.seller && !isPos ? `<div class="row"><span>Vendedor</span><span>${esc(invoice.seller)}</span></div>` : ""}
<div class="row"><span>Cliente</span><span>${customer.finalConsumer ? "Consumidor final" : esc(customer.legalName)}</span></div>
${customer.finalConsumer ? "" : `<div class="row"><span>${esc(customer.identificationType)}</span><span>${esc(nit(customer.identificationNumber, customer.verificationDigit))}</span></div>`}
<hr>
<table><thead><tr><th class="qty">Cant</th><th>Descripción</th><th class="num">Valor</th></tr></thead><tbody>${rows}</tbody></table>
<hr>
<div class="row"><span>Subtotal</span><span>${peso(subtotal)}</span></div>
${Number(invoice.discountTotal) ? `<div class="row muted"><span>Descuentos</span><span>−${peso(invoice.discountTotal)}</span></div>` : ""}
<div class="row muted"><span>Base gravable</span><span>${peso(base)}</span></div>
${[...taxes].map(([label, value]) => `<div class="row muted"><span>${esc(label)}</span><span>${peso(value)}</span></div>`).join("")}
${invoice.aiu ? `<div class="row muted"><span>AIU</span><span>${peso(Number(invoice.aiu.administration) + Number(invoice.aiu.contingency) + Number(invoice.aiu.profit))}</span></div>` : ""}
<div class="row total"><span>TOTAL</span><span>${peso(invoice.total)}</span></div>
${Number(invoice.withholdingTotal) ? `<div class="row muted"><span>Retenciones</span><span>−${peso(invoice.withholdingTotal)}</span></div>` : ""}
<hr>
<div class="row"><span>${esc(paymentMethodName(data))}</span><span>${peso(invoice.total)}</span></div>
<hr>
<div class="center">
<div class="qr">${qrSvg(data.qrText, 3)}</div>
<div class="cufe">${isPos ? "CUDE" : "CUFE"}: ${esc(invoice.cufe ?? "pendiente (ambiente de pruebas)")}</div>
<hr>
<p class="thanks">${esc(org.receiptFooter || "¡Gracias por su compra!")}</p>
<div class="muted">Software: Betel Solution</div>
</div>
</body></html>`;
}

/** Factura electrónica tamaño carta. */
export function letterInvoiceHtml(data: PrintData) {
  const { organization: org, customer, invoice } = data;
  const rows = data.lines
    .map(
      (line, index) =>
        `<tr><td>${index + 1}</td><td>${esc(line.code ?? "")}</td><td>${esc(line.description)}</td><td class="num">${qty(line.quantity)}</td><td>${esc(line.unit ?? "")}</td><td class="num">${money(line.unitPrice)}</td><td class="num">${Number(line.discountAmount) ? money(line.discountAmount) : "—"}</td><td class="num">${line.taxRate}%</td><td class="num">${money(line.lineTotal)}</td></tr>`
    )
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Factura ${esc(invoice.number)}</title><style>
@page { size: letter; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 10px/1.4 Arial, Helvetica, sans-serif; color: #111; }
header { display: grid; grid-template-columns: 1fr auto; gap: 8mm; align-items: start; }
.logo { max-height: 22mm; max-width: 55mm; display: block; margin-bottom: 2mm; }
h1 { font-size: 15px; margin: 0 0 1mm; } .title { border: 1.5px solid #0b3d91; border-radius: 3mm; padding: 3mm 5mm; text-align: center; min-width: 62mm; }
.title b { display: block; color: #0b3d91; font-size: 11px; } .title strong { display: block; font-size: 16px; margin: 1mm 0; }
.boxes { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin: 5mm 0; }
.box { border: 1px solid #c9d3e0; border-radius: 2mm; padding: 2.5mm 3.5mm; } .box h3 { margin: 0 0 1mm; font-size: 10px; color: #0b3d91; text-transform: uppercase; }
table { width: 100%; border-collapse: collapse; } th { background: #eaf0f8; text-align: left; font-size: 9px; padding: 2mm; }
td { padding: 1.6mm 2mm; border-bottom: 1px solid #e3e8ef; vertical-align: top; } .num { text-align: right; white-space: nowrap; }
.bottom { display: grid; grid-template-columns: 1fr 70mm; gap: 6mm; margin-top: 5mm; align-items: start; }
.totals div { display: flex; justify-content: space-between; padding: 1.2mm 0; } .totals .grand { border-top: 1.5px solid #111; font-size: 13px; font-weight: bold; margin-top: 1mm; padding-top: 2mm; }
.dian { display: grid; grid-template-columns: 30mm 1fr; gap: 4mm; align-items: center; margin-top: 6mm; padding: 3mm; border: 1px solid #c9d3e0; border-radius: 2mm; }
.dian svg { width: 30mm; height: 30mm; display: block; } .cufe { word-break: break-all; font-size: 8.5px; }
footer { margin-top: 5mm; color: #667; font-size: 8.5px; text-align: center; }
</style></head><body>
<header>
<div>
${org.logoData ? `<img class="logo" src="${esc(org.logoData)}" alt="">` : ""}
<h1>${esc(org.legalName)}</h1>
${org.tradeName ? `<div>${esc(org.tradeName)}</div>` : ""}
<div>NIT ${esc(nit(org.nit, org.verificationDigit))}</div>
${org.address ? `<div>${esc(org.address)}</div>` : ""}
${[org.phone, org.email].filter(Boolean).length ? `<div>${esc([org.phone, org.email].filter(Boolean).join(" · "))}</div>` : ""}
</div>
<div class="title"><b>${invoice.documentType === "POS" ? "DOCUMENTO EQUIVALENTE ELECTRÓNICO POS" : "FACTURA ELECTRÓNICA DE VENTA"}</b><strong>No. ${esc(invoice.number)}</strong><div>Fecha: ${esc(dateTime(invoice.issuedAt))}</div>${invoice.dueDate ? `<div>Vence: ${esc(shortDate(invoice.dueDate))}</div>` : ""}</div>
</header>
<div class="boxes">
<div class="box"><h3>Adquiriente</h3><div><b>${esc(customer.legalName)}</b></div><div>${esc(customer.identificationType)} ${esc(nit(customer.identificationNumber, customer.verificationDigit))}</div>${customer.address ? `<div>${esc(customer.address)}</div>` : ""}${[customer.phone, customer.email].filter(Boolean).length ? `<div>${esc([customer.phone, customer.email].filter(Boolean).join(" · "))}</div>` : ""}</div>
<div class="box"><h3>Condiciones</h3><div>Forma de pago: ${esc(paymentLabel(data))}</div>${invoice.seller ? `<div>Vendedor: ${esc(invoice.seller)}</div>` : ""}<div>Moneda: COP</div></div>
</div>
<table><thead><tr><th>#</th><th>Código</th><th>Descripción</th><th class="num">Cant.</th><th>Und.</th><th class="num">Valor unit.</th><th class="num">Desc.</th><th class="num">IVA</th><th class="num">Total</th></tr></thead><tbody>${rows}</tbody></table>
<div class="bottom">
<div>${invoice.notes ? `<div class="box"><h3>Observaciones</h3>${esc(invoice.notes)}</div>` : ""}</div>
<div class="totals">${totalsRows(data)
    .map(([label, value]) => `<div><span>${esc(label)}</span><b>${value}</b></div>`)
    .join(
      ""
    )}<div class="grand"><span>Total a pagar</span><span>${money(invoice.total)}</span></div>${Number(invoice.withholdingTotal) ? `<div><span>Retenciones</span><b>−${money(invoice.withholdingTotal)}</b></div>` : ""}</div>
</div>
<div class="dian">${qrSvg(data.qrText, 4)}<div><b>CUFE</b><div class="cufe">${esc(invoice.cufe ?? "Pendiente: la factura está en el ambiente de pruebas de la DIAN.")}</div><p>Representación gráfica de la factura electrónica de venta. Consúltela en la DIAN con el código QR.</p></div></div>
<footer>Generado por Betel Solution · ${esc(org.legalName)}</footer>
</body></html>`;
}

/** Imprime un documento HTML en un iframe oculto (respeta el tamaño de @page). */
export function printHtml(html: string) {
  return new Promise<void>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) {
      frame.remove();
      return reject(new Error("El navegador no permitió preparar la impresión."));
    }
    doc.open();
    doc.write(html);
    doc.close();
    const images = [...doc.images].map(
      image => new Promise(done => (image.complete ? done(null) : image.addEventListener("load", done, { once: true })))
    );
    Promise.all(images).then(() => {
      const view = frame.contentWindow!;
      // Se retira el iframe cuando termina el diálogo de impresión (o tras un minuto).
      const cleanup = () => frame.remove();
      view.addEventListener("afterprint", cleanup, { once: true });
      window.setTimeout(cleanup, 60_000);
      view.focus();
      view.print();
      resolve();
    }, reject);
  });
}

const WIDTH_KEY = "betel.posPaperWidth";
const titleCase = (value: string) =>
  value
    .toLocaleLowerCase("es")
    .replace(/(^|\s)(\p{L})/gu, (_match, space: string, letter: string) => space + letter.toLocaleUpperCase("es"));

/** «¿Cómo quieres imprimir?»: factura POS en tirilla o factura electrónica en carta. */
export function InvoicePrintDialog({
  invoiceId,
  onClose,
  preferred = "LETTER",
}: {
  invoiceId: string;
  onClose: () => void;
  /** Formato sugerido: POS (tirilla) para el documento equivalente POS, carta para la factura electrónica. */
  preferred?: PrintFormat;
}) {
  const [data, setData] = useState<PrintData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState<PaperWidth>("80");
  const [printing, setPrinting] = useState<PrintFormat | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(WIDTH_KEY);
      if (saved === "58" || saved === "80") setWidth(saved);
    } catch {}
    apiGet<{ data: PrintData }>(`/v1/invoices/${invoiceId}/print-data`).then(
      async response => {
        const code = response.data.organization.municipalityCode;
        let cityName: string | null = null;
        if (code) {
          try {
            const catalog = (await import("../data/colombia-locations.json")).default as unknown as {
              municipalities: { code: string; name: string; departmentName: string }[];
            };
            const town = catalog.municipalities.find(item => item.code === code);
            if (town) cityName = town.code.startsWith("11") ? "Bogotá D.C." : `${titleCase(town.name)}`;
          } catch {}
        }
        setData({ ...response.data, organization: { ...response.data.organization, cityName } });
      },
      (reason: Error) => setError(reason.message)
    );
  }, [invoiceId]);

  const print = async (format: PrintFormat) => {
    if (!data) return;
    setError(null);
    setPrinting(format);
    try {
      await printHtml(format === "POS" ? posReceiptHtml(data, width) : letterInvoiceHtml(data));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPrinting(null);
    }
  };

  return (
    <Modal title="¿Cómo quieres imprimir la factura?" onClose={onClose} wide closeButton>
      <div className="print-options">
        {!data && !error && <p className="report-message">Preparando la factura…</p>}
        {data && (
          <p className="print-summary">
            <b>{data.invoice.number}</b> · {data.customer.legalName} · <b>{money(data.invoice.total)}</b>
          </p>
        )}
        <div className="print-choices">
          <section className={preferred === "POS" ? "print-choice is-preferred" : "print-choice"}>
            <div className="print-icon is-pos" aria-hidden="true">
              <span />
            </div>
            <h3>Factura POS</h3>
            <p>Tirilla para impresora térmica de punto de venta.</p>
            <div className="print-width" role="radiogroup" aria-label="Ancho del papel">
              {(["80", "58"] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={width === option}
                  className={width === option ? "is-selected" : undefined}
                  onClick={() => {
                    setWidth(option);
                    try {
                      localStorage.setItem(WIDTH_KEY, option);
                    } catch {}
                  }}
                >
                  {option} mm
                </button>
              ))}
            </div>
            <button type="button" className="primary" disabled={!data || !!printing} onClick={() => print("POS")}>
              {printing === "POS" ? "Abriendo impresión…" : "🖨 Imprimir tirilla"}
            </button>
          </section>
          <section className={preferred === "LETTER" ? "print-choice is-preferred" : "print-choice"}>
            <div className="print-icon is-letter" aria-hidden="true">
              <span />
            </div>
            <h3>Factura electrónica</h3>
            <p>Hoja tamaño carta con todos los datos, el CUFE y el código QR.</p>
            <div className="print-width">
              <span>Carta · 8,5 × 11 in</span>
            </div>
            <button type="button" className="primary" disabled={!data || !!printing} onClick={() => print("LETTER")}>
              {printing === "LETTER" ? "Abriendo impresión…" : "🖨 Imprimir carta"}
            </button>
          </section>
        </div>
        {error && (
          <p className="report-error" role="alert">
            {error}
          </p>
        )}
        <p className="report-footnote">
          En la ventana de impresión elige la impresora: la térmica para la tirilla o la de oficina para la carta. Ambas
          son la misma factura electrónica (mismo número, CUFE y código QR).
        </p>
      </div>
    </Modal>
  );
}
