/**
 * Campo de celular o teléfono de Colombia: indicativo fijo (bandera + «+57») en un recuadro pequeño y el número al
 * lado, que solo acepta dígitos y máximo 10 (celulares 3XX y fijos 60X). Devuelve solo los dígitos.
 */
"use client";

const MAX_DIGITS = 10;

/** Bandera de Colombia (franjas amarilla, azul y roja). SVG para que se vea igual en Windows, que no pinta emojis de banderas. */
function ColombiaFlag() {
  return (
    <svg className="phone-flag" viewBox="0 0 30 20" aria-hidden="true">
      <rect width="30" height="10" fill="#FCD116" />
      <rect y="10" width="30" height="5" fill="#003893" />
      <rect y="15" width="30" height="5" fill="#CE1126" />
    </svg>
  );
}

export const phoneDigits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "").slice(-MAX_DIGITS);

export function PhoneField({
  label = "Celular",
  value,
  onChange,
  className = "phone-field",
  required = false,
}: {
  label?: string;
  value: string;
  onChange: (digits: string) => void;
  className?: string;
  required?: boolean;
}) {
  const digits = phoneDigits(value);
  const incomplete = digits.length > 0 && digits.length < MAX_DIGITS;
  return (
    <label className={className}>
      <span>{label}</span>
      <span className={incomplete ? "phone-input is-incomplete" : "phone-input"}>
        <span className="phone-prefix" title="Colombia (+57)">
          <ColombiaFlag />
          +57
        </span>
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={MAX_DIGITS}
          pattern="\d{10}"
          required={required}
          placeholder="300 000 0000"
          value={digits}
          onChange={event => onChange(event.target.value.replace(/\D/g, "").slice(0, MAX_DIGITS))}
          onPaste={event => {
            // Al pegar «+57 300 123 4567» se queda con los 10 dígitos del número.
            event.preventDefault();
            onChange(phoneDigits(event.clipboardData.getData("text")));
          }}
        />
      </span>
      {incomplete && <small className="phone-help">Faltan {MAX_DIGITS - digits.length} dígitos (son 10).</small>}
    </label>
  );
}
