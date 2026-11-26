/**
 * Productos y servicios › Costeo mensual (/productos?tab=costeo) y su detalle (/productos/costeo/mes?anio=&mes=).
 *
 * Los 12 meses del año con su última ejecución y estado (Sin costear, Costeado, Desactualizado, Mes futuro);
 * "Calcular costeo" o "Recalcular" (POST /v1/costing/:year/:month/calculate) y el detalle por producto con el costo
 * promedio ponderado y el costo de ventas. Método en apps/api/src/costing.ts y docs/productos-y-servicios.md.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiPost } from "../lib/api";
import type { ExportFormat, ReportColumn } from "../lib/report-export";
import { ActionMenu } from "./action-menu";
import { exportFromApi, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { newInventoryHref } from "./product-documents";

type Status = "NONE" | "DONE" | "OUTDATED" | "FUTURE";
type Run = {
  executedAt: string;
  executedBy: string | null;
  version: number;
  productCount: number;
  costOfSales: string;
  closingValue: string;
  negativeCount: number;
};
type MonthRow = { month: number; status: Status; current: boolean; run: Run | null };
type CostingResponse = { data: { year: number; years: number[]; months: MonthRow[] } };

export const monthNames = [
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
const statusLabels: Record<Status, string> = {
  NONE: "Sin costear",
  DONE: "Costeado",
  OUTDATED: "Desactualizado",
  FUTURE: "Mes futuro",
};
const statusBadges: Record<Status, string> = {
  NONE: "pay-badge is-bad",
  DONE: "pay-badge is-ok",
  OUTDATED: "pay-badge is-pending",
  FUTURE: "pay-badge",
};
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value)
  );
export const costingDetailHref = (year: number, month: number) => `/productos/costeo/mes?anio=${year}&mes=${month}`;

export function MonthlyCosting() {
  const { canInventory: canCalculate } = useSession();
  const [year, setYear] = useState<number | undefined>(undefined);
  const report = useReport<CostingResponse>("/v1/costing", { year });
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: React.ReactNode } | null>(null);
  const data = report.data?.data;

  const calculate = async (month: number) => {
    if (!data) return;
    setBusy(month);
    setNotice(null);
    try {
      const result = await apiPost<{
        data: { version: number; costOfSales: string; products: number; negative: number };
      }>(`/v1/costing/${data.year}/${month}/calculate`);
      const { costOfSales, products, negative } = result.data;
      setNotice({
        kind: "ok",
        text: (
          <>
            {monthNames[month - 1]} {data.year} costeado: {products} producto(s), costo de ventas {money(costOfSales)}
            {negative ? ` · ${negative} con stock negativo (costo menos preciso)` : ""}.{" "}
            <Link href={costingDetailHref(data.year, month)} className="report-link">
              Ver detalle
            </Link>
          </>
        ),
      });
      report.reload();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel costing-panel">
      <div className="events-info costing-info" role="note">
        <span className="events-info-icon" aria-hidden="true">
          i
        </span>
        <p>
          Para garantizar que el costo de ventas sea preciso, registra todos los documentos que impacten el inventario,
          como facturas de venta y compra, conteos físicos y ajustes de inventario. Si cambias un documento de un mes ya
          costeado, ese mes queda <b>Desactualizado</b> y debes recalcularlo.
        </p>
      </div>

      <div className="costing-toolbar">
        <label className="field costing-year">
          Año
          <select
            value={data?.year ?? ""}
            onChange={event => {
              setYear(Number(event.target.value));
              setNotice(null);
            }}
          >
            {(data?.years ?? []).map(value => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <span className="collections-spacer" />
        <ActionMenu
          label="Crear documento"
          className="primary products-create"
          items={[
            { label: "Saldo inicial", note: "Inventario de apertura", href: newInventoryHref("INITIAL") },
            {
              label: "Ajuste de inventario",
              note: "Conteo físico: sobrantes y faltantes",
              href: newInventoryHref("ADJUSTMENT"),
            },
            { label: "Compra", href: "/compras/nuevo?tipo=PURCHASE" },
            { label: "Factura de venta", href: "/facturacion/nueva" },
          ]}
        >
          Crear documento <span aria-hidden="true">⌄</span>
        </ActionMenu>
      </div>

      {notice && (
        <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
          {notice.text}
        </p>
      )}
      <ReportStatus loading={report.loading && !data} error={report.error} />

      {data && (
        <div className="report-table-wrap">
          <table className="report-table costing-table">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Última ejecución</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map(row => (
                <tr key={row.month}>
                  <td>
                    {monthNames[row.month - 1]}
                    {row.current && <small>Mes en curso</small>}
                  </td>
                  <td>
                    {row.run ? (
                      <>
                        {dateTime(row.run.executedAt)}
                        <small>
                          {row.run.executedBy ?? "—"} · costo de ventas {money(row.run.costOfSales)}
                          {row.run.negativeCount ? ` · ${row.run.negativeCount} con stock negativo` : ""}
                        </small>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <span className={statusBadges[row.status]}>{statusLabels[row.status]}</span>
                  </td>
                  <td>
                    <div className="costing-actions">
                      <button
                        type="button"
                        className={row.status === "OUTDATED" ? "primary" : "secondary"}
                        disabled={row.status === "FUTURE" || !canCalculate || busy !== null}
                        title={
                          row.status === "FUTURE"
                            ? "Este mes aún no ha empezado"
                            : canCalculate
                              ? undefined
                              : "Tu rol no permite calcular el costeo"
                        }
                        onClick={() => calculate(row.month)}
                      >
                        {busy === row.month ? "Calculando…" : row.run ? "Recalcular costeo" : "Calcular costeo"}
                      </button>
                      {row.run && (
                        <Link href={costingDetailHref(data.year, row.month)} className="secondary">
                          Ver detalle
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type DetailLine = {
  productId: string;
  name: string;
  sku: string | null;
  unit: string;
  openingQty: string;
  openingValue: string;
  inQty: string;
  inValue: string;
  salesQty: string;
  salesCost: string;
  adjustOutQty: string;
  adjustOutValue: string;
  closingQty: string;
  closingValue: string;
  averageCost: string;
  negative: boolean;
};
type DetailResponse = {
  data: DetailLine[];
  run: {
    year: number;
    month: number;
    version: number;
    executedAt: string;
    executedBy: string | null;
    costOfSales: string;
    closingValue: string;
    negativeCount: number;
    status: Status;
  };
};

const quantity = (value: string) =>
  new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
const detailColumns: ReportColumn<DetailLine>[] = [
  { header: "Producto", value: line => line.name },
  { header: "Código", value: line => line.sku ?? "" },
  { header: "Saldo inicial (cant.)", value: line => line.openingQty },
  { header: "Saldo inicial (valor)", value: line => line.openingValue, money: true },
  { header: "Entradas (cant.)", value: line => line.inQty },
  { header: "Entradas (valor)", value: line => line.inValue, money: true },
  { header: "Costo promedio", value: line => line.averageCost, money: true },
  { header: "Vendido (cant.)", value: line => line.salesQty },
  { header: "Costo de ventas", value: line => line.salesCost, money: true },
  { header: "Ajustes salida (cant.)", value: line => line.adjustOutQty },
  { header: "Ajustes salida (valor)", value: line => line.adjustOutValue, money: true },
  { header: "Saldo final (cant.)", value: line => line.closingQty },
  { header: "Saldo final (valor)", value: line => line.closingValue, money: true },
];

/** Detalle del costeo de un mes por producto. */
export function CostingDetail() {
  const params = useSearchParams();
  const year = Number(params.get("anio"));
  const month = Number(params.get("mes"));
  const { company, canExport, canInventory: canCalculate } = useSession();
  const valid = Number.isInteger(year) && month >= 1 && month <= 12;
  const report = useReport<DetailResponse>(valid ? `/v1/costing/${year}/${month}` : null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const run = report.data?.run;
  const lines = (report.data?.data ?? []).filter(line =>
    `${line.name} ${line.sku ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())
  );
  const label = valid ? `${monthNames[month - 1]} ${year}` : "";

  const recalculate = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await apiPost(`/v1/costing/${year}/${month}/calculate`);
      setNotice({ kind: "ok", text: `${label} recalculado.` });
      report.reload();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const download = async (format: ExportFormat) => {
    setNotice(null);
    try {
      await exportFromApi<DetailLine>(format, `/v1/costing/${year}/${month}/export`, {}, response => ({
        company,
        title: `Costeo mensual — ${label}`,
        period: {
          from: `${year}-${String(month).padStart(2, "0")}-01`,
          to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
        },
        filters: [["Método", "Promedio ponderado mensual"]],
        columns: detailColumns,
        rows: response.data,
        totals: [
          ["Costo de ventas", money(run?.costOfSales ?? 0)],
          ["Valor del inventario al cierre", money(run?.closingValue ?? 0)],
        ],
        fileName: `costeo-${year}-${String(month).padStart(2, "0")}`,
      }));
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };

  return (
    <div className="page-content">
      <div className="document-toolbar">
        <Link href="/productos?tab=costeo" className="report-link">
          ‹ Volver a Costeo mensual
        </Link>
        {run && (
          <div className="page-actions">
            <ActionMenu
              label="Descargar"
              className="secondary quotes-download"
              items={(["pdf", "xlsx", "csv"] as const).map(format => ({
                label: format === "xlsx" ? "Excel (XLSX)" : format.toUpperCase(),
                disabled: !canExport,
                note: canExport ? undefined : "Tu rol no permite descargar",
                onSelect: () => download(format),
              }))}
            >
              ⤓ Descargar
            </ActionMenu>
            {canCalculate && (
              <button
                type="button"
                className={run.status === "OUTDATED" ? "primary" : "secondary"}
                onClick={recalculate}
                disabled={busy}
              >
                {busy ? "Calculando…" : "Recalcular costeo"}
              </button>
            )}
          </div>
        )}
      </div>
      {!valid && <p className="report-error">Mes inválido.</p>}
      {notice && (
        <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
          {notice.text}
        </p>
      )}
      <ReportStatus loading={report.loading && !report.data} error={report.error} />

      {run && (
        <section className="panel costing-detail">
          <header className="document-head">
            <div>
              <h2>Costeo de {label}</h2>
              <p>
                Promedio ponderado mensual · versión {run.version} · {dateTime(run.executedAt)}
                {run.executedBy && ` · ${run.executedBy}`}
              </p>
            </div>
            <span className={statusBadges[run.status]}>{statusLabels[run.status]}</span>
          </header>
          {run.status === "OUTDATED" && (
            <p className="collections-notice is-error" role="status">
              Algún documento del mes o de meses anteriores cambió después de este cálculo: recalcula para actualizar el
              costo de ventas.
            </p>
          )}
          <div className="statement-kpis">
            <div>
              <span>Costo de ventas</span>
              <b>{money(run.costOfSales)}</b>
            </div>
            <div>
              <span>Inventario al cierre</span>
              <b>{money(run.closingValue)}</b>
            </div>
            <div>
              <span>Productos costeados</span>
              <b>{report.data!.data.length}</b>
            </div>
            <div className={run.negativeCount ? "is-bad" : undefined}>
              <span>Con stock negativo</span>
              <b>{run.negativeCount}</b>
            </div>
          </div>
          <div className="costing-search collections-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar producto"
              aria-label="Buscar producto"
            />
          </div>
          <div className="report-table-wrap">
            <table className="report-table costing-lines">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Saldo inicial</th>
                  <th className="num">Entradas</th>
                  <th className="num">Costo promedio</th>
                  <th className="num">Vendido</th>
                  <th className="num">Costo de ventas</th>
                  <th className="num">Ajustes de salida</th>
                  <th className="num">Saldo final</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(line => (
                  <tr key={line.productId}>
                    <td>
                      {line.name}
                      <small>
                        {line.sku ?? "Sin código"}
                        {line.negative && <b className="receipt-overdue"> · stock negativo</b>}
                      </small>
                    </td>
                    <td className="num">
                      {quantity(line.openingQty)}
                      <small>{money(line.openingValue)}</small>
                    </td>
                    <td className="num">
                      {quantity(line.inQty)}
                      <small>{money(line.inValue)}</small>
                    </td>
                    <td className="num">{money(line.averageCost)}</td>
                    <td className="num">{quantity(line.salesQty)}</td>
                    <td className="num">
                      <b>{money(line.salesCost)}</b>
                    </td>
                    <td className="num">
                      {quantity(line.adjustOutQty)}
                      <small>{money(line.adjustOutValue)}</small>
                    </td>
                    <td className="num">
                      {quantity(line.closingQty)}
                      <small>{money(line.closingValue)}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!lines.length && (
              <p className="report-message">
                {search
                  ? "No hay productos con esa búsqueda."
                  : "No hubo productos con saldo ni movimientos en el mes."}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
