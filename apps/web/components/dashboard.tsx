"use client";

import Link from "next/link";
import { useState } from "react";
import { money, ReportStatus, useReport } from "./billing-report-common";
import { Icon, type IconName } from "./brand";

type Kpi = { value: string | null; change: string | null };
type DashboardResponse = {
  period: { from: string; to: string };
  kpis: { income: Kpi; expense: Kpi; profit: Kpi; margin: Kpi };
  cashFlow: { inflows: string; outflows: string; net: string };
  accountBalances: {
    receivable: AccountingBalance;
    payable: AccountingBalance;
  };
  series: { period: string; from: string; income: string; expense: string; profit: string }[];
};
type AccountingBalance = { code: string; name: string; debits: string; credits: string; balance: string };
type Granularity = "month" | "quarter" | "year";

const moneyShort = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", notation: "compact", maximumFractionDigits: 1 });
const moduleLinks: [IconName, string, string][] = [
  ["document", "Facturación", "/facturacion/nueva"], ["users", "Terceros", "/terceros/nuevo"],
  ["box", "Productos y servicios", "/productos"], ["wallet", "Cajas y bancos", "/bancos"],
  ["scale", "Contabilidad", "/contabilidad"], ["calendar", "Impuestos", "/calendario"],
  ["report", "Reportes", "/reportes"], ["gear", "Configuración", "/configuracion"],
];
const taxEvents = [
  ["Mié", "14", "Retención en la fuente", "Declaración y pago · Periodo anterior", "Vence pronto", "danger"],
  ["Vie", "17", "IVA", "Declaración y pago · Periodo anterior", "Vence en 5 días", "good"],
  ["Mar", "21", "Impuesto Nacional al Consumo", "Declaración y pago · Periodo anterior", "Vence en 9 días", "info"],
  ["Vie", "31", "Información exógena", "Presentación · Año gravable 2025", "Vence en 19 días", "violet"],
] as const;

function safeNumber(value: string | null) { return Number(value ?? 0); }
function compact(value: string | null) { return moneyShort.format(safeNumber(value)); }

export function Dashboard() {
  const [granularity, setGranularity] = useState<Granularity>("month");
  const dashboard = useReport<DashboardResponse>("/v1/dashboard", { granularity });
  const data = dashboard.data;
  const series = data?.series ?? [];
  const recent = series.slice(-6);

  return <div className="financial-dashboard">
    <ReportStatus loading={dashboard.loading && !data} error={dashboard.error} />
    {data && <><section className="financial-kpis" aria-label="Indicadores financieros">
      <FinancialKpi icon="document" label="Facturación del período" value={compact(data.kpis.income.value)} change={data.kpis.income.change} tone="blue" />
      <FinancialKpi icon="wallet" label="Gastos del período" value={compact(data.kpis.expense.value)} change={data.kpis.expense.change} tone="violet" negative />
      <FinancialKpi icon="coins" label="Flujo neto" value={money(data.cashFlow.net)} change={data.kpis.profit.change} tone="cyan" />
      <div className="financial-kpi dian-card"><span className="financial-kpi-icon"><b>DIAN</b></span><div><span>Estado DIAN</span><strong><i /> Conectada</strong><small>Habilitada para facturación electrónica</small></div></div>
    </section>

    <div className="financial-main-grid">
      <section className="financial-panel revenue-panel">
        <header><div><h2><Icon name="bars" /> Evolución de facturación</h2><p>Total facturado: <b>{money(data.kpis.income.value ?? "0")}</b><em /> {recent.length} períodos</p></div><div className="financial-switch" role="group" aria-label="Agrupar gráfica">{([["month", "Facturación"], ["quarter", "Resultado"], ["year", "Anual"]] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={granularity === value} onClick={() => setGranularity(value)}>{label}</button>)}</div></header>
        <TrendChart series={recent} />
      </section>
      <aside className="financial-panel tax-panel"><header><div><h2><Icon name="calendar" /> Calendario tributario</h2><p>Vencimientos y obligaciones con la DIAN</p></div></header><div className="tax-month">‹ <b>Este mes</b> ›</div><div className="tax-events">{taxEvents.map(([day, number, title, detail, due, tone]) => <article key={title}><time className={tone}><b>{day}</b><strong>{number}</strong><small>Oct</small></time><div><h3>{title}</h3><p>{detail}</p><span>{due}</span></div></article>)}</div><Link className="tax-more" href="/calendario"><Icon name="calendar" size={17} /> Ver calendario completo →</Link></aside>
    </div>

    <div className="financial-lower-grid">
      <section className="financial-panel cash-panel"><header><div><h2><Icon name="coins" /> Flujo de caja</h2><p>Entradas, salidas y saldo disponible de tu empresa.</p></div><span className="cash-month">▣ Este mes⌄</span></header><div className="cash-content"><dl><CashStat kind="in" label="Entradas" value={data.cashFlow.inflows} /><CashStat kind="out" label="Salidas" value={data.cashFlow.outflows} /><CashStat kind="net" label="Flujo neto" value={data.cashFlow.net} /></dl><CashChart series={recent.slice(-5)} /><div className="available-balance"><span><Icon name="wallet" size={21} /></span><small>Saldo disponible</small><b>{money(data.cashFlow.net)}</b><em>↗ {data.kpis.profit.change ?? "0"}% <i>vs. mes anterior</i></em></div></div></section>
      <div className="financial-side account-balances">
        <AccountBalanceCard title="Cuentas por cobrar" icon="users" balance={data.accountBalances.receivable} tone="receivable" />
        <AccountBalanceCard title="Cuentas por pagar" icon="wallet" balance={data.accountBalances.payable} tone="payable" />
      </div>
    </div>

    <section className="module-dock"><div><h2><Icon name="box" /> Módulos de Betel</h2><p>Accede rápidamente a las principales funcionalidades.</p></div><nav aria-label="Módulos de Betel">{moduleLinks.map(([icon, label, href]) => <Link href={href} key={href}><Icon name={icon} size={19} /> {label}</Link>)}</nav></section>
    </>}
  </div>;
}

function FinancialKpi({ icon, label, value, change, tone, negative = false }: { icon: IconName; label: string; value: string; change: string | null; tone: string; negative?: boolean }) {
  const up = Number(change ?? 0) >= 0;
  return <article className="financial-kpi"><span className={`financial-kpi-icon ${tone}`}><Icon name={icon} size={24} /></span><div><span>{label}</span><strong>{value}</strong><small className={negative ? (up ? "negative" : "positive") : (up ? "positive" : "negative")}>{up ? "↗" : "↘"} {Math.abs(Number(change ?? 0)).toFixed(1).replace(".", ",")}% <i>vs. mes anterior</i></small></div></article>;
}

function TrendChart({ series }: { series: DashboardResponse["series"] }) {
  const values = series.map(item => safeNumber(item.income));
  const max = Math.max(...values, 1);
  const width = 680, height = 240, pad = 24;
  const points = values.map((value, index) => `${pad + index * ((width - pad * 2) / Math.max(values.length - 1, 1))},${height - pad - (value / max) * (height - pad * 2)}`).join(" ");
  const area = `${pad},${height - pad} ${points} ${width - pad},${height - pad}`;
  return <div className="trend-chart"><div className="trend-scale"><span>{compact(String(max))}</span><span>{compact(String(max / 2))}</span><span>$0</span></div><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="Gráfica de evolución de facturación"><defs><linearGradient id="revenue-area" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#00b7ee" stopOpacity=".36" /><stop offset="1" stopColor="#00b7ee" stopOpacity=".02" /></linearGradient></defs><path className="chart-grid" d={`M${pad} 48H${width - pad}M${pad} 120H${width - pad}M${pad} 192H${width - pad}`} /><polygon points={area} fill="url(#revenue-area)" /><polyline points={points} fill="none" stroke="#00a9ee" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />{values.length > 0 && <circle cx={width - pad} cy={Number(points.split(" ").at(-1)?.split(",")[1])} r="6" fill="#fff" stroke="#00a9ee" strokeWidth="4" />}</svg><div className="trend-labels">{series.map(item => <span key={item.period}>{item.period.slice(-2)}/{item.period.slice(0, 4)}</span>)}</div></div>;
}

function CashStat({ kind, label, value }: { kind: "in" | "out" | "net"; label: string; value: string }) { return <div className={kind}><dt><i>{kind === "in" ? "↗" : kind === "out" ? "↘" : "▣"}</i>{label}</dt><dd>{money(value)}</dd></div>; }
function CashChart({ series }: { series: DashboardResponse["series"] }) {
  const max = Math.max(...series.flatMap(item => [safeNumber(item.income), safeNumber(item.expense)]), 1);
  return <div className="cash-chart"><div className="cash-legend"><span>● Entradas</span><span>● Salidas</span><span>━ Saldo acumulado</span></div><div className="cash-bars">{series.map(item => <div key={item.period}><i style={{ height: `${Math.max(12, safeNumber(item.income) / max * 94)}%` }} /><b style={{ height: `${Math.max(10, safeNumber(item.expense) / max * 94)}%` }} /><span>{item.period.slice(-2)}</span></div>)}</div></div>;
}
function AccountBalanceCard({ title, icon, balance, tone }: { title: string; icon: IconName; balance: AccountingBalance; tone: "receivable" | "payable" }) {
  return <Link className={`financial-panel account-balance-card ${tone}`} href={`/contabilidad?tab=cuentas&account=${balance.code}`}>
    <header><span className="account-balance-icon"><Icon name={icon} size={21} /></span><span>Cuenta contable</span></header>
    <h2>{title}</h2>
    <p>{balance.code} · {balance.name}</p>
    <strong>{money(balance.balance)}</strong>
    <dl><div><dt>Débitos</dt><dd>{money(balance.debits)}</dd></div><div><dt>Créditos</dt><dd>{money(balance.credits)}</dd></div></dl>
    <footer>Ver cuenta contable <span>→</span></footer>
  </Link>;
}
