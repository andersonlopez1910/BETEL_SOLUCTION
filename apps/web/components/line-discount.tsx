/**
 * Descuento de un renglón de la factura: una casilla «Descuento»; al marcarla se elige si es en porcentaje (%) o en
 * pesos ($) y se digita el valor. Sin marcar, el renglón va sin descuento (valor 0).
 */
"use client";

export type DiscountType = "PERCENTAGE" | "FIXED";

export function LineDiscount({
  enabled,
  type,
  value,
  onChange,
}: {
  enabled: boolean;
  type: DiscountType;
  value: string;
  onChange: (patch: { discountEnabled?: boolean; discountType?: DiscountType; discountValue?: string }) => void;
}) {
  return (
    <div className={enabled ? "line-discount is-on" : "line-discount"}>
      <label className="line-discount-check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={event =>
            onChange({ discountEnabled: event.target.checked, ...(!event.target.checked && { discountValue: "0" }) })
          }
        />
        Descuento
      </label>
      {enabled && (
        <div className="line-discount-fields">
          <div className="line-discount-type" role="radiogroup" aria-label="Tipo de descuento">
            {(
              [
                ["PERCENTAGE", "%", "En porcentaje"],
                ["FIXED", "$", "En pesos"],
              ] as const
            ).map(([option, symbol, title]) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={type === option}
                title={title}
                className={type === option ? "is-selected" : undefined}
                onClick={() => onChange({ discountType: option })}
              >
                {symbol}
              </button>
            ))}
          </div>
          <input
            type="number"
            min="0"
            max={type === "PERCENTAGE" ? 100 : undefined}
            step={type === "PERCENTAGE" ? "0.01" : "1"}
            value={value}
            aria-label={type === "PERCENTAGE" ? "Descuento en porcentaje" : "Descuento en pesos"}
            placeholder={type === "PERCENTAGE" ? "0 %" : "$ 0"}
            onFocus={event => event.target.select()}
            onChange={event => onChange({ discountValue: event.target.value })}
          />
        </div>
      )}
    </div>
  );
}
