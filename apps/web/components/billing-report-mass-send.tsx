/**
 * Pestaña "Envío masivo": impresión y envío masivo de comprobantes (GET /v1/reports/billing/mass-send).
 *
 * Criterios: cliente, tipos de comprobante, fecha de elaboración (año y mes o rango), estado de envío a la
 * DIAN y estado del envío por email. Se seleccionan filas y se imprimen juntas (/envio-masivo/imprimir) o
 * se envían por correo; el envío usa la ruta de cada documento, uno tras otro, y resume el resultado.
 * Las facturas electrónicas solo se envían cuando la DIAN las aprobó (salvo con la DIAN de pruebas).
 */
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiPost } from "../lib/api";
import { date, defaultPeriod, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { SearchIllustration } from "./billing-report-quotes";

type DocumentType = "Invoice" | "CashReceipt" | "Quote" | "Delivery";
type MassRow = {
  type: DocumentType;
  id: string;
  number: string;
  transaction: string;
  date: string;
  customer: { legalName: string; identificationType: string; identificationNumber: string; email: string | null };
  branch: string | null;
  total: string;
  currency: string;
  status: string;
  dian: string;
  emailBlocked: string | null;
  email: { recipient: string; sentAt: string } | null;
};
type MassResponse = {
  data: MassRow[];
  pagination: { page: number; pageSize: number; total: number };
  period: { from: string; to: string };
  dianSandbox: boolean;
};

export const typeLabels: Record<DocumentType, string> = {
  Invoice: "Factura electrónica de venta",
  CashReceipt: "Recibo de caja",
  Quote: "Cotización",
  Delivery: "Remisión",
};
const dianLabels: Record<string, string> = {
  NOT_SENT: "No enviado",
  NOT_APPLICABLE: "No aplica",
  REJECTED: "Rechazado",
  QUEUED: "En cola",
  SENT: "Enviado",
  ACCEPTED: "Aceptado",
  ERROR: "Error",
};
const dianBadge: Record<string, string> = {
  ACCEPTED: "pay-badge is-ok",
  REJECTED: "pay-badge is-bad",
  ERROR: "pay-badge is-bad",
  QUEUED: "pay-badge is-pending",
  SENT: "pay-badge is-info",
  NOT_SENT: "pay-badge is-pending",
  NOT_APPLICABLE: "pay-badge",
};
const months = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
const BANNER_KEY = "betel.massSendBannerClosed";

/** Primer y último día de un mes (AAAA-MM-DD). */
const monthRange = (year: number, month: number) => ({
  from: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
  to: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
});

type Filters = { customer: string; types: DocumentType[]; from: string; to: string; dian: string[]; email: string };
const emptyFilters = (): Filters => {
  const today = defaultPeriod().to;
  return {
    customer: "",
    types: Object.keys(typeLabels) as DocumentType[],
    ...monthRange(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1),
    dian: Object.keys(dianLabels),
    email: "",
  };
};

/** Ruta de envío por correo de cada tipo de documento. */
const emailRequest = (row: Pick<MassRow, "type" | "id">) =>
  row.type === "Quote"
    ? apiPost(`/v1/quotes/${row.id}/email`)
    : row.type === "Delivery"
      ? apiPost(`/v1/deliveries/${row.id}/email`)
      : apiPost("/v1/documents/email", { documentType: row.type, documentId: row.id });

export function MassSendReport() {
  const { canEmail } = useSession();
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(draft);
  const [showCriteria, setShowCriteria] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Map<string, MassRow>>(new Map());
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [banner, setBanner] = useState(true);
  const [learnMore, setLearnMore] = useState(false);
  const allTypes = Object.keys(typeLabels);
  const allDian = Object.keys(dianLabels);
  const report = useReport<MassResponse>("/v1/reports/billing/mass-send", {
    customer: applied.customer,
    from: applied.from,
    to: applied.to,
    // Todo seleccionado = sin filtro (la API lo interpreta igual, pero la URL queda limpia).
    types: applied.types.length === allTypes.length ? undefined : applied.types.join(","),
    dian: applied.dian.length === allDian.length ? undefined : applied.dian.join(","),
    email: applied.email,
    page,
    pageSize,
  });
  const data = report.data;
  const rows = data?.data ?? [];
  const total = data?.pagination.total ?? 0;
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, total);

  useEffect(() => {
    try {
      if (localStorage.getItem(BANNER_KEY)) setBanner(false);
    } catch {}
  }, []);

  const set = <K extends keyof Filters>(field: K, value: Filters[K]) => setDraft({ ...draft, [field]: value });
  const search = (filters = draft) => {
    if (!filters.types.length || !filters.dian.length)
      return setNotice({
        kind: "error",
        text: "Selecciona al menos un tipo de comprobante y un estado de envío a la DIAN.",
      });
    setNotice(null);
    setApplied(filters);
    setPage(1);
    setSelected(new Map());
  };
  const clear = () => {
    const reset = emptyFilters();
    setDraft(reset);
    search(reset);
  };

  const toggleRow = (row: MassRow) => {
    const next = new Map(selected);
    const key = `${row.type}:${row.id}`;
    if (next.has(key)) next.delete(key);
    else next.set(key, row);
    setSelected(next);
  };
  const pageKeys = rows.map(row => `${row.type}:${row.id}`);
  const allOnPage = rows.length > 0 && pageKeys.every(key => selected.has(key));
  const togglePage = () => {
    const next = new Map(selected);
    for (const row of rows) {
      const key = `${row.type}:${row.id}`;
      if (allOnPage) next.delete(key);
      else next.set(key, row);
    }
    setSelected(next);
  };

  /** Envía los seleccionados que se pueden enviar, uno tras otro, y resume el resultado. */
  const sendSelected = async () => {
    const targets = [...selected.values()];
    const skipped: string[] = [];
    const failed: string[] = [];
    let sent = 0;
    setNotice(null);
    for (const [index, row] of targets.entries()) {
      if (row.emailBlocked) {
        skipped.push(`${row.number}: ${row.emailBlocked}`);
        continue;
      }
      if (!row.customer.email) {
        skipped.push(`${row.number}: el cliente no tiene correo`);
        continue;
      }
      setSending(`Enviando ${index + 1} de ${targets.length}…`);
      try {
        await emailRequest(row);
        sent++;
      } catch (error) {
        failed.push(`${row.number}: ${(error as Error).message}`);
      }
    }
    setSending(null);
    const problems = [...skipped, ...failed];
    setNotice({
      kind: problems.length ? "error" : "ok",
      text: `${sent} comprobante(s) enviado(s).${problems.length ? ` No se enviaron: ${problems.join(" · ")}` : ""}`,
    });
    setSelected(new Map());
    report.reload();
  };

  const printHref = `/envio-masivo/imprimir?docs=${[...selected.keys()].join(",")}`;
  const year = Number(draft.from.slice(0, 4));
  const month = Number(draft.from.slice(5, 7)) - 1;
  const years = Array.from({ length: 6 }, (_, index) => Number(defaultPeriod().to.slice(0, 4)) - index);

  return (
    <>
      {banner && (
        <div className="recurring-banner mass-banner" role="note">
          <span aria-hidden="true">i</span>
          <p>
            Para cumplir el anexo técnico de facturación electrónica de la DIAN,{" "}
            <b>una factura electrónica solo se envía al cliente cuando la DIAN la aprueba</b>; mientras tanto la columna
            &quot;Envío por email&quot; no cambia.{" "}
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
                Recibos de caja, cotizaciones y remisiones no se transmiten a la DIAN (&quot;No aplica&quot;) y se
                pueden enviar en cualquier momento. Las facturas en borrador no aparecen aquí. Mientras Betel use el
                proveedor DIAN de pruebas, que no aprueba facturas, el envío de facturas se permite para poder probarlo.
              </small>
            )}
          </p>
          <button
            type="button"
            className="recurring-banner-close"
            aria-label="Cerrar aviso"
            onClick={() => {
              setBanner(false);
              try {
                localStorage.setItem(BANNER_KEY, "1");
              } catch {}
            }}
          >
            ×
          </button>
        </div>
      )}

      <section className="panel collections mass-send">
        <div className="mass-head">
          <h2>Impresión y envío masivo de comprobantes</h2>
          <p>
            Para los documentos electrónicos, la columna <b>&quot;Envío por email&quot;</b> solo se actualizará cuando
            el documento sea <b>aprobado por la DIAN</b>.
            {data?.dianSandbox && (
              <span className="pay-badge is-pending"> DIAN en pruebas: envío de facturas permitido</span>
            )}
          </p>
          <button
            type="button"
            className="report-link"
            aria-expanded={showCriteria}
            aria-controls="mass-criteria"
            onClick={() => setShowCriteria(!showCriteria)}
          >
            {showCriteria ? "⌃ Ocultar criterios de búsqueda" : "⌄ Mostrar criterios de búsqueda"}
          </button>
        </div>

        {showCriteria && (
          <form
            id="mass-criteria"
            className="mass-criteria"
            onSubmit={event => {
              event.preventDefault();
              search();
            }}
          >
            <div className="mass-criteria-actions">
              <button type="submit" className="primary mass-search">
                Buscar
              </button>
              <button type="button" className="secondary" onClick={clear}>
                Limpiar filtro
              </button>
            </div>
            <div className="mass-grid">
              <label className="field">
                Clientes
                <input
                  type="search"
                  value={draft.customer}
                  onChange={event => set("customer", event.target.value)}
                  placeholder="Buscar por nombre o identificación"
                />
              </label>
              <div className="field">
                Fecha de elaboración
                <div className="mass-dates">
                  <select
                    aria-label="Año"
                    value={year}
                    onChange={event => setDraft({ ...draft, ...monthRange(Number(event.target.value), month) })}
                  >
                    {years.map(value => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Mes"
                    value={month}
                    onChange={event => setDraft({ ...draft, ...monthRange(year, Number(event.target.value)) })}
                  >
                    {months.map((name, index) => (
                      <option key={name} value={index}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    aria-label="Desde"
                    value={draft.from}
                    onChange={event => set("from", event.target.value)}
                    required
                  />
                  <input
                    type="date"
                    aria-label="Hasta"
                    value={draft.to}
                    min={draft.from}
                    onChange={event => set("to", event.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="field">
                Comprobante
                <MultiSelect
                  label="Comprobante"
                  options={typeLabels}
                  value={draft.types}
                  onChange={value => set("types", value as DocumentType[])}
                />
              </div>
              <div className="field">
                Envío a la DIAN
                <MultiSelect
                  label="Envío a la DIAN"
                  options={dianLabels}
                  value={draft.dian}
                  onChange={value => set("dian", value)}
                  chips
                />
              </div>
              <label className="field">
                Envío por email
                <select value={draft.email} onChange={event => set("email", event.target.value)}>
                  <option value="">Todos</option>
                  <option value="SENT">Enviado</option>
                  <option value="UNSENT">Sin enviar</option>
                </select>
              </label>
            </div>
          </form>
        )}

        <div className="mass-toolbar">
          <span>{selected.size ? `${selected.size} seleccionado(s)` : ""}</span>
          {selected.size > 0 && selected.size <= 50 ? (
            <Link href={printHref} target="_blank" className="secondary mass-button">
              Imprimir
            </Link>
          ) : (
            <button
              type="button"
              className="secondary mass-button"
              disabled
              title={selected.size > 50 ? "Imprime máximo 50 comprobantes a la vez" : "Selecciona comprobantes"}
            >
              Imprimir
            </button>
          )}
          <button
            type="button"
            className="primary mass-button"
            disabled={!selected.size || !canEmail || !!sending}
            title={canEmail ? undefined : "Tu rol no permite enviar correos"}
            onClick={sendSelected}
          >
            {sending ?? "Enviar"}
          </button>
        </div>

        {notice && (
          <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
            {notice.text}
          </p>
        )}
        <ReportStatus loading={report.loading && !data} error={report.error} />

        {data && (
          <>
            <div className="report-table-wrap">
              <table className="report-table collections-table quotes-table mass-table">
                <thead>
                  <tr>
                    <th className="check">
                      <input
                        type="checkbox"
                        checked={allOnPage}
                        onChange={togglePage}
                        aria-label="Seleccionar la página"
                      />
                    </th>
                    <th>Tipo transacción</th>
                    <th>Comprobante</th>
                    <th>Fecha de elaboración</th>
                    <th>Identificación</th>
                    <th>Sucursal</th>
                    <th>Clientes</th>
                    <th>Correo electrónico</th>
                    <th className="num">Total</th>
                    <th>Envío por email</th>
                    <th>Envío a la DIAN</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const key = `${row.type}:${row.id}`;
                    return (
                      <tr key={key} className={row.status === "VOID" ? "is-cancelled" : undefined}>
                        <td className="check">
                          <input
                            type="checkbox"
                            checked={selected.has(key)}
                            onChange={() => toggleRow(row)}
                            aria-label={`Seleccionar ${row.number}`}
                          />
                        </td>
                        <td>{row.transaction}</td>
                        <td>{row.number}</td>
                        <td>{date(row.date)}</td>
                        <td>
                          {row.customer.identificationType} {row.customer.identificationNumber}
                        </td>
                        <td title="Betel aún no maneja sucursales">{row.branch ?? "—"}</td>
                        <td>{row.customer.legalName}</td>
                        <td>{row.customer.email ?? <span className="report-hint">Sin correo</span>}</td>
                        <td className="num">{money(row.total)}</td>
                        <td>
                          <span
                            className={row.email ? "email-badge is-sent" : "email-badge"}
                            title={row.emailBlocked ?? (row.email ? `Enviado a ${row.email.recipient}` : undefined)}
                          >
                            {row.email ? "Enviado" : row.emailBlocked ? "No disponible" : "Sin enviar"}
                          </span>
                        </td>
                        <td>
                          <span className={dianBadge[row.dian]}>{dianLabels[row.dian] ?? row.dian}</span>
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
                <h3>No se encontraron comprobantes.</h3>
                <p>Modifica los criterios de búsqueda e inténtalo de nuevo.</p>
              </div>
            )}
            <div className="mass-footer">
              <span>
                Mostrando{" "}
                <b>
                  {first}-{last}
                </b>{" "}
                de {total}
              </span>
              <span className="mass-pages">
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
                  disabled={last >= total}
                  onClick={() => setPage(page + 1)}
                >
                  ›
                </button>
              </span>
              <label>
                <select
                  value={pageSize}
                  onChange={event => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                  aria-label="Comprobantes por página"
                >
                  {[10, 25, 50, 100].map(size => (
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
    </>
  );
}

/** Selección múltiple con casillas; con `chips` muestra las opciones elegidas como etiquetas (máx. 3 + "+N"). */
function MultiSelect({
  label,
  options,
  value,
  onChange,
  chips = false,
}: {
  label: string;
  options: Record<string, string>;
  value: string[];
  onChange: (value: string[]) => void;
  chips?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => !ref.current?.contains(event.target as Node) && setOpen(false);
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const toggle = (option: string) =>
    onChange(value.includes(option) ? value.filter(item => item !== option) : [...value, option]);
  const names = value.map(option => options[option]!);

  return (
    <div className="mass-multi" ref={ref}>
      <button
        type="button"
        className="mass-multi-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {chips ? (
          <span className="mass-chips">
            {value.slice(0, 3).map(option => (
              <span key={option} className="mass-chip">
                {options[option]}
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Quitar ${options[option]}`}
                  onClick={event => {
                    event.stopPropagation();
                    toggle(option);
                  }}
                  onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      toggle(option);
                    }
                  }}
                >
                  ×
                </span>
              </span>
            ))}
            {value.length > 3 && <span className="mass-more">+{value.length - 3}</span>}
            {!value.length && <span className="report-hint">Ninguno</span>}
          </span>
        ) : (
          <span className="mass-multi-text">
            {value.length === Object.keys(options).length ? "Todos" : names.join(", ") || "Ninguno"}
          </span>
        )}
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="mass-multi-list" role="listbox" aria-label={label} aria-multiselectable="true">
          <label>
            <input
              type="checkbox"
              checked={value.length === Object.keys(options).length}
              onChange={() => onChange(value.length === Object.keys(options).length ? [] : Object.keys(options))}
            />
            Todos
          </label>
          {Object.entries(options).map(([option, name]) => (
            <label key={option}>
              <input type="checkbox" checked={value.includes(option)} onChange={() => toggle(option)} />
              {name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
