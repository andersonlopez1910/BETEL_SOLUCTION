/**
 * Menú Reportes: centro de reportes (/reportes) con todos los reportes por área (los del catálogo genérico abren
 * /reportes/ver?id=..., ver catalog-report.tsx), y los estados
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

/**
 * Áreas y secciones en el orden de la referencia. `href`: reporte disponible (los del catálogo genérico abren
 * /reportes/ver?id=...). `pending`: aún no disponible; se muestra el motivo, sin enlace.
 */
type HubItem = { label: string; href?: string; pending?: string; isNew?: boolean };
type HubSection = { title: string; items: HubItem[] };
type HubArea = { title: string; sections: HubSection[] };
const view = (id: string) => `/reportes/ver?id=${id}`;
const billing = (tab: string) => `/reportes/facturacion?tab=${tab}`;

const reportAreas: HubArea[] = [
  {
    title: "Facturación y ventas",
    sections: [
      {
        title: "Cotizaciones",
        items: [{ label: "Cotizaciones por vendedor", href: view("cotizaciones-por-vendedor") }],
      },
      {
        title: "Ventas",
        items: [
          { label: "Ventas por cliente", href: view("ventas-por-cliente") },
          { label: "Ventas por producto", href: view("ventas-por-producto") },
          { label: "Ventas por vendedor", href: view("ventas-por-vendedor") },
          { label: "Ventas por cliente por producto", href: view("ventas-cliente-producto") },
          { label: "Ventas por vendedor por producto", href: view("ventas-vendedor-producto") },
          { label: "Comparativo de ventas por mes", href: view("comparativo-ventas-mes") },
          { label: "Comparativo de ventas por producto", href: view("comparativo-ventas-producto") },
          { label: "Comparativo de ventas por vendedor", href: view("comparativo-ventas-vendedor") },
          { label: "Informe facturación de obsequios", href: view("obsequios") },
          { label: "Impresión y envío masivo de comprobantes", href: billing("envio-masivo") },
        ],
      },
      {
        title: "Proveedor tecnológico (PT)",
        items: [{ label: "Informes facturación electrónica", href: view("facturacion-electronica") }],
      },
      { title: "POS", items: [{ label: "Ventas POS", pending: "Betel no tiene punto de venta (POS)." }] },
      {
        title: "Facturas recurrentes",
        items: [{ label: "Seguimiento de facturas recurrentes", href: billing("facturas-recurrentes") }],
      },
      {
        title: "Recibos de caja",
        items: [{ label: "Recibos de caja detallado por facturas", href: view("recibos-por-factura") }],
      },
      {
        title: "Movimiento de documentos de ventas",
        items: [
          { label: "Movimiento facturas de venta / Ingresos", href: view("movimiento-facturas-venta") },
          {
            label: "Movimiento notas crédito y débito (ventas)",
            pending: "Betel aún no emite notas crédito ni débito de venta.",
          },
        ],
      },
      {
        title: "Reporte de facturación",
        items: [
          { label: "Facturas de venta (tablero)", href: billing("ventas") },
          { label: "Recaudos", href: billing("recaudos") },
          { label: "Cotizaciones", href: billing("cotizaciones") },
          { label: "Remisiones", href: billing("remisiones") },
          { label: "Clientes", href: billing("clientes") },
        ],
      },
    ],
  },
  {
    title: "Clientes y proveedores",
    sections: [
      {
        title: "Cuánto me deben (clientes) o cuánto estoy debiendo (proveedores)",
        items: [
          { label: "Cuentas por cobrar/pagar general por cliente/proveedor", href: view("cartera-general") },
          { label: "Cuentas por cobrar/pagar detallada por documento", href: view("cartera-por-documento") },
          { label: "Movimiento de cuentas por cobrar/pagar por documento", href: view("movimiento-cartera") },
          { label: "Movimiento de recibos de caja/pago", href: view("movimiento-recibos") },
          { label: "Cuentas por cobrar con corte a una fecha", href: view("cartera-corte") },
        ],
      },
      {
        title: "Clientes",
        items: [
          { label: "Búsqueda de cliente, proveedor u otro", href: view("terceros") },
          { label: "Búsqueda avanzada contacto de cliente, proveedor u otro", href: view("contactos-terceros") },
        ],
      },
    ],
  },
  {
    title: "Compras y gastos",
    sections: [
      {
        title: "Compras y gastos",
        items: [
          { label: "Compras por proveedor", href: view("compras-por-proveedor") },
          { label: "Compras por producto", href: view("compras-por-producto") },
          { label: "Compras por producto por proveedor", href: view("compras-producto-proveedor") },
          { label: "Cruce orden de compra vs factura de compra", pending: "Betel no maneja órdenes de compra." },
        ],
      },
      {
        title: "Movimiento de documentos compras",
        items: [
          { label: "Movimiento facturas de compra", href: view("movimiento-compras") },
          {
            label: "Movimiento notas débito",
            pending: "Betel aún no registra notas débito ni crédito de proveedores.",
          },
        ],
      },
      {
        title: "Módulo de compras",
        items: [
          { label: "Registro de eventos DIAN", href: "/compras?tab=eventos" },
          { label: "Proveedores y estado de cuenta", href: "/compras?tab=proveedores" },
          { label: "Soporte por legalizar", href: "/compras?tab=soporte-por-legalizar" },
        ],
      },
    ],
  },
  {
    title: "Productos y servicios",
    sections: [
      {
        title: "Gestión de costos",
        items: [
          { label: "Informe costeo mensual", href: "/productos?tab=costeo" },
          { label: "Rentabilidad por producto", href: view("rentabilidad-producto") },
        ],
      },
      {
        title: "Saldos y movimientos",
        items: [
          { label: "Saldos de inventario", href: view("saldos-inventario") },
          { label: "Movimiento de productos / Kárdex", href: view("kardex") },
          { label: "Movimiento de productos", href: view("movimiento-productos") },
          { label: "Listado de productos / servicios", href: view("listado-productos") },
        ],
      },
      { title: "Remisiones", items: [{ label: "Informe de remisiones cruzadas", href: view("remisiones-cruzadas") }] },
    ],
  },
  {
    title: "Cajas y bancos",
    sections: [{ title: "Saldos", items: [{ label: "Saldos de cajas y bancos con auxiliar", href: "/bancos" }] }],
  },
  {
    title: "Nómina",
    sections: [
      {
        title: "Reportes de nómina",
        items: [
          { label: "Prima de servicios", href: view("nomina-prima") },
          { label: "Provisiones", href: view("nomina-provisiones") },
          { label: "Acumulados", href: view("nomina-acumulados") },
          { label: "Seguridad social y parafiscales", href: view("nomina-seguridad-social") },
        ],
      },
      {
        title: "Módulo de nómina",
        items: [
          { label: "Liquidaciones de nómina", href: "/nomina?tab=nominas" },
          { label: "Nómina electrónica", href: "/nomina?tab=electronica" },
          { label: "Certificado de ingresos y retenciones", href: "/contabilidad/certificado-ingresos" },
        ],
      },
    ],
  },
  {
    title: "Contabilidad",
    sections: [
      {
        title: "Contables",
        items: [
          { label: "Consecutivo de comprobantes", href: view("consecutivo-comprobantes") },
          { label: "Comprobantes no contabilizados", href: view("comprobantes-no-contabilizados") },
          {
            label: "Informes personalizados de movimiento contable",
            pending: "Informes configurables pendientes; usa el auxiliar por cuenta o el libro diario.",
          },
          { label: "Movimiento auxiliar por cuenta contable", href: view("auxiliar-cuenta") },
          { label: "Balance de prueba general", href: "/contabilidad/balance-de-prueba" },
        ],
      },
      {
        title: "Financieros",
        items: [
          { label: "Estado de situación financiera", href: "/reportes/situacion-financiera" },
          { label: "Estado de situación financiera (configurable)", pending: "Formatos configurables pendientes." },
          { label: "Estado de resultado integral", href: "/reportes/estado-de-resultados" },
          { label: "Estado de resultado integral (configurable)", pending: "Formatos configurables pendientes." },
          { label: "Estado de resultado integral por función de gastos", href: "/reportes/estado-de-resultados" },
          {
            label: "Estado de flujos de efectivo - Método indirecto",
            pending: "Requiere clasificar las cuentas por actividad (operación, inversión, financiación).",
          },
          { label: "Estado de cambios en el patrimonio", href: view("cambios-patrimonio") },
        ],
      },
      {
        title: "Tributario / Libros oficiales",
        items: [
          { label: "Libro de inventarios y balance", href: view("libro-inventarios-balance") },
          { label: "Impuestos detallados", href: view("impuestos-detallados") },
          { label: "Libro oficial de compras", href: view("libro-compras") },
          { label: "Libro oficial de ventas", href: view("libro-ventas") },
          { label: "Libro Mayor y Balance", href: view("libro-mayor") },
          { label: "Libro diario", href: "/contabilidad/libro-diario" },
          { label: "Comprobante informe diario", href: view("comprobante-diario") },
        ],
      },
      {
        title: "Activos fijos",
        items: [{ label: "Listado de activos fijos", pending: "Betel aún no maneja activos fijos." }],
      },
      { title: "Plan de cuentas", items: [{ label: "Plan de cuentas (PUC)", href: "/contabilidad?tab=cuentas" }] },
    ],
  },
  {
    title: "Seguimiento comercial (CRM) y de cobranza",
    sections: [
      {
        title: "Seguimiento comercial (CRM) y de cobranza",
        items: [
          { label: "Seguimiento comercial (CRM)", href: billing("seguimiento-comercial") },
          { label: "Gestión de cobro cartera", href: billing("gestion-cobro") },
        ],
      },
    ],
  },
  {
    title: "Auditoría",
    sections: [
      {
        title: "Auditoría de comprobantes y catálogos",
        items: [{ label: "Auditoría de borrado de comprobantes", href: view("auditoria-borrado") }],
      },
    ],
  },
  {
    title: "Reportes de configuración",
    sections: [
      { title: "Localidad", items: [{ label: "Países, departamentos y ciudades", href: view("localidades") }] },
    ],
  },
];

export function ReportsHub() {
  const [filter, setFilter] = useState("");
  const text = filter.trim().toLocaleLowerCase("es");
  const areas = reportAreas
    .map(area => ({
      ...area,
      sections: area.sections
        .map(section => ({
          ...section,
          items: section.items.filter(item => !text || item.label.toLocaleLowerCase("es").includes(text)),
        }))
        .filter(section => section.items.length),
    }))
    .filter(area => area.sections.length);
  const counts = reportAreas
    .flatMap(area => area.sections.flatMap(section => section.items))
    .reduce(
      (acc, item) => ({ ready: acc.ready + (item.href ? 1 : 0), pending: acc.pending + (item.pending ? 1 : 0) }),
      {
        ready: 0,
        pending: 0,
      }
    );
  return (
    <div className="page-content">
      <div className="reports-toolbar">
        <label className="field">
          Buscar reporte
          <input
            type="search"
            value={filter}
            placeholder="Ej.: ventas por producto"
            onChange={event => setFilter(event.target.value)}
          />
        </label>
        <p className="reports-intro">
          {counts.ready} reportes disponibles · {counts.pending} en desarrollo. Cada reporte valida los permisos de tu
          rol.
        </p>
      </div>
      {!areas.length && <p className="report-message">Ningún reporte coincide con «{filter}».</p>}
      {areas.map(area => (
        <details key={area.title} className="panel reports-area" open>
          <summary>{area.title}</summary>
          <div className="reports-sections">
            {area.sections.map(section => (
              <section key={section.title} className="reports-section">
                <h3>{section.title}</h3>
                <ul>
                  {section.items.map(item => (
                    <li key={item.label}>
                      {item.href ? (
                        <Link href={item.href}>{item.label}</Link>
                      ) : (
                        <span className="reports-pending">
                          {item.label}
                          <small>En desarrollo</small>
                          <em>{item.pending}</em>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </details>
      ))}
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
