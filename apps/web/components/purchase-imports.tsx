/**
 * Compras y gastos › Soporte de compras o gastos por legalizar (/compras?tab=soporte-por-legalizar).
 *
 * "Importar nuevo documento" sube el XML de la factura electrónica del proveedor (UBL 2.1 o AttachedDocument);
 * cada soporte se revisa (ítems, advertencias, proveedor) y se legaliza como compra o gasto (CG-n) o se rechaza.
 * Criterios: documento soporte, estado y fecha de elaboración (últimos 30 días por defecto). Descarga en Excel.
 * API: apps/api/src/purchase-imports.ts; reglas en docs/compras-y-gastos.md.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import { apiPost } from "../lib/api";
import type { ReportColumn } from "../lib/report-export";
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
import { periodPresets, presetRange, type Preset } from "./billing-report-quotes";
import { Modal, VoidDocumentDialog } from "./collection-dialogs";
import { purchaseHref } from "./purchases";

type Warning = { message: string; blocking: boolean };
type ImportRow = {
  id: string;
  fileName: string;
  cufe: string;
  number: string;
  supplierName: string;
  supplierNit: string;
  supplierIdType: string;
  issueDate: string;
  dueDate: string | null;
  paymentTerm: "CASH" | "CREDIT";
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  createdAt: string;
  status: "PENDING" | "LEGALIZED" | "REJECTED";
  rejectReason: string | null;
  warnings: Warning[];
  blocked: boolean;
  voucher: { id: string; name: string; number: string; void: boolean } | null;
};
type ImportsResponse = { data: ImportRow[]; pagination: { page: number; pageSize: number; total: number } };

const statusLabels: Record<ImportRow["status"], string> = {
  PENDING: "Por legalizar",
  LEGALIZED: "Legalizado",
  REJECTED: "Rechazado",
};
const statusBadges: Record<ImportRow["status"], string> = {
  PENDING: "pay-badge is-pending",
  LEGALIZED: "pay-badge is-ok",
  REJECTED: "pay-badge is-bad",
};
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" }).format(
    new Date(value)
  );

type Criteria = { search: string; status: string; preset: Preset; from: string; to: string };
const initialCriteria = (): Criteria => ({
  search: "",
  status: "",
  preset: "last30",
  ...presetRange("last30", defaultPeriod()),
});

const exportColumns: ReportColumn<ImportRow>[] = [
  { header: "Documento soporte", value: row => row.number },
  { header: "Proveedor", value: row => row.supplierName },
  { header: "NIT", value: row => row.supplierNit },
  { header: "Fecha elaboración", value: row => date(row.issueDate) },
  { header: "Fecha creación", value: row => dateTime(row.createdAt) },
  { header: "Nombre comprobante", value: row => row.voucher?.name ?? "" },
  { header: "Número de comprobante", value: row => row.voucher?.number ?? "" },
  { header: "Estado", value: row => statusLabels[row.status] },
  { header: "Valor", value: row => row.total, money: true },
  { header: "CUFE", value: row => row.cufe },
];

export function PurchaseImports() {
  const { company, canExport, canReceive: canRegister } = useSession();
  const [draft, setDraft] = useState<Criteria>(initialCriteria);
  const [applied, setApplied] = useState<Criteria>(draft);
  const [showCriteria, setShowCriteria] = useState(true);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: React.ReactNode } | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "import" }
    | { kind: "detail"; id: string }
    | { kind: "legalize"; id: string }
    | { kind: "reject"; row: Pick<ImportRow, "id" | "number"> }
    | null
  >(null);
  const pageSize = 25;
  const { preset: _preset, ...query } = applied;
  const params = { ...query, page, pageSize };
  const report = useReport<ImportsResponse>("/v1/reports/purchases/imports", params);
  const rows = report.data?.data ?? [];
  const total = report.data?.pagination.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const search = (criteria: Criteria) => {
    setApplied(criteria);
    setPage(1);
  };
  const setPreset = (preset: Preset) =>
    setDraft(current => ({ ...current, preset, ...(preset === "custom" ? {} : presetRange(preset, current)) }));

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

  const download = async () => {
    setNotice(null);
    try {
      await exportFromApi<ImportRow>("xlsx", "/v1/reports/purchases/imports/export", query, response => ({
        company,
        title: "Soporte de compras o gastos por legalizar",
        period: { from: applied.from, to: applied.to },
        filters: [
          ...(applied.search ? [["Documento soporte", applied.search] as [string, string]] : []),
          ...(applied.status
            ? [["Estado", statusLabels[applied.status as ImportRow["status"]]] as [string, string]]
            : []),
        ],
        columns: exportColumns,
        rows: response.data,
        totals: [["Documentos", String(response.data.length)]],
        fileName: `soportes-por-legalizar-${applied.from}-a-${applied.to}`,
      }));
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };

  return (
    <>
      <section className="panel imports-panel">
        <h2 className="imports-title">Soporte de compras o gastos por legalizar</h2>
        <div className="imports-head">
          <button
            type="button"
            className="primary"
            disabled={!canRegister}
            title={canRegister ? undefined : "Tu rol no permite importar documentos"}
            onClick={() => {
              setNotice(null);
              setDialog({ kind: "import" });
            }}
          >
            Importar nuevo documento
          </button>
          <button
            type="button"
            className="report-link imports-toggle"
            aria-expanded={showCriteria}
            aria-controls="imports-criteria"
            onClick={() => setShowCriteria(!showCriteria)}
          >
            {showCriteria ? "⌃ Ocultar criterios de búsqueda" : "⌄ Mostrar criterios de búsqueda"}
          </button>
        </div>

        {showCriteria && (
          <form
            id="imports-criteria"
            className="imports-criteria"
            onSubmit={event => {
              event.preventDefault();
              search(draft);
            }}
          >
            <label className="field">
              Documento soporte
              <input
                value={draft.search}
                onChange={event => setDraft({ ...draft, search: event.target.value })}
                placeholder="Número, proveedor, NIT o CUFE"
              />
            </label>
            <div className="field imports-dates">
              <span>Fecha elaboración</span>
              <select
                value={draft.preset}
                onChange={event => setPreset(event.target.value as Preset)}
                aria-label="Período de fecha de elaboración"
              >
                {Object.entries(periodPresets).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {draft.preset !== "all" && (
                <span className="imports-range">
                  <input
                    type="date"
                    value={draft.from}
                    aria-label="Desde"
                    required
                    onChange={event => setDraft({ ...draft, preset: "custom", from: event.target.value })}
                  />
                  <input
                    type="date"
                    value={draft.to}
                    min={draft.from}
                    aria-label="Hasta"
                    required
                    onChange={event => setDraft({ ...draft, preset: "custom", to: event.target.value })}
                  />
                </span>
              )}
            </div>
            <label className="field">
              Estado
              <select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}>
                <option value="">Todos</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="report-actions imports-buttons">
              <button type="submit" className="secondary">
                Buscar
              </button>
              <button
                type="button"
                className="report-link"
                onClick={() => {
                  const reset = initialCriteria();
                  setDraft(reset);
                  search(reset);
                }}
              >
                Limpiar filtros
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="panel imports-results">
        <div className="imports-results-head">
          {notice && (
            <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
              {notice.text}
            </p>
          )}
          <span className="collections-spacer" />
          <button
            type="button"
            className="secondary imports-excel"
            onClick={download}
            disabled={!canExport || !total}
            title={
              !canExport
                ? "Tu rol no permite descargar"
                : !total
                  ? "No hay documentos para descargar"
                  : "Descargar en Excel"
            }
            aria-label="Descargar en Excel"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 2h9l5 5v15H6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="m9.5 11 4 6m0-6-4 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <ReportStatus loading={report.loading && !report.data} error={report.error} />
        {report.data && (
          <>
            <div className="report-table-wrap events-table-wrap">
              <table className="report-table events-table imports-table">
                <thead>
                  <tr>
                    <th>Documento soporte</th>
                    <th>Fecha creación</th>
                    <th>Nombre Comprobante</th>
                    <th>Número de comprobante</th>
                    <th>Estado</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id}>
                      <td>
                        <button
                          type="button"
                          className="report-link collections-doc"
                          onClick={() => setDialog({ kind: "detail", id: row.id })}
                        >
                          {row.number}
                        </button>
                        <small>
                          {row.supplierName} · NIT {row.supplierNit} · {date(row.issueDate)} · {money(row.total)}
                        </small>
                      </td>
                      <td>{dateTime(row.createdAt)}</td>
                      <td>{row.voucher?.name ?? "—"}</td>
                      <td>
                        {row.voucher ? (
                          <>
                            <Link href={purchaseHref("Purchase", row.voucher.id)} className="collections-doc">
                              {row.voucher.number}
                            </Link>
                            {row.voucher.void && <small>Anulado</small>}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <span className={statusBadges[row.status]}>{statusLabels[row.status]}</span>
                        {row.status === "PENDING" && row.blocked && (
                          <small className="receipt-overdue">Requiere revisión</small>
                        )}
                        {row.status === "REJECTED" && row.rejectReason && <small>{row.rejectReason}</small>}
                      </td>
                      <td>
                        <div className="split-button row-actions">
                          {row.status === "PENDING" ? (
                            <button
                              type="button"
                              className="secondary pay-main"
                              disabled={!canRegister || row.blocked}
                              title={row.blocked ? row.warnings.find(warning => warning.blocking)?.message : undefined}
                              onClick={() => setDialog({ kind: "legalize", id: row.id })}
                            >
                              Legalizar
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="secondary pay-main"
                              onClick={() => setDialog({ kind: "detail", id: row.id })}
                            >
                              Ver detalle
                            </button>
                          )}
                          <ActionMenu
                            label={`Más acciones de ${row.number}`}
                            className="secondary split-toggle"
                            items={[
                              { label: "Ver detalle", onSelect: () => setDialog({ kind: "detail", id: row.id }) },
                              ...(row.voucher
                                ? [
                                    {
                                      label: `Ver ${row.voucher.number}`,
                                      href: purchaseHref("Purchase", row.voucher.id),
                                    },
                                  ]
                                : []),
                              ...(row.status === "PENDING"
                                ? [
                                    {
                                      label: "Rechazar",
                                      danger: true,
                                      disabled: !canRegister,
                                      onSelect: () => setDialog({ kind: "reject", row }),
                                    },
                                  ]
                                : []),
                              ...(row.status === "REJECTED"
                                ? [
                                    {
                                      label: "Volver a por legalizar",
                                      disabled: !canRegister,
                                      onSelect: () =>
                                        run(
                                          () => apiPost(`/v1/purchases/imports/${row.id}/restore`),
                                          `${row.number} volvió a "Por legalizar".`
                                        ),
                                    },
                                  ]
                                : []),
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
              {!rows.length && <p className="imports-empty">No se encontraron resultados para tu búsqueda</p>}
            </div>
            {total > pageSize && (
              <div className="events-pagination">
                <span>
                  Mostrando{" "}
                  <b>
                    {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)}
                  </b>{" "}
                  de {total} registros
                </span>
                <span className="events-pages">
                  <button
                    type="button"
                    aria-label="Página anterior"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    aria-label="Página siguiente"
                    disabled={page >= pages}
                    onClick={() => setPage(page + 1)}
                  >
                    ›
                  </button>
                </span>
              </div>
            )}
          </>
        )}
      </section>

      {dialog?.kind === "import" && (
        <ImportDialog
          onClose={() => setDialog(null)}
          onImported={result => {
            setNotice({
              kind: "ok",
              text: `Documento importado${result.events ? " y registrado en Registro de eventos" : ""}. Revísalo y legalízalo.`,
            });
            // Se muestran todos los pendientes para que aparezca aunque su fecha no entre en el rango buscado.
            const pending: Criteria = {
              search: "",
              status: "PENDING",
              preset: "all",
              ...presetRange("all", defaultPeriod()),
            };
            setDraft(pending);
            search(pending);
            report.reload();
            setDialog({ kind: "detail", id: result.id });
          }}
        />
      )}
      {dialog?.kind === "detail" && (
        <DetailDialog
          id={dialog.id}
          canRegister={canRegister}
          onClose={() => setDialog(null)}
          onLegalize={() => setDialog({ kind: "legalize", id: dialog.id })}
          onReject={row => setDialog({ kind: "reject", row })}
        />
      )}
      {dialog?.kind === "legalize" && (
        <LegalizeDialog
          id={dialog.id}
          onClose={() => setDialog(null)}
          onDone={result => {
            setDialog(null);
            setNotice({
              kind: "ok",
              text: (
                <>
                  Soporte legalizado como{" "}
                  <Link href={purchaseHref("Purchase", result.purchaseDocumentId)} className="collections-doc">
                    {result.number}
                  </Link>
                  {result.createdSupplier ? " (se creó el proveedor)." : "."}
                </>
              ),
            });
            report.reload();
          }}
        />
      )}
      {dialog?.kind === "reject" && (
        <VoidDocumentDialog
          title={`Rechazar ${dialog.row.number}`}
          description="El soporte queda como rechazado y no se contabiliza. Puedes volverlo a “Por legalizar” después."
          path={`/v1/purchases/imports/${dialog.row.id}/reject`}
          confirmLabel="Rechazar soporte"
          onClose={() => setDialog(null)}
          onVoided={() => {
            setNotice({ kind: "ok", text: `${dialog.row.number} rechazado.` });
            setDialog(null);
            report.reload();
          }}
        />
      )}
    </>
  );
}

const MAX_BYTES = 2_000_000;

function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (result: { id: string; events: boolean; warnings: Warning[] }) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [registerEvents, setRegisterEvents] = useState(true);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    if (file.size > MAX_BYTES) return setState({ busy: false, error: "El archivo supera 2 MB." });
    setState({ busy: true });
    try {
      const xml = await file.text();
      const result = await apiPost<{ data: { id: string; events: boolean; warnings: Warning[] } }>(
        "/v1/purchases/imports",
        {
          fileName: file.name,
          xml,
          registerEvents,
        }
      );
      onImported(result.data);
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  return (
    <Modal title="Importar nuevo documento" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="report-dialog-text">
          Sube el XML de la factura electrónica que te envió el proveedor (el .xml del correo o del .zip; también sirve
          el AttachedDocument). Debe estar dirigida al NIT de tu empresa.
        </p>
        <label className="field">
          Archivo XML
          <input
            type="file"
            accept=".xml,text/xml,application/xml"
            required
            onChange={event => {
              setFile(event.target.files?.[0] ?? null);
              setState({ busy: false });
            }}
          />
        </label>
        <label className="events-check">
          <input type="checkbox" checked={registerEvents} onChange={event => setRegisterEvents(event.target.checked)} />
          Si es a crédito, registrarla también en Registro de eventos
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
          <button type="submit" className="primary" disabled={state.busy || !file}>
            {state.busy ? "Importando…" : "Importar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Detail = ImportRow & {
  lines: {
    description: string;
    quantity: number;
    unitPrice: number;
    discountRate: number;
    taxRate: number;
    total: number;
  }[];
  createdBy: string | null;
  supplier: { id: string; legalName: string; isSupplier: boolean; active: boolean } | null;
};

/** Texto sobre el proveedor que se usará al legalizar. */
function supplierNote(detail: Detail) {
  if (!detail.supplier)
    return `Se creará el proveedor ${detail.supplierName} (${detail.supplierIdType} ${detail.supplierNit}).`;
  if (!detail.supplier.active)
    return `El proveedor ${detail.supplier.legalName} está inactivo: actívalo en Proveedores para legalizar.`;
  return `Se usará el proveedor ${detail.supplier.legalName}${detail.supplier.isSupplier ? "" : " (se marcará como proveedor)"}.`;
}

function DetailDialog({
  id,
  canRegister,
  onClose,
  onLegalize,
  onReject,
}: {
  id: string;
  canRegister: boolean;
  onClose: () => void;
  onLegalize: () => void;
  onReject: (row: Pick<ImportRow, "id" | "number">) => void;
}) {
  const detail = useReport<{ data: Detail }>(`/v1/purchases/imports/${id}`);
  const doc = detail.data?.data;
  return (
    <Modal title={doc ? `Soporte ${doc.number}` : "Soporte"} onClose={onClose} wide>
      <ReportStatus loading={detail.loading && !doc} error={detail.error} />
      {doc && (
        <div className="imports-detail">
          <dl className="document-meta">
            <div>
              <dt>Proveedor</dt>
              <dd>
                {doc.supplierName} · {doc.supplierIdType} {doc.supplierNit}
              </dd>
            </div>
            <div>
              <dt>Fecha / vencimiento</dt>
              <dd>
                {date(doc.issueDate)} ·{" "}
                {doc.paymentTerm === "CREDIT" ? `Crédito, vence ${date(doc.dueDate)}` : "Contado"}
              </dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>
                <span className={statusBadges[doc.status]}>{statusLabels[doc.status]}</span>
                {doc.voucher && (
                  <>
                    {" "}
                    →{" "}
                    <Link href={purchaseHref("Purchase", doc.voucher.id)} className="collections-doc">
                      {doc.voucher.name} {doc.voucher.number}
                    </Link>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Importado</dt>
              <dd>
                {dateTime(doc.createdAt)} · {doc.fileName}
                {doc.createdBy && ` · ${doc.createdBy}`}
              </dd>
            </div>
            <div className="events-form-full">
              <dt>CUFE</dt>
              <dd>
                <code className="events-cufe-full">{doc.cufe}</code>
              </dd>
            </div>
          </dl>
          {doc.warnings.length > 0 && (
            <ul className="imports-warnings">
              {doc.warnings.map(warning => (
                <li key={warning.message} className={warning.blocking ? "is-blocking" : undefined}>
                  {warning.blocking ? "⛔ " : "⚠ "}
                  {warning.message}
                </li>
              ))}
            </ul>
          )}
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Valor unitario</th>
                  <th className="num">Desc. %</th>
                  <th className="num">IVA %</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((line, index) => (
                  <tr key={index}>
                    <td>{line.description}</td>
                    <td className="num">{line.quantity}</td>
                    <td className="num">{money(line.unitPrice)}</td>
                    <td className="num">{line.discountRate} %</td>
                    <td className="num">{line.taxRate} %</td>
                    <td className="num">{money(line.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="document-totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{money(doc.subtotal)}</dd>
            </div>
            <div>
              <dt>Impuestos</dt>
              <dd>{money(doc.taxTotal)}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{money(doc.total)}</dd>
            </div>
          </dl>
          {doc.status === "PENDING" && <p className="report-dialog-text">{supplierNote(doc)}</p>}
          {doc.status === "REJECTED" && doc.rejectReason && (
            <p className="report-dialog-text">Motivo del rechazo: {doc.rejectReason}</p>
          )}
        </div>
      )}
      <div className="report-dialog-actions">
        {doc?.status === "PENDING" && canRegister && (
          <button type="button" className="secondary danger" onClick={() => onReject(doc)}>
            Rechazar
          </button>
        )}
        <button type="button" className="secondary" onClick={onClose}>
          Cerrar
        </button>
        {doc?.status === "PENDING" && canRegister && !doc.blocked && doc.supplier?.active !== false && (
          <button type="button" className="primary" onClick={onLegalize}>
            Legalizar
          </button>
        )}
      </div>
    </Modal>
  );
}

function LegalizeDialog({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: (result: { purchaseDocumentId: string; number: string; createdSupplier: boolean }) => void;
}) {
  const detail = useReport<{ data: Detail }>(`/v1/purchases/imports/${id}`);
  const doc = detail.data?.data;
  const [type, setType] = useState<"PURCHASE" | "EXPENSE">("PURCHASE");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const needsDueDate = doc?.paymentTerm === "CREDIT" && !doc.dueDate;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      const result = await apiPost<{ data: { purchaseDocumentId: string; number: string; createdSupplier: boolean } }>(
        `/v1/purchases/imports/${id}/legalize`,
        { type, ...(needsDueDate && { dueDate }), ...(notes.trim() && { notes: notes.trim() }) }
      );
      onDone(result.data);
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  return (
    <Modal title={doc ? `Legalizar ${doc.number}` : "Legalizar"} onClose={onClose}>
      <ReportStatus loading={detail.loading && !doc} error={detail.error} />
      {doc && (
        <form onSubmit={submit}>
          <p className="report-dialog-text">
            Se registra como compra o gasto de {doc.supplierName} por <b>{money(doc.total)}</b> (
            {doc.paymentTerm === "CREDIT" ? "a crédito" : "de contado"}) con su asiento contable. {supplierNote(doc)}
          </p>
          <div className="purchase-types imports-types" role="radiogroup" aria-label="Registrar como">
            {(
              [
                ["PURCHASE", "Compra", "Mercancía o activos (inventario)"],
                ["EXPENSE", "Gasto", "Servicios, arriendos y otros gastos"],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className={type === value ? "is-selected" : undefined}>
                <input type="radio" name="legalize-type" checked={type === value} onChange={() => setType(value)} />
                <b>{label}</b>
                <small>{hint}</small>
              </label>
            ))}
          </div>
          {needsDueDate && (
            <label className="field">
              Fecha de vencimiento (la factura no la trae)
              <input
                type="date"
                value={dueDate}
                min={doc.issueDate}
                onChange={event => setDueDate(event.target.value)}
                required
              />
            </label>
          )}
          <label className="field">
            Observaciones (opcional)
            <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} maxLength={2000} />
          </label>
          {doc.warnings
            .filter(warning => !warning.blocking)
            .map(warning => (
              <p key={warning.message} className="report-dialog-text">
                ⚠ {warning.message}
              </p>
            ))}
          {state.error && (
            <p className="report-error" role="alert">
              {state.error}
            </p>
          )}
          <div className="report-dialog-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="primary" disabled={state.busy || doc.blocked || doc.status !== "PENDING"}>
              {state.busy ? "Legalizando…" : `Legalizar como ${type === "PURCHASE" ? "compra" : "gasto"}`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
