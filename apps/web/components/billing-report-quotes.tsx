/**
 * Pestaña "Cotizaciones" del Reporte de facturación (GET /v1/reports/billing/quotes).
 *
 * Filtro principal por usuario que elaboró la cotización; "Más filtros" agrega período de elaboración,
 * cliente y estado, y cada filtro activo aparece como etiqueta que se puede quitar. "Descargar" exporta
 * lo filtrado (PDF, XLSX o CSV). Cada fila permite ver, enviar por correo, convertir en factura en
 * borrador o anular. Definiciones en apps/api/src/quotes.ts y docs/reporte-facturacion.md.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
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
import { SendEmailDialog, VoidDocumentDialog } from "./collection-dialogs";
import { ConvertQuoteDialog } from "./quote-dialogs";

export type QuoteRow = {
  id: string;
  number: string;
  issueDate: string;
  validUntil: string | null;
  customer: {
    id: string;
    legalName: string;
    identificationType: string;
    identificationNumber: string;
    email: string | null;
  };
  branch: string | null;
  total: string;
  currency: string;
  status: "OPEN" | "EXPIRED" | "INVOICED" | "VOID";
  createdBy: string | null;
  invoiceId: string | null;
};

type QuotesResponse = {
  data: QuoteRow[];
  pagination: { page: number; pageSize: number; total: number };
  period: { from: string; to: string };
};

export const quoteStatusLabels: Record<string, string> = {
  OPEN: "Abierta",
  EXPIRED: "Vencida",
  INVOICED: "Facturada",
  VOID: "Anulada",
};
export const quoteBadge: Record<string, string> = {
  OPEN: "pay-badge is-ok",
  EXPIRED: "pay-badge is-pending",
  INVOICED: "pay-badge is-info",
  VOID: "pay-badge",
};

/** Períodos rápidos de "Fecha elaboración". "all" quita el filtro de fecha. */
export const periodPresets = {
  month: "Este mes",
  last15: "Últimos 15 días",
  lastMonth: "Mes anterior",
  last30: "Últimos 30 días",
  year: "Este año",
  all: "Todas las fechas",
  custom: "Rango personalizado",
} as const;
export type Preset = keyof typeof periodPresets;

export function presetRange(preset: Preset, custom: { from: string; to: string }) {
  const today = defaultPeriod().to;
  const shift = (days: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const [year, month] = today.split("-").map(Number) as [number, number];
  switch (preset) {
    case "month":
      return defaultPeriod();
    case "lastMonth": {
      const first = new Date(Date.UTC(year, month - 2, 1));
      const last = new Date(Date.UTC(year, month - 1, 0));
      return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
    }
    case "last15":
      return { from: shift(-14), to: today };
    case "last30":
      return { from: shift(-29), to: today };
    case "year":
      return { from: `${year}-01-01`, to: today };
    case "all":
      return { from: "2000-01-01", to: today };
    case "custom":
      return custom;
  }
}

type Filters = { userId: string; preset: Preset; from: string; to: string; customer: string; status: string };
const emptyFilters = (): Filters => ({ userId: "", preset: "month", ...defaultPeriod(), customer: "", status: "" });

const quoteColumns: ReportColumn<QuoteRow>[] = [
  { header: "Comprobante", value: row => row.number },
  { header: "Fecha elaboración", value: row => date(row.issueDate) },
  { header: "Identificación", value: row => `${row.customer.identificationType} ${row.customer.identificationNumber}` },
  { header: "Sucursal", value: row => row.branch ?? "" },
  { header: "Cliente", value: row => row.customer.legalName },
  { header: "Total", value: row => row.total, money: true },
  { header: "Moneda", value: row => row.currency },
  { header: "Estado", value: row => quoteStatusLabels[row.status] },
  { header: "Válida hasta", value: row => (row.validUntil ? date(row.validUntil) : "") },
  { header: "Elaborada por", value: row => row.createdBy ?? "" },
];

export const quoteHref = (id: string) => `/cotizaciones/documento?id=${id}`;

export function QuotesReport() {
  const { company, canExport, canEmail: canQuote } = useSession();
  const users = useReport<{ data: { id: string; displayName: string }[] }>("/v1/reports/billing/users");
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [draft, setDraft] = useState<Filters>(applied);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [dialog, setDialog] = useState<{ kind: "email" | "void" | "convert"; row: QuoteRow } | null>(null);
  const params = {
    userId: applied.userId,
    from: applied.from,
    to: applied.to,
    customer: applied.customer,
    status: applied.status,
    page,
    pageSize,
  };
  const report = useReport<QuotesResponse>("/v1/reports/billing/quotes", params);
  const data = report.data;
  const rows = data?.data ?? [];
  const total = data?.pagination.total ?? 0;
  const pages = Math.ceil(total / pageSize);

  const apply = (filters: Filters) => {
    const range = presetRange(filters.preset, filters);
    const next = { ...filters, ...range };
    setApplied(next);
    setDraft(next);
    setPage(1);
  };
  const setDraftField = (field: keyof Filters) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft({ ...draft, [field]: event.target.value });

  /** Etiquetas de los filtros activos (la fecha "Este mes" es el valor por defecto, pero se muestra). */
  const chips: { label: string; clear: Partial<Filters> }[] = [
    ...(applied.preset !== "all"
      ? [
          {
            label: `Fecha elaboración: ${
              applied.preset === "custom"
                ? `${date(applied.from)} – ${date(applied.to)}`
                : periodPresets[applied.preset]
            }`,
            clear: { preset: "all" as Preset },
          },
        ]
      : []),
    ...(applied.customer ? [{ label: `Cliente: ${applied.customer}`, clear: { customer: "" } }] : []),
    ...(applied.status ? [{ label: `Estado: ${quoteStatusLabels[applied.status]}`, clear: { status: "" } }] : []),
  ];
  const filterCount = chips.length;

  const exportQuotes = async (format: ExportFormat) => {
    setNotice(null);
    try {
      await exportFromApi<QuoteRow>(format, "/v1/reports/billing/quotes/export", params, response => ({
        company,
        title: "Reporte de facturación — Cotizaciones",
        period: response.period,
        filters: [
          ...(applied.userId
            ? [
                ["Usuario", users.data?.data.find(user => user.id === applied.userId)?.displayName ?? ""] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...chips.map(chip => chip.label.split(": ") as [string, string]),
        ],
        columns: quoteColumns,
        rows: response.data,
        totals: [
          ["Cotizaciones", String(response.data.length)],
          [
            "Total cotizado (sin anuladas)",
            money(response.data.filter(row => row.status !== "VOID").reduce((sum, row) => sum + Number(row.total), 0)),
          ],
        ],
        fileName: `cotizaciones-${response.period.from}-a-${response.period.to}`,
      }));
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };

  const done = (text: string) => {
    setDialog(null);
    setNotice({ kind: "ok", text });
    report.reload();
  };

  return (
    <>
      <section className="panel collections quotes">
        <div className="quotes-toolbar">
          <label className="quotes-user">
            <span>Usuario</span>
            <span className="collections-search">
              <span aria-hidden="true">⌕</span>
              <select value={applied.userId} onChange={event => apply({ ...applied, userId: event.target.value })}>
                <option value="">Todos los usuarios</option>
                {users.data?.data.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <button
            type="button"
            className="secondary quotes-more"
            aria-expanded={showFilters}
            aria-controls="quotes-filters"
            onClick={() => {
              setDraft(applied);
              setShowFilters(!showFilters);
            }}
          >
            <FilterIcon /> Más filtros
            {filterCount > 0 && <b className="quotes-count">{filterCount}</b>}
          </button>
          <span className="collections-spacer" />
          <ActionMenu
            label="Descargar"
            className="secondary quotes-download"
            items={(["pdf", "xlsx", "csv"] as const).map(format => ({
              label: format === "xlsx" ? "Excel (XLSX)" : format.toUpperCase(),
              onSelect: () => exportQuotes(format),
              disabled: !canExport || !total,
              note: !canExport
                ? "Tu rol no permite descargar"
                : !total
                  ? "No hay cotizaciones para descargar"
                  : undefined,
            }))}
          >
            ⤓ Descargar
          </ActionMenu>
          {canQuote ? (
            <Link href="/cotizaciones/nueva" className="primary">
              Crear cotización
            </Link>
          ) : (
            <button type="button" className="primary" disabled title="Tu rol no permite crear cotizaciones">
              Crear cotización
            </button>
          )}
        </div>

        {showFilters && (
          <form
            id="quotes-filters"
            className="collections-filters quotes-filters"
            onSubmit={event => {
              event.preventDefault();
              apply(draft);
              setShowFilters(false);
            }}
          >
            <label className="field">
              Fecha elaboración
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
              Cliente
              <input
                value={draft.customer}
                onChange={setDraftField("customer")}
                placeholder="Nombre o identificación"
              />
            </label>
            <label className="field">
              Estado
              <select value={draft.status} onChange={setDraftField("status")}>
                <option value="">Todos</option>
                {Object.entries(quoteStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
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

        {(chips.length > 0 || applied.userId) && (
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
            <button type="button" className="report-link" onClick={() => apply({ ...emptyFilters(), preset: "all" })}>
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
                    <th>Comprobante</th>
                    <th>Fecha elaboración</th>
                    <th>Identificación</th>
                    <th>Sucursal</th>
                    <th>Cliente</th>
                    <th className="num">Total</th>
                    <th>Moneda</th>
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const open = row.status === "OPEN" || row.status === "EXPIRED";
                    return (
                      <tr key={row.id} className={row.status === "VOID" ? "is-cancelled" : undefined}>
                        <td>
                          <Link href={quoteHref(row.id)} className="collections-doc">
                            {row.number}
                          </Link>
                          <small>
                            <span className={quoteBadge[row.status]}>{quoteStatusLabels[row.status]}</span>
                          </small>
                        </td>
                        <td>{date(row.issueDate)}</td>
                        <td>
                          {row.customer.identificationType} {row.customer.identificationNumber}
                        </td>
                        <td title="Betel aún no maneja sucursales">{row.branch ?? "—"}</td>
                        <td>{row.customer.legalName}</td>
                        <td className="num">{money(row.total)}</td>
                        <td>{row.currency}</td>
                        <td>
                          <ActionMenu
                            label={`Acciones de ${row.number}`}
                            className="secondary quotes-row-menu"
                            items={[
                              { label: "Ver cotización", href: quoteHref(row.id) },
                              {
                                label: "Enviar por correo",
                                onSelect: () =>
                                  apiPost<{ data: { recipient: string } }>(`/v1/quotes/${row.id}/email`).then(
                                    result => done(`${row.number} enviada a ${result.data.recipient}.`),
                                    (error: Error) => setNotice({ kind: "error", text: error.message })
                                  ),
                                disabled: !canQuote || row.status === "VOID" || !row.customer.email,
                                note: !row.customer.email ? "El cliente no tiene correo" : undefined,
                              },
                              {
                                label: "Enviar a otro correo",
                                onSelect: () => setDialog({ kind: "email", row }),
                                disabled: !canQuote || row.status === "VOID",
                              },
                              {
                                label: "Convertir en factura",
                                onSelect: () => setDialog({ kind: "convert", row }),
                                disabled: !canQuote || !open,
                                note: row.status === "INVOICED" ? "Ya se convirtió" : undefined,
                              },
                              {
                                label: "Anular",
                                danger: true,
                                onSelect: () => setDialog({ kind: "void", row }),
                                disabled: !canQuote || !open,
                              },
                            ]}
                          >
                            ⋯
                          </ActionMenu>
                        </td>
                      </tr>
                    );
                  })}
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

      {dialog?.kind === "email" && (
        <SendEmailDialog
          document={{
            type: "Quote",
            id: dialog.row.id,
            number: dialog.row.number,
            customerEmail: dialog.row.customer.email,
          }}
          send={to => apiPost(`/v1/quotes/${dialog.row.id}/email`, { to })}
          onClose={() => setDialog(null)}
          onSent={recipient => done(`${dialog.row.number} enviada a ${recipient}.`)}
        />
      )}
      {dialog?.kind === "void" && (
        <VoidDocumentDialog
          title={`Anular cotización ${dialog.row.number}`}
          description="La cotización queda anulada y ya no se podrá enviar ni convertir en factura."
          path={`/v1/quotes/${dialog.row.id}/void`}
          confirmLabel="Anular cotización"
          onClose={() => setDialog(null)}
          onVoided={() => done(`Cotización ${dialog.row.number} anulada.`)}
        />
      )}
      {dialog?.kind === "convert" && (
        <ConvertQuoteDialog
          quote={{ id: dialog.row.id, number: dialog.row.number }}
          onClose={() => setDialog(null)}
          onConverted={() => done(`${dialog.row.number} convertida en factura en borrador.`)}
        />
      )}
    </>
  );
}

/** Documento con lupa (sin resultados). */
export function SearchIllustration() {
  return (
    <svg width="110" height="100" viewBox="0 0 110 100" aria-hidden="true">
      <ellipse cx="58" cy="92" rx="32" ry="5" fill="#e2ebf3" />
      <circle cx="62" cy="50" r="36" fill="#eaf2fe" />
      <rect x="44" y="14" width="44" height="58" rx="6" fill="#3b82f6" transform="rotate(8 66 43)" />
      <rect x="40" y="16" width="44" height="58" rx="6" fill="#ffffff" stroke="#2563eb" strokeWidth="2" />
      <path d="M48 30h28M48 38h28M48 46h20M48 54h24" stroke="#a9c6f5" strokeWidth="3" strokeLinecap="round" />
      <rect x="54" y="10" width="16" height="8" rx="3" fill="#2563eb" />
      <circle cx="40" cy="62" r="13" fill="#dbe8fd" stroke="#3e5568" strokeWidth="4" />
      <path d="M31 72l-10 11" stroke="#0d293b" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}
