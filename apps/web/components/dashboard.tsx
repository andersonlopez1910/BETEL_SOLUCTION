/**
 * Tablero principal (Resumen) con datos reales de GET /v1/dashboard: indicadores del mes, evolución de
 * resultados por mes, trimestre o año, flujo de caja y accesos rápidos. Las definiciones de cada cifra
 * están en apps/api/src/dashboard.ts.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import { money, ReportStatus, useReport } from "./billing-report-common";
import { Icon, type IconName } from "./brand";
import { LineChart } from "./report-charts";

type Kpi = { value: string | null; change: string | null };
type DashboardResponse = {
  period: { from: string; to: string };
  kpis: { income: Kpi; expense: Kpi; profit: Kpi; margin: Kpi };
  cashFlow: { inflows: string; outflows: string; net: string };
  series: { period: string; from: string; income: string; expense: string; profit: string }[];
};
type Granularity = "month" | "quarter" | "year";

const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
/** "2026-11" → "Nov", "2026-T4" → "T4 26", "2026" → "2026". */
const periodLabel = (period: string, granularity: Granularity) =>
  granularity === "month"
    ? months[Number(period.slice(5, 7)) - 1]!
    : granularity === "quarter"
      ? `${period.slice(5)} ${period.slice(2, 4)}`
      : period;

const shortMoney = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

const quickLinks: [IconName, string, string][] = [
  ["filePlus", "Nueva factura", "/facturacion/nueva"],
  ["receipt", "Recibo de caja", "/recaudos/nuevo"],
  ["list", "Cotización", "/cotizaciones/nueva"],
  ["document", "Documento soporte", "/documentos-soporte/nuevo"],
  ["report", "Reportes", "/reportes/facturacion"],
];

export function Dashboard() {
  const [granularity, setGranularity] = useState<Granularity>("month");
  const dashboard = useReport<DashboardResponse>("/v1/dashboard", { granularity });
  const data = dashboard.data;

  return (
    <div className="dashboard">
      <ReportStatus loading={dashboard.loading && !data} error={dashboard.error} />
      {data && (
        <>
          <section className="dash-kpis" aria-label="Indicadores del mes">
            <KpiCard
              icon="coins"
              tone="blue"
              label="Ingresos"
              value={shortMoney.format(Number(data.kpis.income.value))}
              change={data.kpis.income.change}
            />
            <KpiCard
              icon="wallet"
              tone="violet"
              label="Gastos"
              value={shortMoney.format(Number(data.kpis.expense.value))}
              change={data.kpis.expense.change}
              upIsBad
              hint="Compras con documento soporte"
            />
            <KpiCard
              icon="bars"
              tone="teal"
              label="Utilidad"
              value={shortMoney.format(Number(data.kpis.profit.value))}
              change={data.kpis.profit.change}
            />
            <KpiCard
              icon="percent"
              tone="blue"
              label="Margen"
              value={data.kpis.margin.value === null ? "Sin ingresos" : `${data.kpis.margin.value.replace(".", ",")} %`}
              change={data.kpis.margin.change}
              points
            />
          </section>

          <section className="dash-row">
            <div className="panel dash-chart">
              <div className="panel-head">
                <h2>
                  <Icon name="bars" /> Evolución de resultados
                </h2>
                <div className="dash-segmented" role="group" aria-label="Agrupar por">
                  {(
                    [
                      ["month", "Mes"],
                      ["quarter", "Trimestre"],
                      ["year", "Año"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={granularity === value}
                      onClick={() => setGranularity(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="report-hint">
                Utilidad (ingresos − gastos) por período. Pasa el mouse para ver el detalle.
              </p>
              <LineChart
                area
                label="Evolución de la utilidad"
                points={data.series.map(item => ({
                  label: periodLabel(item.period, granularity),
                  value: Number(item.profit),
                  detail: `Ingresos ${shortMoney.format(Number(item.income))} · Gastos ${shortMoney.format(Number(item.expense))}`,
                }))}
              />
            </div>

            <div className="panel dash-cash">
              <div className="panel-head">
                <h2>
                  <Icon name="coins" /> Flujo de caja
                </h2>
              </div>
              <p className="report-hint">Este mes</p>
              <dl>
                <div>
                  <dt>
                    <span className="dash-flow is-in">
                      <Icon name="arrowIn" size={18} />
                    </span>
                    Entradas
                  </dt>
                  <dd>{money(data.cashFlow.inflows)}</dd>
                </div>
                <div>
                  <dt>
                    <span className="dash-flow is-out">
                      <Icon name="arrowOut" size={18} />
                    </span>
                    Salidas
                  </dt>
                  <dd>{money(data.cashFlow.outflows)}</dd>
                </div>
                <div className="dash-net">
                  <dt>
                    <span className="dash-flow">
                      <Icon name="scale" size={18} />
                    </span>
                    Flujo neto
                  </dt>
                  <dd>{money(data.cashFlow.net)}</dd>
                </div>
              </dl>
              <small className="report-hint">
                Entradas: recaudos (facturas de contado y recibos de caja). Salidas: compras con documento soporte.
              </small>
            </div>
          </section>

          <h2 className="dash-title">Accesos rápidos</h2>
          <nav className="dash-quick" aria-label="Accesos rápidos">
            {quickLinks.map(([icon, label, href]) => (
              <Link key={href} href={href}>
                <Icon name={icon} size={26} />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  tone,
  label,
  value,
  change,
  upIsBad = false,
  points = false,
  hint,
}: {
  icon: IconName;
  tone: "blue" | "teal" | "violet";
  label: string;
  value: string;
  change: string | null;
  /** Para gastos: subir es desfavorable (rojo). */
  upIsBad?: boolean;
  /** El margen varía en puntos porcentuales. */
  points?: boolean;
  hint?: string;
}) {
  const up = change !== null && Number(change) > 0;
  const down = change !== null && Number(change) < 0;
  const good = upIsBad ? down : up;
  const bad = upIsBad ? up : down;
  return (
    <div className="metric dash-kpi">
      <span className={`dash-kpi-icon is-${tone}`}>
        <Icon name={icon} size={24} />
      </span>
      <div>
        <span>{label}</span>
        <b>{value}</b>
        <small className={good ? "is-good" : bad ? "is-bad" : undefined}>
          {change === null
            ? "Sin base vs. mes anterior"
            : `${up ? "▲" : down ? "▼" : "■"} ${up ? "+" : ""}${change.replace(".", ",")}${points ? " p.p." : " %"} vs. mes anterior`}
        </small>
        {hint && <small className="dash-kpi-hint">{hint}</small>}
      </div>
    </div>
  );
}
