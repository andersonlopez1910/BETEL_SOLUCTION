/**
 * Piezas compartidas por las pestañas del Reporte de facturación: consulta a la API, sesión,
 * formatos, indicadores, botones Buscar/Limpiar/Actualizar/Exportar y paginación.
 * La barra de pestañas está en billing-report.tsx.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { apiGet, type QueryParams } from "../lib/api";
import { exportReport, type ExportFormat, type ReportDocument } from "../lib/report-export";

// ─── Datos ────────────────────────────────────────────────────────────────────

/**
 * Consulta un endpoint del reporte y vuelve a consultar cuando cambian los parámetros.
 * `reload()` repite la consulta con los mismos parámetros (botón Actualizar).
 */
export function useReport<T>(path: string | null, params: QueryParams = {}) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: !!path });
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify(params);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setState(current => ({ ...current, loading: true, error: undefined }));
    apiGet<T>(path, JSON.parse(key) as QueryParams).then(
      data => !cancelled && setState({ data, loading: false }),
      (error: Error) => !cancelled && setState(current => ({ ...current, loading: false, error: error.message }))
    );
    return () => {
      cancelled = true;
    };
  }, [path, key, attempt]);
  return { ...state, reload: () => setAttempt(value => value + 1) };
}

type Me = { user: { role: string }; organization: { legalName: string } };
/** Roles que pueden exportar (espejo de REPORT_EXPORT_ROLES en la API, que es quien lo hace cumplir). */
const exportRoles = ["OWNER", "ADMIN", "ACCOUNTANT"];

/** Espejo de RECEIPT_ROLES y EMAIL_ROLES (apps/api/src/collections.ts); la API los hace cumplir. */
const receiptRoles = ["OWNER", "ADMIN", "ACCOUNTANT"];
const emailRoles = ["OWNER", "ADMIN", "ACCOUNTANT", "SALES"];

/** Usuario actual: nombre de la empresa (encabezado de exportaciones) y qué acciones puede hacer. */
export function useSession() {
  const { data } = useReport<Me>("/v1/me");
  const role = data?.user.role ?? "";
  return {
    company: data?.organization.legalName ?? "",
    canExport: exportRoles.includes(role),
    canReceive: receiptRoles.includes(role),
    canEmail: emailRoles.includes(role),
    // Generar, enviar y anular links de pago (LINK_ROLES en apps/api/src/payments.ts: mismos roles que correo).
    canLink: emailRoles.includes(role),
  };
}

/** Período por defecto: del día 1 del mes actual a hoy (hora de Colombia), en formato AAAA-MM-DD. */
export function defaultPeriod() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

// ─── Formatos ─────────────────────────────────────────────────────────────────

const moneyFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 2 });
/** Monto de la API (texto decimal "404600.60") → "$ 404.600,60". Solo para mostrar. */
export const money = (value: string | number) => moneyFormat.format(Number(value));

/** "2026-11-02" o "2026-11-02T00:00:00.000Z" → "02/11/2026". */
export function date(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

export const invoiceStatusLabels: Record<string, string> = {
  DRAFT: "Borrador",
  ISSUED: "Emitida",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  VOID: "Anulada",
  OVERDUE: "Vencida",
};

export const dianStatusLabels: Record<string, string> = {
  PENDING: "Pendiente",
  QUEUED: "En cola",
  SENT: "Enviada",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  ERROR: "Error",
};

/** Prefijo + número; la emisión actual aún no asigna consecutivo, en ese caso se indica. */
export function invoiceNumber(invoice: { prefix: string | null; number: string | null }) {
  return invoice.number ? `${invoice.prefix ?? ""}${invoice.number}` : "Sin numerar";
}

// ─── Componentes compartidos ──────────────────────────────────────────────────

/** Indicador (reutiliza el estilo .metric del tablero). */
export function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <b>{value}</b>
      {note && <small className="report-kpi-note">{note}</small>}
    </div>
  );
}

/**
 * Botones del formulario de filtros. "Buscar" es el submit del formulario que lo contiene.
 * Exportar solo aparece para roles con permiso; la API lo valida igualmente.
 */
export function ReportActions({
  onClear,
  onRefresh,
  onExport,
  canExport,
  busy,
}: {
  onClear: () => void;
  onRefresh: () => void;
  onExport: (format: ExportFormat) => Promise<void>;
  canExport: boolean;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const run = async (format: ExportFormat) => {
    setOpen(false);
    setExporting(true);
    setError("");
    try {
      await onExport(format);
    } catch (exportError) {
      setError((exportError as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="report-actions">
      <button type="submit" className="primary" disabled={busy}>
        Buscar
      </button>
      <button type="button" className="secondary" onClick={onClear} disabled={busy}>
        Limpiar
      </button>
      <button type="button" className="secondary" onClick={onRefresh} disabled={busy}>
        Actualizar
      </button>
      {canExport && (
        <div className="popover-anchor" ref={anchorRef}>
          <button
            type="button"
            className="secondary"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            disabled={exporting}
          >
            {exporting ? "Exportando…" : "Exportar ⌄"}
          </button>
          <div role="menu" className={`popover settings-menu report-export-menu${open ? " is-open" : ""}`}>
            {(
              [
                ["pdf", "PDF"],
                ["xlsx", "Excel (XLSX)"],
                ["csv", "CSV"],
              ] as const
            ).map(([format, name]) => (
              <button type="button" role="menuitem" key={format} onClick={() => run(format)}>
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && (
        <span className="report-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total ? (page - 1) * pageSize + 1 : 0;
  return (
    <div className="report-pagination">
      <span>
        {first}–{Math.min(page * pageSize, total)} de {total}
      </span>
      <button type="button" className="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ‹ Anterior
      </button>
      <span>
        Página {page} de {pages}
      </span>
      <button type="button" className="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Siguiente ›
      </button>
    </div>
  );
}

/** Mensaje de carga, error o vacío para el contenido de un reporte. */
export function ReportStatus({ loading, error, empty }: { loading: boolean; error?: string; empty?: boolean }) {
  if (error)
    return (
      <p className="report-message report-error" role="alert">
        {error}
      </p>
    );
  if (loading) return <p className="report-message">Consultando…</p>;
  if (empty) return <p className="report-message">No hay resultados para los filtros seleccionados.</p>;
  return null;
}

/** Descarga las filas completas del endpoint /export y genera el archivo. */
export async function exportFromApi<T>(
  format: ExportFormat,
  path: string,
  params: QueryParams,
  build: (response: { data: T[]; period: { from: string; to: string } } & Record<string, unknown>) => ReportDocument<T>
) {
  const response = await apiGet<{ data: T[]; period: { from: string; to: string } } & Record<string, unknown>>(
    path,
    params
  );
  await exportReport(format, build(response));
}
