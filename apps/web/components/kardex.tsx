/**
 * Costeo automático (kárdex permanente) y kárdex por producto.
 *   - CostingModeCard: dentro de Productos y servicios › Costeo mensual. Interruptor Mensual / Automático
 *     (PUT /v1/costing/settings) y "Recalcular kárdex" (POST /v1/costing/kardex/recalculate).
 *   - ProductKardex: /productos/kardex?producto=<id> — entradas, salidas, saldo y costo promedio por documento
 *     (GET /v1/products/:id/kardex).
 * Método y reglas en apps/api/src/kardex.ts y docs/costeo-automatico.md.
 */
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiPost, apiPut } from "../lib/api";
import type { ExportFormat, ReportColumn } from "../lib/report-export";
import { ActionMenu } from "./action-menu";
import { date, money, ReportStatus, useReport, useSession } from "./billing-report-common";

export type CostingMode = "MONTHLY" | "AUTOMATIC";
export const kardexHref = (productId?: string) => `/productos/kardex${productId ? `?producto=${productId}` : ""}`;

/** Interruptor del modo de costeo con confirmación (cambia asientos contables). */
export function CostingModeCard(props: { mode: CostingMode; automaticFrom: string | null; onChanged: () => void }) {
  const { canInventory } = useSession();
  const [asking, setAsking] = useState<CostingMode | null>(null);
  const [busy, setBusy] = useState<"mode" | "recalculate" | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const automatic = props.mode === "AUTOMATIC";

  const change = async (mode: CostingMode) => {
    setBusy("mode");
    setNotice(null);
    try {
      const result = await apiPut<{
        data: { mode: CostingMode; reversed: string; products: number; invoices: number; adjustment: string };
      }>("/v1/costing/settings", { mode });
      const { reversed, products, invoices, adjustment } = result.data;
      setNotice({
        kind: "ok",
        text:
          mode === "AUTOMATIC"
            ? `Costeo automático activado. Kárdex de ${products} producto(s) calculado; ${invoices} venta(s) con costo contabilizado (${money(adjustment)})${Number(reversed) ? `; se reversó el costeo mensual del mes en curso (${money(reversed)})` : ""}.`
            : `Costeo mensual activado. Se reversó el costo de ventas automático (${money(reversed)}): calcula cada mes con «Calcular costeo».`,
      });
      setAsking(null);
      props.onChanged();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const recalculate = async () => {
    setBusy("recalculate");
    setNotice(null);
    try {
      const result = await apiPost<{ data: { products: number; invoices: number; adjustment: string } }>(
        "/v1/costing/kardex/recalculate"
      );
      const { products, invoices, adjustment } = result.data;
      setNotice({
        kind: "ok",
        text: invoices
          ? `Kárdex recalculado: ${products} producto(s). Se ajustó el costo de ${invoices} venta(s) por ${money(adjustment)}.`
          : `Kárdex recalculado: ${products} producto(s). El costo de ventas ya estaba al día.`,
      });
      props.onChanged();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="costing-mode" aria-label="Modo de costeo">
      <div className="costing-mode-head">
        <div>
          <h3>Modo de costeo</h3>
          <p>
            {automatic ? (
              <>
                <b>Automático desde el {date(props.automaticFrom)}.</b> Cada compra, saldo inicial, ajuste o venta
                recalcula el costo (promedio ponderado o PEPS, según el producto) y contabiliza el costo de ventas de
                cada venta. Las ventas sin existencias se bloquean salvo que el producto permita inventario negativo.
              </>
            ) : (
              <>
                <b>Mensual.</b> El costo de ventas se calcula a mano, mes por mes, con «Calcular costeo». Activa el modo
                automático para que el kárdex y el costo se calculen solos con cada documento.
              </>
            )}
          </p>
        </div>
        <div className="financial-switch" role="group" aria-label="Modo de costeo">
          {(["MONTHLY", "AUTOMATIC"] as const).map(mode => (
            <button
              key={mode}
              type="button"
              aria-pressed={props.mode === mode}
              disabled={!canInventory || busy !== null}
              title={canInventory ? undefined : "Tu rol no permite cambiar el modo de costeo"}
              onClick={() => {
                setNotice(null);
                if (mode !== props.mode) setAsking(mode);
              }}
            >
              {mode === "MONTHLY" ? "Mensual" : "Automático"}
            </button>
          ))}
        </div>
      </div>

      {asking && (
        <div className="costing-mode-confirm" role="alertdialog" aria-label="Confirmar cambio de modo">
          <p>
            {asking === "AUTOMATIC"
              ? "Desde el 1 de este mes, cada venta contabilizará su costo (613505 / 143505). Si este mes ya tiene «Costeo mensual», se reversa su asiento para no duplicar el costo. Los meses anteriores no cambian."
              : "Se reversará el costo de ventas contabilizado venta por venta y deberás calcular cada mes con «Calcular costeo»."}
          </p>
          <div className="costing-actions">
            <button type="button" className="primary" disabled={busy !== null} onClick={() => change(asking)}>
              {busy === "mode"
                ? "Aplicando…"
                : asking === "AUTOMATIC"
                  ? "Activar costeo automático"
                  : "Volver a mensual"}
            </button>
            <button type="button" className="secondary" disabled={busy !== null} onClick={() => setAsking(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="costing-actions">
        {automatic && canInventory && (
          <button type="button" className="secondary" disabled={busy !== null} onClick={recalculate}>
            {busy === "recalculate" ? "Recalculando…" : "↻ Recalcular kárdex"}
          </button>
        )}
        <Link href={kardexHref()} className="secondary">
          Ver kárdex por producto
        </Link>
      </div>
      {notice && (
        <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
          {notice.text}
        </p>
      )}
    </section>
  );
}

type KardexRow = {
  date: string;
  kind: "INITIAL" | "PURCHASE" | "ADJUST_IN" | "ADJUST_OUT" | "SALE";
  document: string;
  sourceType: string;
  sourceId: string;
  qtyIn: string;
  qtyOut: string;
  unitCost: string;
  totalCost: string;
  balanceQty: string;
  balanceValue: string;
  averageCost: string;
  shortage: string;
};
type Balance = { quantity: string; value: string; averageCost: string };
type KardexResponse = {
  product: {
    id: string;
    name: string;
    sku: string | null;
    unit: string;
    kind: "PRODUCT" | "SERVICE";
    methodLabel: string;
    allowNegativeStock: boolean;
    masterCost: string;
  };
  mode: CostingMode;
  automaticFrom: string | null;
  opening: Balance;
  closing: Balance;
  data: KardexRow[];
};
type ProductOption = { id: string; name: string; sku: string | null };

const kindLabels: Record<KardexRow["kind"], string> = {
  INITIAL: "Saldo inicial",
  PURCHASE: "Compra",
  ADJUST_IN: "Ajuste (entrada)",
  ADJUST_OUT: "Ajuste (salida)",
  SALE: "Venta",
};
const quantity = (value: string) =>
  new Intl.NumberFormat("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(Number(value));
const unitMoney = (value: string) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
const sourceHref = (row: KardexRow) =>
  row.sourceType === "Invoice"
    ? `/recaudos/documento?type=Invoice&id=${row.sourceId}`
    : row.sourceType === "PurchaseDocument"
      ? `/compras/documento?kind=Purchase&id=${row.sourceId}`
      : `/productos/documentos/ver?id=${row.sourceId}`;

const columns: ReportColumn<KardexRow>[] = [
  { header: "Fecha", value: row => row.date },
  { header: "Documento", value: row => row.document },
  { header: "Movimiento", value: row => kindLabels[row.kind] },
  { header: "Entradas", value: row => row.qtyIn },
  { header: "Salidas", value: row => row.qtyOut },
  { header: "Costo unitario", value: row => row.unitCost, money: true },
  { header: "Costo total", value: row => row.totalCost, money: true },
  { header: "Saldo (cant.)", value: row => row.balanceQty },
  { header: "Saldo (valor)", value: row => row.balanceValue, money: true },
  { header: "Costo promedio", value: row => row.averageCost, money: true },
];

/** Kárdex valorizado de un producto con filtro de fechas. */
export function ProductKardex() {
  const params = useSearchParams();
  const router = useRouter();
  const productId = params.get("producto");
  const { company, canExport } = useSession();
  const [search, setSearch] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });
  const options = useReport<{ data: ProductOption[] }>("/v1/reports/products", {
    kind: "PRODUCT",
    status: "ALL",
    search: search.trim() || undefined,
    pageSize: 50,
  });
  const kardex = useReport<KardexResponse>(productId ? `/v1/products/${productId}/kardex` : null, {
    from: range.from || undefined,
    to: range.to || undefined,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const result = kardex.data;

  const download = async (format: ExportFormat) => {
    if (!result) return;
    setNotice(null);
    try {
      const { exportReport } = await import("../lib/report-export");
      await exportReport(format, {
        company,
        title: `Kárdex — ${result.product.name}`,
        period: { from: range.from || result.data[0]?.date || "", to: range.to || result.data.at(-1)?.date || "" },
        filters: [
          ["Producto", `${result.product.name}${result.product.sku ? ` (${result.product.sku})` : ""}`],
          ["Método", result.product.methodLabel],
        ],
        columns,
        rows: result.data,
        totals: [
          ["Saldo anterior", `${quantity(result.opening.quantity)} · ${money(result.opening.value)}`],
          ["Saldo final", `${quantity(result.closing.quantity)} · ${money(result.closing.value)}`],
        ],
        fileName: `kardex-${result.product.sku ?? result.product.id.slice(0, 8)}`,
      });
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  return (
    <div className="page-content">
      <div className="document-toolbar">
        <Link href="/productos?tab=costeo" className="report-link">
          ‹ Volver a Costeo
        </Link>
        {result && (
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
          </div>
        )}
      </div>

      <section className="panel kardex-panel">
        <div className="kardex-filters">
          <label className="field kardex-product">
            Producto
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar por nombre o código"
              aria-label="Buscar producto"
            />
            <select
              value={productId ?? ""}
              onChange={event => router.replace(kardexHref(event.target.value || undefined))}
              aria-label="Producto"
            >
              <option value="">Selecciona un producto…</option>
              {(options.data?.data ?? []).map(option => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.sku ? ` · ${option.sku}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Desde
            <input
              type="date"
              value={range.from}
              onChange={event => setRange({ ...range, from: event.target.value })}
            />
          </label>
          <label className="field">
            Hasta
            <input type="date" value={range.to} onChange={event => setRange({ ...range, to: event.target.value })} />
          </label>
        </div>

        {notice && (
          <p className="collections-notice is-error" role="status">
            {notice}
          </p>
        )}
        {!productId && <p className="report-message">Elige un producto para ver sus entradas, salidas y saldos.</p>}
        <ReportStatus loading={kardex.loading && !result} error={kardex.error} />

        {result && (
          <>
            <header className="document-head kardex-head">
              <div>
                <h2>{result.product.name}</h2>
                <p>
                  {result.product.sku ?? "Sin código"} · {result.product.methodLabel} ·{" "}
                  {result.mode === "AUTOMATIC"
                    ? `costeo automático desde el ${date(result.automaticFrom)}`
                    : "costeo mensual (kárdex calculado al consultar)"}
                  {result.product.allowNegativeStock ? " · permite inventario negativo" : ""}
                </p>
              </div>
            </header>
            {result.product.kind === "SERVICE" ? (
              <p className="report-message">Los servicios no manejan inventario ni kárdex.</p>
            ) : (
              <>
                <div className="statement-kpis">
                  <div>
                    <span>Saldo anterior</span>
                    <b>{quantity(result.opening.quantity)}</b>
                    <small>{money(result.opening.value)}</small>
                  </div>
                  <div>
                    <span>Existencias</span>
                    <b>{quantity(result.closing.quantity)}</b>
                    <small>{money(result.closing.value)}</small>
                  </div>
                  <div>
                    <span>Costo unitario vigente</span>
                    <b>{unitMoney(result.closing.averageCost)}</b>
                    <small>Maestro: {money(result.product.masterCost)}</small>
                  </div>
                  <div>
                    <span>Movimientos</span>
                    <b>{result.data.length}</b>
                  </div>
                </div>
                <div className="report-table-wrap">
                  <table className="report-table kardex-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Documento</th>
                        <th className="num">Entradas</th>
                        <th className="num">Salidas</th>
                        <th className="num">Costo unitario</th>
                        <th className="num">Costo total</th>
                        <th className="num">Saldo</th>
                        <th className="num">Valor saldo</th>
                        <th className="num">Costo promedio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.data.map(row => (
                        <tr key={`${row.sourceId}-${row.document}-${row.kind}-${row.qtyIn}-${row.qtyOut}`}>
                          <td>{date(row.date)}</td>
                          <td>
                            <Link href={sourceHref(row)} className="report-link">
                              {row.document}
                            </Link>
                            <small>{kindLabels[row.kind]}</small>
                          </td>
                          <td className="num">{Number(row.qtyIn) ? quantity(row.qtyIn) : ""}</td>
                          <td className="num">
                            {Number(row.qtyOut) ? quantity(row.qtyOut) : ""}
                            {Number(row.shortage) > 0 && (
                              <small className="receipt-overdue">{quantity(row.shortage)} sin existencias</small>
                            )}
                          </td>
                          <td className="num">{unitMoney(row.unitCost)}</td>
                          <td className="num">{money(row.totalCost)}</td>
                          <td className={Number(row.balanceQty) < 0 ? "num receipt-overdue" : "num"}>
                            {quantity(row.balanceQty)}
                          </td>
                          <td className="num">{money(row.balanceValue)}</td>
                          <td className="num">
                            <b>{unitMoney(row.averageCost)}</b>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!result.data.length && <p className="report-message">Sin movimientos en el período.</p>}
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
