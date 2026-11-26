/**
 * Compras y gastos › Proveedores (/compras?tab=proveedores): cuentas por pagar por proveedor
 * (GET /v1/reports/purchases/suppliers).
 *
 * Búsqueda, "Más filtros" (saldo y estado del proveedor) con etiquetas, columnas visibles, descarga,
 * "Ver reportes" (antigüedad de cuentas por pagar) y "Crear Proveedor". Cada fila abre sus cuentas por pagar
 * (/compras/proveedor) y su menú permite registrar un pago (comprobante de egreso) y activar o desactivar.
 * Definiciones en apps/api/src/payables.ts.
 */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiPost } from "../lib/api";
import type { ExportFormat, ReportColumn } from "../lib/report-export";
import { ActionMenu } from "./action-menu";
import { date, exportFromApi, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { FilterIcon } from "./billing-report-collections";
import { CreateCustomerDialog } from "./billing-report-portfolio";
import { SearchIllustration } from "./billing-report-quotes";
import { Modal } from "./collection-dialogs";

type SupplierRow = {
  id: string;
  legalName: string;
  identificationType: string;
  identificationNumber: string;
  email: string | null;
  active: boolean;
  branch: string | null;
  overdue: string;
  upcoming: string;
  credit: string;
  total: string;
};
type Summary = { overdue: string; upcoming: string; credit: string; total: string };
type SuppliersResponse = {
  data: SupplierRow[];
  pagination: { page: number; pageSize: number; total: number };
  summary: Summary;
};

const balanceLabels: Record<string, string> = {
  ALL: "Todos",
  WITH_BALANCE: "Con saldo",
  OVERDUE: "Con saldo vencido",
  NO_BALANCE: "Sin saldo",
};
const statusLabels: Record<string, string> = { ACTIVE: "Activo", INACTIVE: "Inactivo", ALL: "Todos" };

/** Columnas que se pueden ocultar (Proveedor y Acciones siempre se ven). */
const optionalColumns = {
  branch: "Sucursal",
  overdue: "Saldo vencido",
  upcoming: "Saldo por vencer",
  credit: "Saldo a favor",
  total: "Total saldo",
  status: "Estado",
} as const;
type ColumnKey = keyof typeof optionalColumns;
const COLUMNS_KEY = "betel.supplierColumns";

type Filters = { search: string; balance: string; status: string };
const defaultFilters = (): Filters => ({ search: "", balance: "ALL", status: "ACTIVE" });

const exportColumns: ReportColumn<SupplierRow>[] = [
  { header: "Proveedor", value: row => row.legalName },
  { header: "Identificación", value: row => `${row.identificationType} ${row.identificationNumber}` },
  { header: "Sucursal", value: row => row.branch ?? "" },
  { header: "Saldo vencido", value: row => row.overdue, money: true },
  { header: "Saldo por vencer", value: row => row.upcoming, money: true },
  { header: "Saldo a favor", value: row => row.credit, money: true },
  { header: "Total saldo", value: row => row.total, money: true },
  { header: "Estado", value: row => (row.active ? "Activo" : "Inactivo") },
  { header: "Correo", value: row => row.email ?? "" },
];

export const supplierStatementHref = (id: string) => `/compras/proveedor?id=${id}`;
export const supplierPaymentHref = (id?: string) => `/compras/pago/nuevo${id ? `?proveedor=${id}` : ""}`;

export function PurchaseSuppliers() {
  const { company, canExport, canPurchase: canEdit } = useSession();
  const [applied, setApplied] = useState<Filters>(defaultFilters);
  const [draft, setDraft] = useState<Filters>(applied);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [hidden, setHidden] = useState<ColumnKey[]>([]);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [dialog, setDialog] = useState<{ kind: "create"; customer: boolean } | { kind: "aging" } | null>(null);
  const report = useReport<SuppliersResponse>("/v1/reports/purchases/suppliers", { ...applied, page, pageSize });
  const data = report.data;
  const rows = data?.data ?? [];
  const total = data?.pagination.total ?? 0;
  const pages = Math.ceil(total / pageSize);

  // Columnas ocultas: preferencia de este navegador.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? "[]") as ColumnKey[];
      if (Array.isArray(saved)) setHidden(saved.filter(key => key in optionalColumns));
    } catch {}
  }, []);
  const toggleColumn = (key: ColumnKey) => {
    const next = hidden.includes(key) ? hidden.filter(item => item !== key) : [...hidden, key];
    setHidden(next);
    try {
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
    } catch {}
  };
  const show = (key: ColumnKey) => !hidden.includes(key);

  const apply = (filters: Filters) => {
    setApplied(filters);
    setDraft(filters);
    setSearch(filters.search);
    setPage(1);
  };
  const chips = [
    { label: `Saldo de proveedor: ${balanceLabels[applied.balance]}`, clear: { balance: "ALL" } },
    { label: `Estado de proveedor: ${statusLabels[applied.status]}`, clear: { status: "ALL" } },
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

  const exportSuppliers = async (format: ExportFormat) => {
    setNotice(null);
    try {
      await exportFromApi<SupplierRow>(format, "/v1/reports/purchases/suppliers/export", applied, response => {
        const summary = response.summary as Summary;
        return {
          company,
          title: "Compras y gastos — Cuentas por pagar por proveedor",
          period: { from: null, to: null },
          filters: [
            ...(applied.search ? [["Búsqueda", applied.search] as [string, string]] : []),
            ...chips.map(chip => chip.label.split(": ") as [string, string]),
          ],
          columns: exportColumns,
          rows: response.data,
          totals: [
            ["Saldo vencido", money(summary.overdue)],
            ["Saldo por vencer", money(summary.upcoming)],
            ["Saldo a favor", money(summary.credit)],
            ["Total saldo", money(summary.total)],
          ],
          fileName: "cuentas-por-pagar-por-proveedor",
        };
      });
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };

  return (
    <>
      <section className="panel collections quotes">
        <form
          className="quotes-toolbar"
          onSubmit={event => {
            event.preventDefault();
            apply({ ...applied, search: search.trim() });
          }}
        >
          <label className="quotes-user">
            <span>Búsqueda</span>
            <span className="collections-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Buscar por nombre o identificación"
                aria-label="Buscar proveedor por nombre o identificación"
              />
            </span>
          </label>
          <button
            type="button"
            className="secondary quotes-more"
            aria-expanded={showFilters}
            aria-controls="suppliers-filters"
            onClick={() => {
              setDraft(applied);
              setShowFilters(!showFilters);
            }}
          >
            <FilterIcon /> Más filtros
            <b className="quotes-count">{chips.length}</b>
          </button>
          <span className="collections-spacer" />
          <ActionMenu
            label="Columnas"
            className="report-link portfolio-columns"
            items={Object.entries(optionalColumns).map(([key, label]) => ({
              label: `${show(key as ColumnKey) ? "☑" : "☐"} ${label}`,
              onSelect: () => toggleColumn(key as ColumnKey),
            }))}
          >
            ▥ Columnas
          </ActionMenu>
          <ActionMenu
            label="Descargar"
            className="secondary quotes-download"
            items={(["pdf", "xlsx", "csv"] as const).map(format => ({
              label: format === "xlsx" ? "Excel (XLSX)" : format.toUpperCase(),
              onSelect: () => exportSuppliers(format),
              disabled: !canExport || !total,
              note: !canExport
                ? "Tu rol no permite descargar"
                : !total
                  ? "No hay proveedores para descargar"
                  : undefined,
            }))}
          >
            ⤓ Descargar
          </ActionMenu>
          <ActionMenu
            label="Ver reportes"
            className="secondary quotes-download"
            items={[
              { label: "Actualizar", onSelect: report.reload },
              {
                label: "Antigüedad de cuentas por pagar",
                note: "Saldos por días de vencido",
                onSelect: () => setDialog({ kind: "aging" }),
              },
              { label: "Registrar pago a proveedor", href: supplierPaymentHref(), disabled: !canEdit },
            ]}
          >
            Ver reportes ⌄
          </ActionMenu>
          <div className="split-button">
            <button
              type="button"
              className="primary"
              disabled={!canEdit}
              title={canEdit ? undefined : "Tu rol no permite crear proveedores"}
              onClick={() => setDialog({ kind: "create", customer: false })}
            >
              Crear Proveedor
            </button>
            <ActionMenu
              label="Otras formas de crear"
              className="primary split-toggle"
              items={[
                {
                  label: "Crear proveedor que también es cliente",
                  onSelect: () => setDialog({ kind: "create", customer: true }),
                  disabled: !canEdit,
                },
                { label: "Formulario completo de terceros", href: "/terceros/nuevo", disabled: !canEdit },
              ]}
            >
              <span aria-hidden="true">⌄</span>
            </ActionMenu>
          </div>
        </form>

        {showFilters && (
          <form
            id="suppliers-filters"
            className="collections-filters quotes-filters"
            onSubmit={event => {
              event.preventDefault();
              apply({ ...draft, search: search.trim() });
              setShowFilters(false);
            }}
          >
            <label className="field">
              Saldo de proveedor
              <select value={draft.balance} onChange={event => setDraft({ ...draft, balance: event.target.value })}>
                {Object.entries(balanceLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Estado de proveedor
              <select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}>
                {Object.entries(statusLabels).map(([value, label]) => (
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
            onClick={() => apply({ search: "", balance: "ALL", status: "ALL" })}
          >
            Limpiar filtros
          </button>
        </div>

        {data && (
          <p className="portfolio-summary">
            Cuentas por pagar de los proveedores filtrados: vencido <b>{money(data.summary.overdue)}</b> · por vencer{" "}
            <b>{money(data.summary.upcoming)}</b> · total <b>{money(data.summary.total)}</b>
          </p>
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
              <table className="report-table collections-table quotes-table portfolio-table">
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    {show("branch") && <th>Sucursal</th>}
                    {show("overdue") && <th className="num">Saldo vencido</th>}
                    {show("upcoming") && <th className="num">Saldo por vencer</th>}
                    {show("credit") && <th className="num">Saldo a favor</th>}
                    {show("total") && <th className="num">Total saldo</th>}
                    {show("status") && <th>Estado</th>}
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className={row.active ? undefined : "is-cancelled"}>
                      <td>
                        <Link href={supplierStatementHref(row.id)} className="collections-doc">
                          {row.legalName}
                        </Link>
                        <small>{row.identificationNumber}</small>
                      </td>
                      {show("branch") && <td title="Betel aún no maneja sucursales">{row.branch ?? "—"}</td>}
                      {show("overdue") && (
                        <td className={Number(row.overdue) > 0 ? "num portfolio-overdue" : "num"}>
                          {money(row.overdue)}
                        </td>
                      )}
                      {show("upcoming") && <td className="num">{money(row.upcoming)}</td>}
                      {show("credit") && (
                        <td className="num" title="Betel aún no registra anticipos a proveedores">
                          {money(row.credit)}
                        </td>
                      )}
                      {show("total") && (
                        <td className="num">
                          <b>{money(row.total)}</b>
                        </td>
                      )}
                      {show("status") && (
                        <td>
                          <span className={row.active ? "pay-badge is-ok" : "pay-badge"}>
                            {row.active ? "Activo" : "Inactivo"}
                          </span>
                        </td>
                      )}
                      <td>
                        <div className="split-button row-actions">
                          <Link href={supplierStatementHref(row.id)} className="secondary pay-main">
                            Ver cuentas por pagar
                          </Link>
                          <ActionMenu
                            label={`Más acciones de ${row.legalName}`}
                            className="secondary split-toggle"
                            items={[
                              {
                                label: "Registrar pago (comprobante de egreso)",
                                href: supplierPaymentHref(row.id),
                                disabled: !canEdit || Number(row.total) <= 0,
                                note: Number(row.total) <= 0 ? "No tiene saldo por pagar" : undefined,
                              },
                              {
                                label: "Registrar compra o gasto",
                                href: "/compras/nuevo?tipo=PURCHASE",
                                disabled: !canEdit || !row.active,
                              },
                              {
                                label: row.active ? "Desactivar proveedor" : "Activar proveedor",
                                danger: row.active,
                                disabled: !canEdit,
                                onSelect: () =>
                                  run(
                                    () => apiPost(`/v1/suppliers/${row.id}/active`, { active: !row.active }),
                                    `${row.legalName} ${row.active ? "desactivado" : "activado"}.`
                                  ),
                              },
                            ]}
                          >
                            <span aria-hidden="true">⌄</span>
                          </ActionMenu>
                        </div>
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

      {dialog?.kind === "create" && (
        <CreateCustomerDialog
          supplier
          supplierOnly={!dialog.customer}
          onClose={() => setDialog(null)}
          onCreated={name => {
            setDialog(null);
            setNotice({ kind: "ok", text: `Proveedor ${name} creado.` });
            report.reload();
          }}
        />
      )}
      {dialog?.kind === "aging" && (
        <AgingDialog filters={{ search: applied.search, status: applied.status }} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

type AgingRow = {
  id: string;
  legalName: string;
  identificationNumber: string;
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90: string;
  total: string;
};
const agingColumns: [keyof AgingRow, string][] = [
  ["current", "Por vencer"],
  ["d1_30", "1 a 30 días"],
  ["d31_60", "31 a 60 días"],
  ["d61_90", "61 a 90 días"],
  ["d90", "Más de 90 días"],
  ["total", "Total"],
];

/** Ver reportes › Antigüedad de cuentas por pagar (respeta la búsqueda y el estado aplicados). */
function AgingDialog({ filters, onClose }: { filters: { search: string; status: string }; onClose: () => void }) {
  const aging = useReport<{
    data: { date: string; rows: AgingRow[]; totals: Omit<AgingRow, "id" | "legalName" | "identificationNumber"> };
  }>("/v1/reports/purchases/suppliers/aging", filters);
  const report = aging.data?.data;
  return (
    <Modal title="Antigüedad de cuentas por pagar" onClose={onClose} wide>
      <ReportStatus loading={aging.loading && !report} error={aging.error} />
      {report && (
        <>
          <p className="report-dialog-text">
            Saldos de compras y gastos a crédito por días de vencido, con corte al {date(report.date)}.
          </p>
          {report.rows.length ? (
            <div className="report-table-wrap aging-table">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    {agingColumns.map(([key, label]) => (
                      <th key={key} className="num">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map(row => (
                    <tr key={row.id}>
                      <td>
                        <Link href={supplierStatementHref(row.id)} className="collections-doc">
                          {row.legalName}
                        </Link>
                        <small>{row.identificationNumber}</small>
                      </td>
                      {agingColumns.map(([key]) => (
                        <td
                          key={key}
                          className={
                            key !== "current" && key !== "total" && Number(row[key]) > 0
                              ? "num portfolio-overdue"
                              : "num"
                          }
                        >
                          {key === "total" ? <b>{money(row[key])}</b> : money(row[key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    {agingColumns.map(([key]) => (
                      <th key={key} className="num">
                        {money(report.totals[key as keyof typeof report.totals])}
                      </th>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="report-message">No hay cuentas por pagar con los filtros aplicados.</p>
          )}
        </>
      )}
      <div className="report-dialog-actions">
        <button type="button" className="primary" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
