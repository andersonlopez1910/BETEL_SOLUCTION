/**
 * Buscador de clientes (combobox): al hacer clic muestra los clientes activos y, a medida que se escribe, busca
 * parecidos por razón social, nombre comercial, NIT, correo o teléfono (sin tildes y con tolerancia a errores de
 * tipeo; la búsqueda la hace GET /v1/parties?role=customer, ver apps/api/src/party-search.ts).
 * Teclado: ↑ ↓ para moverse, Enter para elegir, Esc para cerrar.
 */
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { apiGet } from "../lib/api";

export type CustomerOption = {
  id: string;
  legalName: string;
  tradeName?: string | null;
  identificationNumber: string;
  verificationDigit?: string | null;
  email: string | null;
  phone?: string | null;
  address: string | null;
  municipalityCode: string | null;
  isCustomer: boolean;
};

const nit = (customer: CustomerOption) =>
  customer.verificationDigit
    ? `${customer.identificationNumber}-${customer.verificationDigit}`
    : customer.identificationNumber;

export function CustomerPicker({
  value,
  onChange,
  label = "Buscar cliente",
}: {
  value: CustomerOption | null;
  onChange: (customer: CustomerOption | null) => void;
  label?: string;
}) {
  const [text, setText] = useState(value?.legalName ?? "");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  // Con un cliente elegido, el texto es su nombre: no se busca hasta que el usuario lo cambie.
  const query = value && text === value.legalName ? "" : text.trim();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      apiGet<{ data: CustomerOption[] }>("/v1/parties", { role: "customer", ...(query && { search: query }) }).then(
        result => {
          if (cancelled) return;
          setOptions(result.data);
          setActive(0);
          setError(false);
          setLoading(false);
        },
        () => {
          if (cancelled) return;
          setOptions([]);
          setError(true);
          setLoading(false);
        }
      );
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (customer: CustomerOption) => {
    onChange(customer);
    setText(customer.legalName);
    setOpen(false);
  };

  return (
    <div className="customer-picker">
      <label className="invoice-search">
        {label}
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          value={text}
          placeholder="NIT, nombre o razón social"
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onChange={event => {
            setText(event.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onKeyDown={event => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive(index => Math.min(index + 1, options.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive(index => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && open && options[active]) {
              event.preventDefault();
              choose(options[active]!);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </label>
      {open && (
        <div className="invoice-options customer-picker-list" id={listId} role="listbox" ref={listRef}>
          {loading && !options.length && <p className="customer-picker-status">Buscando clientes…</p>}
          {error && <p className="customer-picker-status">No se pudieron consultar los clientes. Intenta de nuevo.</p>}
          {!loading && !error && !options.length && (
            <p className="customer-picker-status">
              {query ? `Ningún cliente se parece a «${query}».` : "Aún no hay clientes activos."} Créalo en Terceros.
            </p>
          )}
          {options.map((customer, index) => (
            <button
              type="button"
              key={customer.id}
              id={`${listId}-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === active}
              className={index === active ? "is-active" : undefined}
              onMouseEnter={() => setActive(index)}
              // mousedown en lugar de click: se elige antes de que el campo pierda el foco.
              onMouseDown={event => {
                event.preventDefault();
                choose(customer);
              }}
            >
              <b>{customer.legalName}</b>
              <small>
                NIT {nit(customer)}
                {customer.tradeName ? ` · ${customer.tradeName}` : ""} · {customer.email || "Sin correo"}
              </small>
            </button>
          ))}
          {!query && options.length > 0 && (
            <p className="customer-picker-status">Escribe para buscar por nombre, razón social o NIT.</p>
          )}
        </div>
      )}
    </div>
  );
}
