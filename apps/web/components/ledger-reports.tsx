/**
 * Contabilidad › Más procesos: balance de prueba (/contabilidad/balance-de-prueba), libro diario
 * (/contabilidad/libro-diario), detalle de un comprobante (/contabilidad/comprobante?id=) y comprobante contable
 * manual (/contabilidad/comprobante/nuevo). API: apps/api/src/ledger.ts.
 */
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
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
import { periodPresets, presetRange, type Preset } from "./billing-report-quotes";
import { VoidDocumentDialog } from "./collection-dialogs";

const back = (
  <Link href="/contabilidad?tab=procesos" className="report-link">
    ‹ Volver a Contabilidad
  </Link>
);

function PeriodPicker({
  preset,
  range,
  onChange,
}: {
  preset: Preset;
  range: { from: string; to: string };
  onChange: (preset: Preset, range: { from: string; to: string }) => void;
}) {
  return (
    <>
      <label className="field">
        Período
        <select
          value={preset}
          onChange={event =>
            onChange(
              event.target.value as Preset,
              event.target.value === "custom" ? range : presetRange(event.target.value as Preset, range)
            )
          }
        >
          {Object.entries(periodPresets).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {preset === "custom" && (
        <>
          <label className="field">
            Desde
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={event => onChange(preset, { ...range, from: event.target.value })}
            />
          </label>
          <label className="field">
            Hasta
            <input
              type="date"
              value={range.to}
              min={range.from}
              onChange={event => onChange(preset, { ...range, to: event.target.value })}
            />
          </label>
        </>
      )}
    </>
  );
}

// ─── Balance de prueba ───────────────────────────────────────────────────────

type TrialRow = {
  code: string;
  name: string;
  nature: string;
  opening: string;
  debits: string;
  credits: string;
  closing: string;
};
type TrialResponse = {
  data: TrialRow[];
  totals: { opening: string; debits: string; credits: string; closing: string };
  balanced: boolean;
  period: { from: string; to: string };
  level: number;
};
const levels: [number, string][] = [
  [1, "Clase"],
  [2, "Grupo"],
  [4, "Cuenta"],
  [6, "Subcuenta"],
  [8, "Auxiliar"],
];
const trialColumns: ReportColumn<TrialRow>[] = [
  { header: "Código", value: row => row.code },
  { header: "Cuenta", value: row => row.name },
  { header: "Saldo inicial", value: row => row.opening, money: true },
  { header: "Débitos", value: row => row.debits, money: true },
  { header: "Créditos", value: row => row.credits, money: true },
  { header: "Saldo final", value: row => row.closing, money: true },
];

export function TrialBalance() {
  const { company, canExport } = useSession();
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState(() => presetRange("month", defaultPeriod()));
  const [level, setLevel] = useState(4);
  const report = useReport<TrialResponse>("/v1/accounting/trial-balance", { ...range, level });
  const [error, setError] = useState<string | null>(null);
  const data = report.data;
  const download = async (format: ExportFormat) => {
    setError(null);
    try {
      await exportFromApi<TrialRow>(format, "/v1/accounting/trial-balance", { ...range, level }, response => ({
        company,
        title: "Balance de prueba",
        period: response.period,
        filters: [["Nivel", levels.find(([value]) => value === level)![1]]],
        columns: trialColumns,
        rows: response.data,
        totals: [
          ["Débitos", money((response.totals as TrialResponse["totals"]).debits)],
          ["Créditos", money((response.totals as TrialResponse["totals"]).credits)],
        ],
        fileName: `balance-de-prueba-${response.period.from}-a-${response.period.to}`,
      }));
    } catch (exportError) {
      setError((exportError as Error).message);
    }
  };
  return (
    <div className="page-content">
      <div className="document-toolbar">
        {back}
        <div className="page-actions">
          <ActionMenu
            label="Descargar"
            className="secondary quotes-download"
            items={(["pdf", "xlsx", "csv"] as const).map(format => ({
              label: format === "xlsx" ? "Excel (XLSX)" : format.toUpperCase(),
              onSelect: () => download(format),
              disabled: !canExport || !data?.data.length,
            }))}
          >
            ⤓ Descargar
          </ActionMenu>
        </div>
      </div>
      <section className="panel">
        <div className="banks-period">
          <PeriodPicker
            preset={preset}
            range={range}
            onChange={(nextPreset, nextRange) => {
              setPreset(nextPreset);
              setRange(nextRange);
            }}
          />
          <label className="field">
            Nivel
            <select value={level} onChange={event => setLevel(Number(event.target.value))}>
              {levels.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p className="report-error" role="alert">
            {error}
          </p>
        )}
        <ReportStatus loading={report.loading && !data} error={report.error} />
        {data && (
          <>
            <p className={data.balanced ? "collections-notice" : "collections-notice is-error"} role="status">
              {data.balanced
                ? `Cuadra: débitos y créditos del ${date(data.period.from)} al ${date(data.period.to)} suman ${money(data.totals.debits)}.`
                : `No cuadra: débitos ${money(data.totals.debits)} y créditos ${money(data.totals.credits)}.`}
            </p>
            <div className="report-table-wrap">
              <table className="report-table banks-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Cuenta</th>
                    <th className="num">Saldo inicial</th>
                    <th className="num">Débitos</th>
                    <th className="num">Créditos</th>
                    <th className="num">Saldo final</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map(row => (
                    <tr key={row.code}>
                      <td>{row.code}</td>
                      <td>{row.name}</td>
                      <td className="num">{money(row.opening)}</td>
                      <td className="num">{money(row.debits)}</td>
                      <td className="num">{money(row.credits)}</td>
                      <td className="num">
                        <b>{money(row.closing)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {data.data.length > 0 && (
                  <tfoot>
                    <tr>
                      <th colSpan={2}>Totales</th>
                      <th className="num">{money(data.totals.opening)}</th>
                      <th className="num">{money(data.totals.debits)}</th>
                      <th className="num">{money(data.totals.credits)}</th>
                      <th className="num">{money(data.totals.closing)}</th>
                    </tr>
                  </tfoot>
                )}
              </table>
              {!data.data.length && (
                <p className="report-message">No hay saldos ni movimientos contabilizados hasta esa fecha.</p>
              )}
            </div>
            <p className="report-hint">
              Saldos con signo: débito positivo y crédito negativo. Solo comprobantes contabilizados (los anulados no
              suman).
            </p>
          </>
        )}
      </section>
    </div>
  );
}

// ─── Libro diario ────────────────────────────────────────────────────────────

type JournalRow = {
  id: string;
  reference: string;
  date: string;
  description: string;
  source: string | null;
  sourceLabel: string;
  status: string;
  lines: number;
  total: string;
};

export const entryHref = (id: string) => `/contabilidad/comprobante?id=${id}`;

export function JournalBook() {
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState(() => presetRange("month", defaultPeriod()));
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const report = useReport<{ data: JournalRow[]; pagination: { total: number } }>("/v1/accounting/journal", {
    ...range,
    source,
    search: query,
    page,
    pageSize,
  });
  const rows = report.data?.data ?? [];
  const total = report.data?.pagination.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="page-content">
      <div className="document-toolbar">
        {back}
        <div className="page-actions">
          <Link href="/contabilidad/comprobante/nuevo" className="primary">
            ＋ Nuevo comprobante
          </Link>
        </div>
      </div>
      <section className="panel">
        <form
          className="banks-period"
          onSubmit={event => {
            event.preventDefault();
            setQuery(search.trim());
            setPage(1);
          }}
        >
          <PeriodPicker
            preset={preset}
            range={range}
            onChange={(nextPreset, nextRange) => {
              setPreset(nextPreset);
              setRange(nextRange);
              setPage(1);
            }}
          />
          <label className="field">
            Origen
            <select
              value={source}
              onChange={event => {
                setSource(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              <option value="AUTOMATIC">Automáticos</option>
              <option value="MANUAL">Manuales</option>
            </select>
          </label>
          <label className="field">
            Buscar
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Comprobante o descripción"
            />
          </label>
        </form>
        <ReportStatus loading={report.loading && !report.data} error={report.error} />
        {report.data && (
          <div className="report-table-wrap">
            <table className="report-table collections-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Comprobante</th>
                  <th>Origen</th>
                  <th>Descripción</th>
                  <th className="num">Renglones</th>
                  <th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className={row.status === "REVERSED" ? "is-cancelled" : undefined}>
                    <td>{date(row.date)}</td>
                    <td>
                      <Link href={entryHref(row.id)} className="collections-doc">
                        {row.reference}
                      </Link>
                      {row.status === "REVERSED" && <small>Anulado</small>}
                    </td>
                    <td>{row.sourceLabel}</td>
                    <td>{row.description}</td>
                    <td className="num">{row.lines}</td>
                    <td className="num">{money(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="report-message">No hay comprobantes en el período.</p>}
          </div>
        )}
        {total > pageSize && (
          <div className="pay-pagination quotes-pagination">
            <span>
              {(page - 1) * pageSize + 1} a {Math.min(page * pageSize, total)} de {total}
            </span>
            <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ‹
            </button>
            <span>
              Página <b>{page}</b> de <b>{pages}</b>
            </span>
            <button
              type="button"
              aria-label="Página siguiente"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              ›
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Detalle de un comprobante ───────────────────────────────────────────────

type EntryDetail = {
  id: string;
  reference: string;
  date: string;
  description: string;
  source: string | null;
  sourceLabel: string;
  status: string;
  lines: { id: string; code: string; name: string; memo: string | null; debit: string; credit: string }[];
  debits: string;
  credits: string;
};

export function JournalEntryView() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { company, canReceive: canEdit } = useSession();
  const report = useReport<{ data: EntryDetail }>(`/v1/accounting/journal/${id}`);
  const [voiding, setVoiding] = useState(false);
  const [notice, setNotice] = useState<string | null>(params.get("creado") ? "Comprobante contabilizado." : null);
  const entry = report.data?.data;
  return (
    <div className="page-content">
      <div className="document-toolbar">
        <Link href="/contabilidad/libro-diario" className="report-link">
          ‹ Volver al libro diario
        </Link>
        {entry && (
          <div className="page-actions">
            <button type="button" className="secondary" onClick={() => window.print()}>
              Imprimir / PDF
            </button>
            {entry.source === "Manual" && entry.status === "POSTED" && canEdit && (
              <button type="button" className="secondary danger" onClick={() => setVoiding(true)}>
                Anular
              </button>
            )}
          </div>
        )}
      </div>
      {notice && (
        <p className="collections-notice" role="status">
          {notice}
        </p>
      )}
      <ReportStatus loading={report.loading && !entry} error={report.error} />
      {entry && (
        <article className={`panel document-sheet${entry.status === "REVERSED" ? " is-void" : ""}`}>
          <header className="document-head">
            <div>
              <p className="eyebrow">{company}</p>
              <h2>
                {entry.sourceLabel} {entry.reference}
              </h2>
              <p>
                {date(entry.date)} · {entry.description}
              </p>
            </div>
            <div className="document-total">
              <span>Valor</span>
              <b>{money(entry.debits)}</b>
              {entry.status === "REVERSED" && <strong className="document-void">ANULADO</strong>}
            </div>
          </header>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Detalle</th>
                  <th className="num">Débito</th>
                  <th className="num">Crédito</th>
                </tr>
              </thead>
              <tbody>
                {entry.lines.map(line => (
                  <tr key={line.id}>
                    <td>
                      {line.code} · {line.name}
                    </td>
                    <td>{line.memo ?? "—"}</td>
                    <td className="num">{Number(line.debit) ? money(line.debit) : ""}</td>
                    <td className="num">{Number(line.credit) ? money(line.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={2}>Sumas iguales</th>
                  <th className="num">{money(entry.debits)}</th>
                  <th className="num">{money(entry.credits)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </article>
      )}
      {entry && voiding && (
        <VoidDocumentDialog
          title={`Anular ${entry.reference}`}
          description="El comprobante queda anulado y deja de sumar en los saldos. Esta acción no se puede deshacer."
          path={`/v1/accounting/journal/${entry.id}/void`}
          confirmLabel="Anular comprobante"
          onClose={() => setVoiding(false)}
          onVoided={() => {
            setVoiding(false);
            setNotice(`${entry.reference} anulado.`);
            report.reload();
          }}
        />
      )}
    </div>
  );
}

// ─── Comprobante contable manual ─────────────────────────────────────────────

type Postable = { id: string | null; code: string; name: string; postable: boolean };
type EntryLine = { key: number; accountId: string; debit: string; credit: string; memo: string };
const cents = (value: string) => Math.round(Number(value || 0) * 100);

export function ManualEntryForm() {
  const router = useRouter();
  const { canReceive: canEdit } = useSession();
  const chart = useReport<{ data: Postable[] }>("/v1/accounting/chart");
  const accounts = useMemo(() => (chart.data?.data ?? []).filter(node => node.postable && node.id), [chart.data]);
  const today = defaultPeriod().to;
  const [form, setForm] = useState({ date: today, description: "" });
  const [lines, setLines] = useState<EntryLine[]>([
    { key: 1, accountId: "", debit: "", credit: "", memo: "" },
    { key: 2, accountId: "", debit: "", credit: "", memo: "" },
  ]);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const debits = lines.reduce((sum, line) => sum + cents(line.debit), 0);
  const credits = lines.reduce((sum, line) => sum + cents(line.credit), 0);
  const update = (key: number, patch: Partial<EntryLine>) =>
    setLines(lines.map(line => (line.key === key ? { ...line, ...patch } : line)));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      const created = await apiPost<{ data: { id: string } }>("/v1/accounting/journal", {
        date: form.date,
        description: form.description.trim(),
        lines: lines
          .filter(line => line.accountId)
          .map(line => ({
            accountId: line.accountId,
            debit: cents(line.debit) / 100,
            credit: cents(line.credit) / 100,
            memo: line.memo.trim() || undefined,
          })),
      });
      router.push(`${entryHref(created.data.id)}&creado=1`);
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  return (
    <form className="page-content receipt-form" onSubmit={submit}>
      <section className="panel">
        <div className="panel-head">
          <h2>Comprobante contable</h2>
          {back}
        </div>
        <p className="report-hint">
          Solo se registran movimientos en cuentas de movimiento (de la organización, activas y sin subcuentas). Crea
          subcuentas o auxiliares en Contabilidad › Cuentas contables.
        </p>
        <div className="receipt-fields">
          <label className="field">
            Fecha
            <input
              type="date"
              value={form.date}
              max={today}
              onChange={event => setForm({ ...form, date: event.target.value })}
              required
            />
          </label>
          <label className="field receipt-notes">
            Descripción
            <input
              value={form.description}
              onChange={event => setForm({ ...form, description: event.target.value })}
              minLength={3}
              maxLength={300}
              required
              placeholder="Ej. Ajuste por diferencia en caja"
            />
          </label>
        </div>
      </section>
      <section className="panel report-table-panel">
        <ReportStatus loading={chart.loading && !chart.data} error={chart.error} />
        <div className="report-table-wrap">
          <table className="report-table inventory-lines ledger-lines">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Detalle</th>
                <th className="num">Débito</th>
                <th className="num">Crédito</th>
                <th>
                  <span className="sr-only">Quitar</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map(line => (
                <tr key={line.key}>
                  <td>
                    <select
                      value={line.accountId}
                      onChange={event => update(line.key, { accountId: event.target.value })}
                      aria-label="Cuenta"
                      required={line.key <= 2}
                    >
                      <option value="">Selecciona la cuenta</option>
                      {accounts.map(account => (
                        <option key={account.id} value={account.id!}>
                          {account.code} · {account.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={line.memo}
                      onChange={event => update(line.key, { memo: event.target.value })}
                      maxLength={200}
                      aria-label="Detalle"
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.debit}
                      onChange={event =>
                        update(line.key, { debit: event.target.value, credit: event.target.value ? "" : line.credit })
                      }
                      aria-label="Débito"
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.credit}
                      onChange={event =>
                        update(line.key, { credit: event.target.value, debit: event.target.value ? "" : line.debit })
                      }
                      aria-label="Crédito"
                    />
                  </td>
                  <td>
                    {lines.length > 2 && (
                      <button
                        type="button"
                        className="report-link danger"
                        onClick={() => setLines(lines.filter(item => item.key !== line.key))}
                        aria-label="Quitar renglón"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={2}>Sumas</th>
                <th className="num">{money(debits / 100)}</th>
                <th className="num">{money(credits / 100)}</th>
                <th />
              </tr>
            </tfoot>
          </table>
        </div>
        <button
          type="button"
          className="secondary ledger-add"
          onClick={() =>
            setLines([
              ...lines,
              { key: Math.max(...lines.map(line => line.key)) + 1, accountId: "", debit: "", credit: "", memo: "" },
            ])
          }
        >
          ＋ Agregar renglón
        </button>
      </section>
      <section className="panel receipt-footer">
        <div>
          <span>Diferencia</span>
          <b className={debits !== credits ? "banks-negative" : undefined}>{money((debits - credits) / 100)}</b>
        </div>
        {state.error && (
          <p className="report-error" role="alert">
            {state.error}
          </p>
        )}
        <div className="report-actions">
          <Link href="/contabilidad/libro-diario" className="secondary receipt-cancel">
            Cancelar
          </Link>
          <button
            type="submit"
            className="primary"
            disabled={state.busy || !canEdit || debits === 0 || debits !== credits}
          >
            {state.busy ? "Guardando…" : "Contabilizar comprobante"}
          </button>
        </div>
      </section>
    </form>
  );
}
