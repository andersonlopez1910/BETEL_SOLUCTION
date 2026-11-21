/**
 * Módulo "Compras y gastos" (/compras): barra de submenús y su contenido.
 *
 * Submenús, en orden: Documentos de compras y gastos (funcional), Registro de eventos, Proveedores y
 * Soporte por legalizar. Los tres últimos aún no tienen su desarrollo y lo indican en lugar de mostrar
 * datos inventados. La pestaña activa va en la URL (?tab=documentos).
 *
 * Documentos: GET /v1/reports/purchases/documents (compras y gastos con factura del proveedor + documentos
 * soporte). Definiciones en apps/api/src/purchases.ts y docs/compras-y-gastos.md.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { periodPresets, presetRange, SearchIllustration, type Preset } from "./billing-report-quotes";
import { VoidDocumentDialog } from "./collection-dialogs";

/** [slug, nombre del submenú, pendiente de desarrollo]. Orden y nombres de la referencia. */
const purchaseTabs = [
  ["documentos", "Documentos de compras y gastos", null],
  [
    "eventos",
    "Registro de eventos",
    "el registro de eventos de las facturas electrónicas recibidas (acuse de recibo, recibo del bien, aceptación o reclamo ante la DIAN)",
  ],
  ["proveedores", "Proveedores", "la cartera por proveedor (cuentas por pagar) y su estado de cuenta"],
  ["soporte-por-legalizar", "Soporte por legalizar", "los documentos soporte pendientes de legalizar ante la DIAN"],
] as const;

export const purchaseTypeLabels: Record<string, string> = {
  PURCHASE: "Compra",
  EXPENSE: "Gasto",
  SUPPORT: "Documento soporte",
};
const dianLabels: Record<string, string> = {
  NOT_APPLICABLE: "No aplica",
  DRAFT: "Sin contabilizar",
  PENDING: "Pendiente",
  QUEUED: "En cola",
  SENT: "Enviado",
  ACCEPTED: "Aceptado",
  REJECTED: "Rechazado",
  ERROR: "Error",
};
const dianBadge: Record<string, string> = {
  NOT_APPLICABLE: "pay-badge",
  DRAFT: "pay-badge is-pending",
  PENDING: "pay-badge is-pending",
  QUEUED: "pay-badge is-pending",
  SENT: "pay-badge is-info",
  ACCEPTED: "pay-badge is-ok",
  REJECTED: "pay-badge is-bad",
  ERROR: "pay-badge is-bad",
};

export const purchaseHref = (kind: string, id: string) => `/compras/documento?kind=${kind}&id=${id}`;

export function PurchasesModule() {
  const requested = useSearchParams().get("tab");
  const [slug, label, pending] = purchaseTabs.find(([tab]) => tab === requested) ?? purchaseTabs[0];
  return (
    <div className="page-content">
      <nav className="report-tabs" aria-label="Compras y gastos">
        {purchaseTabs.map(([tab, name]) => (
          <Link
            key={tab}
            href={`/compras?tab=${tab}`}
            scroll={false}
            aria-current={tab === slug ? "page" : undefined}
            className={tab === slug ? "active" : undefined}
          >
            {name}
          </Link>
        ))}
      </nav>
      {slug === "documentos" && <PurchaseDocuments />}
      {pending && (
        <section className="panel report-unavailable">
          <h2>{label}: en desarrollo</h2>
          <p>
            Este submenú mostrará {pending}. Todavía no está desarrollado en Betel; para no mostrar información ficticia
            no se presentan cifras ni botones.
          </p>
        </section>
      )}
    </div>
  );
}

type PurchaseRow = {
  kind: "Purchase" | "Support";
  id: string;
  type: "PURCHASE" | "EXPENSE" | "SUPPORT";
  number: string;
  supplierInvoiceNumber: string | null;
  date: string;
  supplier: { id: string; legalName: string; identificationType: string; identificationNumber: string };
  branch: string | null;
  total: string;
  currency: string;
  status: string;
  dian: string;
};
type PurchasesResponse = {
  data: PurchaseRow[];
  pagination: { page: number; pageSize: number; total: number };
  period: { from: string; to: string };
};

type Filters = { type: string; preset: Preset; from: string; to: string; supplier: string; supplierInvoice: string };
const emptyFilters = (): Filters => ({
  type: "",
  preset: "last15",
  ...presetRange("last15", defaultPeriod()),
  supplier: "",
  supplierInvoice: "",
});

const isVoid = (row: PurchaseRow) => row.status === "VOID";
const columns: ReportColumn<PurchaseRow>[] = [
  { header: "Tipo de transacción", value: row => purchaseTypeLabels[row.type] },
  { header: "Comprobante", value: row => row.number },
  { header: "Factura proveedor", value: row => row.supplierInvoiceNumber ?? "" },
  { header: "Fecha elaboración", value: row => date(row.date) },
  { header: "Identificación", value: row => `${row.supplier.identificationType} ${row.supplier.identificationNumber}` },
  { header: "Sucursal", value: row => row.branch ?? "" },
  { header: "Proveedor", value: row => row.supplier.legalName },
  { header: "Valor", value: row => row.total, money: true },
  { header: "Moneda", value: row => row.currency },
  { header: "Envío a la DIAN", value: row => dianLabels[row.dian] ?? row.dian },
  { header: "Estado", value: row => (isVoid(row) ? "Anulado" : row.status === "DRAFT" ? "Borrador" : "Vigente") },
];

function PurchaseDocuments() {
  const { company, canExport, canReceive: canRegister } = useSession();
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [draft, setDraft] = useState<Filters>(applied);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [voiding, setVoiding] = useState<PurchaseRow | null>(null);
  const { preset: _preset, ...query } = applied;
  const params = { ...query, page, pageSize };
  const report = useReport<PurchasesResponse>("/v1/reports/purchases/documents", params);
  const data = report.data;
  const rows = data?.data ?? [];
  const total = data?.pagination.total ?? 0;
  const pages = Math.ceil(total / pageSize);

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
            label: `Fecha elaboración: ${
              applied.preset === "custom"
                ? `${date(applied.from)} – ${date(applied.to)}`
                : periodPresets[applied.preset]
            }`,
            clear: { preset: "all" as Preset },
          },
        ]
      : []),
    ...(applied.supplier ? [{ label: `Proveedor: ${applied.supplier}`, clear: { supplier: "" } }] : []),
    ...(applied.supplierInvoice
      ? [{ label: `Factura proveedor: ${applied.supplierInvoice}`, clear: { supplierInvoice: "" } }]
      : []),
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

  const exportDocuments = async (format: ExportFormat) => {
    setNotice(null);
    try {
      await exportFromApi<PurchaseRow>(format, "/v1/reports/purchases/documents/export", params, response => ({
        company,
        title: "Compras, gastos y documento soporte",
        period: response.period,
        filters: [
          ...(applied.type ? [["Tipo de transacción", purchaseTypeLabels[applied.type]!] as [string, string]] : []),
          ...chips.map(chip => chip.label.split(": ") as [string, string]),
        ],
        columns,
        rows: response.data,
        totals: [
          ["Documentos", String(response.data.length)],
          [
            "Valor (sin anulados)",
            money(response.data.filter(row => !isVoid(row)).reduce((sum, row) => sum + Number(row.total), 0)),
          ],
        ],
        fileName: `compras-y-gastos-${response.period.from}-a-${response.period.to}`,
      }));
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };

  return (
    <>
      <section className="panel collections quotes">
        <h2 className="purchases-title">Compras, Gastos y Documento Soporte</h2>
        <div className="quotes-toolbar">
          <label className="quotes-user">
            <span>Tipo de transacción</span>
            <span className="collections-search">
              <select value={applied.type} onChange={event => apply({ ...applied, type: event.target.value })}>
                <option value="">Seleccione una opción</option>
                {Object.entries(purchaseTypeLabels).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <button
            type="button"
            className="secondary quotes-more"
            aria-expanded={showFilters}
            aria-controls="purchases-filters"
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
              onSelect: () => exportDocuments(format),
              disabled: !canExport || !total,
              note: !canExport
                ? "Tu rol no permite descargar"
                : !total
                  ? "No hay documentos para descargar"
                  : undefined,
            }))}
          >
            ⤓ Descargar
          </ActionMenu>
          <div className="split-button">
            {canRegister ? (
              <Link href="/compras/nuevo" className="primary">
                Nueva Compra / Gasto / Doc Soporte
              </Link>
            ) : (
              <button type="button" className="primary" disabled title="Tu rol no permite registrar compras">
                Nueva Compra / Gasto / Doc Soporte
              </button>
            )}
            <ActionMenu
              label="Tipo de documento a registrar"
              className="primary split-toggle"
              items={Object.entries(purchaseTypeLabels).map(([value, name]) => ({
                label: name,
                href: `/compras/nuevo?tipo=${value}`,
                disabled: !canRegister,
              }))}
            >
              <span aria-hidden="true">⌄</span>
            </ActionMenu>
          </div>
        </div>

        {showFilters && (
          <form
            id="purchases-filters"
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
                {Object.entries(periodPresets).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
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
              Proveedor
              <input
                value={draft.supplier}
                onChange={setDraftField("supplier")}
                placeholder="Nombre o identificación"
              />
            </label>
            <label className="field">
              Factura proveedor
              <input value={draft.supplierInvoice} onChange={setDraftField("supplierInvoice")} placeholder="Número" />
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

        {(chips.length > 0 || applied.type) && (
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
                    <th>Tipo de transacción</th>
                    <th>Comprobante</th>
                    <th>Factura proveedor</th>
                    <th>Fecha elaboración</th>
                    <th>Identificación</th>
                    <th>Sucursal</th>
                    <th>Proveedor</th>
                    <th>Estado envío de correo</th>
                    <th className="num">Valor</th>
                    <th>Moneda</th>
                    <th>Envío a la DIAN</th>
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={`${row.kind}-${row.id}`} className={isVoid(row) ? "is-cancelled" : undefined}>
                      <td>{purchaseTypeLabels[row.type]}</td>
                      <td>
                        <Link href={purchaseHref(row.kind, row.id)} className="collections-doc">
                          {row.number}
                        </Link>
                        {(isVoid(row) || row.status === "DRAFT") && (
                          <small>{isVoid(row) ? "Anulado" : "Borrador"}</small>
                        )}
                      </td>
                      <td>{row.supplierInvoiceNumber ?? "—"}</td>
                      <td>{date(row.date)}</td>
                      <td>
                        {row.supplier.identificationType} {row.supplier.identificationNumber}
                      </td>
                      <td title="Betel aún no maneja sucursales">{row.branch ?? "—"}</td>
                      <td>{row.supplier.legalName}</td>
                      <td title="Betel aún no envía documentos de compra por correo">
                        <span className="pay-badge">No aplica</span>
                      </td>
                      <td className="num">{money(row.total)}</td>
                      <td>{row.currency}</td>
                      <td>
                        <span className={dianBadge[row.dian] ?? "pay-badge"}>{dianLabels[row.dian] ?? row.dian}</span>
                      </td>
                      <td>
                        <ActionMenu
                          label={`Acciones de ${row.number}`}
                          className="secondary quotes-row-menu"
                          items={[
                            { label: "Ver documento", href: purchaseHref(row.kind, row.id) },
                            ...(row.kind === "Support" && row.status === "DRAFT"
                              ? [
                                  {
                                    label: "Contabilizar",
                                    disabled: !canRegister,
                                    onSelect: () =>
                                      run(
                                        () => apiPost(`/v1/support-documents/${row.id}/issue`),
                                        `${row.number} contabilizado.`
                                      ),
                                  },
                                ]
                              : []),
                            ...(row.kind === "Purchase"
                              ? [
                                  {
                                    label: "Anular",
                                    danger: true,
                                    disabled: !canRegister || isVoid(row),
                                    note: isVoid(row) ? "Ya está anulado" : undefined,
                                    onSelect: () => setVoiding(row),
                                  },
                                ]
                              : []),
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

      {voiding && (
        <VoidDocumentDialog
          title={`Anular ${voiding.number}`}
          description="Se registra el asiento contable inverso y el documento deja de sumar. Esta acción no se puede deshacer."
          path={`/v1/purchases/${voiding.id}/void`}
          confirmLabel="Anular documento"
          onClose={() => setVoiding(null)}
          onVoided={() => {
            setNotice({ kind: "ok", text: `${voiding.number} anulado.` });
            setVoiding(null);
            report.reload();
          }}
        />
      )}
    </>
  );
}
