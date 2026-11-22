/**
 * Cajas y bancos (/bancos): saldo de cada cuenta de caja (1105) y bancos (1110) según la contabilidad, con total
 * general, columnas visibles y descarga; y el auxiliar de cada cuenta (/bancos/movimientos?cuenta=…) con saldo
 * anterior, movimientos con saldo acumulado y enlace al documento que los originó.
 * API: apps/api/src/banks.ts; definiciones en docs/cajas-y-bancos.md.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
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

type BankRow = {
  id: string;
  code: string;
  name: string;
  kind: "CASH" | "BANK";
  debits: string;
  credits: string;
  balance: string;
  lastMovement: string | null;
};
type BanksResponse = { data: BankRow[]; total: string; to: string };

const kindLabels = { CASH: "Caja", BANK: "Banco" } as const;
export const movementsHref = (id: string) => `/bancos/movimientos?cuenta=${id}`;

/** Columnas que se pueden ocultar (Cuenta bancaria / caja y Saldo siempre se ven). */
const optionalColumns = {
  code: "Código cuenta contable",
  kind: "Tipo",
  debits: "Débitos",
  credits: "Créditos",
  lastMovement: "Último movimiento",
} as const;
type ColumnKey = keyof typeof optionalColumns;
const COLUMNS_KEY = "betel.bankColumns";
const defaultHidden: ColumnKey[] = ["kind", "debits", "credits", "lastMovement"];

const exportColumns: ReportColumn<BankRow>[] = [
  { header: "Código cuenta contable", value: row => row.code },
  { header: "Cuenta bancaria / caja", value: row => row.name },
  { header: "Tipo", value: row => kindLabels[row.kind] },
  { header: "Débitos", value: row => row.debits, money: true },
  { header: "Créditos", value: row => row.credits, money: true },
  { header: "Saldo", value: row => row.balance, money: true },
  { header: "Último movimiento", value: row => date(row.lastMovement) },
];

export function BanksModule() {
  const { company, canExport } = useSession();
  const today = defaultPeriod().to;
  const [to, setTo] = useState(today);
  const [hidden, setHidden] = useState<ColumnKey[]>(defaultHidden);
  const [error, setError] = useState<string | null>(null);
  const report = useReport<BanksResponse>("/v1/reports/banks", { to });
  const rows = report.data?.data ?? [];

  // Columnas ocultas: preferencia de este navegador.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? "null") as ColumnKey[] | null;
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

  const download = async (format: ExportFormat) => {
    setError(null);
    try {
      await exportFromApi<BankRow>(format, "/v1/reports/banks/export", { to }, response => ({
        company,
        title: "Cajas y bancos",
        period: { from: null, to: response.to as string },
        filters: [["Saldo al", date(response.to as string)]],
        columns: exportColumns,
        rows: response.data,
        totals: [["Total general", money(response.total as string)]],
        fileName: `cajas-y-bancos-${response.to}`,
      }));
    } catch (exportError) {
      setError((exportError as Error).message);
    }
  };

  return (
    <div className="page-content">
      <nav className="report-tabs" aria-label="Cajas y bancos">
        <Link href="/bancos" className="active" aria-current="page">
          Cajas y bancos
        </Link>
      </nav>
      <section className="panel collections banks-panel">
        <div className="quotes-toolbar">
          <label className="field banks-date">
            Saldo al
            <input type="date" value={to} max={today} onChange={event => setTo(event.target.value || today)} />
          </label>
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
              onSelect: () => download(format),
              disabled: !canExport || !rows.length,
              note: !canExport
                ? "Tu rol no permite descargar"
                : !rows.length
                  ? "No hay cuentas para descargar"
                  : undefined,
            }))}
          >
            ⤓ Descargar
          </ActionMenu>
        </div>
        {error && (
          <p className="collections-notice is-error" role="alert">
            {error}
          </p>
        )}
        <ReportStatus loading={report.loading && !report.data} error={report.error} />
        {report.data && (
          <div className="report-table-wrap">
            <table className="report-table collections-table banks-table">
              <thead>
                <tr>
                  {show("code") && <th>Código cuenta contable</th>}
                  <th>Cuenta bancaria / caja</th>
                  {show("kind") && <th>Tipo</th>}
                  {show("debits") && <th className="num">Débitos</th>}
                  {show("credits") && <th className="num">Créditos</th>}
                  {show("lastMovement") && <th>Último movimiento</th>}
                  <th className="num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    {show("code") && <td>{row.code}</td>}
                    <td>
                      <Link href={movementsHref(row.id)} className="collections-doc">
                        {row.name}
                      </Link>
                    </td>
                    {show("kind") && <td>{kindLabels[row.kind]}</td>}
                    {show("debits") && <td className="num">{money(row.debits)}</td>}
                    {show("credits") && <td className="num">{money(row.credits)}</td>}
                    {show("lastMovement") && <td>{date(row.lastMovement)}</td>}
                    <td className="num">
                      <Link
                        href={movementsHref(row.id)}
                        className={Number(row.balance) < 0 ? "collections-doc banks-negative" : "collections-doc"}
                        title="Ver movimientos"
                      >
                        {money(row.balance)}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr>
                    <th colSpan={1 + Object.keys(optionalColumns).filter(key => show(key as ColumnKey)).length}>
                      Total general
                    </th>
                    <th className="num">{money(report.data.total)}</th>
                  </tr>
                </tfoot>
              )}
            </table>
            {!rows.length && (
              <p className="report-message">
                Aún no hay cuentas de caja ni de bancos: se crean con el primer documento contabilizado (factura de
                contado, recibo de caja, compra o pago).
              </p>
            )}
          </div>
        )}
        <p className="report-hint banks-note">
          Saldo = débitos − créditos de los comprobantes contabilizados hasta la fecha de corte (recaudos, pagos en
          línea, compras y gastos de contado, documentos soporte, comprobantes de egreso y sus anulaciones). Un saldo
          negativo indica que se registraron más salidas que entradas de dinero en esa cuenta.
        </p>
      </section>
    </div>
  );
}

type Movement = {
  id: string;
  date: string;
  reference: string;
  description: string;
  memo: string | null;
  sourceType: string | null;
  sourceId: string | null;
  supplierId: string | null;
  debit: string;
  credit: string;
  balance: string;
};
type MovementsResponse = {
  data: Movement[];
  pagination: { page: number; pageSize: number; total: number };
  account: { id: string; code: string; name: string; kind: "CASH" | "BANK" };
  period: { from: string; to: string };
  opening: string;
  debits: string;
  credits: string;
  closing: string;
};

/** Enlace al documento que originó el movimiento (si tiene pantalla propia). */
function sourceHref(movement: Movement) {
  const id = movement.sourceId;
  if (!id) return null;
  switch (movement.sourceType) {
    case "CashReceipt":
      return `/recaudos/documento?type=CashReceipt&id=${id}`;
    case "Invoice":
      return `/recaudos/documento?type=Invoice&id=${id}`;
    case "PurchaseDocument":
      return `/compras/documento?kind=Purchase&id=${id}`;
    case "SupportDocument":
      return `/compras/documento?kind=Support&id=${id}`;
    case "SupplierPayment":
      return movement.supplierId ? `/compras/proveedor?id=${movement.supplierId}` : null;
    case "InventoryDocument":
      return `/productos/documentos/ver?id=${id}`;
    default:
      return null;
  }
}

const movementColumns: ReportColumn<Movement>[] = [
  { header: "Fecha", value: row => date(row.date) },
  { header: "Comprobante", value: row => row.reference },
  { header: "Descripción", value: row => row.description },
  { header: "Débito", value: row => row.debit, money: true },
  { header: "Crédito", value: row => row.credit, money: true },
  { header: "Saldo", value: row => row.balance, money: true },
];

/** Auxiliar de una cuenta de caja o banco. */
export function BankMovements() {
  const accountId = useSearchParams().get("cuenta") ?? "";
  const { company, canExport } = useSession();
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState(() => presetRange("month", defaultPeriod()));
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 50;
  const report = useReport<MovementsResponse>(`/v1/banks/${accountId}/movements`, { ...range, page, pageSize });
  const data = report.data;
  const total = data?.pagination.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const choosePreset = (value: Preset) => {
    setPreset(value);
    if (value !== "custom") setRange(presetRange(value, range));
    setPage(1);
  };
  const download = async (format: ExportFormat) => {
    setError(null);
    try {
      await exportFromApi<Movement>(format, `/v1/banks/${accountId}/movements/export`, range, response => ({
        company,
        title: `Movimientos — ${(response.account as MovementsResponse["account"]).code} ${(response.account as MovementsResponse["account"]).name}`,
        period: response.period,
        filters: [["Saldo anterior", money(response.opening as string)]],
        columns: movementColumns,
        rows: response.data,
        totals: [
          ["Débitos", money(response.debits as string)],
          ["Créditos", money(response.credits as string)],
          ["Saldo final", money(response.closing as string)],
        ],
        fileName: `movimientos-${(response.account as MovementsResponse["account"]).code}-${response.period.from}-a-${response.period.to}`,
      }));
    } catch (exportError) {
      setError((exportError as Error).message);
    }
  };

  return (
    <div className="page-content">
      <div className="document-toolbar">
        <Link href="/bancos" className="report-link">
          ‹ Volver a Cajas y bancos
        </Link>
        {data && (
          <div className="page-actions">
            <ActionMenu
              label="Descargar"
              className="secondary quotes-download"
              items={(["pdf", "xlsx", "csv"] as const).map(format => ({
                label: format === "xlsx" ? "Excel (XLSX)" : format.toUpperCase(),
                onSelect: () => download(format),
                disabled: !canExport,
                note: canExport ? undefined : "Tu rol no permite descargar",
              }))}
            >
              ⤓ Descargar
            </ActionMenu>
          </div>
        )}
      </div>
      {error && (
        <p className="collections-notice is-error" role="alert">
          {error}
        </p>
      )}
      <ReportStatus loading={report.loading && !data} error={report.error} />
      {data && (
        <section className="panel">
          <header className="document-head">
            <div>
              <p className="eyebrow">{kindLabels[data.account.kind]}</p>
              <h2>
                {data.account.code} · {data.account.name}
              </h2>
              <p>
                Movimientos del {date(data.period.from)} al {date(data.period.to)}
              </p>
            </div>
            <div className="document-total">
              <span>Saldo final</span>
              <b className={Number(data.closing) < 0 ? "banks-negative" : undefined}>{money(data.closing)}</b>
            </div>
          </header>
          <div className="banks-period">
            <label className="field">
              Período
              <select value={preset} onChange={event => choosePreset(event.target.value as Preset)}>
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
                    onChange={event => setRange({ ...range, from: event.target.value })}
                  />
                </label>
                <label className="field">
                  Hasta
                  <input
                    type="date"
                    value={range.to}
                    min={range.from}
                    onChange={event => setRange({ ...range, to: event.target.value })}
                  />
                </label>
              </>
            )}
          </div>
          <div className="statement-kpis">
            <div>
              <span>Saldo anterior</span>
              <b>{money(data.opening)}</b>
            </div>
            <div>
              <span>Entradas (débitos)</span>
              <b>{money(data.debits)}</b>
            </div>
            <div>
              <span>Salidas (créditos)</span>
              <b>{money(data.credits)}</b>
            </div>
            <div className={Number(data.closing) < 0 ? "is-bad" : undefined}>
              <span>Saldo final</span>
              <b>{money(data.closing)}</b>
            </div>
          </div>
          <div className="report-table-wrap">
            <table className="report-table banks-movements">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Comprobante</th>
                  <th>Descripción</th>
                  <th className="num">Débito</th>
                  <th className="num">Crédito</th>
                  <th className="num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {page === 1 && (
                  <tr className="banks-opening">
                    <td>{date(data.period.from)}</td>
                    <td colSpan={2}>Saldo anterior</td>
                    <td />
                    <td />
                    <td className="num">{money(data.opening)}</td>
                  </tr>
                )}
                {data.data.map(movement => {
                  const href = sourceHref(movement);
                  return (
                    <tr key={movement.id}>
                      <td>{date(movement.date)}</td>
                      <td>
                        {href ? (
                          <Link href={href} className="collections-doc">
                            {movement.reference}
                          </Link>
                        ) : (
                          movement.reference
                        )}
                      </td>
                      <td>
                        {movement.description}
                        {movement.memo && <small>{movement.memo}</small>}
                      </td>
                      <td className="num">{Number(movement.debit) ? money(movement.debit) : ""}</td>
                      <td className="num">{Number(movement.credit) ? money(movement.credit) : ""}</td>
                      <td className={Number(movement.balance) < 0 ? "num banks-negative" : "num"}>
                        {money(movement.balance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!data.data.length && <p className="report-message">No hay movimientos en el período.</p>}
          </div>
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
      )}
    </div>
  );
}
