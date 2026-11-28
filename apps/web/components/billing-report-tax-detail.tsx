/**
 * Reporte de facturación › Detalle tributario: un renglón por producto o servicio vendido (factura electrónica o
 * documento equivalente POS) con base, IVA, INC, descuento, costo contable, utilidad y margen, tal como los calculó
 * el motor tributario único al facturar. KPI del período, filtros y Excel con hojas RESUMEN y DETALLE.
 * API: GET /v1/reports/billing/tax-detail (apps/api/src/billing-tax-report.ts).
 */
"use client";

import { useState } from "react";
import type { ReportColumn } from "../lib/report-export";
import {
  date,
  defaultPeriod,
  exportFromApi,
  money,
  ReportStatus,
  useReport,
  useSession,
} from "./billing-report-common";
import { presetRange, type Preset } from "./billing-report-quotes";
import { CustomerPicker, type CustomerOption } from "./customer-picker";
import { PeriodPicker } from "./ledger-reports";

type Row = {
  id: string;
  date: string;
  documentType: string;
  documentNumber: string;
  customer: string;
  nit: string;
  product: string;
  productCode: string;
  category: string;
  quantity: string;
  unitPrice: string;
  priceIncludesTax: boolean;
  base: string;
  vatRate: string;
  vat: string;
  incRate: string;
  inc: string;
  discount: string;
  subtotal: string;
  total: string;
  unitCost: string;
  costTotal: string;
  grossProfit: string;
  grossMargin: string;
  status: string;
};
type Summary = {
  salesBeforeTaxes: string;
  vat: string;
  inc: string;
  discounts: string;
  totalSales: string;
  cost: string;
  grossProfit: string;
  grossMargin: string;
};
type Response = {
  data: Row[];
  summary: Summary;
  pagination: { page: number; pageSize: number; total: number };
  period: { from: string; to: string };
};

const num = (value: string) => Number(value);
const columns: ReportColumn<Row>[] = [
  { header: "Fecha", value: row => date(row.date) },
  { header: "Tipo documento", value: row => row.documentType },
  { header: "Número documento", value: row => row.documentNumber },
  { header: "Cliente", value: row => row.customer },
  { header: "NIT", value: row => row.nit },
  { header: "Producto", value: row => row.product },
  { header: "Código producto", value: row => row.productCode },
  { header: "Categoría", value: row => row.category },
  { header: "Cantidad", value: row => num(row.quantity) },
  { header: "Precio unitario ingresado", value: row => row.unitPrice, money: true },
  { header: "Precio con impuesto incluido", value: row => (row.priceIncludesTax ? "Sí" : "No") },
  { header: "Base gravable", value: row => row.base, money: true },
  { header: "Tarifa IVA %", value: row => num(row.vatRate) },
  { header: "Valor IVA", value: row => row.vat, money: true },
  { header: "Tarifa INC %", value: row => num(row.incRate) },
  { header: "Valor INC", value: row => row.inc, money: true },
  { header: "Descuento", value: row => row.discount, money: true },
  { header: "Subtotal", value: row => row.subtotal, money: true },
  { header: "Total", value: row => row.total, money: true },
  { header: "Costo contable unitario", value: row => row.unitCost, money: true },
  { header: "Costo total", value: row => row.costTotal, money: true },
  { header: "Utilidad bruta", value: row => row.grossProfit, money: true },
  { header: "Margen bruto %", value: row => num(row.grossMargin) },
  { header: "Estado documento", value: row => row.status },
];

const statusOptions = [
  ["BILLED", "Vigentes (emitidas, aceptadas y vencidas)"],
  ["ISSUED", "Emitidas"],
  ["ACCEPTED", "Aceptadas"],
  ["OVERDUE", "Vencidas"],
  ["VOID", "Anuladas"],
] as const;

export function TaxDetailReport() {
  const { company, canExport } = useSession();
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState(() => presetRange("month", defaultPeriod()));
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [productId, setProductId] = useState("");
  const [category, setCategory] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [vatRate, setVatRate] = useState("");
  const [status, setStatus] = useState("BILLED");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const users = useReport<{ data: { id: string; displayName: string }[] }>("/v1/reports/billing/users");
  const products = useReport<{ data: { id: string; sku: string | null; name: string }[] }>(
    "/v1/invoice-catalog/products"
  );
  const filters = {
    ...range,
    customerId: customer?.id,
    productId: productId || undefined,
    category: category.trim() || undefined,
    sellerId: sellerId || undefined,
    documentType: documentType || undefined,
    vatRate: vatRate || undefined,
    status,
  };
  const report = useReport<Response>("/v1/reports/billing/tax-detail", { ...filters, page, pageSize: 25 });
  const data = report.data;
  const reset = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const download = async () => {
    setError(null);
    try {
      await exportFromApi<Row>("xlsx", "/v1/reports/billing/tax-detail", { ...filters, export: "1" }, raw => {
        const response = raw as unknown as Response;
        const s = response.summary;
        return {
          company,
          title: "Detalle tributario de facturación",
          period: response.period,
          filters: [
            ...(customer ? [["Cliente", customer.legalName] as [string, string]] : []),
            ...(category ? [["Categoría", category] as [string, string]] : []),
            ...(documentType
              ? [["Tipo documento", documentType === "POS" ? "POS" : "Factura electrónica"] as [string, string]]
              : []),
            ...(vatRate ? [["Tarifa IVA", `${vatRate} %`] as [string, string]] : []),
            ["Estado", statusOptions.find(([value]) => value === status)![1]],
          ],
          columns,
          rows: response.data,
          totals: [["Renglones", String(response.data.length)]],
          fileName: `detalle-tributario-${response.period.from}-a-${response.period.to}`,
          sheetName: "DETALLE",
          summarySheet: {
            name: "RESUMEN",
            rows: [
              ["Total ventas sin impuestos", s.salesBeforeTaxes, true],
              ["IVA generado", s.vat, true],
              ["INC generado", s.inc, true],
              ["Descuentos", s.discounts, true],
              ["Ventas totales", s.totalSales, true],
              ["Costos", s.cost, true],
              ["Utilidad", s.grossProfit, true],
              ["Margen %", Number(s.grossMargin)],
            ],
          },
        };
      });
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const kpis: [string, string, boolean?][] = data
    ? [
        ["Ventas antes de impuestos", money(data.summary.salesBeforeTaxes)],
        ["IVA generado", money(data.summary.vat)],
        ["INC generado", money(data.summary.inc)],
        ["Descuentos otorgados", money(data.summary.discounts)],
        ["Ventas totales", money(data.summary.totalSales), true],
        ["Costo de venta", money(data.summary.cost)],
        ["Utilidad bruta", money(data.summary.grossProfit), true],
        [
          "Margen bruto",
          `${Number(data.summary.grossMargin).toLocaleString("es-CO", { minimumFractionDigits: 2 })} %`,
          true,
        ],
      ]
    : [];
  const pages = data ? Math.max(1, Math.ceil(data.pagination.total / data.pagination.pageSize)) : 1;

  return (
    <section className="panel tax-detail">
      <div className="tax-detail-filters">
        <PeriodPicker
          preset={preset}
          range={range}
          onChange={(next, nextRange) => reset(() => (setPreset(next), setRange(nextRange)))}
        />
        <div className="tax-detail-customer">
          <CustomerPicker label="Cliente" value={customer} onChange={value => reset(() => setCustomer(value))} />
        </div>
        <label className="field">
          Producto
          <select value={productId} onChange={event => reset(() => setProductId(event.target.value))}>
            <option value="">Todos</option>
            {products.data?.data.map(product => (
              <option key={product.id} value={product.id}>
                {product.sku ? `${product.sku} · ` : ""}
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Categoría
          <input
            value={category}
            onChange={event => reset(() => setCategory(event.target.value))}
            placeholder="Todas"
          />
        </label>
        <label className="field">
          Vendedor
          <select value={sellerId} onChange={event => reset(() => setSellerId(event.target.value))}>
            <option value="">Todos</option>
            {users.data?.data.map(user => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Documento
          <select value={documentType} onChange={event => reset(() => setDocumentType(event.target.value))}>
            <option value="">Factura electrónica y POS</option>
            <option value="FE">Factura electrónica</option>
            <option value="POS">Documento equivalente POS</option>
          </select>
        </label>
        <label className="field">
          Tarifa IVA
          <select value={vatRate} onChange={event => reset(() => setVatRate(event.target.value))}>
            <option value="">Todas</option>
            <option value="19">19 %</option>
            <option value="5">5 %</option>
            <option value="0">0 %</option>
          </select>
        </label>
        <label className="field">
          Estado
          <select value={status} onChange={event => reset(() => setStatus(event.target.value))}>
            {statusOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary tax-detail-export"
          disabled={!canExport || !data?.data.length}
          onClick={download}
        >
          ⤓ Exportar Excel
        </button>
      </div>
      {error && (
        <p className="report-error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <div className="tax-kpis">
          {kpis.map(([label, value, strong]) => (
            <div key={label} className={strong ? "is-strong" : undefined}>
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
      )}
      <ReportStatus loading={report.loading && !data} error={report.error} />
      {data && (
        <>
          <div className="report-table-wrap">
            <table className="report-table tax-detail-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Documento</th>
                  <th>Cliente</th>
                  <th>Producto</th>
                  <th className="num">Cant.</th>
                  <th className="num">Precio ingresado</th>
                  <th className="num">Base</th>
                  <th className="num">IVA</th>
                  <th className="num">INC</th>
                  <th className="num">Descuento</th>
                  <th className="num">Total</th>
                  <th className="num">Costo</th>
                  <th className="num">Utilidad</th>
                  <th className="num">Margen</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map(row => (
                  <tr key={row.id}>
                    <td>{date(row.date)}</td>
                    <td>
                      <b>{row.documentNumber}</b>
                      <small>{row.documentType}</small>
                    </td>
                    <td>
                      {row.customer}
                      <small>NIT {row.nit}</small>
                    </td>
                    <td>
                      {row.product}
                      <small>{[row.productCode, row.category].filter(Boolean).join(" · ") || "—"}</small>
                    </td>
                    <td className="num">{Number(row.quantity).toLocaleString("es-CO")}</td>
                    <td className="num">
                      {money(row.unitPrice)}
                      <small>{row.priceIncludesTax ? "Con impuesto" : "Sin impuesto"}</small>
                    </td>
                    <td className="num">{money(row.base)}</td>
                    <td className="num">
                      {money(row.vat)}
                      <small>{Number(row.vatRate)} %</small>
                    </td>
                    <td className="num">
                      {money(row.inc)}
                      {Number(row.incRate) > 0 && <small>{Number(row.incRate)} %</small>}
                    </td>
                    <td className="num">{money(row.discount)}</td>
                    <td className="num">
                      <b>{money(row.total)}</b>
                    </td>
                    <td className="num">{money(row.costTotal)}</td>
                    <td className={Number(row.grossProfit) < 0 ? "num is-negative" : "num"}>
                      {money(row.grossProfit)}
                    </td>
                    <td className="num">{Number(row.grossMargin).toLocaleString("es-CO")} %</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.data.length && <p className="report-message">No hay ventas con estos filtros en el período.</p>}
          </div>
          <div className="tax-detail-pager">
            <span>
              {data.pagination.total} renglones · página {data.pagination.page} de {pages}
            </span>
            <button type="button" className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ‹ Anterior
            </button>
            <button type="button" className="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Siguiente ›
            </button>
          </div>
          <p className="report-footnote">
            Valores guardados en cada renglón al facturar (no se recalculan si después cambia el producto). Costo: costo
            contable del producto al momento de la venta. Utilidad bruta = base − costo total.
          </p>
        </>
      )}
    </section>
  );
}
