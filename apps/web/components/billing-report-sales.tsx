/**
 * Pestaña "Ventas" del Reporte de facturación (GET /v1/reports/billing/sales).
 *
 * Los filtros se editan en un borrador y se aplican con "Buscar"; así no se consulta la API en
 * cada tecla. Los indicadores y gráficas solo cuentan facturas vigentes (emitidas, aceptadas o
 * vencidas): la tabla también lista anuladas y rechazadas, pero esas no suman.
 */
"use client";

import { useState } from "react";
import type { ReportColumn } from "../lib/report-export";
import {
  date,
  defaultPeriod,
  dianStatusLabels,
  exportFromApi,
  invoiceNumber,
  invoiceStatusLabels,
  Kpi,
  money,
  Pagination,
  ReportActions,
  ReportStatus,
  useReport,
  useSession,
} from "./billing-report-common";
import { BarChart, LineChart, type ChartPoint } from "./report-charts";

export type InvoiceRow = {
  id: string;
  prefix: string | null;
  number: string | null;
  issueDate: string;
  status: string;
  dianStatus: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  customer: { id: string; legalName: string; identificationType: string; identificationNumber: string };
  responsible: { id: string; displayName: string } | null;
};

type Bucket = { period: string; total: string; count: number };

type SalesResponse = {
  data: InvoiceRow[];
  pagination: { page: number; pageSize: number; total: number };
  period: { from: string; to: string };
  summary: {
    invoiceCount: number;
    subtotal: string;
    discountTotal: string;
    taxTotal: string;
    total: string;
    average: string;
    previous: { from: string; to: string; invoiceCount: number; total: string };
    change: string | null;
  };
  byDay: Bucket[];
  byMonth: Bucket[];
};

type Filters = { from: string; to: string; customer: string; number: string; status: string; userId: string };
const emptyFilters = (): Filters => ({ ...defaultPeriod(), customer: "", number: "", status: "", userId: "" });

/** Columnas de la tabla y de la exportación (mismo orden en pantalla, CSV, XLSX y PDF). */
export const invoiceColumns: ReportColumn<InvoiceRow>[] = [
  { header: "Factura", value: invoiceNumber },
  { header: "Fecha de emisión", value: row => date(row.issueDate) },
  { header: "Cliente", value: row => row.customer.legalName },
  { header: "Identificación", value: row => `${row.customer.identificationType} ${row.customer.identificationNumber}` },
  { header: "Subtotal", value: row => row.subtotal, money: true },
  { header: "Descuentos", value: row => row.discountTotal, money: true },
  { header: "Impuestos", value: row => row.taxTotal, money: true },
  { header: "Total", value: row => row.total, money: true },
  { header: "Estado", value: row => invoiceStatusLabels[row.status] ?? row.status },
  { header: "Estado DIAN", value: row => dianStatusLabels[row.dianStatus] ?? row.dianStatus },
  { header: "Responsable", value: row => row.responsible?.displayName ?? "Sin registro" },
];

/** Serie diaria completa: los días sin ventas aparecen en 0 para que la línea no salte. */
function fillDays(from: string, to: string, days: Bucket[]): ChartPoint[] {
  const byDay = new Map(days.map(day => [day.period, day]));
  const points: ChartPoint[] = [];
  for (let cursor = new Date(`${from}T00:00:00Z`); cursor <= new Date(`${to}T00:00:00Z`);) {
    const key = cursor.toISOString().slice(0, 10);
    const day = byDay.get(key);
    points.push({
      label: key.slice(8, 10) + "/" + key.slice(5, 7),
      value: Number(day?.total ?? 0),
      detail: `${day?.count ?? 0} facturas`,
    });
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return points;
}

const monthLabel = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString("es-CO", { month: "short", year: "2-digit", timeZone: "UTC" });

export function SalesReport() {
  const { company, canExport } = useSession();
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(draft);
  const [page, setPage] = useState(1);
  const report = useReport<SalesResponse>("/v1/reports/billing/sales", { ...applied, page });
  const users = useReport<{ data: { id: string; displayName: string }[] }>("/v1/reports/billing/users");
  const data = report.data;

  const set = (field: keyof Filters) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft({ ...draft, [field]: event.target.value });

  const search = (event: React.FormEvent) => {
    event.preventDefault();
    setApplied(draft);
    setPage(1);
  };
  const clear = () => {
    const reset = emptyFilters();
    setDraft(reset);
    setApplied(reset);
    setPage(1);
  };

  const exportSales = (format: Parameters<typeof exportFromApi>[0]) =>
    exportFromApi<InvoiceRow>(format, "/v1/reports/billing/sales/export", applied, response => {
      const summary = response.summary as SalesResponse["summary"];
      const user = users.data?.data.find(item => item.id === applied.userId);
      return {
        company,
        title: "Reporte de facturación — Ventas",
        period: response.period,
        filters: [
          ...(applied.customer ? [["Cliente", applied.customer] as [string, string]] : []),
          ...(applied.number ? [["Número", applied.number] as [string, string]] : []),
          ...(applied.status ? [["Estado", invoiceStatusLabels[applied.status]!] as [string, string]] : []),
          ...(user ? [["Responsable", user.displayName] as [string, string]] : []),
        ],
        columns: invoiceColumns,
        rows: response.data,
        totals: [
          ["Facturas vigentes", String(summary.invoiceCount)],
          ["Subtotal", money(summary.subtotal)],
          ["Descuentos", money(summary.discountTotal)],
          ["Impuestos", money(summary.taxTotal)],
          ["Total de ventas", money(summary.total)],
          ["Promedio por factura", money(summary.average)],
          ["Nota", "Los totales solo incluyen facturas vigentes (emitidas, aceptadas o vencidas)."],
        ],
        fileName: `reporte-ventas-${response.period.from}-a-${response.period.to}`,
      };
    });

  const change = data?.summary.change;
  return (
    <>
      <form className="report-filters" onSubmit={search}>
        <label className="field">
          Fecha inicial
          <input type="date" value={draft.from} onChange={set("from")} required />
        </label>
        <label className="field">
          Fecha final
          <input type="date" value={draft.to} onChange={set("to")} min={draft.from} required />
        </label>
        <label className="field">
          Cliente
          <input value={draft.customer} onChange={set("customer")} placeholder="Nombre o identificación" />
        </label>
        <label className="field">
          Número de factura
          <input value={draft.number} onChange={set("number")} placeholder="Prefijo o número" />
        </label>
        <label className="field">
          Estado
          <select value={draft.status} onChange={set("status")}>
            <option value="">Todos (sin borradores)</option>
            {Object.entries(invoiceStatusLabels).map(([status, name]) => (
              <option key={status} value={status}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Usuario responsable
          <select value={draft.userId} onChange={set("userId")}>
            <option value="">Todos</option>
            {users.data?.data.map(user => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </select>
        </label>
        <ReportActions
          onClear={clear}
          onRefresh={report.reload}
          onExport={exportSales}
          canExport={canExport}
          busy={report.loading}
        />
      </form>

      <ReportStatus loading={report.loading && !data} error={report.error} />
      {data && (
        <>
          <section className="report-kpis" aria-label="Indicadores de ventas">
            <Kpi
              label="Total de ventas"
              value={money(data.summary.total)}
              note={`Impuestos ${money(data.summary.taxTotal)} · Descuentos ${money(data.summary.discountTotal)}`}
            />
            <Kpi label="Cantidad de facturas" value={String(data.summary.invoiceCount)} note="Solo facturas vigentes" />
            <Kpi label="Promedio por factura" value={money(data.summary.average)} />
            <Kpi
              label="Comparación con el período anterior"
              value={
                change === null || change === undefined
                  ? "Sin base"
                  : `${Number(change) > 0 ? "+" : ""}${change.replace(".", ",")} %`
              }
              note={`${date(data.summary.previous.from)} – ${date(data.summary.previous.to)}: ${money(data.summary.previous.total)}`}
            />
          </section>

          <section className="report-charts">
            <div className="panel">
              <div className="panel-head">
                <h2>Ventas por día</h2>
              </div>
              <LineChart label="Ventas por día" points={fillDays(data.period.from, data.period.to, data.byDay)} />
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Ventas por mes</h2>
              </div>
              <BarChart
                label="Ventas por mes"
                points={data.byMonth.map(month => ({
                  label: monthLabel(month.period),
                  value: Number(month.total),
                  detail: `${month.count} facturas`,
                }))}
              />
            </div>
          </section>

          <section className="panel report-table-panel">
            <div className="panel-head">
              <h2>Facturas</h2>
              <span className="report-hint">
                Pagos y saldos: ver las pestañas Recaudos y Gestión de cobro cartera Betel.
              </span>
            </div>
            <InvoiceTable rows={data.data} />
            <ReportStatus loading={false} empty={!data.data.length} />
            <Pagination {...data.pagination} onPage={setPage} />
          </section>
        </>
      )}
    </>
  );
}

/** Tabla de facturas (también la usa el detalle de un cliente). */
export function InvoiceTable({ rows }: { rows: InvoiceRow[] }) {
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        <thead>
          <tr>
            {invoiceColumns.map(column => (
              <th key={column.header} className={column.money ? "num" : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className={row.status === "VOID" || row.status === "REJECTED" ? "is-excluded" : undefined}>
              {invoiceColumns.map(column => (
                <td key={column.header} className={column.money ? "num" : undefined}>
                  {column.money ? money(column.value(row) as string) : column.value(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
