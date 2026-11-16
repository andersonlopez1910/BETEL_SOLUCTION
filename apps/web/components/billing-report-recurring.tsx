/**
 * Pestaña "Facturas recurrentes" del Reporte de facturación (GET /v1/reports/billing/recurring-invoices).
 *
 * Filtro principal por recurrencia; "Más filtros" agrega fecha de inicio (por defecto este mes), estado
 * (por defecto activas) y cliente, como etiquetas que se quitan. El interruptor "Activo" activa o
 * desactiva la plantilla; el menú de acción permite verla y generar ya la factura del período pendiente.
 * La generación automática corre en la API (apps/api/src/recurring.ts).
 */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiPost } from "../lib/api";
import type { ExportFormat, ReportColumn } from "../lib/report-export";
import { ActionMenu } from "./action-menu";
import {
  date,
  defaultPeriod,
  exportFromApi,
  money,
  ReportStatus,
  useReport,
  useSession,
} from "./billing-report-common";
import { FilterIcon } from "./billing-report-collections";
import { periodPresets, presetRange, SearchIllustration, type Preset } from "./billing-report-quotes";
import { frequencyLabels } from "./quote-form";

type RecurringRow = {
  id: string;
  number: string;
  customer: { id: string; legalName: string; identificationType: string; identificationNumber: string };
  branch: string | null;
  frequency: string;
  occurrences: number | null;
  generatedCount: number;
  startDate: string;
  nextRunDate: string | null;
  active: boolean;
  paymentTerm: string;
  total: string;
  currency: string;
  createdBy: string | null;
};

type RecurringResponse = {
  data: RecurringRow[];
  pagination: { page: number; pageSize: number; total: number };
  period: { from: string; to: string };
};

type Filters = { frequency: string; preset: Preset; from: string; to: string; active: string; customer: string };
const emptyFilters = (): Filters => ({
  frequency: "",
  preset: "month",
  ...defaultPeriod(),
  active: "true",
  customer: "",
});
const activeLabels: Record<string, string> = { true: "Activo", false: "Inactivo" };
const BANNER_KEY = "betel.recurringBannerClosed";

/** "1 de 12" o "1 de ∞" cuando no hay límite. */
export const timesLabel = (row: { generatedCount: number; occurrences: number | null }) =>
  `${row.generatedCount} de ${row.occurrences ?? "∞"}`;
export const recurringHref = (id: string) => `/facturas-recurrentes/documento?id=${id}`;

const columns: ReportColumn<RecurringRow>[] = [
  { header: "Factura recurrente", value: row => row.number },
  { header: "Identificación", value: row => `${row.customer.identificationType} ${row.customer.identificationNumber}` },
  { header: "Sucursal", value: row => row.branch ?? "" },
  { header: "Cliente", value: row => row.customer.legalName },
  { header: "Recurrencia", value: row => frequencyLabels[row.frequency] ?? row.frequency },
  { header: "Número de veces", value: timesLabel },
  { header: "Fecha inicio", value: row => date(row.startDate) },
  { header: "Próxima factura", value: row => (row.nextRunDate ? date(row.nextRunDate) : "Finalizada") },
  { header: "Activo", value: row => (row.active ? "Sí" : "No") },
  { header: "Forma de pago", value: row => (row.paymentTerm === "CREDIT" ? "Crédito" : "Contado") },
  { header: "Total por factura", value: row => row.total, money: true },
];

export function RecurringReport() {
  const { company, canExport, canEmail: canEdit } = useSession();
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [draft, setDraft] = useState<Filters>(applied);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [banner, setBanner] = useState(true);
  const [learnMore, setLearnMore] = useState(false);
  const { preset: _preset, ...query } = applied;
  const params = { ...query, page, pageSize };
  const report = useReport<RecurringResponse>("/v1/reports/billing/recurring-invoices", params);
  const data = report.data;
  const rows = data?.data ?? [];
  const total = data?.pagination.total ?? 0;
  const pages = Math.ceil(total / pageSize);

  // El aviso cerrado se recuerda solo en este navegador (comodidad, no dato del sistema).
  useEffect(() => {
    try {
      if (localStorage.getItem(BANNER_KEY)) setBanner(false);
    } catch {}
  }, []);
  const closeBanner = () => {
    setBanner(false);
    try {
      localStorage.setItem(BANNER_KEY, "1");
    } catch {}
  };

  const apply = (filters: Filters) => {
    const next = { ...filters, ...presetRange(filters.preset, filters) };
    setApplied(next);
    setDraft(next);
    setPage(1);
  };
  const setDraftField = (field: keyof Filters) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft({ ...draft, [field]: event.target.value });

  const chips: { label: string; clear: Partial<Filters> }[] = [
    ...(applied.preset !== "all"
      ? [
          {
            label: `Fecha inicio: ${
              applied.preset === "custom"
                ? `${date(applied.from)} – ${date(applied.to)}`
                : periodPresets[applied.preset]
            }`,
            clear: { preset: "all" as Preset },
          },
        ]
      : []),
    ...(applied.active ? [{ label: `Estado: ${activeLabels[applied.active]}`, clear: { active: "" } }] : []),
    ...(applied.customer ? [{ label: `Cliente: ${applied.customer}`, clear: { customer: "" } }] : []),
  ];

  const run = async (action: () => Promise<unknown>, done: string) => {
    setNotice(null);
    try {
      await action();
      setNotice({ kind: "ok", text: done });
      report.reload();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };
  const toggle = (row: RecurringRow) =>
    run(
      () => apiPost(`/v1/recurring-invoices/${row.id}/active`, { active: !row.active }),
      `${row.number} ${row.active ? "desactivada" : "activada"}.`
    );

  const exportRecurring = async (format: ExportFormat) => {
    setNotice(null);
    try {
      await exportFromApi<RecurringRow>(format, "/v1/reports/billing/recurring-invoices/export", params, response => ({
        company,
        title: "Reporte de facturación — Facturas recurrentes",
        period: response.period,
        filters: [
          ...(applied.frequency ? [["Recurrencia", frequencyLabels[applied.frequency]!] as [string, string]] : []),
          ...chips.map(chip => chip.label.split(": ") as [string, string]),
        ],
        columns,
        rows: response.data,
        totals: [
          ["Facturas recurrentes", String(response.data.length)],
          ["Activas", String(response.data.filter(row => row.active).length)],
        ],
        fileName: `facturas-recurrentes-${response.period.from}-a-${response.period.to}`,
      }));
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };

  return (
    <>
      {banner && (
        <div className="recurring-banner" role="note">
          <span aria-hidden="true">i</span>
          <p>
            Ten en cuenta que la fecha de elaboración de tus facturas recurrentes deberá ser igual a la fecha de envío a
            la DIAN, para evitar rechazos durante la validación.{" "}
            <button
              type="button"
              className="report-link"
              aria-expanded={learnMore}
              onClick={() => setLearnMore(!learnMore)}
            >
              {learnMore ? "Ver menos" : "Conocer más"}
            </button>
            {learnMore && (
              <small>
                Por eso Betel genera cada factura con la fecha del día en que se crea (no con la fecha programada) y la
                deja en borrador para emitirla ese mismo día desde Ventas. Si la generación se atrasa, no se crean
                facturas atrasadas en lote: se genera la del período vencido y se continúa con la siguiente fecha.
              </small>
            )}
          </p>
          <button type="button" className="recurring-banner-close" aria-label="Cerrar aviso" onClick={closeBanner}>
            ×
          </button>
        </div>
      )}

      <section className="panel collections quotes">
        <div className="quotes-toolbar">
          <label className="quotes-user">
            <span>Recurrencia</span>
            <span className="collections-search">
              <select
                value={applied.frequency}
                onChange={event => apply({ ...applied, frequency: event.target.value })}
              >
                <option value="">Seleccione una opción</option>
                {Object.entries(frequencyLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <button
            type="button"
            className="secondary quotes-more"
            aria-expanded={showFilters}
            aria-controls="recurring-filters"
            onClick={() => {
              setDraft(applied);
              setShowFilters(!showFilters);
            }}
          >
            <FilterIcon /> Más filtros
            {chips.length > 0 && <b className="quotes-count">{chips.length}</b>}
          </button>
          <span className="collections-spacer" />
          <ActionMenu
            label="Descargar"
            className="secondary quotes-download"
            items={(["pdf", "xlsx", "csv"] as const).map(format => ({
              label: format === "xlsx" ? "Excel (XLSX)" : format.toUpperCase(),
              onSelect: () => exportRecurring(format),
              disabled: !canExport || !total,
              note: !canExport ? "Tu rol no permite descargar" : !total ? "No hay facturas para descargar" : undefined,
            }))}
          >
            ⤓ Descargar
          </ActionMenu>
          {canEdit ? (
            <Link href="/facturas-recurrentes/nueva" className="primary">
              Crear factura recurrente
            </Link>
          ) : (
            <button type="button" className="primary" disabled title="Tu rol no permite crear facturas recurrentes">
              Crear factura recurrente
            </button>
          )}
        </div>

        {showFilters && (
          <form
            id="recurring-filters"
            className="collections-filters quotes-filters"
            onSubmit={event => {
              event.preventDefault();
              apply(draft);
              setShowFilters(false);
            }}
          >
            <label className="field">
              Fecha inicio
              <select value={draft.preset} onChange={setDraftField("preset")}>
                {Object.entries(periodPresets).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {draft.preset === "custom" && (
              <>
                <label className="field">
                  Desde
                  <input type="date" value={draft.from} onChange={setDraftField("from")} required />
                </label>
                <label className="field">
                  Hasta
                  <input type="date" value={draft.to} onChange={setDraftField("to")} min={draft.from} required />
                </label>
              </>
            )}
            <label className="field">
              Estado
              <select value={draft.active} onChange={setDraftField("active")}>
                <option value="">Todos</option>
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </label>
            <label className="field">
              Cliente
              <input
                value={draft.customer}
                onChange={setDraftField("customer")}
                placeholder="Nombre o identificación"
              />
            </label>
            <div className="report-actions">
              <button type="submit" className="primary">
                Aplicar
              </button>
              <button type="button" className="secondary" onClick={() => setShowFilters(false)}>
                Cancelar
              </button>
            </div>
          </form>
        )}

        {(chips.length > 0 || applied.frequency) && (
          <div className="quotes-chips">
            {chips.map(chip => (
              <span key={chip.label} className="quotes-chip">
                {chip.label}
                <button
                  type="button"
                  aria-label={`Quitar filtro ${chip.label}`}
                  onClick={() => apply({ ...applied, ...chip.clear })}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              className="report-link"
              onClick={() => apply({ ...emptyFilters(), preset: "all", active: "" })}
            >
              Limpiar filtros
            </button>
          </div>
        )}

        {notice && (
          <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
            {notice.text}
          </p>
        )}
        <ReportStatus loading={report.loading && !data} error={report.error} />

        {data && (
          <>
            <div className="report-table-wrap">
              <table className="report-table collections-table quotes-table">
                <thead>
                  <tr>
                    <th>Factura recurrente</th>
                    <th>Identificación</th>
                    <th>Sucursal</th>
                    <th>Cliente</th>
                    <th>Recurrencia</th>
                    <th>Número de veces</th>
                    <th>Fecha inicio</th>
                    <th>Activo</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className={row.active ? undefined : "is-cancelled"}>
                      <td>
                        <Link href={recurringHref(row.id)} className="collections-doc">
                          {row.number}
                        </Link>
                        <small>
                          {money(row.total)} · {row.paymentTerm === "CREDIT" ? "Crédito" : "Contado"}
                        </small>
                      </td>
                      <td>
                        {row.customer.identificationType} {row.customer.identificationNumber}
                      </td>
                      <td title="Betel aún no maneja sucursales">{row.branch ?? "—"}</td>
                      <td>{row.customer.legalName}</td>
                      <td>{frequencyLabels[row.frequency] ?? row.frequency}</td>
                      <td>{timesLabel(row)}</td>
                      <td>
                        {date(row.startDate)}
                        <small>{row.nextRunDate ? `Próxima: ${date(row.nextRunDate)}` : "Finalizada"}</small>
                      </td>
                      <td>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={row.active}
                          aria-label={`${row.number} activa`}
                          className="recurring-switch"
                          disabled={!canEdit}
                          onClick={() => toggle(row)}
                        >
                          <span />
                        </button>
                      </td>
                      <td>
                        <ActionMenu
                          label={`Acciones de ${row.number}`}
                          className="secondary quotes-row-menu"
                          items={[
                            { label: "Ver factura recurrente", href: recurringHref(row.id) },
                            {
                              label: "Generar factura ahora",
                              onSelect: () =>
                                run(
                                  () => apiPost(`/v1/recurring-invoices/${row.id}/generate`),
                                  `Factura de ${row.number} creada en borrador con la fecha de hoy.`
                                ),
                              disabled: !canEdit || !row.active || !row.nextRunDate,
                              note: !row.nextRunDate
                                ? "Ya alcanzó el número de veces"
                                : !row.active
                                  ? "Está inactiva"
                                  : undefined,
                            },
                            {
                              label: row.active ? "Desactivar" : "Activar",
                              onSelect: () => toggle(row),
                              disabled: !canEdit,
                              danger: row.active,
                            },
                          ]}
                        >
                          ⋯
                        </ActionMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <div className="pay-empty">
                <SearchIllustration />
                <h3>No se encontraron resultados para tu búsqueda.</h3>
                <p>Modifica tus criterios de búsqueda o filtrado e inténtalo de nuevo.</p>
              </div>
            )}
            <div className="pay-pagination quotes-pagination">
              <label>
                Items por página
                <select
                  value={pageSize}
                  onChange={event => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  {[10, 25, 50, 100].map(size => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <span>
                {total ? (page - 1) * pageSize + 1 : 0} a {Math.min(page * pageSize, total)} de {total}
              </span>
              <button type="button" aria-label="Primera página" disabled={page <= 1} onClick={() => setPage(1)}>
                «
              </button>
              <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ‹
              </button>
              <span>
                Página <b>{total ? page : 0}</b> de <b>{pages}</b>
              </span>
              <button
                type="button"
                aria-label="Página siguiente"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                ›
              </button>
              <button type="button" aria-label="Última página" disabled={page >= pages} onClick={() => setPage(pages)}>
                »
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
