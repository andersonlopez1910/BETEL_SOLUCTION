/**
 * Pestaña "Clientes": cartera por cliente (GET /v1/reports/billing/portfolio).
 *
 * Búsqueda, "Más filtros" (saldo de cartera y estado del cliente) con etiquetas, columnas visibles,
 * descarga, "Ver reportes" (incluye "Facturación por cliente") y "Crear cliente". Cada fila abre el estado
 * de cuenta (/clientes/estado-de-cuenta) y su menú permite ver la facturación del cliente, enviar el
 * estado de cuenta, registrar un recibo de caja y activar o desactivar. Definiciones en
 * apps/api/src/portfolio.ts.
 */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiPost } from "../lib/api";
import type { ExportFormat, ReportColumn } from "../lib/report-export";
import { ActionMenu } from "./action-menu";
import { exportFromApi, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { FilterIcon } from "./billing-report-collections";
import { CustomersReport } from "./billing-report-customers";
import { SearchIllustration } from "./billing-report-quotes";
import { Modal, SendEmailDialog } from "./collection-dialogs";

type PortfolioRow = {
  id: string;
  legalName: string;
  tradeName: string | null;
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
type PortfolioResponse = {
  data: PortfolioRow[];
  pagination: { page: number; pageSize: number; total: number };
  summary: { overdue: string; upcoming: string; credit: string; total: string };
};

const balanceLabels: Record<string, string> = {
  ALL: "Todos",
  WITH_BALANCE: "Con saldo",
  OVERDUE: "Con saldo vencido",
  NO_BALANCE: "Sin saldo",
};
const statusLabels: Record<string, string> = { ACTIVE: "Activo", INACTIVE: "Inactivo", ALL: "Todos" };

/** Columnas que se pueden ocultar (Cliente y Acciones siempre se ven). */
const optionalColumns = {
  branch: "Sucursal",
  overdue: "Saldo vencido",
  upcoming: "Saldo por vencer",
  credit: "Saldo a favor",
  total: "Total cartera",
  status: "Estado",
} as const;
type ColumnKey = keyof typeof optionalColumns;
const COLUMNS_KEY = "betel.portfolioColumns";

type Filters = { search: string; balance: string; status: string };
const defaultFilters = (): Filters => ({ search: "", balance: "ALL", status: "ACTIVE" });

const exportColumns: ReportColumn<PortfolioRow>[] = [
  { header: "Cliente", value: row => row.legalName },
  { header: "Identificación", value: row => `${row.identificationType} ${row.identificationNumber}` },
  { header: "Sucursal", value: row => row.branch ?? "" },
  { header: "Saldo vencido", value: row => row.overdue, money: true },
  { header: "Saldo por vencer", value: row => row.upcoming, money: true },
  { header: "Saldo a favor", value: row => row.credit, money: true },
  { header: "Total cartera", value: row => row.total, money: true },
  { header: "Estado", value: row => (row.active ? "Activo" : "Inactivo") },
  { header: "Correo", value: row => row.email ?? "" },
];

export const statementHref = (id: string) => `/clientes/estado-de-cuenta?id=${id}`;

export function PortfolioReport() {
  const { company, canExport, canEmail: canEdit, canReceive } = useSession();
  const [applied, setApplied] = useState<Filters>(defaultFilters);
  const [draft, setDraft] = useState<Filters>(applied);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [hidden, setHidden] = useState<ColumnKey[]>([]);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [dialog, setDialog] = useState<
    { kind: "create"; supplier: boolean } | { kind: "email"; row: PortfolioRow } | null
  >(null);
  const [billing, setBilling] = useState<{ customer: string | null } | null>(null);
  const report = useReport<PortfolioResponse>("/v1/reports/billing/portfolio", { ...applied, page, pageSize });
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
    { label: `Saldo de cartera: ${balanceLabels[applied.balance]}`, clear: { balance: "ALL" } },
    { label: `Estado de cliente: ${statusLabels[applied.status]}`, clear: { status: "ALL" } },
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

  const exportPortfolio = async (format: ExportFormat) => {
    setNotice(null);
    try {
      await exportFromApi<PortfolioRow>(format, "/v1/reports/billing/portfolio/export", applied, response => {
        const summary = response.summary as PortfolioResponse["summary"];
        return {
          company,
          title: "Reporte de facturación — Cartera por cliente",
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
            ["Total cartera", money(summary.total)],
          ],
          fileName: "cartera-por-cliente",
        };
      });
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };

  if (billing) return <CustomersReport initialCustomer={billing.customer} onClose={() => setBilling(null)} />;

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
                aria-label="Buscar cliente por nombre o identificación"
              />
            </span>
          </label>
          <button
            type="button"
            className="secondary quotes-more"
            aria-expanded={showFilters}
            aria-controls="portfolio-filters"
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
              onSelect: () => exportPortfolio(format),
              disabled: !canExport || !total,
              note: !canExport ? "Tu rol no permite descargar" : !total ? "No hay clientes para descargar" : undefined,
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
                label: "Facturación por cliente",
                note: "Facturas, promedio y evolución por período",
                onSelect: () => setBilling({ customer: null }),
              },
            ]}
          >
            Ver reportes ⌄
          </ActionMenu>
          <div className="split-button">
            <button
              type="button"
              className="primary"
              disabled={!canEdit}
              title={canEdit ? undefined : "Tu rol no permite crear clientes"}
              onClick={() => setDialog({ kind: "create", supplier: false })}
            >
              Crear cliente
            </button>
            <ActionMenu
              label="Otras formas de crear"
              className="primary split-toggle"
              items={[
                {
                  label: "Crear cliente que también es proveedor",
                  onSelect: () => setDialog({ kind: "create", supplier: true }),
                  disabled: !canEdit,
                },
              ]}
            >
              <span aria-hidden="true">⌄</span>
            </ActionMenu>
          </div>
        </form>

        {showFilters && (
          <form
            id="portfolio-filters"
            className="collections-filters quotes-filters"
            onSubmit={event => {
              event.preventDefault();
              apply({ ...draft, search: search.trim() });
              setShowFilters(false);
            }}
          >
            <label className="field">
              Saldo de cartera
              <select value={draft.balance} onChange={event => setDraft({ ...draft, balance: event.target.value })}>
                {Object.entries(balanceLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Estado de cliente
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
            Cartera de los clientes filtrados: vencido <b>{money(data.summary.overdue)}</b> · por vencer{" "}
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
                    <th>Cliente</th>
                    {show("branch") && <th>Sucursal</th>}
                    {show("overdue") && <th className="num">Saldo vencido</th>}
                    {show("upcoming") && <th className="num">Saldo por vencer</th>}
                    {show("credit") && <th className="num">Saldo a favor</th>}
                    {show("total") && <th className="num">Total cartera</th>}
                    {show("status") && <th>Estado</th>}
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className={row.active ? undefined : "is-cancelled"}>
                      <td>
                        <Link href={statementHref(row.id)} className="collections-doc">
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
                        <td className="num" title="Betel aún no registra anticipos ni saldos a favor">
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
                          <Link href={statementHref(row.id)} className="secondary pay-main">
                            Ver estado de cuenta
                          </Link>
                          <ActionMenu
                            label={`Más acciones de ${row.legalName}`}
                            className="secondary split-toggle"
                            items={[
                              {
                                label: "Ver facturación del cliente",
                                onSelect: () => setBilling({ customer: row.id }),
                              },
                              {
                                label: "Enviar estado de cuenta",
                                onSelect: () =>
                                  row.email
                                    ? run(
                                        () => apiPost(`/v1/customers/${row.id}/statement/email`),
                                        `Estado de cuenta enviado a ${row.email}.`
                                      )
                                    : setDialog({ kind: "email", row }),
                                disabled: !canEdit,
                                note: row.email ? undefined : "Sin correo: se pedirá el destino",
                              },
                              {
                                label: "Registrar recibo de caja",
                                href: `/recaudos/nuevo?cliente=${row.id}`,
                                disabled: !canReceive || Number(row.total) <= 0,
                                note: Number(row.total) <= 0 ? "No tiene saldo pendiente" : undefined,
                              },
                              {
                                label: row.active ? "Desactivar cliente" : "Activar cliente",
                                danger: row.active,
                                disabled: !canEdit,
                                onSelect: () =>
                                  run(
                                    () => apiPost(`/v1/customers/${row.id}/active`, { active: !row.active }),
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
          supplier={dialog.supplier}
          onClose={() => setDialog(null)}
          onCreated={name => {
            setDialog(null);
            setNotice({ kind: "ok", text: `Cliente ${name} creado.` });
            report.reload();
          }}
        />
      )}
      {dialog?.kind === "email" && (
        <SendEmailDialog
          document={{
            type: "Statement",
            id: dialog.row.id,
            number: "el estado de cuenta",
            customerEmail: dialog.row.email,
          }}
          send={to => apiPost(`/v1/customers/${dialog.row.id}/statement/email`, { to })}
          onClose={() => setDialog(null)}
          onSent={recipient => {
            setDialog(null);
            setNotice({ kind: "ok", text: `Estado de cuenta enviado a ${recipient}.` });
          }}
        />
      )}
    </>
  );
}

const identificationTypes: Record<string, string> = {
  NIT: "NIT",
  CC: "Cédula de ciudadanía",
  CE: "Cédula de extranjería",
  PA: "Pasaporte",
  TI: "Tarjeta de identidad",
  PPT: "Permiso por protección temporal",
};

/** Crear cliente (POST /v1/parties): datos básicos. El formulario completo de terceros está en /terceros/nuevo. */
export function CreateCustomerDialog({
  supplier,
  onClose,
  onCreated,
}: {
  supplier: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [form, setForm] = useState({
    kind: "COMPANY",
    identificationType: "NIT",
    identificationNumber: "",
    verificationDigit: "",
    legalName: "",
    email: "",
    phone: "",
    address: "",
  });
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [field]: event.target.value });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      await apiPost("/v1/parties", {
        kind: form.kind,
        identificationType: form.identificationType,
        identificationNumber: form.identificationNumber.trim(),
        ...(form.identificationType === "NIT" &&
          form.verificationDigit && { verificationDigit: form.verificationDigit }),
        legalName: form.legalName.trim(),
        ...(form.email.trim() && { email: form.email.trim() }),
        ...(form.phone.trim() && { phone: form.phone.trim() }),
        ...(form.address.trim() && { address: form.address.trim() }),
        isCustomer: true,
        isSupplier: supplier,
      });
      onCreated(form.legalName.trim());
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };

  return (
    <Modal title={supplier ? "Crear cliente y proveedor" : "Crear cliente"} onClose={onClose}>
      <form onSubmit={submit} className="customer-form">
        <label className="field">
          Tipo de persona
          <select value={form.kind} onChange={set("kind")}>
            <option value="COMPANY">Persona jurídica</option>
            <option value="PERSON">Persona natural</option>
          </select>
        </label>
        <div className="customer-id">
          <label className="field">
            Tipo de identificación
            <select value={form.identificationType} onChange={set("identificationType")}>
              {Object.entries(identificationTypes).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Número
            <input
              value={form.identificationNumber}
              onChange={set("identificationNumber")}
              minLength={3}
              maxLength={30}
              required
            />
          </label>
          {form.identificationType === "NIT" && (
            <label className="field">
              DV
              <input
                value={form.verificationDigit}
                onChange={set("verificationDigit")}
                maxLength={1}
                inputMode="numeric"
              />
            </label>
          )}
        </div>
        <label className="field">
          {form.kind === "COMPANY" ? "Razón social" : "Nombre completo"}
          <input value={form.legalName} onChange={set("legalName")} minLength={2} maxLength={200} required />
        </label>
        <label className="field">
          Correo electrónico (para enviarle documentos)
          <input type="email" value={form.email} onChange={set("email")} />
        </label>
        <div className="customer-id">
          <label className="field">
            Teléfono
            <input value={form.phone} onChange={set("phone")} maxLength={30} />
          </label>
          <label className="field">
            Dirección
            <input value={form.address} onChange={set("address")} maxLength={250} />
          </label>
        </div>
        {state.error && (
          <p className="report-error" role="alert">
            {state.error}
          </p>
        )}
        <div className="report-dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={state.busy}>
            {state.busy ? "Guardando…" : "Crear cliente"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
