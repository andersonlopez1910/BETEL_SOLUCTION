"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../lib/api";
import { openInvoicePdf } from "../lib/invoice-pdf";
import { money } from "./billing-report-common";
import { useToast } from "./toast-provider";

type Party = { id: string; legalName: string; identificationNumber: string; email: string | null; address: string | null; municipalityCode: string | null; isCustomer: boolean };
type Product = { id: string; sku: string | null; name: string; description: string | null; kind: string; unit: string; unitPrice: string; taxRate: string; taxTreatment: "TAXED" | "EXEMPT" | "EXCLUDED" | "OTHER"; taxConfig: { appliesInc: boolean; incRate: string | null } | null };
type Line = { productId: string; description: string; quantity: string; unitPrice: string; discountType: "PERCENTAGE" | "FIXED"; discountValue: string; taxRate: number; taxTreatment: Product["taxTreatment"]; incRate: number; unit: string };

const blank = (): Line => ({ productId: "", description: "", quantity: "1", unitPrice: "", discountType: "PERCENTAGE", discountValue: "0", taxRate: 19, taxTreatment: "TAXED", incRate: 0, unit: "—" });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());

/** Compositor de factura: el cálculo mostrado es orientativo; el API recalcula y persiste los importes. */
export function ElectronicInvoiceForm() {
  const toast = useToast();
  const [customers, setCustomers] = useState<Party[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "CREDIT">("CASH");
  const [paymentMethodCode, setPaymentMethodCode] = useState("42");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [status, setStatus] = useState("BORRADOR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuedNumber, setIssuedNumber] = useState<string | null>(null);

  useEffect(() => { apiGet<{ data: Product[] }>("/v1/invoice-catalog/products").then(result => setProducts(result.data), () => setProducts([])); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => apiGet<{ data: Party[] }>("/v1/parties", { search: customerSearch }).then(result => setCustomers(result.data.filter(item => item.isCustomer)), () => setCustomers([])), 180);
    return () => window.clearTimeout(timer);
  }, [customerSearch]);

  const selectedCustomer = customers.find(customer => customer.id === customerId);
  const computed = useMemo(() => lines.map(line => {
    const gross = Number(line.quantity || 0) * Number(line.unitPrice || 0);
    const discount = line.discountType === "FIXED" ? Math.min(gross, Number(line.discountValue || 0)) : gross * Number(line.discountValue || 0) / 100;
    const base = gross - discount;
    const vat = line.taxTreatment === "TAXED" ? base * line.taxRate / 100 : 0;
    const inc = base * line.incRate / 100;
    return { gross, discount, base, vat, inc, total: base + vat + inc };
  }), [lines]);
  const totals = computed.reduce((total, line) => ({ gross: total.gross + line.gross, discount: total.discount + line.discount, base: total.base + line.base, vat: total.vat + line.vat, inc: total.inc + line.inc, total: total.total + line.total }), { gross: 0, discount: 0, base: 0, vat: 0, inc: 0, total: 0 });
  const change = (index: number, patch: Partial<Line>) => setLines(current => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  const chooseProduct = (index: number, id: string) => {
    const product = products.find(item => item.id === id);
    if (!product) return change(index, { productId: id });
    change(index, { productId: id, description: product.description || product.name, unitPrice: product.unitPrice, taxRate: Number(product.taxRate), taxTreatment: product.taxTreatment, incRate: product.taxConfig?.appliesInc ? Number(product.taxConfig.incRate || 0) : 0, unit: product.unit });
  };
  const body = () => ({ customerId, issueDate: today, dueDate: paymentMethod === "CREDIT" ? dueDate : undefined, paymentMethod, paymentMethodCode: paymentMethod === "CASH" ? paymentMethodCode : undefined, currency: "COP", notes: notes || undefined, internalNotes: internalNotes || undefined, lines: lines.map(line => ({ productId: line.productId || undefined, description: line.description, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), discountType: line.discountType, discountValue: Number(line.discountValue || 0), taxRate: line.taxRate, taxTreatment: line.taxTreatment, incRate: line.incRate })) });
  const save = async () => {
    setBusy(true); setError(null);
    try { const response = await apiPost<{ data: { id: string } }>("/v1/invoices", body()); setInvoiceId(response.data.id); setStatus("LISTA PARA ENVIAR"); return response.data.id; }
    catch (reason) { setError((reason as Error).message); return null; }
    finally { setBusy(false); }
  };
  const send = async () => {
    const id = invoiceId ?? await save(); if (!id) return;
    setBusy(true); setError(null);
    try {
      const response = await apiPost<{ data: { dianStatus: string; prefix: string | null; number: string | null } }>(`/v1/invoices/${id}/issue`);
      const number = `${response.data.prefix ?? ""}${response.data.number ?? ""}`;
      setIssuedNumber(number || "Factura emitida");
      setStatus(response.data.dianStatus === "ACCEPTED" ? "ACEPTADA DIAN" : "EN VALIDACIÓN");
      toast.success({ title: "Factura enviada correctamente", description: `${number || "La factura"} fue procesada correctamente.` });
    }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  return <form className="electronic-invoice" onSubmit={event => { event.preventDefault(); void save(); }}>
    <header className="invoice-composer-head"><div><span className="eyebrow">FACTURACIÓN ELECTRÓNICA</span><h2>Nueva factura electrónica</h2><p>Crea, valida y envía una factura electrónica de venta a la DIAN.</p></div><b className={`invoice-status ${status === "BORRADOR" ? "" : "is-ready"}`}>{status}</b></header>
    <div className="invoice-workspace"><main>
      <section className="invoice-card invoice-document-data"><h3>Documento</h3><div className="invoice-fields"><label>Tipo<input value="Factura electrónica de venta" readOnly /></label><label>Número<input value={invoiceId ? "Reservado al emitir" : "Se asignará mediante resolución"} readOnly /></label><label>Fecha<input value={today} readOnly /></label><label>Moneda<select defaultValue="COP"><option value="COP">COP · Peso colombiano</option></select></label></div></section>
      <section className="invoice-card"><div className="section-title"><h3>Cliente</h3><span>{selectedCustomer ? "Datos fiscales cargados" : "Obligatorio"}</span></div><label className="invoice-search">Buscar cliente<input value={customerSearch} onChange={event => { setCustomerSearch(event.target.value); setCustomerId(""); }} placeholder="NIT, nombre, correo o teléfono" /></label>{customers.length > 0 && !customerId && <div className="invoice-options">{customers.map(customer => <button type="button" key={customer.id} onClick={() => { setCustomerId(customer.id); setCustomerSearch(customer.legalName); }}><b>{customer.legalName}</b><small>{customer.identificationNumber} · {customer.email || "Sin correo"}</small></button>)}</div>}{selectedCustomer && <div className="customer-snapshot"><b>{selectedCustomer.legalName}</b><span>{selectedCustomer.identificationNumber} · {selectedCustomer.email || "Sin correo"}</span><span>{selectedCustomer.address || "Dirección no registrada"}</span></div>}</section>
      <section className="invoice-card invoice-lines"><div className="section-title"><h3>Productos y servicios</h3><span>Los impuestos se cargan desde el maestro</span></div><div className="invoice-line-head"><span>#</span><span>Producto / servicio</span><span>Descripción</span><span>Cant.</span><span>Unidad</span><span>Valor unit.</span><span>Desc.</span><span>IVA / INC</span><span>Total</span><span /></div>{lines.map((line, index) => <div className="invoice-line" key={index}><span>{index + 1}</span><select value={line.productId} onChange={event => chooseProduct(index, event.target.value)}><option value="">Selecciona…</option>{products.map(product => <option key={product.id} value={product.id}>{product.sku ? `${product.sku} · ` : ""}{product.name}</option>)}</select><textarea value={line.description} onChange={event => change(index, { description: event.target.value })} rows={1} /><input type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={event => change(index, { quantity: event.target.value })} /><span>{line.unit}</span><input type="number" min="0" step="0.01" value={line.unitPrice} onChange={event => change(index, { unitPrice: event.target.value })} /><div className="discount-cell"><select value={line.discountType} onChange={event => change(index, { discountType: event.target.value as Line["discountType"] })}><option value="PERCENTAGE">%</option><option value="FIXED">$</option></select><input type="number" min="0" value={line.discountValue} onChange={event => change(index, { discountValue: event.target.value })} /></div><small>{line.taxTreatment === "TAXED" ? `IVA ${line.taxRate}%` : line.taxTreatment === "EXEMPT" ? "Exento" : line.taxTreatment === "EXCLUDED" ? "Excluido" : "No sujeto"}{line.incRate ? ` · INC ${line.incRate}%` : ""}</small><b>{money(computed[index]!.total)}</b><button type="button" className="line-delete" disabled={lines.length === 1} onClick={() => setLines(current => current.filter((_, i) => i !== index))} aria-label="Eliminar línea">⌫</button></div>)}<button type="button" className="add-invoice-line" onClick={() => setLines(current => [...current, blank()])}>＋ Agregar producto o servicio</button></section>
      <section className="invoice-card payment-section"><h3>Forma de pago</h3><div className="payment-switch"><label><input type="radio" checked={paymentMethod === "CASH"} onChange={() => setPaymentMethod("CASH")} /> Contado</label><label><input type="radio" checked={paymentMethod === "CREDIT"} onChange={() => setPaymentMethod("CREDIT")} /> Crédito</label></div>{paymentMethod === "CASH" ? <label>Medio de pago<select value={paymentMethodCode} onChange={event => setPaymentMethodCode(event.target.value)}><option value="10">Efectivo</option><option value="42">Transferencia</option><option value="48">Tarjeta</option><option value="20">Cheque</option></select></label> : <label>Fecha de vencimiento<input type="date" min={today} value={dueDate} onChange={event => setDueDate(event.target.value)} required /></label>}<label>Observaciones<textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Visible para el cliente" /></label><label>Notas internas<textarea value={internalNotes} onChange={event => setInternalNotes(event.target.value)} placeholder="No se transmiten a DIAN" /></label></section>
    </main><aside className="invoice-summary"><h3>Resumen</h3><p><span>Subtotal bruto</span><b>{money(totals.gross)}</b></p><p><span>Descuentos</span><b>−{money(totals.discount)}</b></p><p><span>Base gravable</span><b>{money(totals.base)}</b></p><p><span>IVA</span><b>{money(totals.vat)}</b></p><p><span>INC</span><b>{money(totals.inc)}</b></p><div className="invoice-total"><span>TOTAL FACTURA</span><b>{money(totals.total)}</b></div><p><span>Retenciones</span><b>−{money(0)}</b></p><div className="invoice-net"><span>NETO ESTIMADO A RECIBIR</span><b>{money(totals.total)}</b></div><details><summary>Configuración DIAN</summary><p>La validación y transmisión se ejecutan en el servidor. Ambiente: habilitación/sandbox según la configuración de la empresa.</p></details></aside></div>
    {error && <p className="invoice-error" role="alert">{error}</p>}
    {issuedNumber && invoiceId && <section className="invoice-issued-actions"><b>{issuedNumber}</b><span>Factura procesada. Puedes consultar su representación gráfica sin salir de esta pantalla.</span><button type="button" className="secondary" onClick={() => void openInvoicePdf(invoiceId).catch(reason => setError((reason as Error).message))}>↗ Ver factura</button><button type="button" className="secondary" onClick={() => location.reload()}>Nueva factura</button><a className="secondary" href="/reportes/facturacion?tab=ventas">Ir al reporte de facturación</a></section>}
    <footer className="invoice-actions"><button type="button" className="secondary" onClick={() => history.back()}>Cancelar</button><button type="submit" className="secondary" disabled={busy}>{busy ? "Guardando…" : "Guardar borrador"}</button><button type="button" className="primary" onClick={() => void send()} disabled={busy || Boolean(issuedNumber)}>{busy ? "Enviando…" : "✈ Guardar y enviar"}</button></footer>
  </form>;
}
