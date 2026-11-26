/**
 * Pestaña "Remisiones" del Reporte de facturación (GET /v1/reports/billing/deliveries).
 *
 * Filtro principal por cliente; "Más filtros" agrega fecha de elaboración (por defecto últimos 15 días),
 * usuario que la elaboró, tipo de transacción, estado y estado del envío de correo. Cada filtro activo
 * aparece como etiqueta que se puede quitar. Por fila: ver, enviar por correo, convertir en factura en
 * borrador o anular. Definiciones en apps/api/src/deliveries.ts y docs/reporte-facturacion.md.
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
import { periodPresets, presetRange, quoteBadge, SearchIllustration, type Preset } from "./billing-report-quotes";
import { SendEmailDialog, VoidDocumentDialog } from "./collection-dialogs";
import { ConvertQuoteDialog } from "./quote-dialogs";
import { deliveryTypeLabels } from "./quote-form";

type DeliveryRow = {
  id: string;
  number: string;
  transactionType: string;
  issueDate: string;
  customer: {
    id: string;
    legalName: string;
    identificationType: string;
    identificationNumber: string;
    email: string | null;
  };
  branch: string | null;
  email: { recipient: string; sentAt: string } | null;
  total: string;
  currency: string;
  status: "OPEN" | "INVOICED" | "VOID";
  createdBy: string | null;
};

type DeliveriesResponse = {
  data: DeliveryRow[];
  pagination: { page: number; pageSize: number; total: number };
  period: { from: string; to: string };
};

const statusLabels: Record<string, string> = { OPEN: "Abierta", INVOICED: "Facturada", VOID: "Anulada" };
const emailLabels: Record<string, string> = { SENT: "Enviado", UNSENT: "Sin enviar" };

type Filters = {
  customer: string;
  preset: Preset;
  from: string;
  to: string;
  userId: string;
  transactionType: string;
  status: string;
  email: string;
};
const emptyFilters = (): Filters => ({
  customer: "",
  preset: "last15",
  ...presetRange("last15", defaultPeriod()),
  userId: "",
  transactionType: "",
  status: "",
  email: "",
});

const deliveryColumns: ReportColumn<DeliveryRow>[] = [
  { header: "Tipo transacción", value: row => deliveryTypeLabels[row.transactionType] ?? row.transactionType },
  { header: "Comprobante", value: row => row.number },
  { header: "Fecha elaboración", value: row => date(row.issueDate) },
  { header: "Identificación", value: row => `${row.customer.identificationType} ${row.customer.identificationNumber}` },
  { header: "Sucursal", value: row => row.branch ?? "" },
  { header: "Cliente", value: row => row.customer.legalName },
  { header: "Estado envío de correo", value: row => (row.email ? `Enviado a ${row.email.recipient}` : "Sin enviar") },
  { header: "Total", value: row => row.total, money: true },
  { header: "Moneda", value: row => row.currency },
  { header: "Estado", value: row => statusLabels[row.status] },
  { header: "Elaborada por", value: row => row.createdBy ?? "" },
];

const deliveryHref = (id: string) => `/remisiones/documento?id=${id}`;

export function DeliveriesReport() {
  const { company, canExport, canSalesDocs: canEdit } = useSession();
  const users = useReport<{ data: { id: string; displayName: string }[] }>("/v1/reports/billing/users");
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [draft, setDraft] = useState<Filters>(applied);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [dialog, setDialog] = useState<{ kind: "email" | "void" | "convert"; row: DeliveryRow } | null>(null);
  const { preset: _preset, ...query } = applied;
  const params = { ...query, page, pageSize };
  const report = useReport<DeliveriesResponse>("/v1/reports/billing/deliveries", params);
  const data = report.data;
  const rows = data?.data ?? [];
  const total = data?.pagination.total ?? 0;
  const pages = Math.ceil(total / pageSize);

  const apply = (filters: Filters) => {
    const next = { ...filters, ...presetRange(filters.preset, filters) };
    setApplied(next);
    setDraft(next);
    setSearch(next.customer);
    setPage(1);
  };
  const setDraftField = (field: keyof Filters) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft({ ...draft, [field]: event.target.value });
  const userName = (id: string) => users.data?.data.find(user => user.id === id)?.displayName ?? "";

  /** Etiquetas de los filtros activos (el cliente va en el buscador, no en etiqueta). */
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
    ...(applied.userId ? [{ label: `Usuario: ${userName(applied.userId)}`, clear: { userId: "" } }] : []),
    ...(applied.transactionType
      ? [{ label: `Tipo: ${deliveryTypeLabels[applied.transactionType]}`, clear: { transactionType: "" } }]
      : []),
    ...(applied.status ? [{ label: `Estado: ${statusLabels[applied.status]}`, clear: { status: "" } }] : []),
    ...(applied.email ? [{ label: `Correo: ${emailLabels[applied.email]}`, clear: { email: "" } }] : []),
  ];

  const exportDeliveries = async (format: ExportFormat) => {
    setNotice(null);
    try {
      await exportFromApi<DeliveryRow>(format, "/v1/reports/billing/deliveries/export", params, response => ({
        company,
        title: "Reporte de facturación — Remisiones",
        period: response.period,
        filters: [
          ...(applied.customer ? [["Cliente", applied.customer] as [string, string]] : []),
          ...chips.map(chip => chip.label.split(": ") as [string, string]),
        ],
        columns: deliveryColumns,
        rows: response.data,
        totals: [
          ["Remisiones", String(response.data.length)],
          [
            "Total remitido (sin anuladas)",
            money(response.data.filter(row => row.status !== "VOID").reduce((sum, row) => sum + Number(row.total), 0)),
          ],
        ],
        fileName: `remisiones-${response.period.from}-a-${response.period.to}`,
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
        <form
          className="quotes-toolbar"
          onSubmit={event => {
            event.preventDefault();
            apply({ ...applied, customer: search.trim() });
          }}
        >
          <label className="quotes-user">
            <span>Cliente</span>
            <span className="collections-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Buscar por nombre o identificación"
                aria-label="Buscar cliente por nombre o identificación"
              />
            </span>
          </label>
          <button
            type="button"
            className="secondary quotes-more"
            aria-expanded={showFilters}
            aria-controls="deliveries-filters"
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
              onSelect: () => exportDeliveries(format),
              disabled: !canExport || !total,
              note: !canExport
                ? "Tu rol no permite descargar"
                : !total
                  ? "No hay remisiones para descargar"
                  : undefined,
            }))}
          >
            ⤓ Descargar
          </ActionMenu>
          {canEdit ? (
            <Link href="/remisiones/nueva" className="primary">
              Crear remisión
            </Link>
          ) : (
            <button type="button" className="primary" disabled title="Tu rol no permite crear remisiones">
              Crear remisión
            </button>
          )}
        </form>

        {showFilters && (
          <form
            id="deliveries-filters"
            className="collections-filters quotes-filters"
            onSubmit={event => {
              event.preventDefault();
              apply({ ...draft, customer: search.trim() });
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
              Usuario
              <select value={draft.userId} onChange={setDraftField("userId")}>
                <option value="">Todos</option>
                {users.data?.data.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Tipo transacción
              <select value={draft.transactionType} onChange={setDraftField("transactionType")}>
                <option value="">Todos</option>
                {Object.entries(deliveryTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Estado
              <select value={draft.status} onChange={setDraftField("status")}>
                <option value="">Todos</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Estado envío de correo
              <select value={draft.email} onChange={setDraftField("email")}>
                <option value="">Todos</option>
                {Object.entries(emailLabels).map(([value, label]) => (
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

        {(chips.length > 0 || applied.customer) && (
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
                    <th>Tipo transacción</th>
                    <th>Comprobante</th>
                    <th>Fecha elaboración</th>
                    <th>Identificación</th>
                    <th>Sucursal</th>
                    <th>Cliente</th>
                    <th>Estado envío de correo</th>
                    <th className="num">Total</th>
                    <th>Moneda</th>
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const open = row.status === "OPEN";
                    return (
                      <tr key={row.id} className={row.status === "VOID" ? "is-cancelled" : undefined}>
                        <td>{deliveryTypeLabels[row.transactionType] ?? row.transactionType}</td>
                        <td>
                          <Link href={deliveryHref(row.id)} className="collections-doc">
                            {row.number}
                          </Link>
                          <small>
                            <span className={quoteBadge[row.status]}>{statusLabels[row.status]}</span>
                          </small>
                        </td>
                        <td>{date(row.issueDate)}</td>
                        <td>
                          {row.customer.identificationType} {row.customer.identificationNumber}
                        </td>
                        <td title="Betel aún no maneja sucursales">{row.branch ?? "—"}</td>
                        <td>{row.customer.legalName}</td>
                        <td>
                          <span
                            className={row.email ? "email-badge is-sent" : "email-badge"}
                            title={row.email ? `Enviado a ${row.email.recipient}` : undefined}
                          >
                            {row.email ? "Enviado" : "Sin enviar"}
                          </span>
                        </td>
                        <td className="num">{money(row.total)}</td>
                        <td>{row.currency}</td>
                        <td>
                          <ActionMenu
                            label={`Acciones de ${row.number}`}
                            className="secondary quotes-row-menu"
                            items={[
                              { label: "Ver remisión", href: deliveryHref(row.id) },
                              {
                                label: "Enviar por correo",
                                onSelect: () =>
                                  apiPost<{ data: { recipient: string } }>(`/v1/deliveries/${row.id}/email`).then(
                                    result => done(`${row.number} enviada a ${result.data.recipient}.`),
                                    (error: Error) => setNotice({ kind: "error", text: error.message })
                                  ),
                                disabled: !canEdit || row.status === "VOID" || !row.customer.email,
                                note: !row.customer.email ? "El cliente no tiene correo" : undefined,
                              },
                              {
                                label: "Enviar a otro correo",
                                onSelect: () => setDialog({ kind: "email", row }),
                                disabled: !canEdit || row.status === "VOID",
                              },
                              {
                                label: "Convertir en factura",
                                onSelect: () => setDialog({ kind: "convert", row }),
                                disabled: !canEdit || !open,
                                note: row.status === "INVOICED" ? "Ya se convirtió" : undefined,
                              },
                              {
                                label: "Anular",
                                danger: true,
                                onSelect: () => setDialog({ kind: "void", row }),
                                disabled: !canEdit || !open,
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
            type: "Delivery",
            id: dialog.row.id,
            number: dialog.row.number,
            customerEmail: dialog.row.customer.email,
          }}
          send={to => apiPost(`/v1/deliveries/${dialog.row.id}/email`, { to })}
          onClose={() => setDialog(null)}
          onSent={recipient => done(`${dialog.row.number} enviada a ${recipient}.`)}
        />
      )}
      {dialog?.kind === "void" && (
        <VoidDocumentDialog
          title={`Anular remisión ${dialog.row.number}`}
          description="La remisión queda anulada y ya no se podrá enviar ni convertir en factura."
          path={`/v1/deliveries/${dialog.row.id}/void`}
          confirmLabel="Anular remisión"
          onClose={() => setDialog(null)}
          onVoided={() => done(`Remisión ${dialog.row.number} anulada.`)}
        />
      )}
      {dialog?.kind === "convert" && (
        <ConvertQuoteDialog
          quote={{ id: dialog.row.id, number: dialog.row.number }}
          path={`/v1/deliveries/${dialog.row.id}/invoice`}
          noun="La remisión"
          onClose={() => setDialog(null)}
          onConverted={() => done(`${dialog.row.number} convertida en factura en borrador.`)}
        />
      )}
    </>
  );
}
