/**
 * AIU de la factura (Administración, Imprevistos y Utilidad): casilla «Incluye AIU» y ventana «Configuración AIU» con
 * el modelo de contabilización, los porcentajes y la base de IVA, retefuente y reteICA. La API recalcula todo
 * (apps/api/src/tax-engine.ts); aquí está el mismo cálculo para el resumen en pantalla.
 */
"use client";

import { useState } from "react";
import { Modal } from "./collection-dialogs";

export type AiuBase = "SUBTOTAL" | "AIU" | "PROFIT";
export type AiuConfig = {
  model: "ADDED" | "INCLUDED";
  administrationRate: number;
  contingencyRate: number;
  profitRate: number;
  vatBase: AiuBase;
  withholdingBase: AiuBase;
  icaBase: AiuBase;
};

/** Valores por defecto de la referencia: 8 % / 2 % / 5 %, IVA sobre la utilidad, retenciones sobre la base AIU. */
export const defaultAiu: AiuConfig = {
  model: "ADDED",
  administrationRate: 8,
  contingencyRate: 2,
  profitRate: 5,
  vatBase: "PROFIT",
  withholdingBase: "AIU",
  icaBase: "AIU",
};

export const aiuRate = (aiu: AiuConfig) => aiu.administrationRate + aiu.contingencyRate + aiu.profitRate;

/** Factor sobre la base de un renglón: 1 (subtotal), (A + I + U) / 100 o U / 100. */
export function aiuFactor(aiu: AiuConfig | null, base: AiuBase) {
  if (!aiu || base === "SUBTOTAL") return 1;
  return (base === "PROFIT" ? aiu.profitRate : aiuRate(aiu)) / 100;
}

/** Administración, imprevistos y utilidad sobre el subtotal (base después de descuentos). */
export function aiuAmounts(aiu: AiuConfig | null, subtotal: number) {
  const part = (rate: number) => Math.round(subtotal * rate) / 100;
  if (!aiu) return null;
  const administration = part(aiu.administrationRate);
  const contingency = part(aiu.contingencyRate);
  const profit = part(aiu.profitRate);
  return {
    administration,
    contingency,
    profit,
    total: administration + contingency + profit,
    added: aiu.model === "ADDED",
  };
}

const percent = (value: number) => `${value.toFixed(2)}%`;
const bases: [AiuBase, string][] = [
  ["SUBTOTAL", "Subtotal"],
  ["AIU", "Base AIU"],
  ["PROFIT", "Utilidad"],
];
const taxes: [keyof Pick<AiuConfig, "vatBase" | "withholdingBase" | "icaBase">, string][] = [
  ["vatBase", "IVA"],
  ["withholdingBase", "Retefuente"],
  ["icaBase", "ReteICA"],
];

/** Casilla «Incluye AIU»: al marcarla abre la configuración; con AIU muestra el resumen y «Configurar». */
export function InvoiceAiuToggle({
  value,
  onChange,
}: {
  value: AiuConfig | null;
  onChange: (aiu: AiuConfig | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="invoice-aiu">
      <label className="invoice-aiu-check">
        Incluye AIU
        <input
          type="checkbox"
          checked={!!value}
          onChange={event => (event.target.checked ? setEditing(true) : onChange(null))}
        />
      </label>
      {value && (
        <span className="invoice-aiu-summary">
          A {percent(value.administrationRate)} · I {percent(value.contingencyRate)} · U {percent(value.profitRate)} ·{" "}
          {value.model === "ADDED" ? "sumada al total" : "no sumada al total"}
          <button type="button" className="report-link" onClick={() => setEditing(true)}>
            Configurar
          </button>
        </span>
      )}
      {editing && (
        <AiuDialog
          initial={value ?? defaultAiu}
          onCancel={() => setEditing(false)}
          onSave={aiu => {
            onChange(aiu);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function AiuDialog({
  initial,
  onCancel,
  onSave,
}: {
  initial: AiuConfig;
  onCancel: () => void;
  onSave: (aiu: AiuConfig) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [rates, setRates] = useState({
    administrationRate: initial.administrationRate.toFixed(2),
    contingencyRate: initial.contingencyRate.toFixed(2),
    profitRate: initial.profitRate.toFixed(2),
  });
  const numeric = {
    administrationRate: Number(rates.administrationRate || 0),
    contingencyRate: Number(rates.contingencyRate || 0),
    profitRate: Number(rates.profitRate || 0),
  };
  const sum = numeric.administrationRate + numeric.contingencyRate + numeric.profitRate;
  const invalid = Object.values(numeric).some(value => !Number.isFinite(value) || value < 0 || value > 100);
  const error = invalid
    ? "Cada porcentaje debe estar entre 0 y 100."
    : sum <= 0
      ? "Indica al menos un porcentaje."
      : sum > 100
        ? "La suma de los porcentajes no puede superar el 100 %."
        : null;
  return (
    <Modal title="Configuración AIU" onClose={onCancel} wide>
      <div className="aiu-dialog">
        <h3>Modelo de contabilización</h3>
        <label className="aiu-radio">
          <input
            type="radio"
            checked={draft.model === "INCLUDED"}
            onChange={() => setDraft({ ...draft, model: "INCLUDED" })}
          />
          <span>
            1. Base AIU <b>NO</b> sumada al total de la factura.
          </span>
        </label>
        <label className="aiu-radio">
          <input
            type="radio"
            checked={draft.model === "ADDED"}
            onChange={() => setDraft({ ...draft, model: "ADDED" })}
          />
          <span>2. Base AIU sumada al total de la factura.</span>
        </label>

        <h3>Base AIU</h3>
        <div className="aiu-rates">
          {(
            [
              ["administrationRate", "% Administración"],
              ["contingencyRate", "% Imprevistos"],
              ["profitRate", "% Utilidad"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={rates[key]}
                onFocus={event => event.target.select()}
                onChange={event => setRates({ ...rates, [key]: event.target.value })}
                onBlur={() => setRates({ ...rates, [key]: Number(rates[key] || 0).toFixed(2) })}
              />
            </label>
          ))}
        </div>

        <h3>Base impuestos</h3>
        <table className="aiu-bases">
          <thead>
            <tr>
              <th />
              <th>Subtotal</th>
              <th>
                Base AIU
                <small>{percent(sum)}</small>
              </th>
              <th>
                Utilidad
                <small>{percent(numeric.profitRate)}</small>
              </th>
            </tr>
          </thead>
          <tbody>
            {taxes.map(([key, label]) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                {bases.map(([base, baseLabel]) => (
                  <td key={base}>
                    <input
                      type="radio"
                      name={key}
                      aria-label={`${label} sobre ${baseLabel}`}
                      checked={draft[key] === base}
                      onChange={() => setDraft({ ...draft, [key]: base })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {error && (
          <p className="report-error" role="alert">
            {error}
          </p>
        )}
        <div className="report-dialog-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="primary" disabled={!!error} onClick={() => onSave({ ...draft, ...numeric })}>
            Guardar
          </button>
        </div>
      </div>
    </Modal>
  );
}
