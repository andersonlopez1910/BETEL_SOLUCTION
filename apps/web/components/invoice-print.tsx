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
  };
  customer: {
    legalName: string;
    identificationType: string;
    identificationNumber: string;
    verificationDigit: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  invoice: {
    number: string;
    documentType?: "FE" | "POS";
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
const nit = (number: string, dv: string | null) => (dv ? `${number}-${dv}` : number);

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

/** Tirilla POS (80 o 58 mm). */
export function posReceiptHtml(data: PrintData, width: PaperWidth) {
  const { organization: org, customer, invoice } = data;
  const small = width === "58";
  const lines = data.lines
    .map(
      line =>
        `<div class="item"><div class="desc">${esc(line.description)}</div><div class="row"><span>${qty(line.quantity)} × ${money(line.unitPrice)}</span><b>${money(line.lineTotal)}</b></div><div class="note">${[Number(line.discountAmount) ? `Desc. −${money(line.discountAmount)}` : "", Number(line.taxRate) ? `IVA ${line.taxRate}%` : "Sin IVA"].filter(Boolean).join(" · ")}</div></div>`
    )
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Factura ${esc(invoice.number)}</title><style>
@page { size: ${width}mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; width: ${width}mm; padding: 3mm ${small ? 2 : 3}mm 6mm; font: ${small ? 10 : 11}px/1.35 "Courier New", ui-monospace, monospace; color: #000; }
.center { text-align: center; } .logo { max-width: 60%; max-height: 22mm; margin: 0 auto 2mm; display: block; }
h1 { font-size: ${small ? 12 : 13}px; margin: 0; } h2 { font-size: ${small ? 11 : 12}px; margin: 2mm 0 1mm; }
hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
.row { display: flex; justify-content: space-between; gap: 2mm; } .row b { white-space: nowrap; }
.item { margin: 1mm 0; } .desc { font-weight: bold; word-break: break-word; }
.note { font-size: ${small ? 8 : 9}px; }
.total { font-size: ${small ? 13 : 15}px; font-weight: bold; margin-top: 1mm; }
.qr { width: ${small ? 30 : 36}mm; margin: 2mm auto; } .qr svg { width: 100%; height: auto; display: block; }
.cufe { font-size: ${small ? 7 : 8}px; word-break: break-all; } .muted { font-size: ${small ? 8 : 9}px; }
</style></head><body>
<div class="center">
${org.logoData ? `<img class="logo" src="${esc(org.logoData)}" alt="">` : ""}
<h1>${esc(org.tradeName || org.legalName)}</h1>
${org.tradeName ? `<div>${esc(org.legalName)}</div>` : ""}
<div>NIT ${esc(nit(org.nit, org.verificationDigit))}</div>
${org.address ? `<div>${esc(org.address)}</div>` : ""}
${org.phone ? `<div>Tel. ${esc(org.phone)}</div>` : ""}
<h2>${invoice.documentType === "POS" ? "DOCUMENTO EQUIVALENTE ELECTRÓNICO POS" : "FACTURA ELECTRÓNICA DE VENTA"}</h2>
<div><b>No. ${esc(invoice.number)}</b></div>
</div>
<hr>
<div class="row"><span>Fecha</span><span>${esc(dateTime(invoice.issuedAt))}</span></div>
${invoice.seller ? `<div class="row"><span>Vendedor</span><span>${esc(invoice.seller)}</span></div>` : ""}
<div>Cliente: <b>${esc(customer.legalName)}</b></div>
<div>${esc(customer.identificationType)} ${esc(nit(customer.identificationNumber, customer.verificationDigit))}</div>
<hr>
${lines}
<hr>
${totalsRows(data)
  .map(([label, value]) => `<div class="row"><span>${esc(label)}</span><b>${value}</b></div>`)
  .join("")}
<div class="row total"><span>TOTAL</span><span>${money(invoice.total)}</span></div>
${Number(invoice.withholdingTotal) ? `<div class="row"><span>Retenciones</span><b>−${money(invoice.withholdingTotal)}</b></div>` : ""}
<div class="row"><span>Pago</span><span>${esc(paymentLabel(data))}</span></div>
<hr>
<div class="center">
<div class="qr">${qrSvg(data.qrText, 3)}</div>
<div class="cufe">CUFE: ${esc(invoice.cufe ?? "pendiente (ambiente de pruebas)")}</div>
<p class="muted">Representación impresa de la factura electrónica de venta. Consúltela con el código QR.</p>
<p class="muted">¡Gracias por su compra!</p>
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
      response => setData(response.data),
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
