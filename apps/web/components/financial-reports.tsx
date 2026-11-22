/**
 * Menú Reportes: centro de reportes (/reportes) con enlace a todos los reportes de Betel por área, y los estados
 * financieros: estado de resultados (/reportes/estado-de-resultados) y estado de situación financiera
 * (/reportes/situacion-financiera). API: apps/api/src/statements.ts.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
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

// ─── Centro de reportes ──────────────────────────────────────────────────────

type ReportLink = { label: string; href: string; detail: string; isNew?: boolean };
const reportGroups: { title: string; reports: ReportLink[] }[] = [
  {
    title: "Estados financieros",
    reports: [
      {
        label: "Estado de resultados",
        href: "/reportes/estado-de-resultados",
        detail: "Ingresos, costos, gastos y utilidad del período frente al anterior.",
        isNew: true,
      },
      {
        label: "Estado de situación financiera",
        href: "/reportes/situacion-financiera",
        detail: "Activo, pasivo y patrimonio a una fecha (balance general).",
        isNew: true,
      },
      {
        label: "Balance de prueba",
        href: "/contabilidad/balance-de-prueba",
        detail: "Saldos y movimientos por cuenta.",
      },
      { label: "Libro diario", href: "/contabilidad/libro-diario", detail: "Comprobantes contables del período." },
      { label: "Plan de cuentas", href: "/contabilidad?tab=cuentas", detail: "Catálogo PUC de la empresa." },
    ],
  },
  {
    title: "Ventas y facturación",
    reports: [
      {
        label: "Facturas de venta",
        href: "/reportes/facturacion?tab=ventas",
        detail: "Ventas, IVA y estado de cada factura.",
      },
      { label: "Recaudos", href: "/reportes/facturacion?tab=recaudos", detail: "Recibos de caja y pagos en línea." },
      {
        label: "Gestión de cobro",
        href: "/reportes/facturacion?tab=gestion-cobro",
        detail: "Cartera por edades y vencimientos.",
      },
      {
        label: "Cotizaciones",
        href: "/reportes/facturacion?tab=cotizaciones",
        detail: "Cotizaciones y su conversión.",
      },
      {
        label: "Remisiones",
        href: "/reportes/facturacion?tab=remisiones",
        detail: "Entregas pendientes y facturadas.",
      },
      {
        label: "Facturas recurrentes",
        href: "/reportes/facturacion?tab=facturas-recurrentes",
        detail: "Programaciones y emisiones.",
      },
      { label: "Envío masivo", href: "/reportes/facturacion?tab=envio-masivo", detail: "Estados de cuenta enviados." },
      { label: "Clientes", href: "/reportes/facturacion?tab=clientes", detail: "Ventas y saldo por cliente." },
      {
        label: "Seguimiento comercial",
        href: "/reportes/facturacion?tab=seguimiento-comercial",
        detail: "Productos más vendidos y vendedores.",
      },
    ],
  },
  {
    title: "Compras y gastos",
    reports: [
      {
        label: "Documentos de compra",
        href: "/compras?tab=documentos",
        detail: "Facturas de proveedor, gastos y soportes.",
      },
      {
        label: "Registro de eventos",
        href: "/compras?tab=eventos",
        detail: "Acuse, recibo y aceptación ante la DIAN.",
      },
      { label: "Proveedores", href: "/compras?tab=proveedores", detail: "Cuentas por pagar y estado de cuenta." },
      {
        label: "Soporte por legalizar",
        href: "/compras?tab=soporte-por-legalizar",
        detail: "Facturas recibidas sin registrar.",
      },
    ],
  },
  {
    title: "Productos e inventario",
    reports: [
      { label: "Gestión de productos", href: "/productos?tab=gestion", detail: "Catálogo, precios y existencias." },
      {
        label: "Documentos de productos",
        href: "/productos?tab=documentos",
        detail: "Entradas, salidas y ajustes de inventario.",
      },
      { label: "Costeo mensual", href: "/productos?tab=costeo", detail: "Costo promedio y costo de ventas por mes." },
    ],
  },
  {
    title: "Cajas y bancos",
    reports: [
      { label: "Saldos de cajas y bancos", href: "/bancos", detail: "Saldo por cuenta a una fecha y su auxiliar." },
    ],
  },
  {
    title: "Nómina",
    reports: [
      {
        label: "Liquidaciones de nómina",
        href: "/nomina?tab=nominas",
        detail: "Devengos, deducciones y costo empleador.",
      },
      {
        label: "Nómina electrónica",
        href: "/nomina?tab=electronica",
        detail: "Documentos soporte de nómina ante la DIAN.",
      },
      {
        label: "Certificado de ingresos y retenciones",
        href: "/contabilidad/certificado-ingresos",
        detail: "Formato 220 por empleado y año.",
      },
    ],
  },
];

export function ReportsHub() {
  return (
    <div className="page-content">
      <p className="reports-intro">
        Cada enlace abre el reporte con sus filtros y descargas; los permisos son los de cada módulo.
      </p>
      <div className="reports-hub">
        {reportGroups.map(group => (
          <section key={group.title} className="panel reports-group">
            <h2>{group.title}</h2>
            <ul>
              {group.reports.map(report => (
                <li key={report.href}>
                  <Link href={report.href}>
                    {report.label}
                    {report.isNew && <small>Nuevo</small>}
                  </Link>
                  <span>{report.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

// ─── Estados financieros ─────────────────────────────────────────────────────

type StatementRow = {
  kind: "header" | "account" | "subtotal" | "result";
  code?: string;
  label: string;
  current: string;
  previous?: string;
};
type IncomeResponse = {
  data: StatementRow[];
  net: { current: string; previous: string };
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
};
type BalanceResponse = {
  data: StatementRow[];
  totals: { assets: string; liabilities: string; equity: string; liabilitiesAndEquity: string; openResult: string };
  balanced: boolean;
  period: { from: null; to: string };
};

const back = (
  <Link href="/reportes" className="report-link">
    ‹ Volver a Reportes
  </Link>
);

function DownloadMenu({ disabled, onDownload }: { disabled: boolean; onDownload: (format: ExportFormat) => void }) {
  return (
    <ActionMenu
      label="Descargar"
      className="secondary quotes-download"
      items={(["pdf", "xlsx", "csv"] as const).map(format => ({
        label: format === "xlsx" ? "Excel (XLSX)" : format.toUpperCase(),
        onSelect: () => onDownload(format),
        disabled,
      }))}
    >
      ⤓ Descargar
    </ActionMenu>
  );
}

const rowClass = (row: StatementRow) => `statement-${row.kind}`;
const statementLabel = (row: StatementRow) =>
  row.kind === "account" && row.code ? `${row.code} ${row.label}` : row.label;
const variation = (row: StatementRow) => {
  const current = Number(row.current);
  const previous = Number(row.previous ?? 0);
  if (!previous) return "—";
  return `${(((current - previous) / Math.abs(previous)) * 100).toFixed(1)} %`;
};

export function IncomeStatement() {
  const { company, canReceive } = useSession();
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState(() => presetRange("month", defaultPeriod()));
  const report = useReport<IncomeResponse>("/v1/reports/income-statement", range);
  const [error, setError] = useState<string | null>(null);
  const data = report.data;
  const download = async (format: ExportFormat) => {
    setError(null);
    try {
      await exportFromApi<StatementRow>(format, "/v1/reports/income-statement", range, response => {
        const previous = (response as unknown as IncomeResponse).previousPeriod;
        const columns: ReportColumn<StatementRow>[] = [
          { header: "Concepto", value: statementLabel },
          { header: "Período", value: row => row.current, money: true },
          { header: `Anterior (${previous.from} a ${previous.to})`, value: row => row.previous, money: true },
          { header: "Variación", value: variation },
        ];
        return {
          company,
          title: "Estado de resultados",
          period: response.period,
          filters: [["Período anterior", `${previous.from} a ${previous.to}`]],
          columns,
          rows: response.data,
          totals: [["Utilidad neta del ejercicio", money((response as unknown as IncomeResponse).net.current)]],
          fileName: `estado-de-resultados-${response.period.from}-a-${response.period.to}`,
        };
      });
    } catch (exportError) {
      setError((exportError as Error).message);
    }
  };
  const empty = data && !data.data.some(row => row.kind === "account");
  return (
    <div className="page-content">
      <div className="document-toolbar">
        {back}
        <div className="page-actions">
          <DownloadMenu disabled={!canReceive || !data || !!empty} onDownload={download} />
        </div>
      </div>
      <section className="panel">
        <div className="banks-period">
          <label className="field">
            Período
            <select
              value={preset}
              onChange={event => {
                const next = event.target.value as Preset;
                setPreset(next);
                if (next !== "custom") setRange(presetRange(next, range));
              }}
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
        {error && (
          <p className="report-error" role="alert">
            {error}
          </p>
        )}
        <ReportStatus loading={report.loading && !data} error={report.error} />
        {data && (
          <>
            <p className="collections-notice" role="status">
              {Number(data.net.current) >= 0 ? "Utilidad" : "Pérdida"} neta del {date(data.period.from)} al{" "}
              {date(data.period.to)}: <b>{money(data.net.current)}</b>. Se compara con el{" "}
              {date(data.previousPeriod.from)} al {date(data.previousPeriod.to)}.
            </p>
            <div className="report-table-wrap">
              <table className="report-table statement-table">
                <thead>
                  <tr>
                    <th>Concepto</th>
                    <th className="num">Período</th>
                    <th className="num">Período anterior</th>
                    <th className="num">Variación</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((row, index) => (
                    <tr key={`${row.label}-${index}`} className={rowClass(row)}>
                      <td>{statementLabel(row)}</td>
                      <td className="num">{money(row.current)}</td>
                      <td className="num">{money(row.previous ?? "0")}</td>
                      <td className="num">{variation(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {empty && (
                <p className="report-message">No hay ingresos, costos ni gastos contabilizados en el período.</p>
              )}
            </div>
            <p className="report-footnote">
              Saldos de los comprobantes contabilizados (sin el cierre de año). Costo de ventas: clases 6 y 7; gastos
              operacionales: grupos 51 y 52; impuesto de renta: grupo 54.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

export function BalanceSheet() {
  const { company, canReceive } = useSession();
  const [to, setTo] = useState(() => defaultPeriod().to);
  const report = useReport<BalanceResponse>("/v1/reports/balance-sheet", { to });
  const [error, setError] = useState<string | null>(null);
  const data = report.data;
  const columns: ReportColumn<StatementRow>[] = [
    { header: "Concepto", value: statementLabel },
    { header: "Saldo", value: row => row.current, money: true },
  ];
  const download = async (format: ExportFormat) => {
    setError(null);
    try {
      await exportFromApi<StatementRow>(format, "/v1/reports/balance-sheet", { to }, response => {
        const totals = (response as unknown as BalanceResponse).totals;
        return {
          company,
          title: "Estado de situación financiera",
          period: response.period,
          filters: [["Corte", response.period.to]],
          columns,
          rows: response.data,
          totals: [
            ["Total activo", money(totals.assets)],
            ["Total pasivo + patrimonio", money(totals.liabilitiesAndEquity)],
          ],
          fileName: `situacion-financiera-${response.period.to}`,
        };
      });
    } catch (exportError) {
      setError((exportError as Error).message);
    }
  };
  const empty = data && !data.data.some(row => row.kind === "account");
  return (
    <div className="page-content">
      <div className="document-toolbar">
        {back}
        <div className="page-actions">
          <DownloadMenu disabled={!canReceive || !data || !!empty} onDownload={download} />
        </div>
      </div>
      <section className="panel">
        <div className="banks-period">
          <label className="field">
            Saldos al
            <input type="date" value={to} onChange={event => event.target.value && setTo(event.target.value)} />
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
                ? `Cuadra al ${date(data.period.to)}: activo ${money(data.totals.assets)} = pasivo ${money(data.totals.liabilities)} + patrimonio ${money(data.totals.equity)}.`
                : `No cuadra: activo ${money(data.totals.assets)} frente a pasivo + patrimonio ${money(data.totals.liabilitiesAndEquity)}.`}
            </p>
            <div className="report-table-wrap">
              <table className="report-table statement-table">
                <thead>
                  <tr>
                    <th>Concepto</th>
                    <th className="num">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((row, index) => (
                    <tr key={`${row.label}-${index}`} className={rowClass(row)}>
                      <td>{statementLabel(row)}</td>
                      <td className="num">{money(row.current)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {empty && <p className="report-message">No hay saldos contabilizados hasta esa fecha.</p>}
            </div>
            <p className="report-footnote">
              Incluye todos los comprobantes contabilizados hasta la fecha. El resultado de los años que aún no se han
              cerrado (clases 4 a 7) se muestra dentro del patrimonio.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
