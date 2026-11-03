/**
 * Estructura común de todas las pantallas internas: barra lateral, barra superior y encabezado.
 *
 * Uso en una página:
 *   <AppShell title="Terceros" subtitle="Crea clientes y proveedores">...contenido...</AppShell>
 *
 * Para agregar un módulo al menú, añadir una fila a `mainNav` ([ícono, texto, ruta]).
 *
 * ESTADO ACTUAL: el nombre del usuario ("Camila Morales"), la empresa y las notificaciones son
 * datos de ejemplo fijos. PENDIENTE: obtenerlos de GET /v1/me y GET /v1/notifications.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Desplegables de la barra superior. Solo uno puede estar abierto a la vez. */
type TopMenu = "notifications" | "settings" | "profile";

/** Menú lateral: [ícono, etiqueta, ruta]. */
const mainNav = [
  ["⌂", "Resumen", "/resumen"],
  ["▤", "Ventas", "/facturacion/nueva"],
  ["▥", "Reporte de facturación", "/reportes/facturacion"],
  ["▣", "Documento soporte", "/documentos-soporte/nuevo"],
  ["♧", "Terceros", "/terceros/nuevo"],
  ["◫", "Calendario", "/calendario"],
  ["◈", "Cuenta", "/cuenta"],
] as const;

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname(); // Ruta actual, para resaltar el ítem activo del menú.
  // Qué menú desplegable está abierto (null = ninguno).
  const [openMenu, setOpenMenu] = useState<TopMenu | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const toggle = (menu: TopMenu) => setOpenMenu(current => (current === menu ? null : menu));
  const close = () => setOpenMenu(null);

  // Cerrar al cambiar de ruta (p. ej. tras elegir una opción del menú).
  useEffect(close, [pathname]);

  // Cerrar con clic fuera del desplegable o con Escape (en ese caso el foco vuelve al botón).
  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const anchor = (event.target as Element).closest(".popover-anchor");
      if (!anchor || !actionsRef.current?.contains(anchor)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      actionsRef.current?.querySelector<HTMLElement>(`[aria-controls="${openMenu}-menu"]`)?.focus();
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  return (
    <div className="app-shell">
      {/* ── Barra lateral ── */}
      <aside className="sidebar">
        <Link className="brand" href="/resumen">
          B<span>e</span>tel
        </Link>
        <nav>
          {mainNav.map(([icon, label, href]) => (
            // OBSERVACIÓN (bug conocido): para rutas distintas de /resumen se compara contra
            // "facturacion" (sin "/"), y como pathname empieza por "/" nunca coincide; por eso solo
            // "Resumen" se resalta. Corrección sugerida: pathname.startsWith("/" + href.split("/")[1]).
            <Link
              className={
                pathname.startsWith(href.split("/")[1] === "resumen" ? "/resumen" : href.split("/")[1])
                  ? "nav-link active"
                  : "nav-link"
              }
              href={href}
              key={href}
            >
              <i>{icon}</i>
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" /> DIAN en pruebas
        </div>
      </aside>
      <main className="main-area">
        {/* ── Barra superior ── */}
        <header className="topbar">
          <div className="company">
            <strong>Betel Solution</strong>
            <span>Soluciones empresariales S.A.S.</span>
          </div>
          <div className="top-actions" ref={actionsRef}>
            <button className="icon-button" aria-label="Buscar">
              ⌕
            </button>
            <Link href="/facturacion/nueva" className="create-button">
              ＋ Crear
            </Link>
            <button className="help-button">Ayuda⌄</button>
            <div className="popover-anchor">
              <button
                onClick={() => toggle("notifications")}
                className="icon-button notification"
                aria-label="Notificaciones"
                aria-expanded={openMenu === "notifications"}
                aria-controls="notifications-menu"
              >
                ♟<b />
              </button>
              <Notifications open={openMenu === "notifications"} onClose={close} />
            </div>
            <div className="popover-anchor">
              <button
                onClick={() => toggle("settings")}
                className="icon-button"
                aria-label="Ajustes"
                aria-haspopup="menu"
                aria-expanded={openMenu === "settings"}
                aria-controls="settings-menu"
              >
                ⚙
              </button>
              <SettingsMenu open={openMenu === "settings"} onClose={close} />
            </div>
            <div className="popover-anchor">
              <button
                onClick={() => toggle("profile")}
                className="avatar"
                aria-label="Abrir perfil"
                aria-expanded={openMenu === "profile"}
                aria-controls="profile-menu"
              >
                CM
              </button>
              <ProfileMenu open={openMenu === "profile"} />
            </div>
          </div>
        </header>
        {/* ── Título de la página ── */}
        <section className="page-head">
          <div>
            <p className="eyebrow">OPERACIÓN · COLOMBIA</p>
            <h1>{title}</h1>
            {subtitle && <p className="subtitle">{subtitle}</p>}
          </div>
        </section>
        {children}
      </main>
    </div>
  );
}

/**
 * Los desplegables siempre están montados; `open` solo alterna la clase `is-open`, lo que permite
 * animar tanto la apertura como el cierre. Cerrados quedan con `visibility: hidden`, así que no
 * reciben foco ni los anuncian los lectores de pantalla.
 */
const popoverClass = (open: boolean, extra: string) => `popover ${extra}${open ? " is-open" : ""}`;

/** Desplegable de notificaciones (datos de ejemplo). */
function Notifications({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = [
    "La factura FV-4-1594 fue aprobada por DIAN",
    "Tu vencimiento de resolución está próximo",
    "CEMENTERIO SAN BONIFACIO leyó la factura FV-4-1585",
    "El documento soporte DS-00042 fue aceptado",
  ];
  return (
    <div id="notifications-menu" className={popoverClass(open, "notifications")}>
      <div className="popover-title">
        Notificaciones
        <button onClick={onClose} aria-label="Cerrar notificaciones">
          ×
        </button>
      </div>
      {items.map((item, i) => (
        <div className="notification-row" key={item}>
          <span className={i === 1 ? "amber" : "red"} />
          <div>
            {item}
            <small>{i + 2} horas</small>
          </div>
        </div>
      ))}
      <Link href="/notificaciones">Ver todas las notificaciones</Link>
    </div>
  );
}

/**
 * Menú del engranaje (patrón "menu button" de WAI-ARIA): al abrirse enfoca la primera opción y se
 * recorre con ↑/↓, Inicio y Fin. Tab lo cierra y deja seguir la navegación normal.
 * Para agregar una opción, añadir una fila a `settingsItems` ([ícono, texto, ruta]).
 */
const settingsItems = [["⚙", "Configuración", "/configuracion"]] as const;

function SettingsMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const list = items();
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
      onClose();
    }
  };

  return (
    <div
      id="settings-menu"
      ref={menuRef}
      role="menu"
      aria-label="Ajustes"
      className={popoverClass(open, "settings-menu")}
      onKeyDown={onKeyDown}
    >
      <p className="popover-label">Ajustes</p>
      {settingsItems.map(([icon, label, href]) => (
        <Link role="menuitem" href={href} key={href} onClick={onClose}>
          <i aria-hidden="true">{icon}</i>
          {label}
        </Link>
      ))}
    </div>
  );
}

/** Menú del perfil de usuario (datos de ejemplo). PENDIENTE: "Cerrar sesión" real. */
function ProfileMenu({ open }: { open: boolean }) {
  return (
    <div id="profile-menu" className={popoverClass(open, "profile-menu")}>
      <strong>Camila Morales</strong>
      <small>camila@betel.co</small>
      <em>Plan Profesional</em>
      <Link href="/perfil">● Mi perfil</Link>
      <Link href="/cuenta">▣ Cuenta</Link>
      <Link href="/calendario">▦ Calendario</Link>
      <button>⇥ Cerrar sesión</button>
    </div>
  );
}
