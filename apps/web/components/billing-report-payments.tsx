/**
 * Pestaña "Gestión de cobro cartera Betel" (GET /v1/reports/billing/online-payments).
 *
 * Pagos en línea de facturas a crédito: se genera un link de pago, el cliente paga en la pasarela y,
 * al aprobarse, el pago abona la factura (aparece también en Recaudos). La pasarela descuenta su
 * comisión (neto recibido) y después desembolsa el dinero al banco ("Registrar desembolso").
 * Indicadores y definiciones en docs/reporte-facturacion.md y apps/api/src/payments.ts.
 *
 * Mientras no haya una pasarela real conectada se usa la de PRUEBAS: lo indica un aviso y la página
 * de pago permite simular el resultado. No se mueve dinero.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import { apiPost } from "../lib/api";
import type { ExportFormat, ReportColumn } from "../lib/report-export";
import { ActionMenu, type ActionMenuItem } from "./action-menu";
import { defaultPeriod, exportFromApi, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { FilterIcon, longDate } from "./billing-report-collections";

type PaymentRow = {
  id: string;
  number: string;
  createdAt: string;
  invoice: { id: string; number: string; total: string };
  customer: {
    id: string;
    legalName: string;
    identificationType: string;
    identificationNumber: string;
    email: string | null;
  };
  amount: string;
  fee: string | null;
  net: string | null;
  paidAt: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  method: string | null;
  rejectionReason: string | null;
  disbursementStatus: "PENDING" | "DISBURSED" | null;
  disbursedAt: string | null;
  cashReceiptId: string | null;
  checkoutUrl: string | null;
};

type PaymentsResponse = {
  data: PaymentRow[];
  pagination: { page: number; pageSize: number; total: number };
  period: { from: string; to: string };
  provider: { name: string; mode: "sandbox" | "production" } | null;
  summary: { totalDocuments: string; totalNet: string; pendingDisbursement: string; rejectedCount: number };
};

type Filters = { search: string; from: string; to: string; status: string; disbursement: string };
const emptyFilters = (): Filters => ({ ...defaultPeriod(), search: "", status: "", disbursement: "" });

const statusLabels: Record<string, string> = {
  PENDING: "Pendiente",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  CANCELLED: "Anulado",
};
const disbursementLabels: Record<string, string> = { PENDING: "Por desembolsar", DISBURSED: "Desembolsado" };
const methodLabels: Record<string, string> = { CARD: "Tarjeta", PSE: "PSE", NEQUI: "Nequi" };
const badge: Record<string, string> = {
  PENDING: "pay-badge is-pending",
  APPROVED: "pay-badge is-ok",
  REJECTED: "pay-badge is-bad",
  CANCELLED: "pay-badge",
  DISBURSED: "pay-badge is-ok",
};
/** Fecha y hora UTC → "16/11/2026" en hora de Colombia. */
const dateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("es-CO", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "America/Bogota",
      })
    : "—";

/** Columnas de la exportación. */
const paymentColumns: ReportColumn<PaymentRow>[] = [
  { header: "Fecha", value: row => dateTime(row.createdAt) },
  { header: "Comprobante", value: row => row.number },
  { header: "Factura", value: row => row.invoice.number },
  { header: "Cliente", value: row => row.customer.legalName },
  { header: "Identificación", value: row => `${row.customer.identificationType} ${row.customer.identificationNumber}` },
  { header: "Valor del link", value: row => row.amount, money: true },
  { header: "Total pagado", value: row => (row.status === "APPROVED" ? row.amount : null), money: true },
  { header: "Comisión", value: row => row.fee, money: true },
  { header: "Neto recibido", value: row => row.net, money: true },
  { header: "Fecha de pago", value: row => (row.status === "APPROVED" ? dateTime(row.paidAt) : "") },
  { header: "Medio", value: row => (row.method ? (methodLabels[row.method] ?? row.method) : "") },
  { header: "Pago", value: row => statusLabels[row.status] },
  { header: "Desembolso", value: row => (row.disbursementStatus ? disbursementLabels[row.disbursementStatus] : "") },
];

export function PaymentsReport() {
  const { company, canExport, canReceive, canLink } = useSession();
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(draft);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [showFilters, setShowFilters] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "email"; row: PaymentRow } | null>(null);
  const report = useReport<PaymentsResponse>("/v1/reports/billing/online-payments", { ...applied, page, pageSize });
  const data = report.data;
  const rows = data?.data ?? [];

  const set = (field: keyof Filters) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft({ ...draft, [field]: event.target.value });
  const apply = (filters: Filters) => {
    setDraft(filters);
    setApplied(filters);
    setPage(1);
  };
  /** "Filtrar" de un indicador: aplica ese estado sobre los filtros actuales. */
  const filterBy = (patch: Partial<Filters>) => apply({ ...applied, status: "", disbursement: "", ...patch });

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
  const copy = async (row: PaymentRow) => {
    try {
      await navigator.clipboard.writeText(row.checkoutUrl!);
      setNotice({ kind: "ok", text: `Link de ${row.number} copiado.` });
    } catch {
      setNotice({ kind: "error", text: `No se pudo copiar. Link: ${row.checkoutUrl}` });
    }
  };

  const exportPayments = async (format: ExportFormat) => {
    setNotice(null);
    try {
      await exportFromApi<PaymentRow>(format, "/v1/reports/billing/online-payments/export", applied, response => {
        const summary = response.summary as PaymentsResponse["summary"];
        return {
          company,
          title: "Reporte de facturación — Gestión de cobro cartera Betel",
          period: response.period,
          filters: [
            ...(applied.search ? [["Cliente", applied.search] as [string, string]] : []),
            ...(applied.status ? [["Pago", statusLabels[applied.status]!] as [string, string]] : []),
            ...(applied.disbursement
              ? [["Desembolso", disbursementLabels[applied.disbursement]!] as [string, string]]
              : []),
          ],
          columns: paymentColumns,
          rows: response.data,
          totals: [
            ["Total documentos", money(summary.totalDocuments)],
            ["Total neto recibido", money(summary.totalNet)],
            ["Por desembolsar", money(summary.pendingDisbursement)],
            ["Pagos rechazados", String(summary.rejectedCount)],
          ],
          fileName: `gestion-cobro-${response.period.from}-a-${response.period.to}`,
        };
      });
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };

  const rowActions = (row: PaymentRow): { main: ActionMenuItem | null; more: ActionMenuItem[] } => {
    const pending = row.status === "PENDING";
    const toDisburse = row.status === "APPROVED" && row.disbursementStatus === "PENDING";
    const disburse: ActionMenuItem = {
      label: "Registrar desembolso",
      onSelect: () =>
        run(() => apiPost(`/v1/online-payments/${row.id}/disburse`), `Desembolso de ${row.number} registrado.`),
      disabled: !canReceive,
      note: canReceive ? "La pasarela consignó el neto en el banco" : "Tu rol no permite registrarlo",
    };
    const more: ActionMenuItem[] = [
      ...(pending && row.checkoutUrl
        ? [
            { label: "Abrir página de pago", onSelect: () => window.open(row.checkoutUrl!, "_blank", "noopener") },
            {
              label: "Enviar link por correo",
              onSelect: () =>
                run(() => apiPost(`/v1/online-payments/${row.id}/email`), `Link de ${row.number} enviado al cliente.`),
              disabled: !canLink || !row.customer.email,
              note: !row.customer.email ? "El cliente no tiene correo" : undefined,
            },
            { label: "Enviar a otro correo", onSelect: () => setDialog({ kind: "email", row }), disabled: !canLink },
          ]
        : []),
      ...(row.cashReceiptId
        ? [{ label: "Ver recibo de caja", href: `/recaudos/documento?type=CashReceipt&id=${row.cashReceiptId}` }]
        : []),
      { label: "Ver factura", href: `/recaudos/documento?type=Invoice&id=${row.invoice.id}` },
      ...(toDisburse ? [disburse] : []),
      ...(pending
        ? [
            {
              label: "Anular link",
              danger: true,
              disabled: !canLink,
              onSelect: () => run(() => apiPost(`/v1/online-payments/${row.id}/cancel`), `Link ${row.number} anulado.`),
            },
          ]
        : []),
    ];
    const main: ActionMenuItem | null =
      pending && row.checkoutUrl
        ? { label: "Copiar link", onSelect: () => copy(row) }
        : toDisburse && canReceive
          ? disburse
          : row.cashReceiptId
            ? { label: "Ver recibo", href: `/recaudos/documento?type=CashReceipt&id=${row.cashReceiptId}` }
            : null;
    return { main, more };
  };

  const total = data?.pagination.total ?? 0;
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, total);
  const activeFilters = [applied.status, applied.disbursement].filter(Boolean).length;

  return (
    <>
      {data?.provider?.mode === "sandbox" && (
        <p className="pay-sandbox" role="note">
          Pasarela de <b>pruebas</b>: los pagos se simulan desde la página de pago y no se mueve dinero real. Para
          cobrar de verdad hay que conectar una pasarela (Wompi, Mercado Pago, PayU…).
        </p>
      )}
      {data && !data.provider && (
        <p className="pay-sandbox is-error" role="alert">
          No hay pasarela de pagos configurada en este entorno: no se pueden generar links de pago.
        </p>
      )}
      <section className="panel collections payments">
        {data && (
          <div className="pay-kpis" aria-label="Indicadores de cobro en línea">
            <PayKpi
              tone="blue"
              label="Total documentos"
              value={money(data.summary.totalDocuments)}
              onFilter={() => filterBy({})}
            />
            <PayKpi
              tone="green"
              label="Total neto recibido"
              value={money(data.summary.totalNet)}
              onFilter={() => filterBy({ status: "APPROVED" })}
            />
            <PayKpi
              tone="amber"
              label="Por desembolsar"
              value={money(data.summary.pendingDisbursement)}
              onFilter={() => filterBy({ disbursement: "PENDING" })}
            />
            <PayKpi
              tone="red"
              label="Pagos rechazados"
              value={String(data.summary.rejectedCount)}
              onFilter={() => filterBy({ status: "REJECTED" })}
            />
          </div>
        )}

        <form
          className="collections-toolbar"
          onSubmit={event => {
            event.preventDefault();
            apply(draft);
          }}
        >
          <label className="collections-search">
            <span aria-hidden="true">👤</span>
            <input
              type="search"
              value={draft.search}
              onChange={set("search")}
              placeholder="Buscar por nombre o identificación"
              aria-label="Buscar por nombre o identificación"
            />
          </label>
          <button
            type="button"
            className="secondary"
            aria-expanded={showFilters}
            aria-controls="payments-filters"
            onClick={() => setShowFilters(!showFilters)}
          >
            <FilterIcon /> Más filtros{activeFilters ? ` (${activeFilters})` : ""}
          </button>
          <span className="collections-spacer" />
          {canExport && (
            <button
              type="button"
              className="secondary pay-xlsx"
              onClick={() => exportPayments("xlsx")}
              title="Exportar a Excel"
            >
              <span aria-hidden="true">X</span>
              <span className="sr-only">Exportar a Excel</span>
            </button>
          )}
          <ActionMenu
            label="Ver reportes"
            items={[
              { label: "Actualizar", onSelect: report.reload },
              ...(["pdf", "xlsx", "csv"] as const).map(format => ({
                label: `Exportar ${format === "xlsx" ? "Excel (XLSX)" : format.toUpperCase()}`,
                onSelect: () => exportPayments(format),
                disabled: !canExport,
                note: canExport ? undefined : "Tu rol no permite exportar",
              })),
            ]}
          >
            Ver reportes ⌄
          </ActionMenu>
          <button
            type="button"
            className="primary"
            disabled={!canLink || !data?.provider}
            title={canLink ? undefined : "Tu rol no permite generar links de pago"}
            onClick={() => setDialog({ kind: "create" })}
          >
            Generar link de pago
          </button>

          {showFilters && (
            <div id="payments-filters" className="collections-filters">
              <label className="field">
                Fecha inicial
                <input type="date" value={draft.from} onChange={set("from")} required />
              </label>
              <label className="field">
                Fecha final
                <input type="date" value={draft.to} onChange={set("to")} min={draft.from} required />
              </label>
              <label className="field">
                Pago
                <select value={draft.status} onChange={set("status")}>
                  <option value="">Todos</option>
                  {Object.entries(statusLabels).map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Desembolso
                <select value={draft.disbursement} onChange={set("disbursement")}>
                  <option value="">Todos</option>
                  {Object.entries(disbursementLabels).map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="report-actions">
                <button type="submit" className="primary">
                  Buscar
                </button>
                <button type="button" className="secondary" onClick={() => apply(emptyFilters())}>
                  Limpiar
                </button>
              </div>
            </div>
          )}
        </form>

        {notice && (
          <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
            {notice.text}
          </p>
        )}
        <ReportStatus loading={report.loading && !data} error={report.error} />

        {data && (
          <>
            <div className="report-table-wrap">
              <table className="report-table collections-table payments-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Comprobante</th>
                    <th>Cliente</th>
                    <th className="num">Total pagado</th>
                    <th className="num">Neto recibido</th>
                    <th>Fecha de pago</th>
                    <th>Pago</th>
                    <th>Desembolso</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const { main, more } = rowActions(row);
                    return (
                      <tr key={row.id} className={row.status === "CANCELLED" ? "is-cancelled" : undefined}>
                        <td>{dateTime(row.createdAt)}</td>
                        <td>
                          <Link
                            href={`/recaudos/documento?type=Invoice&id=${row.invoice.id}`}
                            className="collections-doc"
                          >
                            {row.number}
                          </Link>
                          <small>Factura {row.invoice.number}</small>
                        </td>
                        <td>
                          <span className="collections-doc">{row.customer.legalName}</span>
                          <small>{row.customer.identificationNumber}</small>
                        </td>
                        <td className="num">{row.status === "APPROVED" ? money(row.amount) : "—"}</td>
                        <td className="num">
                          {row.net ? money(row.net) : "—"}
                          {row.fee && <small>Comisión {money(row.fee)}</small>}
                        </td>
                        <td>
                          {row.status === "APPROVED" ? dateTime(row.paidAt) : "—"}
                          {row.method && <small>{methodLabels[row.method] ?? row.method}</small>}
                        </td>
                        <td>
                          <span className={badge[row.status]} title={row.rejectionReason ?? undefined}>
                            {statusLabels[row.status]}
                          </span>
                        </td>
                        <td>
                          {row.disbursementStatus ? (
                            <span className={row.disbursementStatus === "DISBURSED" ? badge.DISBURSED : badge.PENDING}>
                              {disbursementLabels[row.disbursementStatus]}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <div className="split-button row-actions">
                            {main ? (
                              main.href ? (
                                <Link href={main.href} className="secondary pay-main">
                                  {main.label}
                                </Link>
                              ) : (
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={main.onSelect}
                                  disabled={main.disabled}
                                >
                                  {main.label}
                                </button>
                              )
                            ) : (
                              <Link
                                href={`/recaudos/documento?type=Invoice&id=${row.invoice.id}`}
                                className="secondary pay-main"
                              >
                                Ver factura
                              </Link>
                            )}
                            <ActionMenu
                              label={`Más acciones de ${row.number}`}
                              className="secondary split-toggle"
                              items={more}
                            >
                              <span aria-hidden="true">⌄</span>
                            </ActionMenu>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <div className="pay-empty">
                <EmptyIllustration />
                <h3>Aún no tienes documentos registrados</h3>
                <p>Crea un documento para poderlo gestionar</p>
              </div>
            )}
            <div className="pay-pagination">
              <label>
                Filas por página:
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
                {first}–{last} de {total}
              </span>
              <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ‹
              </button>
              <button
                type="button"
                aria-label="Página siguiente"
                disabled={last >= total}
                onClick={() => setPage(page + 1)}
              >
                ›
              </button>
            </div>
          </>
        )}
      </section>

      {dialog?.kind === "create" && (
        <CreateLinkDialog
          onClose={() => setDialog(null)}
          onCreated={number => {
            setNotice({ kind: "ok", text: `Link ${number} generado.` });
            report.reload();
          }}
        />
      )}
      {dialog?.kind === "email" && (
        <LinkEmailDialog
          row={dialog.row}
          onClose={() => setDialog(null)}
          onSent={recipient => {
            setDialog(null);
            setNotice({ kind: "ok", text: `Link de ${dialog.row.number} enviado a ${recipient}.` });
          }}
        />
      )}
    </>
  );
}

function PayKpi({
  tone,
  label,
  value,
  onFilter,
}: {
  tone: "blue" | "green" | "amber" | "red";
  label: string;
  value: string;
  onFilter: () => void;
}) {
  return (
    <div className={`pay-kpi is-${tone}`}>
      <b>{value}</b>
      <div>
        <span>
          <i aria-hidden="true" /> {label}
        </span>
        <button type="button" className="report-link" onClick={onFilter}>
          Filtrar
        </button>
      </div>
    </div>
  );
}

/** Carpeta con avión de papel (estado vacío). */
function EmptyIllustration() {
  return (
    <svg width="110" height="96" viewBox="0 0 110 96" aria-hidden="true">
      <ellipse cx="55" cy="88" rx="34" ry="5" fill="#e3edf6" />
      <circle cx="58" cy="50" r="34" fill="#eaf5fe" />
      <path d="M22 34h26l6 7h34a4 4 0 0 1 4 4v33a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4V38a4 4 0 0 1 4-4z" fill="#1186d8" />
      <path d="M18 46h74v32a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4z" fill="#2c9ff0" />
      <path d="M40 8l30 8-17 6-3 10-4-9z" fill="#78c43b" />
      <path d="M53 22l-7 1 4 9z" fill="#5a9a2a" />
    </svg>
  );
}

type Payable = {
  id: string;
  number: string;
  issueDate: string;
  total: string;
  balance: string;
  customer: { legalName: string; identificationNumber: string; email: string | null };
};

/** Generar link: buscar una factura a crédito con saldo, indicar el valor y crear el link. */
function CreateLinkDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (number: string) => void }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const invoices = useReport<{ data: Payable[] }>("/v1/online-payments/payable-invoices", { search: query });
  const [selected, setSelected] = useState<Payable | null>(null);
  const [amount, setAmount] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const [created, setCreated] = useState<{ number: string; checkoutUrl: string } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setState({ busy: true });
    try {
      const result = await apiPost<{ data: { number: string; checkoutUrl: string } }>("/v1/online-payments", {
        invoiceId: selected.id,
        ...(amount && { amount: Number(amount) }),
      });
      setCreated(result.data);
      setState({ busy: false });
      onCreated(result.data.number);
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };

  return (
    <Dialog title={created ? `Link ${created.number} generado` : "Generar link de pago"} onClose={onClose}>
      {created ? (
        <div className="pay-created">
          <p>Comparte este link con el cliente para que pague en línea:</p>
          <input
            readOnly
            value={created.checkoutUrl}
            onFocus={event => event.target.select()}
            aria-label="Link de pago"
          />
          <div className="report-dialog-actions">
            <a href={created.checkoutUrl} target="_blank" rel="noopener" className="secondary pay-main">
              Abrir página de pago
            </a>
            <button
              type="button"
              className="primary"
              onClick={() => navigator.clipboard?.writeText(created.checkoutUrl)}
            >
              Copiar link
            </button>
            <button type="button" className="secondary" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
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
              placeholder="Cliente o identificación"
              aria-label="Buscar factura por cliente o identificación"
            />
            <button type="button" className="secondary" onClick={() => setQuery(search)}>
              Buscar
            </button>
          </div>
          <ReportStatus loading={invoices.loading} error={invoices.error} />
          {invoices.data && !invoices.data.data.length && (
            <p className="report-message">No hay facturas a crédito con saldo pendiente.</p>
          )}
          <ul className="pay-invoice-list" role="listbox" aria-label="Facturas por cobrar">
            {invoices.data?.data.map(invoice => (
              <li key={invoice.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected?.id === invoice.id}
                  className={selected?.id === invoice.id ? "is-selected" : undefined}
                  onClick={() => {
                    setSelected(invoice);
                    setAmount(invoice.balance);
                  }}
                >
                  <b>{invoice.customer.legalName}</b> · {invoice.customer.identificationNumber}
                  <small>
                    Factura {invoice.number} del {longDate(invoice.issueDate)} · Saldo {money(invoice.balance)}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <label className="field">
              Valor a cobrar (máximo {money(selected.balance)})
              <input
                type="number"
                min="0.01"
                step="0.01"
                max={selected.balance}
                value={amount}
                onChange={event => setAmount(event.target.value)}
                required
              />
            </label>
          )}
          {state.error && (
            <p className="report-error" role="alert">
              {state.error}
            </p>
          )}
          <div className="report-dialog-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="primary" disabled={!selected || state.busy}>
              {state.busy ? "Generando…" : "Generar link"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function LinkEmailDialog({
  row,
  onClose,
  onSent,
}: {
  row: PaymentRow;
  onClose: () => void;
  onSent: (to: string) => void;
}) {
  const [to, setTo] = useState(row.customer.email ?? "");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      const result = await apiPost<{ data: { recipient: string } }>(`/v1/online-payments/${row.id}/email`, {
        to: to.trim(),
      });
      onSent(result.data.recipient);
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  return (
    <Dialog title={`Enviar link ${row.number}`} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          Correo de destino
          <input type="email" value={to} onChange={event => setTo(event.target.value)} required autoFocus />
        </label>
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
            {state.busy ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** <dialog> modal nativo (foco atrapado y Escape los da el navegador). */
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <dialog
      ref={element => {
        if (element && !element.open) element.showModal();
      }}
      className="report-dialog pay-dialog"
      aria-label={title}
      onClose={onClose}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
