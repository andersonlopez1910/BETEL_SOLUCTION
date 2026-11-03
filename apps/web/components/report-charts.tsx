/**
 * Gráficas SVG del reporte de facturación (sin librerías externas).
 *
 *   <BarChart points={[{ label: "nov 26", value: 404600.6, detail: "4 facturas" }]} />
 *   <LineChart points={...} />   // serie diaria; los días sin ventas deben venir con valor 0
 *
 * Una sola serie por gráfica (el título del panel la nombra, por eso no hay leyenda). Al pasar el
 * mouse o el foco se muestra el valor exacto. Los datos completos siempre están en la tabla.
 */
"use client";

import { useState } from "react";

export type ChartPoint = { label: string; value: number; detail?: string };

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 64 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

const money = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 });

/** Tope "redondo" del eje Y y tres líneas guía. */
function scale(points: ChartPoint[]) {
  const max = Math.max(...points.map(point => point.value), 0);
  if (max === 0) return { top: 1, ticks: [0] };
  const step = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / step) * step;
  return { top, ticks: [0, top / 2, top] };
}

function Frame({
  points,
  label,
  active,
  setActive,
  children,
}: {
  points: ChartPoint[];
  label: string;
  active: number | null;
  setActive: (index: number | null) => void;
  children: (geometry: { x: (index: number) => number; y: (value: number) => number; band: number }) => React.ReactNode;
}) {
  const { top, ticks } = scale(points);
  const band = PLOT_W / Math.max(points.length, 1);
  const x = (index: number) => PAD.left + band * index + band / 2;
  const y = (value: number) => PAD.top + PLOT_H - (value / top) * PLOT_H;
  // Con muchos puntos se rotulan solo algunos para que las etiquetas del eje X no se encimen.
  const labelEvery = Math.ceil(points.length / 8);
  const current = active === null ? null : points[active];

  return (
    <div className="chart" onMouseLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
        {ticks.map(tick => (
          <g key={tick} className="chart-grid">
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} />
            <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
              {compact.format(tick)}
            </text>
          </g>
        ))}
        {children({ x, y, band })}
        {points.map((point, index) =>
          index % labelEvery === 0 ? (
            <text key={point.label} className="chart-axis" x={x(index)} y={HEIGHT - 8} textAnchor="middle">
              {point.label}
            </text>
          ) : null
        )}
        {/* Zonas de interacción más grandes que la marca (toda la columna). */}
        {points.map((point, index) => (
          <rect
            key={point.label}
            className="chart-hit"
            x={PAD.left + band * index}
            y={PAD.top}
            width={band}
            height={PLOT_H}
            tabIndex={0}
            aria-label={`${point.label}: ${money.format(point.value)}${point.detail ? `, ${point.detail}` : ""}`}
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(null)}
          />
        ))}
      </svg>
      {current && active !== null && (
        <div
          className="chart-tooltip"
          style={{ left: `${(x(active) / WIDTH) * 100}%`, top: `${(y(current.value) / HEIGHT) * 100}%` }}
        >
          <b>{money.format(current.value)}</b>
          <span>
            {current.label}
            {current.detail && ` · ${current.detail}`}
          </span>
        </div>
      )}
    </div>
  );
}

/** Barras verticales con extremo superior redondeado (4px) apoyadas en la línea base. */
export function BarChart({ points, label }: { points: ChartPoint[]; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  return (
    <Frame points={points} label={label} active={active} setActive={setActive}>
      {({ x, y, band }) =>
        points.map((point, index) => {
          const width = Math.min(Math.max(band - 2, 2), 36); // 2px de separación entre barras
          const height = PAD.top + PLOT_H - y(point.value);
          const r = Math.min(4, height, width / 2);
          const left = x(index) - width / 2;
          const base = PAD.top + PLOT_H;
          return (
            <path
              key={point.label}
              className={active === index ? "chart-bar is-active" : "chart-bar"}
              d={`M${left},${base} V${base - height + r} Q${left},${base - height} ${left + r},${base - height} H${left + width - r} Q${left + width},${base - height} ${left + width},${base - height + r} V${base} Z`}
            />
          );
        })
      }
    </Frame>
  );
}

/** Línea de 2px con guía vertical y marcador en el punto activo. */
export function LineChart({ points, label }: { points: ChartPoint[]; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  return (
    <Frame points={points} label={label} active={active} setActive={setActive}>
      {({ x, y }) => (
        <>
          <polyline
            className="chart-line"
            points={points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ")}
          />
          {active !== null && points[active] && (
            <>
              <line className="chart-crosshair" x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + PLOT_H} />
              <circle className="chart-marker" cx={x(active)} cy={y(points[active].value)} r={5} />
            </>
          )}
        </>
      )}
    </Frame>
  );
}
