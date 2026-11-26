/**
 * Compras y gastos › Registro de eventos en factura electrónica de proveedores (/compras?tab=eventos).
 *
 * Registrar la factura del proveedor por su CUFE y enviar a la DIAN, en orden, la recepción de la factura (030),
 * la recepción de la mercancía o servicio (032) y la aceptación (033) o el reclamo (031) dentro de los 3 días
 * hábiles siguientes. Pestañas "Eventos en proceso" y "Eventos finalizados" (aceptadas, reclamadas o con
 * aceptación tácita). API: apps/api/src/received-invoices.ts; reglas en docs/compras-y-gastos.md.
 */
"use client";

import { useState } from "react";
import { apiGet, apiPost } from "../lib/api";
import { ActionMenu } from "./action-menu";
import { date, defaultPeriod, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { FilterIcon } from "./billing-report-collections";
import { Modal } from "./collection-dialogs";

type EventType = "RECEIPT" | "GOODS_RECEIPT" | "ACCEPTANCE" | "CLAIM";
type EventCell = { at: string; dianStatus: string } | null;
type ReceivedInvoiceRow = {
  id: string;
  cufe: string;
  supplierNit: string;
  supplierName: string;
  number: string;
  issueDate: string;
  total: string | null;
  createdAt: string;
  receipt: EventCell;
  goodsReceipt: EventCell;
  outcome: { type: "ACCEPTANCE" | "CLAIM"; at: string; dianStatus: string; claimReason: string | null } | null;
  responseDeadline: string | null;
  tacitAcceptance: boolean;
  finalized: boolean;
  actions: { type: EventType; blocked: string | null }[];
};
type EventsResponse = {
  data: ReceivedInvoiceRow[];
  pagination: { page: number; pageSize: number; total: number };
  counts: { processing: number; finalized: number };
  sandbox: boolean;
};

const eventInfo: Record<EventType, { code: string; label: string; action: string }> = {
  RECEIPT: { code: "030", label: "Recepción de factura", action: "Registrar recepción de factura" },
  GOODS_RECEIPT: {
    code: "032",
    label: "Recepción de mercancía o servicio",
    action: "Registrar recepción de mercancía o servicio",
  },
  ACCEPTANCE: { code: "033", label: "Aceptación expresa", action: "Aceptar factura" },
  CLAIM: { code: "031", label: "Reclamo", action: "Reclamar factura" },
};
const claimReasons: Record<string, string> = {
  "01": "Documento con inconsistencias",
  "02": "Mercancía no entregada totalmente",
  "03": "Mercancía no entregada parcialmente",
  "04": "Servicio no prestado",
};
const dianLabels: Record<string, string> = {
  PENDING: "Pendiente",
  QUEUED: "En cola DIAN",
  SENT: "Enviado a la DIAN",
  ACCEPTED: "Aceptado por la DIAN",
  REJECTED: "Rechazado por la DIAN",
};

/** Fecha y hora de Colombia de un instante ISO. */
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" }).format(
    new Date(value)
  );
const dayAndTime = (value: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
  const time = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", timeStyle: "short" }).format(
    new Date(value)
  );
  return { day: date(parts), time };
};
/** Fecha arriba y hora debajo, para columnas angostas. */
function Stamp({ value, prefix = "" }: { value: string; prefix?: string }) {
  const { day, time } = dayAndTime(value);
  return (
    <>
      {prefix}
      {day}
      <small>{time}</small>
    </>
  );
}
const shortCufe = (cufe: string) => `${cufe.slice(0, 8)}…${cufe.slice(-6)}`;

type Sort =
  "createdAt" | "cufe" | "supplierNit" | "number" | "supplierName" | "receiptAt" | "goodsReceiptAt" | "outcomeAt";
const columns: [Sort, string][] = [
  ["createdAt", "Fecha de registro"],
  ["cufe", "CUFE"],
  ["supplierNit", "NIT"],
  ["number", "Comprobante"],
  ["supplierName", "Proveedor"],
  ["receiptAt", "Recepción de factura"],
  ["goodsReceiptAt", "Recepción de mercancía o servicio"],
  ["outcomeAt", "Aceptación o reclamo"],
];

type Filters = { from: string; to: string; supplier: string; number: string };
const noFilters: Filters = { from: "", to: "", supplier: "", number: "" };

export function PurchaseEvents() {
  const { canPurchase: canRegister } = useSession();
  const [status, setStatus] = useState<"processing" | "finalized">("processing");
  const [cufeInput, setCufeInput] = useState("");
  const [cufe, setCufe] = useState("");
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [draft, setDraft] = useState<Filters>(noFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<{ field: Sort; direction: "asc" | "desc" }>({
    field: "createdAt",
    direction: "desc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [dialog, setDialog] = useState<
    | { kind: "register" }
    | {
        kind: "event";
        row: Pick<ReceivedInvoiceRow, "id" | "number" | "supplierName" | "responseDeadline">;
        type: EventType;
      }
    | { kind: "detail"; id: string }
    | { kind: "learn" }
    | null
  >(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const report = useReport<EventsResponse>("/v1/reports/purchases/events", {
    status,
    cufe,
    ...filters,
    sort: sort.field,
    direction: sort.direction,
    page,
    pageSize,
  });
  const data = report.data;
  const rows = data?.data ?? [];
  const total = data?.pagination.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const activeFilters = Object.values(filters).filter(Boolean).length + (cufe ? 1 : 0);

  const toggleSort = (field: Sort) => {
    setSort(current => ({
      field,
      direction: current.field === field && current.direction === "desc" ? "asc" : "desc",
    }));
    setPage(1);
  };
  const changeTab = (next: "processing" | "finalized") => {
    setStatus(next);
    setPage(1);
  };
  const openEvent = (row: ReceivedInvoiceRow, type: EventType) => {
    setNotice(null);
    setDialog({ kind: "event", row, type });
  };

  /** Celda de un evento: hecho (fecha y estado DIAN), botón si es el siguiente, o pendiente. */
  const eventCell = (row: ReceivedInvoiceRow, type: "RECEIPT" | "GOODS_RECEIPT", cell: EventCell) => {
    if (cell)
      return (
        <span className="event-done">
          <b>✓ {dayAndTime(cell.at).day}</b>
          <small>
            {dayAndTime(cell.at).time} · {dianLabels[cell.dianStatus] ?? cell.dianStatus}
          </small>
        </span>
      );
    const blocked = row.actions.find(action => action.type === type)?.blocked;
    if (!blocked && canRegister)
      return (
        <button type="button" className="secondary event-next" onClick={() => openEvent(row, type)}>
          Registrar
        </button>
      );
    return <span className="event-pending">Pendiente</span>;
  };

  const outcomeCell = (row: ReceivedInvoiceRow) => {
    if (row.outcome)
      return (
        <span className={row.outcome.type === "ACCEPTANCE" ? "event-done" : "event-done is-claim"}>
          <b>
            {row.outcome.type === "ACCEPTANCE" ? "✓ Aceptada" : "⚠ Reclamada"} · {dayAndTime(row.outcome.at).day}
          </b>
          <small>
            {row.outcome.claimReason ? `${claimReasons[row.outcome.claimReason]} · ` : ""}
            {dianLabels[row.outcome.dianStatus] ?? row.outcome.dianStatus}
          </small>
        </span>
      );
    if (row.tacitAcceptance)
      return (
        <span className="event-done">
          <b>Aceptación tácita</b>
          <small>Venció el plazo el {date(row.responseDeadline)}</small>
        </span>
      );
    const accept = row.actions.find(action => action.type === "ACCEPTANCE")?.blocked;
    if (!accept && canRegister)
      return (
        <span className="event-respond">
          <span>
            <button type="button" className="secondary event-next" onClick={() => openEvent(row, "ACCEPTANCE")}>
              Aceptar
            </button>
            <button type="button" className="secondary event-next danger" onClick={() => openEvent(row, "CLAIM")}>
              Reclamar
            </button>
          </span>
          <small>Plazo hasta el {date(row.responseDeadline)}</small>
        </span>
      );
    return <span className="event-pending">Pendiente</span>;
  };

  const start = total ? (page - 1) * pageSize + 1 : 1;
  const end = Math.min(page * pageSize, total);

  return (
    <>
      <section className="panel events-intro">
        <h2>Registro de eventos en factura electrónica de proveedores</h2>
        <div className="events-info" role="note">
          <span className="events-info-icon" aria-hidden="true">
            i
          </span>
          <p>
            Para que las facturas electrónicas de venta emitidas por tus proveedores en operaciones a crédito puedan
            servir como soporte de costos, deducciones y/o impuestos descontables, debes registrar el CUFE
            correspondiente para enviar a la DIAN los eventos de{" "}
            <b>Recepción de factura, Recepción de mercancía o servicio, y Aceptación o Reclamo de la factura</b> en los
            plazos establecidos (Res. DIAN 000085, art. 34 del 8 de abril de 2022 – Decreto 1074 de 2015).{" "}
            <button type="button" className="report-link" onClick={() => setDialog({ kind: "learn" })}>
              Aprende más
            </button>
          </p>
        </div>
        {data?.sandbox && (
          <p className="events-sandbox">
            Proveedor DIAN de pruebas: los eventos quedan registrados “En cola DIAN” y no se transmiten hasta conectar
            el proveedor tecnológico.
          </p>
        )}
      </section>

      <section className="panel events-panel">
        <nav className="events-tabs" aria-label="Estado de los eventos">
          {(
            [
              ["processing", "Eventos en proceso"],
              ["finalized", "Eventos finalizados"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={status === value ? "active" : undefined}
              aria-pressed={status === value}
              onClick={() => changeTab(value)}
            >
              {label}
              {data && <b>{data.counts[value]}</b>}
            </button>
          ))}
        </nav>

        <div className="events-toolbar">
          <form
            className="events-search"
            role="search"
            onSubmit={event => {
              event.preventDefault();
              setCufe(cufeInput.trim());
              setPage(1);
            }}
          >
            <input
              type="search"
              value={cufeInput}
              onChange={event => {
                setCufeInput(event.target.value);
                if (!event.target.value) {
                  setCufe("");
                  setPage(1);
                }
              }}
              placeholder="Buscar por CUFE"
              aria-label="Buscar por CUFE"
            />
            <button type="submit" className="primary" aria-label="Buscar">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.5" />
                <path d="m20 20-4-4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </button>
          </form>
          <button
            type="button"
            className="secondary quotes-more"
            aria-expanded={showFilters}
            aria-controls="events-filters"
            onClick={() => {
              setDraft(filters);
              setShowFilters(!showFilters);
            }}
          >
            <FilterIcon /> Filtros
            {activeFilters > 0 && <b className="quotes-count">{activeFilters}</b>}
          </button>
          <span className="collections-spacer" />
          <button
            type="button"
            className="primary"
            disabled={!canRegister}
            title={canRegister ? undefined : "Tu rol no permite registrar facturas"}
            onClick={() => {
              setNotice(null);
              setDialog({ kind: "register" });
            }}
          >
            Registrar nueva factura
          </button>
        </div>

        {showFilters && (
          <form
            id="events-filters"
            className="collections-filters quotes-filters events-filters"
            onSubmit={event => {
              event.preventDefault();
              setFilters(draft);
              setPage(1);
              setShowFilters(false);
            }}
          >
            <label className="field">
              Registrada desde
              <input
                type="date"
                value={draft.from}
                onChange={event => setDraft({ ...draft, from: event.target.value })}
              />
            </label>
            <label className="field">
              Registrada hasta
              <input
                type="date"
                value={draft.to}
                min={draft.from || undefined}
                onChange={event => setDraft({ ...draft, to: event.target.value })}
              />
            </label>
            <label className="field">
              Proveedor
              <input
                value={draft.supplier}
                onChange={event => setDraft({ ...draft, supplier: event.target.value })}
                placeholder="Nombre o NIT"
              />
            </label>
            <label className="field">
              Comprobante
              <input
                value={draft.number}
                onChange={event => setDraft({ ...draft, number: event.target.value })}
                placeholder="Ej. FE-1234"
              />
            </label>
            <div className="report-actions">
              <button type="submit" className="primary">
                Aplicar
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setDraft(noFilters);
                  setFilters(noFilters);
                  setPage(1);
                  setShowFilters(false);
                }}
              >
                Limpiar filtros
              </button>
            </div>
          </form>
        )}

        {notice && (
          <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
            {notice.text}
          </p>
        )}
        <ReportStatus loading={report.loading && !data} error={report.error} />

        {data && (
          <>
            <div className="report-table-wrap events-table-wrap">
              <table className="report-table events-table">
                <thead>
                  <tr>
                    {columns.map(([field, label]) => (
                      <th
                        key={field}
                        aria-sort={
                          sort.field === field ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                        }
                      >
                        <button type="button" className="events-sort" onClick={() => toggleSort(field)}>
                          {label}
                          <span aria-hidden="true">
                            {sort.field === field ? (sort.direction === "asc" ? "↑" : "↓") : "⇅"}
                          </span>
                        </button>
                      </th>
                    ))}
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id}>
                      <td>
                        <Stamp value={row.createdAt} />
                      </td>
                      <td>
                        <code className="events-cufe" title={row.cufe}>
                          {shortCufe(row.cufe)}
                        </code>
                      </td>
                      <td>{row.supplierNit}</td>
                      <td>
                        <button
                          type="button"
                          className="collections-doc report-link"
                          onClick={() => setDialog({ kind: "detail", id: row.id })}
                        >
                          {row.number}
                        </button>
                        <small>{date(row.issueDate)}</small>
                      </td>
                      <td>{row.supplierName}</td>
                      <td>{eventCell(row, "RECEIPT", row.receipt)}</td>
                      <td>{eventCell(row, "GOODS_RECEIPT", row.goodsReceipt)}</td>
                      <td>{outcomeCell(row)}</td>
                      <td>
                        <ActionMenu
                          label={`Acciones de ${row.number}`}
                          className="secondary quotes-row-menu"
                          items={[
                            {
                              label: "Ver detalle y eventos",
                              onSelect: () => setDialog({ kind: "detail", id: row.id }),
                            },
                            ...row.actions.map(action => ({
                              label: `${eventInfo[action.type].action} (${eventInfo[action.type].code})`,
                              disabled: !canRegister || !!action.blocked,
                              note: !canRegister
                                ? "Tu rol no permite registrar eventos"
                                : (action.blocked ?? undefined),
                              danger: action.type === "CLAIM",
                              onSelect: () => openEvent(row, action.type),
                            })),
                            {
                              label: "Copiar CUFE",
                              onSelect: () =>
                                navigator.clipboard.writeText(row.cufe).then(
                                  () => setNotice({ kind: "ok", text: `CUFE de ${row.number} copiado.` }),
                                  () => setNotice({ kind: "error", text: "No se pudo copiar el CUFE." })
                                ),
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
              {!rows.length && (
                <div className="pay-empty events-empty">
                  <EmptyDocumentIllustration />
                  {activeFilters || data.counts.processing + data.counts.finalized ? (
                    <>
                      <h3>No se encontraron facturas.</h3>
                      <p>
                        {activeFilters
                          ? "Modifica la búsqueda o los filtros e inténtalo de nuevo."
                          : status === "processing"
                            ? "No tienes eventos en proceso: todas tus facturas registradas están finalizadas."
                            : "Aún no tienes facturas con eventos finalizados."}
                      </p>
                    </>
                  ) : (
                    <>
                      <h3>Aún no tienes facturas agregadas</h3>
                      <p>Debes agregar facturas de tu proveedor para poder gestionar los eventos</p>
                      {canRegister && (
                        <button type="button" className="primary" onClick={() => setDialog({ kind: "register" })}>
                          Registrar nueva factura
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="events-pagination">
              <span>
                Mostrando{" "}
                <b>
                  {start}-{end}
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
              <label>
                <span className="sr-only">Registros por página</span>
                <select
                  value={pageSize}
                  onChange={event => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  {[10, 25, 50].map(size => (
                    <option key={size} value={size}>
                      {size} por página
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}
      </section>

      {dialog?.kind === "register" && (
        <RegisterInvoiceDialog
          onClose={() => setDialog(null)}
          onRegistered={(created, registerReceipt) => {
            setNotice({ kind: "ok", text: `Factura ${created.number} registrada.` });
            setStatus("processing");
            report.reload();
            setDialog(
              registerReceipt ? { kind: "event", row: { ...created, responseDeadline: null }, type: "RECEIPT" } : null
            );
          }}
        />
      )}
      {dialog?.kind === "event" && (
        <EventDialog
          row={dialog.row}
          type={dialog.type}
          onClose={() => setDialog(null)}
          onDone={text => {
            setNotice({ kind: "ok", text });
            setDialog(null);
            report.reload();
          }}
        />
      )}
      {dialog?.kind === "detail" && <DetailDialog id={dialog.id} onClose={() => setDialog(null)} />}
      {dialog?.kind === "learn" && <LearnDialog onClose={() => setDialog(null)} />}
    </>
  );
}

function EmptyDocumentIllustration() {
  return (
    <svg viewBox="0 0 80 100" width="76" height="96" aria-hidden="true" className="events-empty-art">
      <path d="M6 4h48l20 20v70a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="#dbeafe" />
      <path d="M54 4l20 20H58a4 4 0 0 1-4-4z" fill="#3b82f6" />
      <text x="38" y="72" textAnchor="middle" fontSize="40" fontWeight="700" fill="#fff" fontFamily="Inter, sans-serif">
        ?
      </text>
    </svg>
  );
}

type Supplier = { id: string; legalName: string; identificationNumber: string };

/** "Registrar nueva factura": CUFE y datos de la factura del proveedor. */
function RegisterInvoiceDialog({
  onClose,
  onRegistered,
}: {
  onClose: () => void;
  onRegistered: (invoice: { id: string; number: string; supplierName: string }, registerReceipt: boolean) => void;
}) {
  const today = defaultPeriod().to;
  const [form, setForm] = useState({
    cufe: "",
    supplierNit: "",
    supplierName: "",
    number: "",
    issueDate: today,
    total: "",
  });
  const [registerReceipt, setRegisterReceipt] = useState(true);
  const [supplierHint, setSupplierHint] = useState<string | null>(null);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [field]: event.target.value });
  const cleanCufe = form.cufe.replace(/\s/g, "").toLowerCase();

  /** Si el NIT corresponde a un proveedor ya creado, propone su nombre. */
  const lookupSupplier = async () => {
    setSupplierHint(null);
    if (!/^\d{5,15}$/.test(form.supplierNit)) return;
    try {
      const result = await apiGet<{ data: Supplier[] }>("/v1/purchases/suppliers", { search: form.supplierNit });
      const supplier = result.data.find(item => item.identificationNumber === form.supplierNit);
      if (supplier) {
        setForm(current => ({ ...current, supplierName: current.supplierName || supplier.legalName }));
        setSupplierHint(`Proveedor encontrado en tus terceros: ${supplier.legalName}`);
      }
    } catch {
      // Sin la sugerencia se puede escribir el nombre.
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      const created = await apiPost<{ data: { id: string } }>("/v1/purchases/received-invoices", {
        ...form,
        cufe: cleanCufe,
        total: form.total || undefined,
      });
      onRegistered(
        { id: created.data.id, number: form.number.trim(), supplierName: form.supplierName.trim() },
        registerReceipt
      );
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };

  return (
    <Modal title="Registrar nueva factura" onClose={onClose} wide>
      <form onSubmit={submit} className="events-form">
        <p className="report-dialog-text">
          Copia el CUFE de la representación gráfica (PDF) o del XML de la factura electrónica que te envió el
          proveedor, y completa sus datos tal como aparecen en ella.
        </p>
        <label className="field events-form-full">
          CUFE
          <textarea
            value={form.cufe}
            onChange={set("cufe")}
            rows={2}
            required
            autoFocus
            spellCheck={false}
            className="events-cufe-input"
            aria-describedby="cufe-help"
          />
          <small id="cufe-help" className={cleanCufe && !/^[0-9a-f]{96}$/.test(cleanCufe) ? "is-error" : undefined}>
            {cleanCufe.length}/96 caracteres hexadecimales (0-9, a-f)
          </small>
        </label>
        <label className="field">
          NIT del proveedor
          <input
            value={form.supplierNit}
            onChange={set("supplierNit")}
            onBlur={lookupSupplier}
            inputMode="numeric"
            pattern="\d{5,15}"
            title="Solo números, sin dígito de verificación"
            placeholder="Sin dígito de verificación"
            required
          />
        </label>
        <label className="field">
          Proveedor
          <input value={form.supplierName} onChange={set("supplierName")} minLength={2} maxLength={200} required />
          {supplierHint && <small>{supplierHint}</small>}
        </label>
        <label className="field">
          Comprobante (prefijo y número)
          <input value={form.number} onChange={set("number")} maxLength={40} placeholder="Ej. FE-1234" required />
        </label>
        <label className="field">
          Fecha de emisión
          <input type="date" value={form.issueDate} onChange={set("issueDate")} max={today} required />
        </label>
        <label className="field">
          Valor total (opcional)
          <input type="number" min="0.01" step="0.01" value={form.total} onChange={set("total")} />
        </label>
        <label className="events-check events-form-full">
          <input
            type="checkbox"
            checked={registerReceipt}
            onChange={event => setRegisterReceipt(event.target.checked)}
          />
          Registrar enseguida la recepción de la factura (030)
        </label>
        {state.error && (
          <p className="report-error events-form-full" role="alert">
            {state.error}
          </p>
        )}
        <div className="report-dialog-actions events-form-full">
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={state.busy || !/^[0-9a-f]{96}$/.test(cleanCufe)}>
            {state.busy ? "Registrando…" : "Registrar factura"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Quien recibió la última vez (solo en este navegador) para no escribirlo en cada evento. */
const RECEIVER_KEY = "betel.events.receiver";
function lastReceiver() {
  try {
    const saved = JSON.parse(localStorage.getItem(RECEIVER_KEY) ?? "null") as Record<string, string> | null;
    if (saved && typeof saved.name === "string")
      return { name: saved.name, document: saved.document ?? "", role: saved.role ?? "" };
  } catch {
    // Sin almacenamiento disponible.
  }
  return { name: "", document: "", role: "" };
}

/** Registrar un evento (030, 032, 033 o 031) y enviarlo al proveedor DIAN. */
function EventDialog({
  row,
  type,
  onClose,
  onDone,
}: {
  row: Pick<ReceivedInvoiceRow, "id" | "number" | "supplierName" | "responseDeadline">;
  type: EventType;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const needsReceiver = type === "RECEIPT" || type === "GOODS_RECEIPT";
  const [receiver, setReceiver] = useState(lastReceiver);
  const [claimReason, setClaimReason] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const info = eventInfo[type];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      const result = await apiPost<{ data: { dianStatus: string } }>(
        `/v1/purchases/received-invoices/${row.id}/events`,
        {
          type,
          ...(needsReceiver && {
            receiverName: receiver.name.trim(),
            receiverDocument: receiver.document.trim(),
            receiverRole: receiver.role.trim(),
          }),
          ...(type === "CLAIM" && { claimReason }),
          ...(notes.trim() && { notes: notes.trim() }),
        }
      );
      if (needsReceiver)
        try {
          localStorage.setItem(RECEIVER_KEY, JSON.stringify(receiver));
        } catch {
          // Solo es una comodidad.
        }
      onDone(
        `${info.label} (${info.code}) de ${row.number} registrada · ${dianLabels[result.data.dianStatus] ?? result.data.dianStatus}.`
      );
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };

  return (
    <Modal title={`${info.label} (${info.code})`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="report-dialog-text">
          Factura <b>{row.number}</b> de {row.supplierName}.{" "}
          {type === "RECEIPT" && "Confirma ante la DIAN que recibiste la factura electrónica."}
          {type === "GOODS_RECEIPT" &&
            "Confirma que recibiste la mercancía o el servicio. Desde hoy tienes 3 días hábiles para aceptar o reclamar la factura."}
          {type === "ACCEPTANCE" && "Aceptas la factura de forma expresa. Después no podrás reclamarla."}
          {type === "CLAIM" && "Rechazas la factura indicando el motivo. Después no podrás aceptarla."}
          {(type === "ACCEPTANCE" || type === "CLAIM") &&
            row.responseDeadline &&
            ` Plazo: ${date(row.responseDeadline)}.`}
        </p>
        {needsReceiver && (
          <fieldset className="events-receiver">
            <legend>Persona que recibe</legend>
            <label className="field">
              Nombre completo
              <input
                value={receiver.name}
                onChange={event => setReceiver({ ...receiver, name: event.target.value })}
                minLength={3}
                maxLength={120}
                required
                autoFocus
              />
            </label>
            <label className="field">
              Número de documento
              <input
                value={receiver.document}
                onChange={event => setReceiver({ ...receiver, document: event.target.value })}
                inputMode="numeric"
                pattern="\d{5,15}"
                title="Solo números"
                required
              />
            </label>
            <label className="field">
              Cargo
              <input
                value={receiver.role}
                onChange={event => setReceiver({ ...receiver, role: event.target.value })}
                maxLength={80}
                required
              />
            </label>
          </fieldset>
        )}
        {type === "CLAIM" && (
          <label className="field">
            Motivo del reclamo
            <select value={claimReason} onChange={event => setClaimReason(event.target.value)} required autoFocus>
              <option value="">Selecciona el motivo</option>
              {Object.entries(claimReasons).map(([code, label]) => (
                <option key={code} value={code}>
                  {code} · {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          Observaciones (opcional)
          <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} maxLength={500} />
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
          <button type="submit" className={type === "CLAIM" ? "primary danger" : "primary"} disabled={state.busy}>
            {state.busy
              ? "Enviando…"
              : type === "CLAIM"
                ? "Enviar reclamo"
                : type === "ACCEPTANCE"
                  ? "Aceptar factura"
                  : "Registrar evento"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Detail = ReceivedInvoiceRow & {
  createdBy: string | null;
  events: {
    id: string;
    code: string;
    label: string;
    dianStatus: string;
    claimReason: string | null;
    notes: string | null;
    receiver: { name: string; document: string | null; role: string | null } | null;
    at: string;
    by: string | null;
  }[];
};

function DetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useReport<{ data: Detail }>(`/v1/purchases/received-invoices/${id}`);
  const invoice = detail.data?.data;
  return (
    <Modal title={invoice ? `Factura ${invoice.number}` : "Factura"} onClose={onClose} wide>
      <ReportStatus loading={detail.loading && !invoice} error={detail.error} />
      {invoice && (
        <div className="events-detail">
          <dl className="document-meta">
            <div>
              <dt>Proveedor</dt>
              <dd>
                {invoice.supplierName} · NIT {invoice.supplierNit}
              </dd>
            </div>
            <div>
              <dt>Fecha de emisión</dt>
              <dd>{date(invoice.issueDate)}</dd>
            </div>
            {invoice.total && (
              <div>
                <dt>Valor total</dt>
                <dd>{money(invoice.total)}</dd>
              </div>
            )}
            <div>
              <dt>Registrada</dt>
              <dd>
                {dateTime(invoice.createdAt)}
                {invoice.createdBy && ` por ${invoice.createdBy}`}
              </dd>
            </div>
            <div className="events-form-full">
              <dt>CUFE</dt>
              <dd>
                <code className="events-cufe-full">{invoice.cufe}</code>
              </dd>
            </div>
          </dl>
          <h3>Eventos</h3>
          {invoice.events.length ? (
            <ol className="events-timeline">
              {invoice.events.map(event => (
                <li key={event.id}>
                  <b>
                    {event.code} · {event.label}
                  </b>
                  <span>
                    {dateTime(event.at)}
                    {event.by && ` · ${event.by}`} · {dianLabels[event.dianStatus] ?? event.dianStatus}
                  </span>
                  {event.receiver && (
                    <span>
                      Recibió: {event.receiver.name} · C.C. {event.receiver.document} · {event.receiver.role}
                    </span>
                  )}
                  {event.claimReason && <span>Motivo: {event.claimReason}</span>}
                  {event.notes && <span>Observaciones: {event.notes}</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="report-dialog-text">Aún no se ha registrado ningún evento.</p>
          )}
          {invoice.tacitAcceptance && (
            <p className="report-dialog-text">
              Venció el plazo para aceptar o reclamar el {date(invoice.responseDeadline)}: opera la aceptación tácita.
            </p>
          )}
          {!invoice.finalized && invoice.responseDeadline && (
            <p className="report-dialog-text">
              Tienes hasta el {date(invoice.responseDeadline)} para aceptar o reclamar.
            </p>
          )}
        </div>
      )}
      <div className="report-dialog-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Modal>
  );
}

function LearnDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Eventos de la factura electrónica" onClose={onClose} wide>
      <div className="events-learn">
        <p>
          Cuando un proveedor te vende a crédito con factura electrónica, la DIAN necesita saber qué pasó con esa
          factura. Lo informas con estos eventos, en este orden:
        </p>
        <ol>
          <li>
            <b>030 · Recepción de factura (acuse de recibo):</b> recibiste la factura electrónica. Indica quién la
            recibió.
          </li>
          <li>
            <b>032 · Recepción de mercancía o servicio:</b> recibiste lo facturado. Indica quién lo recibió.
          </li>
          <li>
            <b>033 · Aceptación expresa</b> o <b>031 · Reclamo:</b> dentro de los 3 días hábiles siguientes al evento
            032. El reclamo lleva uno de estos motivos: documento con inconsistencias, mercancía no entregada total o
            parcialmente, o servicio no prestado.
          </li>
        </ol>
        <p>
          Si no aceptas ni reclamas a tiempo, opera la <b>aceptación tácita</b> (la registra el proveedor). Con los
          eventos completos, la factura sirve como soporte de costos, deducciones e impuestos descontables y puede
          circular como título valor (RADIAN).
        </p>
        <p>
          Betel cuenta los días hábiles sin sábados, domingos ni festivos de Colombia. Fundamento: Resolución DIAN
          000085 del 8 de abril de 2022 y Decreto 1074 de 2015.
        </p>
      </div>
      <div className="report-dialog-actions">
        <button type="button" className="primary" onClick={onClose}>
          Entendido
        </button>
      </div>
    </Modal>
  );
}
