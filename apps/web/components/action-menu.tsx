/**
 * Botón con menú desplegable (role="menu") para acciones: "Ver reportes", la flecha de
 * "Crear recibo de caja" y las acciones de cada fila de Recaudos.
 *
 * El menú usa posición fija calculada desde el botón, así no lo recorta el contenedor con
 * desplazamiento de la tabla. Se cierra con clic fuera, Escape, al desplazar la página o al elegir.
 * Flechas, Inicio y Fin recorren las opciones.
 */
"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

export type ActionMenuItem = {
  label: string;
  /** Acción al elegir; o `href` para navegar. */
  onSelect?: () => void;
  href?: string;
  /** Texto pequeño bajo la opción (p. ej. por qué está deshabilitada). */
  note?: string;
  disabled?: boolean;
  danger?: boolean;
};

export function ActionMenu({
  label,
  items,
  className = "secondary",
  children,
}: {
  /** Nombre accesible del botón y del menú. */
  label: string;
  items: ActionMenuItem[];
  className?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = position !== null;
  const options = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const close = (refocus = false) => {
    setPosition(null);
    if (refocus) buttonRef.current?.focus();
  };

  const toggle = () => {
    if (open) return close();
    const rect = buttonRef.current!.getBoundingClientRect();
    setPosition({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  };

  useEffect(() => {
    if (!open) return;
    options()[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && close(true);
    const onScroll = (event: Event) => !menuRef.current?.contains(event.target as Node) && close();
    const onResize = () => close();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const list = options();
    const current = list.indexOf(document.activeElement as HTMLElement);
    const next = {
      ArrowDown: (current + 1) % list.length,
      ArrowUp: (current - 1 + list.length) % list.length,
      Home: 0,
      End: list.length - 1,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      list[next]?.focus();
    } else if (event.key === "Tab") {
      close();
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
      >
        {children}
      </button>
      <div
        id={id}
        ref={menuRef}
        role="menu"
        aria-label={label}
        className={`popover settings-menu action-menu${open ? " is-open" : ""}`}
        style={position ? { position: "fixed", top: position.top, right: position.right } : undefined}
        onKeyDown={onMenuKeyDown}
      >
        {items.map(item => {
          const content = (
            <>
              {item.label}
              {item.note && <small>{item.note}</small>}
            </>
          );
          const className = item.danger ? "is-danger" : undefined;
          if (item.href && !item.disabled)
            return (
              <Link role="menuitem" href={item.href} key={item.label} className={className} onClick={() => close()}>
                {content}
              </Link>
            );
          return (
            <button
              type="button"
              role="menuitem"
              key={item.label}
              className={className}
              aria-disabled={item.disabled || undefined}
              tabIndex={-1}
              onClick={() => {
                if (item.disabled) return;
                close();
                item.onSelect?.();
              }}
            >
              {content}
            </button>
          );
        })}
      </div>
    </>
  );
}
