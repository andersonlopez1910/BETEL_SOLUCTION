/**
 * Formulario de documentos de venta: "Crear cotización" (POST /v1/quotes), "Crear remisión"
 * (POST /v1/deliveries) y "Crear factura recurrente" (POST /v1/recurring-invoices). Comparten clientes
 * (GET /v1/quotes/customers), ítems y totales; la cotización agrega la validez, la remisión el tipo de
 * transacción y la recurrente la frecuencia, el número de veces y la forma de pago.
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
export type Line = {
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountRate: string;
  taxRate: string;
};

export const newLine = (): Line => ({
  productId: "",
  description: "",
  quantity: "1",
  unitPrice: "",
  discountRate: "0",
  taxRate: "19",
});
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Misma fórmula que calculateDocumentTotals (apps/api/src/accounting.ts). */
export function preview(lines: Line[]) {
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

/** Ítems en el formato de la API (sin descuento cuando `discount` es falso). */
export const toApiLines = (lines: Line[], discount = true) =>
  lines.map(line => ({
    ...(line.productId && { productId: line.productId }),
    description: line.description,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    ...(discount && { discountRate: Number(line.discountRate || 0) }),
    taxRate: Number(line.taxRate || 0),
  }));

/** Diferencias entre cotización, remisión y factura recurrente. */
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
  recurring: {
    endpoint: "/v1/recurring-invoices",
    tab: "facturas-recurrentes",
    back: "Facturas recurrentes",
    noun: "la factura recurrente",
    view: "/facturas-recurrentes/documento",
  },
} as const;

export const frequencyLabels: Record<string, string> = {
  WEEKLY: "Semanal",
  BIWEEKLY: "Quincenal",
  MONTHLY: "Mensual",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

export const deliveryTypeLabels: Record<string, string> = {
  SALE: "Venta",
  CONSIGNMENT: "Consignación",
  SAMPLE: "Muestra",
};

export const QuoteForm = () => <SalesDocumentForm kind="quote" />;
export const DeliveryForm = () => <SalesDocumentForm kind="delivery" />;
export const RecurringInvoiceForm = () => <SalesDocumentForm kind="recurring" />;

function SalesDocumentForm({ kind }: { kind: keyof typeof kinds }) {
  const config = kinds[kind];
  const router = useRouter();
  const today = defaultPeriod().to;
  const in30 = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const customers = useReport<{ data: Customer[] }>("/v1/quotes/customers", { search: query });
  const [form, setForm] = useState({
    customerId: "",
    issueDate: today,
    validUntil: in30,
    transactionType: "SALE",
    frequency: "MONTHLY",
    occurrences: "",
    paymentMethod: "CASH",
    dueDays: "30",
    notes: "",
  });
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const totals = preview(lines);

  const setField =
    (field: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [field]: event.target.value });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      const created = await apiPost<{ data: { id: string } }>(config.endpoint, {
        customerId: form.customerId,
        ...(kind === "recurring"
          ? {
              startDate: form.issueDate,
              frequency: form.frequency,
              ...(form.occurrences && { occurrences: Number(form.occurrences) }),
              paymentMethod: form.paymentMethod,
              ...(form.paymentMethod === "CREDIT" && { dueDays: Number(form.dueDays) }),
            }
          : { issueDate: form.issueDate }),
        ...(kind === "quote" && { validUntil: form.validUntil || undefined }),
        ...(kind === "delivery" && { transactionType: form.transactionType }),
        notes: form.notes || undefined,
        lines: toApiLines(lines),
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
            {kind === "recurring" ? "Fecha inicio (primera factura)" : "Fecha de elaboración"}
            <input
              type="date"
              value={form.issueDate}
              onChange={setField("issueDate")}
              min={kind === "recurring" ? today : undefined}
              required
            />
          </label>
          {kind === "recurring" ? (
            <>
              <label className="field">
                Recurrencia
                <select value={form.frequency} onChange={setField("frequency")}>
                  {Object.entries(frequencyLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Número de veces
                <input
                  type="number"
                  min="1"
                  max="360"
                  value={form.occurrences}
                  onChange={setField("occurrences")}
                  placeholder="Sin límite"
                />
              </label>
              <label className="field">
                Forma de pago
                <select value={form.paymentMethod} onChange={setField("paymentMethod")}>
                  <option value="CASH">Contado</option>
                  <option value="CREDIT">Crédito</option>
                </select>
              </label>
              {form.paymentMethod === "CREDIT" && (
                <label className="field">
                  Plazo (días)
                  <input type="number" min="1" max="365" value={form.dueDays} onChange={setField("dueDays")} required />
                </label>
              )}
            </>
          ) : kind === "quote" ? (
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

      <LineItemsEditor lines={lines} setLines={setLines} />

      <section className="panel receipt-footer">
        <div>
          <span>{kind === "recurring" ? "Total de cada factura" : `Total de ${config.noun}`}</span>
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
            {state.busy
              ? "Guardando…"
              : { quote: "Guardar cotización", delivery: "Guardar remisión", recurring: "Guardar factura recurrente" }[
                  kind
                ]}
          </button>
        </div>
      </section>
    </form>
  );
}

/**
 * Tabla de ítems con catálogo de productos, vista previa de totales y agregar/quitar filas. La usan los
 * documentos de venta y los de compras y gastos (`discount=false` en el documento soporte).
 */
export function LineItemsEditor({
  lines,
  setLines,
  discount = true,
}: {
  lines: Line[];
  setLines: (lines: Line[]) => void;
  discount?: boolean;
}) {
  const products = useReport<{ data: Product[] }>("/v1/products");
  const totals = preview(discount ? lines : lines.map(line => ({ ...line, discountRate: "0" })));
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

  return (
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
              {discount && <th className="num">Desc. %</th>}
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
                {discount && (
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
                )}
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
  );
}
