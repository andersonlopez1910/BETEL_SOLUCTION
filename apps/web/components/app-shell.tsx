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
import { useState } from "react";

/** Menú lateral: [ícono, etiqueta, ruta]. */
const mainNav = [
  ["⌂", "Resumen", "/resumen"],
  ["▤", "Facturación", "/facturacion/nueva"],
  ["▣", "Documento soporte", "/documentos-soporte/nuevo"],
  ["♧", "Terceros", "/terceros/nuevo"],
  ["◫", "Calendario", "/calendario"],
  ["⚙", "Configuración", "/configuracion"],
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
  // Qué menú desplegable está abierto (notificaciones o perfil).
  const [notifications, setNotifications] = useState(false);
  const [profile, setProfile] = useState(false);
  return (
    <div className="app-shell">
      {/* ── Barra lateral ── */}
      <aside className="sidebar">
        <Link className="brand" href="/resumen">
          B<span>e</span>tel
        </Link>
        <nav>
          {mainNav.map(([icon, label, href]) => (
            <Link
              className={isActiveSection(pathname, href) ? "nav-link active" : "nav-link"}
              aria-current={isActiveSection(pathname, href) ? "page" : undefined}
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
          <div className="top-actions">
            <button className="icon-button" aria-label="Buscar">
              ⌕
            </button>
            <Link href="/facturacion/nueva" className="create-button">
              ＋ Crear
            </Link>
            <button className="help-button">Ayuda⌄</button>
            <div className="popover-anchor">
              <button
                onClick={() => setNotifications(!notifications)}
                className="icon-button notification"
                aria-label="Notificaciones"
              >
                ♟<b />
              </button>
              {notifications && <Notifications />}
            </div>
            <Link href="/configuracion" className="icon-button" aria-label="Configuración">
              ⚙
            </Link>
            <div className="popover-anchor">
              <button onClick={() => setProfile(!profile)} className="avatar" aria-label="Abrir perfil">
                CM
              </button>
              {profile && <ProfileMenu />}
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
 * Indica si el ítem del menú corresponde a la sección en la que está el usuario.
 *
 * Se compara solo el PRIMER segmento de la ruta, para que el ítem quede activo también en
 * las subpáginas de su módulo. Ejemplo: el ítem "/facturacion/nueva" queda activo en
 * "/facturacion/nueva" y también en "/facturacion/123".
 *
 * Corrige el bug de la tarea #1: antes se comparaba "facturacion" (sin "/") contra el pathname,
 * que siempre empieza por "/", y solo se resaltaba "Resumen".
 */
export function isActiveSection(pathname: string, href: string): boolean {
  const section = "/" + href.split("/")[1]; // "/facturacion/nueva" → "/facturacion"
  return pathname === section || pathname.startsWith(section + "/");
}

/** Desplegable de notificaciones (datos de ejemplo). */
function Notifications() {
  const items = [
    "La factura FV-4-1594 fue aprobada por DIAN",
    "Tu vencimiento de resolución está próximo",
    "CEMENTERIO SAN BONIFACIO leyó la factura FV-4-1585",
    "El documento soporte DS-00042 fue aceptado",
  ];
  return (
    <div className="popover notifications">
      <div className="popover-title">
        Notificaciones <button>×</button>
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

/** Menú del perfil de usuario (datos de ejemplo). PENDIENTE: "Cerrar sesión" real. */
function ProfileMenu() {
  return (
    <div className="popover profile-menu">
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
