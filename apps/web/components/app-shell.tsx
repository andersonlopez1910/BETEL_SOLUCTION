/**
 * Estructura común de todas las pantallas internas: barra lateral, barra superior y encabezado.
 *
 * Uso en una página:
 *   <AppShell title="Terceros" subtitle="Crea clientes y proveedores">...contenido...</AppShell>
 *
 * Para agregar un módulo al menú, añadir una fila a `mainNav` (ícono, texto, ruta y rutas que lo resaltan).
 *
 * La empresa de la barra superior sale de GET /v1/me (nombre y NIT). ESTADO ACTUAL: el nombre del
 * usuario ("Camila Morales") y las notificaciones siguen siendo datos de ejemplo fijos.
 * PENDIENTE: obtenerlos de GET /v1/me y GET /v1/notifications.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiGet } from "../lib/api";
import { BrandMark, Icon, type IconName } from "./brand";

/** Desplegables de la barra superior. Solo uno puede estar abierto a la vez. */
type TopMenu = "create" | "notifications" | "profile";

/**
 * Menú lateral. `match`: prefijos de ruta que resaltan el ítem (incluye las pantallas que dependen de él); un
 * prefijo terminado en "$" debe coincidir exacto (p. ej. "/reportes$" es solo el centro de reportes).
 */
const mainNav: { icon: IconName; label: string; href: string; match: string[] }[] = [
  { icon: "home", label: "Inicio", href: "/inicio", match: ["/inicio", "/resumen"] },
  {
    icon: "report",
    label: "Reporte de facturación",
    href: "/reportes/facturacion",
    match: [
      "/reportes/facturacion",
      "/facturacion",
      "/recaudos",
      "/cotizaciones",
      "/remisiones",
      "/facturas-recurrentes",
      "/envio-masivo",
    ],
  },
  { icon: "bag", label: "Compras y gastos", href: "/compras", match: ["/compras", "/documentos-soporte"] },
  { icon: "box", label: "Productos y servicios", href: "/productos", match: ["/productos"] },
  { icon: "wallet", label: "Cajas y bancos", href: "/bancos", match: ["/bancos"] },
  { icon: "idcard", label: "Nómina", href: "/nomina", match: ["/nomina"] },
  { icon: "scale", label: "Contabilidad", href: "/contabilidad", match: ["/contabilidad"] },
  {
    icon: "pie",
    label: "Reportes",
    href: "/reportes",
    match: ["/reportes$", "/reportes/estado-de-resultados", "/reportes/situacion-financiera", "/reportes/ver"],
  },
  { icon: "users", label: "Terceros", href: "/terceros/nuevo", match: ["/terceros"] },
  { icon: "calendar", label: "Calendario", href: "/calendario", match: ["/calendario"] },
  { icon: "gear", label: "Configuración", href: "/configuracion", match: ["/configuracion"] },
  { icon: "account", label: "Cuenta", href: "/cuenta", match: ["/cuenta"] },
];

type Organization = { legalName: string; nit: string };

/** Empresa de la sesión (GET /v1/me). Sin API disponible queda null y se muestra el nombre del producto. */
function useOrganization() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiGet<{ organization: Organization }>("/v1/me").then(
      me => !cancelled && setOrganization(me.organization),
      () => undefined
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return organization;
}

export function AppShell({
  title,
  subtitle,
  headClassName,
  actions,
  children,
}: {
  /** Texto o contenido (p. ej. con una parte resaltada). */
  title: React.ReactNode;
  subtitle?: string;
  /** Clase extra del encabezado (p. ej. "page-head-welcome" en el tablero). */
  headClassName?: string;
  /** Botones propios de la página, a la derecha del título. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname(); // Ruta actual, para resaltar el ítem activo del menú.
  const organization = useOrganization();
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
        <Link className="brand" href="/inicio" aria-label="Betel Solution, ir al inicio">
          {/* La B del logo es la inicial de "BETEL": se lee [B]ETEL Solution. */}
          <BrandMark size={40} />
          <span>
            <b>ETEL</b> Solution
          </span>
        </Link>
        <p className="brand-caption">Gestión contable,<br />fiscal y financiera</p>
        <nav aria-label="Menú principal">
          {mainNav.map(item => {
            const active = item.match.some(prefix =>
              prefix.endsWith("$") ? pathname.replace(/\/$/, "") === prefix.slice(0, -1) : pathname.startsWith(prefix)
            );
            return (
              <Link
                className={active ? "nav-link active" : "nav-link"}
                aria-current={active ? "page" : undefined}
                href={item.href}
                key={item.href}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" /> DIAN en pruebas
        </div>
      </aside>
      <main className="main-area">
        {/* ── Barra superior ── */}
        <header className="topbar">
          <div className="company">
            <span className="company-icon">
              <Icon name="building" size={18} />
            </span>
            <span>
              <strong>{organization?.legalName ?? "Betel Solution"}</strong>
              <small>
                {organization ? `NIT ${organization.nit}` : "Contabilidad inteligente para decisiones claras"}
              </small>
            </span>
          </div>
          <div className="top-actions" ref={actionsRef}>
            <div className="popover-anchor">
              <button className="create-button" onClick={() => toggle("create")} aria-expanded={openMenu === "create"} aria-controls="create-menu">
                <Icon name="plus" size={16} /> Nueva operación
              </button>
              <NewOperationMenu open={openMenu === "create"} onClose={close} />
            </div>
            <span className="dian-status"><i /> DIAN conectada</span>
            <button className="help-button">Ayuda⌄</button>
            <div className="popover-anchor">
              <button
                onClick={() => toggle("notifications")}
                className="icon-button notification"
                aria-label="Notificaciones"
                aria-expanded={openMenu === "notifications"}
                aria-controls="notifications-menu"
              >
                <Icon name="bell" />
                <b />
              </button>
              <Notifications open={openMenu === "notifications"} onClose={close} />
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
        <section className={headClassName ? `page-head ${headClassName}` : "page-head"}>
          <div>
            <p className="eyebrow">OPERACIÓN · COLOMBIA</p>
            <h1>{title}</h1>
            {subtitle && <p className="subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="page-actions">{actions}</div>}
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

const newOperations: { icon: IconName; title: string; description: string; href: string }[] = [
  { icon: "filePlus", title: "Factura de venta", description: "Crea y envía una factura electrónica", href: "/facturacion/nueva" },
  { icon: "users", title: "Tercero", description: "Registra un cliente o proveedor", href: "/terceros/nuevo" },
  { icon: "box", title: "Producto o servicio", description: "Crea un concepto para ventas o compras", href: "/productos?new=product" },
  { icon: "document", title: "Comprobante", description: "Registra un movimiento contable", href: "/contabilidad?tab=procesos" },
];

function NewOperationMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
  useEffect(() => { if (open) items()[0]?.focus(); }, [open]);
  const onKeyDown = (event: React.KeyboardEvent) => {
    const options = items();
    const index = options.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
    } else if (event.key === "Escape") onClose();
  };
  return <div id="create-menu" ref={menuRef} role="menu" aria-label="Nueva operación" className={popoverClass(open, "new-operation-menu")} onKeyDown={onKeyDown}>
    <header><span>Nueva operación</span><small>Crea rápidamente</small></header>
    {newOperations.map(operation => <Link role="menuitem" href={operation.href} key={operation.title} onClick={onClose}>
      <i><Icon name={operation.icon} size={21} /></i><span><b>{operation.title}</b><small>{operation.description}</small></span><em>→</em>
    </Link>)}
  </div>;
}

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
