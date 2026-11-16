/**
 * Pestaña "Recaudos" del Reporte de facturación (GET /v1/reports/billing/collections).
 *
 * Recaudo = dinero recibido: facturas de contado vigentes + recibos de caja activos. Los recibos
 * anulados se listan tachados y no suman. Las facturas a crédito no son recaudo: su saldo pendiente
 * se muestra como "Cartera por cobrar". Definiciones completas en docs/reporte-facturacion.md.
 *
 * Acciones: crear recibo de caja (/recaudos/nuevo), ver documento (/recaudos/documento), enviar por
 * correo (uno o varios seleccionados), enviar a otro correo, anular recibo y exportar.
 * Los botones se muestran según el rol, pero la API valida los permisos en cada acción.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import type { ExportFormat, ReportColumn } from "../lib/report-export";
import { ActionMenu } from "./action-menu";
import {
  exportFromApi,
  Kpi,
  money,
  Pagination,
  ReportStatus,
  useReport,
  useSession,
  defaultPeriod,
} from "./billing-report-common";
import { SendEmailDialog, sendDocumentEmail, VoidReceiptDialog, type DocumentRef } from "./collection-dialogs";

export type CollectionRow = {
  type: "Invoice" | "CashReceipt";
  id: string;
  date: string;
  number: string;
  description: string;
  customer: {
    id: string;
    legalName: string;
    identificationType: string;
    identificationNumber: string;
    email: string | null;
  };
  total: string;
  status: string;
  email: { sentAt: string; recipient: string } | null;
};

type CollectionsResponse = {
  data: CollectionRow[];
  pagination: { page: number; pageSize: number; total: number };
  period: { from: string; to: string };
  summary: {
    total: string;
    cashInvoiceCount: number;
    cashInvoiceTotal: string;
    receiptCount: number;
    receiptTotal: string;
    receivable: string;
  };
};

type Filters = { search: string; from: string; to: string; documentType: string; method: string; email: string };
const emptyFilters = (): Filters => ({ ...defaultPeriod(), search: "", documentType: "", method: "", email: "" });

export const methodLabels: Record<string, string> = {
  CASH: "Efectivo",
  BANK_TRANSFER: "Transferencia",
  CARD: "Tarjeta",
  CHECK: "Cheque",
  OTHER: "Otro",
};
const documentTypeLabels: Record<string, string> = { Invoice: "Facturas de contado", CashReceipt: "Recibos de caja" };
const emailLabels: Record<string, string> = { SENT: "Enviado", UNSENT: "Sin enviar" };

/** "2026-11-16" → "16 nov. 2026" */
export const longDate = (value: string) =>
  new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const isVoid = (row: CollectionRow) => row.status === "VOID";
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Ícono de controles deslizantes para "Más filtros". */
export const FilterIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
  >
    <path d="M3 2v12M8 2v12M13 2v12" strokeLinecap="round" />
    <rect x="1.2" y="9" width="3.6" height="2.4" rx="1" fill="white" />
    <rect x="6.2" y="4" width="3.6" height="2.4" rx="1" fill="white" />
    <rect x="11.2" y="8" width="3.6" height="2.4" rx="1" fill="white" />
  </svg>
);
export const documentHref = (row: { type: string; id: string }) => `/recaudos/documento?type=${row.type}&id=${row.id}`;

/** Columnas de la exportación (CSV, XLSX y PDF). */
const collectionColumns: ReportColumn<CollectionRow>[] = [
  { header: "Fecha", value: row => longDate(row.date) },
  { header: "Comprobante", value: row => row.number },
  { header: "Tipo", value: row => row.description },
  { header: "Cliente", value: row => row.customer.legalName },
  { header: "Identificación", value: row => `${row.customer.identificationType} ${row.customer.identificationNumber}` },
  { header: "Total", value: row => row.total, money: true },
  { header: "Estado", value: row => (isVoid(row) ? "Anulado" : "Vigente") },
  { header: "Correo", value: row => (row.email ? `Enviado a ${row.email.recipient}` : "Sin enviar") },
];

export function CollectionsReport() {
  const { company, canExport, canReceive, canEmail } = useSession();
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(draft);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<
    { kind: "email"; document: DocumentRef } | { kind: "void"; receipt: { id: string; number: string } } | null
  >(null);
  const report = useReport<CollectionsResponse>("/v1/reports/billing/collections", { ...applied, page });
  const data = report.data;
  const rows = data?.data ?? [];

  const set = (field: keyof Filters) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft({ ...draft, [field]: event.target.value });
  const apply = (filters: Filters) => {
    setApplied(filters);
    setPage(1);
    setSelected(new Set());
  };
  const search = (event: React.FormEvent) => {
    event.preventDefault();
    apply(draft);
  };
  const clear = () => {
    const reset = emptyFilters();
    setDraft(reset);
    apply(reset);
  };
  const refresh = () => {
    setSelected(new Set());
    report.reload();
  };
  const changePage = (next: number) => {
    setPage(next);
    setSelected(new Set());
  };

  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const allSelected = rows.length > 0 && rows.every(row => selected.has(row.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map(row => row.id)));

  /** Envía uno o varios documentos al correo de su cliente, uno tras otro, y resume el resultado. */
  const sendToCustomers = async (targets: CollectionRow[]) => {
    setBusy(true);
    setNotice(null);
    const failed: string[] = [];
    for (const row of targets) {
      try {
        await sendDocumentEmail(row);
      } catch (error) {
        failed.push(`${row.number}: ${(error as Error).message}`);
      }
    }
    const sent = targets.length - failed.length;
    setNotice(
      failed.length
        ? { kind: "error", text: `${sent} enviado(s). No se enviaron: ${failed.join(" · ")}` }
        : {
            kind: "ok",
            text: sent === 1 ? `${targets[0]!.number} enviado por correo.` : `${sent} documentos enviados por correo.`,
          }
    );
    setBusy(false);
    refresh();
  };

  const exportCollections = async (format: ExportFormat) => {
    setNotice(null);
    try {
      await exportFromApi<CollectionRow>(format, "/v1/reports/billing/collections/export", applied, response => {
        const summary = response.summary as CollectionsResponse["summary"];
        return {
          company,
          title: "Reporte de facturación — Recaudos",
          period: response.period,
          filters: [
            ...(applied.search ? [["Cliente", applied.search] as [string, string]] : []),
            ...(applied.documentType
              ? [["Documento", documentTypeLabels[applied.documentType]!] as [string, string]]
              : []),
            ...(applied.method ? [["Medio de pago", methodLabels[applied.method]!] as [string, string]] : []),
            ...(applied.email ? [["Correo", emailLabels[applied.email]!] as [string, string]] : []),
          ],
          columns: collectionColumns,
          rows: response.data,
          totals: [
            ["Total recaudado", money(summary.total)],
            [`Facturas de contado (${summary.cashInvoiceCount})`, money(summary.cashInvoiceTotal)],
            [`Recibos de caja activos (${summary.receiptCount})`, money(summary.receiptTotal)],
            ["Cartera por cobrar a hoy", money(summary.receivable)],
            ["Nota", "Los recibos anulados se listan pero no suman."],
          ],
          fileName: `reporte-recaudos-${response.period.from}-a-${response.period.to}`,
        };
      });
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };

  const selectedRows = rows.filter(row => selected.has(row.id));
  const activeFilters = [applied.documentType, applied.method, applied.email].filter(Boolean).length;

  return (
    <>
      <section className="panel collections">
        <form className="collections-toolbar" onSubmit={search}>
          <label className="collections-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={draft.search}
              onChange={set("search")}
              placeholder="Buscar por identificación o cliente"
              aria-label="Buscar por identificación o cliente"
            />
          </label>
          <button
            type="button"
            className="secondary"
            aria-expanded={showFilters}
            aria-controls="collections-filters"
            onClick={() => setShowFilters(!showFilters)}
          >
            <FilterIcon /> Más filtros{activeFilters ? ` (${activeFilters})` : ""}
          </button>
          <span className="collections-spacer" />
          <ActionMenu
            label="Ver reportes"
            items={[
              { label: "Actualizar", onSelect: refresh },
              ...(["pdf", "xlsx", "csv"] as const).map(format => ({
                label: `Exportar ${format === "xlsx" ? "Excel (XLSX)" : format.toUpperCase()}`,
                onSelect: () => exportCollections(format),
                disabled: !canExport,
                note: canExport ? undefined : "Tu rol no permite exportar",
              })),
            ]}
          >
            Ver reportes ⌄
          </ActionMenu>
          <div className="split-button">
            {canReceive ? (
              <Link href="/recaudos/nuevo" className="primary">
                Crear recibo de caja
              </Link>
            ) : (
              <button type="button" className="primary" disabled title="Tu rol no permite registrar recaudos">
                Crear recibo de caja
              </button>
            )}
            <ActionMenu
              label="Otros documentos de recaudo"
              className="primary split-toggle"
              items={[
                { label: "Factura de venta (contado)", href: "/facturacion/nueva", note: "Se recauda al emitirla" },
              ]}
            >
              <span aria-hidden="true">⌄</span>
            </ActionMenu>
          </div>

          {showFilters && (
            <div id="collections-filters" className="collections-filters">
              <label className="field">
                Fecha inicial
                <input type="date" value={draft.from} onChange={set("from")} required />
              </label>
              <label className="field">
                Fecha final
                <input type="date" value={draft.to} onChange={set("to")} min={draft.from} required />
              </label>
              <label className="field">
                Documento
                <select value={draft.documentType} onChange={set("documentType")}>
                  <option value="">Todos</option>
                  {Object.entries(documentTypeLabels).map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Medio de pago
                <select value={draft.method} onChange={set("method")}>
                  <option value="">Todos</option>
                  {Object.entries(methodLabels).map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Correo
                <select value={draft.email} onChange={set("email")}>
                  <option value="">Todos</option>
                  {Object.entries(emailLabels).map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="report-actions">
                <button type="submit" className="primary" disabled={report.loading}>
                  Buscar
                </button>
                <button type="button" className="secondary" onClick={clear} disabled={report.loading}>
                  Limpiar
                </button>
              </div>
            </div>
          )}
        </form>

        {data && (
          <div className="collections-kpis" aria-label="Indicadores de recaudo">
            <Kpi
              label="Total recaudado"
              value={money(data.summary.total)}
              note={`${longDate(data.period.from)} – ${longDate(data.period.to)}`}
            />
            <Kpi
              label="Recibos de caja"
              value={money(data.summary.receiptTotal)}
              note={plural(data.summary.receiptCount, "recibo activo", "recibos activos")}
            />
            <Kpi
              label="Facturas de contado"
              value={money(data.summary.cashInvoiceTotal)}
              note={plural(data.summary.cashInvoiceCount, "factura", "facturas")}
            />
            <Kpi
              label="Cartera por cobrar"
              value={money(data.summary.receivable)}
              note="Saldo de facturas a crédito, a hoy"
            />
          </div>
        )}

        {notice && (
          <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
            {notice.text}
          </p>
        )}

        {selectedRows.length > 0 && (
          <div className="collections-bulk" role="region" aria-label="Acciones sobre los seleccionados">
            <span>{selectedRows.length} seleccionado(s)</span>
            <button
              type="button"
              className="secondary"
              disabled={busy || !canEmail}
              onClick={() => sendToCustomers(selectedRows)}
            >
              {busy ? "Enviando…" : "Enviar por correo"}
            </button>
            <button type="button" className="report-link" onClick={() => setSelected(new Set())}>
              Quitar selección
            </button>
          </div>
        )}

        <ReportStatus loading={report.loading && !data} error={report.error} />
        {data && (
          <>
            <div className="report-table-wrap">
              <table className="report-table collections-table">
                <thead>
                  <tr>
                    <th className="check">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Seleccionar todos"
                      />
                    </th>
                    <th>Fecha</th>
                    <th>Comprobante</th>
                    <th>Cliente</th>
                    <th className="num">Total</th>
                    <th>Correo</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className={isVoid(row) ? "is-void" : undefined}>
                      <td className="check">
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggleRow(row.id)}
                          aria-label={`Seleccionar ${row.number}`}
                        />
                      </td>
                      <td>{longDate(row.date)}</td>
                      <td>
                        <Link href={documentHref(row)} className="collections-doc">
                          {row.number}
                        </Link>
                        <small>{isVoid(row) ? `${row.description} · Anulado` : row.description}</small>
                      </td>
                      <td>
                        <Link
                          href={`/reportes/facturacion?tab=clientes&cliente=${row.customer.id}`}
                          className="collections-doc"
                        >
                          {row.customer.legalName}
                        </Link>
                        <small>{row.customer.identificationNumber}</small>
                      </td>
                      <td className="num">{money(row.total)}</td>
                      <td>
                        <span
                          className={row.email ? "email-badge is-sent" : "email-badge"}
                          title={row.email ? `Enviado a ${row.email.recipient}` : undefined}
                        >
                          {row.email ? "Enviado" : "Sin enviar"}
                        </span>
                      </td>
                      <td>
                        <RowActions
                          row={row}
                          canEmail={canEmail}
                          canReceive={canReceive}
                          busy={busy}
                          onSend={() => sendToCustomers([row])}
                          onSendOther={() =>
                            setDialog({
                              kind: "email",
                              document: {
                                type: row.type,
                                id: row.id,
                                number: row.number,
                                customerEmail: row.customer.email,
                              },
                            })
                          }
                          onVoid={() => setDialog({ kind: "void", receipt: { id: row.id, number: row.number } })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ReportStatus loading={false} empty={!rows.length} />
            <Pagination {...data.pagination} onPage={changePage} />
          </>
        )}
      </section>

      {dialog?.kind === "email" && (
        <SendEmailDialog
          document={dialog.document}
          onClose={() => setDialog(null)}
          onSent={recipient => {
            setDialog(null);
            setNotice({ kind: "ok", text: `${dialog.document.number} enviado a ${recipient}.` });
            refresh();
          }}
        />
      )}
      {dialog?.kind === "void" && (
        <VoidReceiptDialog
          receipt={dialog.receipt}
          onClose={() => setDialog(null)}
          onVoided={() => {
            setDialog(null);
            setNotice({ kind: "ok", text: `Recibo ${dialog.receipt.number} anulado.` });
            refresh();
          }}
        />
      )}
    </>
  );
}

/** "Enviar por correo" (al correo del cliente) + flecha con el resto de acciones de la fila. */
function RowActions({
  row,
  canEmail,
  canReceive,
  busy,
  onSend,
  onSendOther,
  onVoid,
}: {
  row: CollectionRow;
  canEmail: boolean;
  canReceive: boolean;
  busy: boolean;
  onSend: () => void;
  onSendOther: () => void;
  onVoid: () => void;
}) {
  const noEmail = !row.customer.email;
  return (
    <div className="split-button row-actions">
      <button
        type="button"
        className="secondary"
        disabled={busy || !canEmail || noEmail}
        onClick={onSend}
        title={noEmail ? "El cliente no tiene correo: usa “Enviar a otro correo”" : `Enviar a ${row.customer.email}`}
      >
        Enviar por correo
      </button>
      <ActionMenu
        label={`Más acciones de ${row.number}`}
        className="secondary split-toggle"
        items={[
          { label: "Ver documento", href: documentHref(row) },
          {
            label: "Enviar a otro correo",
            onSelect: onSendOther,
            disabled: !canEmail,
            note: canEmail ? undefined : "Tu rol no permite enviar correos",
          },
          ...(row.type === "CashReceipt"
            ? [
                {
                  label: "Anular recibo",
                  onSelect: onVoid,
                  danger: true,
                  disabled: !canReceive || isVoid(row),
                  note: isVoid(row) ? "Ya está anulado" : canReceive ? undefined : "Tu rol no permite anular",
                },
              ]
            : []),
        ]}
      >
        <span aria-hidden="true">⌄</span>
      </ActionMenu>
    </div>
  );
}
