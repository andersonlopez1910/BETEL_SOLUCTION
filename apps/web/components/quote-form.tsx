/**
 * Formulario de documentos de venta previos a la factura: "Crear cotización" (POST /v1/quotes) y
 * "Crear remisión" (POST /v1/deliveries). Comparten clientes (GET /v1/quotes/customers), ítems y totales;
 * la cotización agrega la validez y la remisión el tipo de transacción.
 *
 * Cliente, fecha de elaboración, observaciones e ítems. Cada ítem
 * puede tomarse del catálogo (GET /v1/products) o escribirse a mano. Los totales que se ven aquí son
 * una vista previa con la misma fórmula del servidor; los definitivos los calcula la API al guardar.
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPost } from "../lib/api";
import { defaultPeriod, money, ReportStatus, useReport } from "./billing-report-common";

type Customer = { id: string; legalName: string; identificationType: string; identificationNumber: string };
type Product = { id: string; name: string; unitPrice: string; taxRate: string };
type Line = {
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountRate: string;
  taxRate: string;
};

const newLine = (): Line => ({
  productId: "",
  description: "",
  quantity: "1",
  unitPrice: "",
  discountRate: "0",
  taxRate: "19",
});
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Misma fórmula que calculateDocumentTotals (apps/api/src/accounting.ts). */
function preview(lines: Line[]) {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  let total = 0;
  const rows = lines.map(line => {
    const gross = Number(line.quantity || 0) * Number(line.unitPrice || 0);
    const lineDiscount = gross * (Number(line.discountRate || 0) / 100);
    const lineTax = (gross - lineDiscount) * (Number(line.taxRate || 0) / 100);
    const lineTotal = round(gross - lineDiscount + lineTax);
    subtotal += gross;
    discount += lineDiscount;
    tax += lineTax;
    total += lineTotal;
    return lineTotal;
  });
  return { rows, subtotal: round(subtotal), discount: round(discount), tax: round(tax), total: round(total) };
}

/** Diferencias entre cotización y remisión. */
const kinds = {
  quote: {
    endpoint: "/v1/quotes",
    tab: "cotizaciones",
    back: "Cotizaciones",
    noun: "la cotización",
    view: "/cotizaciones/documento",
  },
  delivery: {
    endpoint: "/v1/deliveries",
    tab: "remisiones",
    back: "Remisiones",
    noun: "la remisión",
    view: "/remisiones/documento",
  },
} as const;

export const deliveryTypeLabels: Record<string, string> = {
  SALE: "Venta",
  CONSIGNMENT: "Consignación",
  SAMPLE: "Muestra",
};

export const QuoteForm = () => <SalesDocumentForm kind="quote" />;
export const DeliveryForm = () => <SalesDocumentForm kind="delivery" />;

function SalesDocumentForm({ kind }: { kind: keyof typeof kinds }) {
  const config = kinds[kind];
  const router = useRouter();
  const today = defaultPeriod().to;
  const in30 = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const customers = useReport<{ data: Customer[] }>("/v1/quotes/customers", { search: query });
  const products = useReport<{ data: Product[] }>("/v1/products");
  const [form, setForm] = useState({
    customerId: "",
    issueDate: today,
    validUntil: in30,
    transactionType: "SALE",
    notes: "",
  });
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const totals = preview(lines);

  const setField =
    (field: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [field]: event.target.value });
  const setLine = (index: number, patch: Partial<Line>) =>
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const chooseProduct = (index: number, productId: string) => {
    const product = products.data?.data.find(item => item.id === productId);
    setLine(
      index,
      product
        ? {
            productId,
            description: product.name,
            unitPrice: String(Number(product.unitPrice)),
            taxRate: String(Number(product.taxRate)),
          }
        : { productId: "" }
    );
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      const created = await apiPost<{ data: { id: string } }>(config.endpoint, {
        customerId: form.customerId,
        issueDate: form.issueDate,
        ...(kind === "quote"
          ? { validUntil: form.validUntil || undefined }
          : { transactionType: form.transactionType }),
        notes: form.notes || undefined,
        lines: lines.map(line => ({
          ...(line.productId && { productId: line.productId }),
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          discountRate: Number(line.discountRate || 0),
          taxRate: Number(line.taxRate || 0),
        })),
      });
      router.push(`${config.view}?id=${created.data.id}&creada=1`);
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };

  return (
    <form className="page-content receipt-form" onSubmit={submit}>
      <section className="panel">
        <div className="panel-head">
          <h2>Datos de {config.noun}</h2>
          <Link href={`/reportes/facturacion?tab=${config.tab}`} className="report-link">
            ‹ Volver a {config.back}
          </Link>
        </div>
        <div className="receipt-fields">
          <div className="field receipt-customer">
            Cliente
            <div className="pay-invoice-search">
              <input
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    setQuery(search);
                  }
                }}
                placeholder="Buscar por nombre o identificación"
                aria-label="Buscar cliente"
              />
              <button type="button" className="secondary" onClick={() => setQuery(search)}>
                Buscar
              </button>
            </div>
            <select value={form.customerId} onChange={setField("customerId")} required aria-label="Cliente">
              <option value="">{customers.loading ? "Cargando clientes…" : "Selecciona un cliente"}</option>
              {customers.data?.data.map(customer => (
                <option key={customer.id} value={customer.id}>
                  {customer.legalName} · {customer.identificationType} {customer.identificationNumber}
                </option>
              ))}
            </select>
            {customers.data && !customers.data.data.length && (
              <small className="report-hint">
                No hay clientes con esa búsqueda. Créalos en <Link href="/terceros/nuevo">Terceros</Link>.
              </small>
            )}
          </div>
          <label className="field">
            Fecha de elaboración
            <input type="date" value={form.issueDate} onChange={setField("issueDate")} required />
          </label>
          {kind === "quote" ? (
            <label className="field">
              Válida hasta
              <input type="date" value={form.validUntil} onChange={setField("validUntil")} min={form.issueDate} />
            </label>
          ) : (
            <label className="field">
              Tipo de transacción
              <select value={form.transactionType} onChange={setField("transactionType")}>
                {Object.entries(deliveryTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field receipt-notes">
            Observaciones
            <textarea value={form.notes} onChange={setField("notes")} maxLength={2000} rows={2} />
          </label>
        </div>
        <ReportStatus loading={false} error={customers.error} />
      </section>

      <section className="panel report-table-panel">
        <div className="panel-head">
          <h2>Ítems</h2>
          <button type="button" className="secondary quote-add" onClick={() => setLines([...lines, newLine()])}>
            ＋ Agregar ítem
          </button>
        </div>
        <div className="report-table-wrap">
          <table className="report-table quote-lines">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Descripción</th>
                <th className="num">Cantidad</th>
                <th className="num">Valor unitario</th>
                <th className="num">Desc. %</th>
                <th className="num">IVA %</th>
                <th className="num">Total</th>
                <th>
                  <span className="sr-only">Quitar</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index}>
                  <td>
                    <select
                      value={line.productId}
                      onChange={event => chooseProduct(index, event.target.value)}
                      aria-label={`Producto del ítem ${index + 1}`}
                    >
                      <option value="">Sin catálogo</option>
                      {products.data?.data.map(product => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={line.description}
                      onChange={event => setLine(index, { description: event.target.value })}
                      required
                      maxLength={500}
                      aria-label={`Descripción del ítem ${index + 1}`}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min="0.0001"
                      step="any"
                      value={line.quantity}
                      onChange={event => setLine(index, { quantity: event.target.value })}
                      required
                      aria-label={`Cantidad del ítem ${index + 1}`}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitPrice}
                      onChange={event => setLine(index, { unitPrice: event.target.value })}
                      required
                      aria-label={`Valor unitario del ítem ${index + 1}`}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={line.discountRate}
                      onChange={event => setLine(index, { discountRate: event.target.value })}
                      aria-label={`Descuento del ítem ${index + 1}`}
                    />
                  </td>
                  <td className="num">
                    <select
                      value={line.taxRate}
                      onChange={event => setLine(index, { taxRate: event.target.value })}
                      aria-label={`IVA del ítem ${index + 1}`}
                    >
                      {["0", "5", "19"].map(rate => (
                        <option key={rate} value={rate}>
                          {rate} %
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">{money(totals.rows[index] ?? 0)}</td>
                  <td>
                    <button
                      type="button"
                      className="report-link"
                      disabled={lines.length === 1}
                      onClick={() => setLines(lines.filter((_, i) => i !== index))}
                      aria-label={`Quitar ítem ${index + 1}`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="document-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{money(totals.subtotal)}</dd>
          </div>
          <div>
            <dt>Descuentos</dt>
            <dd>{money(totals.discount)}</dd>
          </div>
          <div>
            <dt>Impuestos</dt>
            <dd>{money(totals.tax)}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{money(totals.total)}</dd>
          </div>
        </dl>
      </section>

      <section className="panel receipt-footer">
        <div>
          <span>Total de {config.noun}</span>
          <b>{money(totals.total)}</b>
        </div>
        {state.error && (
          <p className="report-error" role="alert">
            {state.error}
          </p>
        )}
        <div className="report-actions">
          <Link href={`/reportes/facturacion?tab=${config.tab}`} className="secondary receipt-cancel">
            Cancelar
          </Link>
          <button type="submit" className="primary" disabled={state.busy || !form.customerId}>
            {state.busy ? "Guardando…" : kind === "quote" ? "Guardar cotización" : "Guardar remisión"}
          </button>
        </div>
      </section>
    </form>
  );
}
