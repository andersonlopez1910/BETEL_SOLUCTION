/**
 * "Facturación por cliente": reporte de la pestaña Clientes que se abre desde "Ver reportes"
 * (la vista principal de la pestaña es la cartera, en billing-report-portfolio.tsx).
 *
 * Lista: GET /v1/reports/billing/customers (consolidado paginado, búsqueda por nombre o identificación).
 * Detalle: GET /v1/reports/billing/customers/:id (historial de facturas y evolución mensual).
 * Los saldos por cliente están en la cartera y en el estado de cuenta.
 */
"use client";

import { useState } from "react";
import type { ReportColumn } from "../lib/report-export";
import {
  date,
  defaultPeriod,
  exportFromApi,
  Kpi,
  money,
  Pagination,
  ReportActions,
  ReportStatus,
  useReport,
  useSession,
} from "./billing-report-common";
import { InvoiceTable, type InvoiceRow } from "./billing-report-sales";
import { BarChart } from "./report-charts";

type CustomerRow = {
  id: string;
  legalName: string;
  tradeName: string | null;
  identificationType: string;
  identificationNumber: string;
  invoiceCount: number;
  totalInvoiced: string;
  overdueCount: number;
  lastInvoiceDate: string | null;
};

type CustomersResponse = {
  data: CustomerRow[];
  pagination: { page: number; pageSize: number; total: number };
  period: { from: string; to: string };
  summary: { invoiceCount: number; total: string };
};

type CustomerDetailResponse = {
  data: InvoiceRow[];
  pagination: { page: number; pageSize: number; total: number };
  customer: {
    id: string;
    legalName: string;
    tradeName: string | null;
    identificationType: string;
    identificationNumber: string;
    email: string | null;
    phone: string | null;
  };
  summary: {
    invoiceCount: number;
    total: string;
    average: string;
    overdueCount: number;
    lastInvoiceDate: string | null;
  };
  byMonth: { period: string; total: string; count: number }[];
};

type Filters = { from: string; to: string; search: string };
const emptyFilters = (): Filters => ({ ...defaultPeriod(), search: "" });

const customerColumns: ReportColumn<CustomerRow>[] = [
  { header: "Cliente", value: row => row.legalName },
  { header: "Identificación", value: row => `${row.identificationType} ${row.identificationNumber}` },
  { header: "Facturas", value: row => row.invoiceCount },
  { header: "Total facturado", value: row => row.totalInvoiced, money: true },
  { header: "Facturas vencidas", value: row => row.overdueCount },
  { header: "Última facturación", value: row => date(row.lastInvoiceDate) },
];

export function CustomersReport({
  initialCustomer = null,
  onClose,
}: {
  /** Abre directamente el detalle de este cliente. */
  initialCustomer?: string | null;
  /** Volver a la cartera. */
  onClose: () => void;
}) {
  const { company, canExport } = useSession();
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(draft);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(initialCustomer);
  const report = useReport<CustomersResponse>("/v1/reports/billing/customers", { ...applied, page });
  const data = report.data;

  if (selected)
    return (
      <CustomerDetail id={selected} period={applied} onBack={() => (initialCustomer ? onClose() : setSelected(null))} />
    );

  const set = (field: keyof Filters) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft({ ...draft, [field]: event.target.value });

  const exportCustomers = (format: Parameters<typeof exportFromApi>[0]) =>
    exportFromApi<CustomerRow>(format, "/v1/reports/billing/customers/export", applied, response => {
      const summary = response.summary as CustomersResponse["summary"];
      return {
        company,
        title: "Reporte de facturación — Clientes",
        period: response.period,
        filters: applied.search ? [["Búsqueda", applied.search]] : [],
        columns: customerColumns,
        rows: response.data,
        totals: [
          ["Clientes", String(response.data.length)],
          ["Facturas vigentes", String(summary.invoiceCount)],
          ["Total facturado", money(summary.total)],
          ["Nota", "Total recaudado y saldo pendiente no disponibles: no existe el módulo de Recaudos."],
        ],
        fileName: `reporte-clientes-${response.period.from}-a-${response.period.to}`,
      };
    });

  return (
    <>
      <div className="report-detail-head">
        <button type="button" className="secondary" onClick={onClose}>
          ‹ Volver a la cartera de clientes
        </button>
        <h2>Facturación por cliente</h2>
      </div>
      <form
        className="report-filters"
        onSubmit={event => {
          event.preventDefault();
          setApplied(draft);
          setPage(1);
        }}
      >
        <label className="field">
          Fecha inicial
          <input type="date" value={draft.from} onChange={set("from")} required />
        </label>
        <label className="field">
          Fecha final
          <input type="date" value={draft.to} onChange={set("to")} min={draft.from} required />
        </label>
        <label className="field report-field-wide">
          Cliente
          <input value={draft.search} onChange={set("search")} placeholder="Nombre o identificación" />
        </label>
        <ReportActions
          onClear={() => {
            const reset = emptyFilters();
            setDraft(reset);
            setApplied(reset);
            setPage(1);
          }}
          onRefresh={report.reload}
          onExport={exportCustomers}
          canExport={canExport}
          busy={report.loading}
        />
      </form>

      <ReportStatus loading={report.loading && !data} error={report.error} />
      {data && (
        <>
          <section className="report-kpis" aria-label="Indicadores de clientes">
            <Kpi label="Clientes encontrados" value={String(data.pagination.total)} />
            <Kpi label="Total facturado" value={money(data.summary.total)} note="Facturas vigentes del período" />
            <Kpi label="Facturas vigentes" value={String(data.summary.invoiceCount)} />
          </section>
          <section className="panel report-table-panel">
            <div className="panel-head">
              <h2>Facturación por cliente</h2>
              <span className="report-hint">
                Recaudado y saldo: no disponibles hasta que exista el módulo de Recaudos.
              </span>
            </div>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    {customerColumns.map(column => (
                      <th key={column.header} className={column.money ? "num" : undefined}>
                        {column.header}
                      </th>
                    ))}
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map(row => (
                    <tr key={row.id}>
                      {customerColumns.map(column => (
                        <td key={column.header} className={column.money ? "num" : undefined}>
                          {column.money ? money(column.value(row) as string) : column.value(row)}
                        </td>
                      ))}
                      <td>
                        <button type="button" className="report-link" onClick={() => setSelected(row.id)}>
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ReportStatus loading={false} empty={!data.data.length} />
            <Pagination {...data.pagination} onPage={setPage} />
          </section>
        </>
      )}
    </>
  );
}

/** Detalle de un cliente en el mismo período que la lista. */
function CustomerDetail({ id, period, onBack }: { id: string; period: Filters; onBack: () => void }) {
  const [page, setPage] = useState(1);
  const detail = useReport<CustomerDetailResponse>(`/v1/reports/billing/customers/${id}`, {
    from: period.from,
    to: period.to,
    page,
  });
  const data = detail.data;
  return (
    <>
      <div className="report-detail-head">
        <button type="button" className="secondary" onClick={onBack}>
          ‹ Volver a clientes
        </button>
        {data && (
          <div>
            <h2>{data.customer.legalName}</h2>
            <span>
              {data.customer.identificationType} {data.customer.identificationNumber}
              {data.customer.email && ` · ${data.customer.email}`}
              {` · Período ${date(period.from)} – ${date(period.to)}`}
            </span>
          </div>
        )}
      </div>
      <ReportStatus loading={detail.loading && !data} error={detail.error} />
      {data && (
        <>
          <section className="report-kpis" aria-label="Indicadores del cliente">
            <Kpi label="Total facturado" value={money(data.summary.total)} />
            <Kpi label="Facturas vigentes" value={String(data.summary.invoiceCount)} />
            <Kpi label="Facturas vencidas" value={String(data.summary.overdueCount)} />
            <Kpi label="Última facturación" value={date(data.summary.lastInvoiceDate)} />
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Evolución de facturación</h2>
            </div>
            <BarChart
              label={`Facturación mensual de ${data.customer.legalName}`}
              points={data.byMonth.map(month => ({
                label: new Date(`${month.period}-01T00:00:00Z`).toLocaleDateString("es-CO", {
                  month: "short",
                  year: "2-digit",
                  timeZone: "UTC",
                }),
                value: Number(month.total),
                detail: `${month.count} facturas`,
              }))}
            />
          </section>
          <section className="panel report-table-panel">
            <div className="panel-head">
              <h2>Historial de facturación</h2>
              <span className="report-hint">Pagos y facturas pendientes: requieren el módulo de Recaudos.</span>
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
