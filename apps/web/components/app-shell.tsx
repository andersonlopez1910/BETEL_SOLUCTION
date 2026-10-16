"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const mainNav = [
  ["⌂", "Resumen", "/resumen"], ["▤", "Facturación", "/facturacion/nueva"], ["▣", "Documento soporte", "/documentos-soporte/nuevo"],
  ["♧", "Terceros", "/terceros/nuevo"], ["◫", "Calendario", "/calendario"], ["⚙", "Configuración", "/configuracion"], ["◈", "Cuenta", "/cuenta"]
] as const;

export function AppShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const pathname = usePathname(); const [notifications, setNotifications] = useState(false); const [profile, setProfile] = useState(false);
  return <div className="app-shell">
    <aside className="sidebar"><Link className="brand" href="/resumen">B<span>e</span>tel</Link>
      <nav>{mainNav.map(([icon, label, href]) => <Link className={pathname.startsWith(href.split("/")[1] === "resumen" ? "/resumen" : href.split("/")[1]) ? "nav-link active" : "nav-link"} href={href} key={href}><i>{icon}</i><span>{label}</span></Link>)}</nav>
      <div className="sidebar-foot"><span className="status-dot"/> DIAN en pruebas</div>
    </aside>
    <main className="main-area"><header className="topbar"><div className="company"><strong>Betel Solution</strong><span>Soluciones empresariales S.A.S.</span></div><div className="top-actions"><button className="icon-button" aria-label="Buscar">⌕</button><Link href="/facturacion/nueva" className="create-button">＋ Crear</Link><button className="help-button">Ayuda⌄</button><div className="popover-anchor"><button onClick={() => setNotifications(!notifications)} className="icon-button notification" aria-label="Notificaciones">♟<b/></button>{notifications && <Notifications />}</div><Link href="/configuracion" className="icon-button" aria-label="Configuración">⚙</Link><div className="popover-anchor"><button onClick={() => setProfile(!profile)} className="avatar" aria-label="Abrir perfil">CM</button>{profile && <ProfileMenu />}</div></div></header>
      <section className="page-head"><div><p className="eyebrow">OPERACIÓN · COLOMBIA</p><h1>{title}</h1>{subtitle && <p className="subtitle">{subtitle}</p>}</div></section>{children}
    </main>
  </div>;
}

function Notifications() { const items = ["La factura FV-4-1594 fue aprobada por DIAN", "Tu vencimiento de resolución está próximo", "CEMENTERIO SAN BONIFACIO leyó la factura FV-4-1585", "El documento soporte DS-00042 fue aceptado"]; return <div className="popover notifications"><div className="popover-title">Notificaciones <button>×</button></div>{items.map((item, i) => <div className="notification-row" key={item}><span className={i === 1 ? "amber" : "red"}/><div>{item}<small>{i + 2} horas</small></div></div>)}<Link href="/notificaciones">Ver todas las notificaciones</Link></div> }
function ProfileMenu() { return <div className="popover profile-menu"><strong>Camila Morales</strong><small>camila@betel.co</small><em>Plan Profesional</em><Link href="/perfil">● Mi perfil</Link><Link href="/cuenta">▣ Cuenta</Link><Link href="/calendario">▦ Calendario</Link><button>⇥ Cerrar sesión</button></div> }
