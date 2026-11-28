"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppShell } from "../../../components/app-shell";
import { Icon, type IconName } from "../../../components/brand";

type Setting = { title: string; description: string; icon: IconName; href?: string; state: "Disponible" | "Requiere configuración" | "Próximamente" };
type Section = { label: string; icon: IconName; intro: string; groups: { title: string; items: Setting[] }[] };
const sections: Section[] = [
  { label: "Organización", icon: "building", intro: "Base legal, usuarios y permisos.", groups: [{ title: "Organización", items: [
    { title: "Perfil de la organización", description: "Datos legales y generales de tu empresa.", icon: "building", href: "/configuracion/organizacion", state: "Disponible" },
    { title: "Usuarios y permisos", description: "Accesos, roles y responsabilidades.", icon: "users", href: "/configuracion/usuarios", state: "Disponible" },
  ] }] },
  { label: "DIAN y documentos", icon: "document", intro: "Configura la emisión y seguimiento de documentos electrónicos.", groups: [{ title: "Documentos electrónicos", items: [
    { title: "Facturación electrónica", description: "Ambiente y datos de transmisión.", icon: "filePlus", href: "/facturacion/nueva", state: "Requiere configuración" },
    { title: "Numeración y resoluciones", description: "Prefijos, rangos y vigencias.", icon: "list", state: "Próximamente" },
    { title: "Certificado digital", description: "Vigencia y diagnóstico de firma.", icon: "account", state: "Próximamente" },
    { title: "Documento soporte", description: "Configuración electrónica de compras.", icon: "receipt", href: "/compras", state: "Disponible" },
    { title: "Documento equivalente POS", description: "Resolución, rango y datos de la tirilla.", icon: "receipt", href: "/configuracion/pos", state: "Disponible" },
  ] }] },
  { label: "Ventas", icon: "filePlus", intro: "Preferencias comerciales y documentos de venta.", groups: [{ title: "Operación comercial", items: [
    { title: "Facturación", description: "Series, preferencias y documentos de venta.", icon: "filePlus", href: "/facturacion/nueva", state: "Disponible" },
    { title: "Cotizaciones y remisiones", description: "Documentos previos a la venta.", icon: "document", href: "/cotizaciones", state: "Disponible" },
    { title: "Facturación recurrente", description: "Plantillas y automatización.", icon: "calendar", href: "/facturas-recurrentes", state: "Disponible" },
  ] }] },
  { label: "Compras", icon: "bag", intro: "Configura compras, gastos y proveedores.", groups: [{ title: "Compras y gastos", items: [
    { title: "Compras y gastos", description: "Preferencias de registro y documentos.", icon: "bag", href: "/compras", state: "Disponible" },
    { title: "Proveedores", description: "Cuentas por pagar y estados de cuenta.", icon: "users", href: "/compras?tab=proveedores", state: "Disponible" },
    { title: "Notas de ajuste", description: "Configuración de documentos de compra.", icon: "document", state: "Próximamente" },
  ] }] },
  { label: "Terceros", icon: "users", intro: "Datos fiscales y reglas para clientes y proveedores.", groups: [{ title: "Maestro de terceros", items: [
    { title: "Clientes y proveedores", description: "Registro y preferencias generales.", icon: "users", href: "/terceros/nuevo", state: "Disponible" },
    { title: "Datos fiscales", description: "Responsabilidades y validaciones.", icon: "account", state: "Próximamente" },
    { title: "Enriquecimiento inteligente", description: "Fuentes públicas para completar registros.", icon: "search", state: "Disponible" },
  ] }] },
  { label: "Productos e inventario", icon: "box", intro: "Catálogo, precios y control de existencias.", groups: [{ title: "Catálogo e inventario", items: [
    { title: "Productos y servicios", description: "Catálogo comercial y reglas tributarias.", icon: "box", href: "/productos", state: "Disponible" },
    { title: "Inventario", description: "Entradas, salidas y regularizaciones.", icon: "wallet", href: "/productos?tab=documentos", state: "Disponible" },
    { title: "Listas de precios", description: "Estrategias de precios comerciales.", icon: "coins", state: "Próximamente" },
  ] }] },
  { label: "Contabilidad", icon: "scale", intro: "Plan de cuentas y procesos contables de Betel.", groups: [{ title: "Estructura contable", items: [
    { title: "Plan de cuentas", description: "Cuentas contables y saldos acumulados.", icon: "scale", href: "/contabilidad?tab=cuentas", state: "Disponible" },
    { title: "Comprobantes", description: "Movimientos y procesos contables.", icon: "document", href: "/contabilidad?tab=procesos", state: "Disponible" },
    { title: "Parametrización automática", description: "Reglas de contabilización de Betel.", icon: "bars", state: "Próximamente" },
  ] }] },
  { label: "Integraciones e IA", icon: "gear", intro: "Amplía Betel con integraciones y asistencia controlada.", groups: [
    { title: "Integraciones", items: [
      { title: "API Betel", description: "Llaves y conexiones de integración.", icon: "account", state: "Próximamente" },
      { title: "Pasarelas de pago", description: "Servicios de recaudo compatibles.", icon: "wallet", state: "Próximamente" },
      { title: "Webhooks", description: "Eventos para servicios conectados.", icon: "bars", state: "Próximamente" },
    ] },
    { title: "Herramientas IA", items: [
      { title: "Asistente Betel IA", description: "Análisis guiado de información empresarial.", icon: "search", state: "Próximamente" },
      { title: "Autocompletar terceros", description: "Consulta fuentes autorizadas al registrar terceros.", icon: "users", href: "/terceros/nuevo", state: "Disponible" },
      { title: "Clasificación contable inteligente", description: "Sugerencias sujetas a confirmación.", icon: "scale", state: "Próximamente" },
      { title: "Asistente tributario", description: "Alertas, no reemplaza al profesional contable.", icon: "document", state: "Próximamente" },
    ] },
  ] },
];

export default function Settings() {
  const [selected, setSelected] = useState(sections[0]!.label);
  const [query, setQuery] = useState("");
  const current = sections.find(section => section.label === selected)!;
  const displayed = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es");
    if (!term) return current.groups;
    return sections.flatMap(section => section.groups.map(group => ({ ...group, title: `${section.label} · ${group.title}`, items: group.items.filter(item => `${item.title} ${item.description}`.toLocaleLowerCase("es").includes(term)) }))).filter(group => group.items.length);
  }, [current, query]);
  return <AppShell title="Centro de configuración" subtitle="Administra la operación, documentos, automatizaciones e integraciones de tu organización.">
    <div className="page-content settings-center">
      <header className="settings-center-head"><div><p className="eyebrow">BETEL CONTROL CENTER</p><h2>{query ? "Resultados de configuración" : current.label}</h2><p>{query ? "Accesos encontrados en toda la configuración." : current.intro}</p></div><label><Icon name="search" size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar DIAN, usuarios, impuestos, productos…" aria-label="Buscar configuración" /></label></header>
      <div className="settings-center-layout"><nav className="settings-navigation" aria-label="Categorías de configuración">{sections.map(section => <button key={section.label} className={section.label === selected && !query ? "active" : ""} onClick={() => { setSelected(section.label); setQuery(""); }}><Icon name={section.icon} size={18} /> {section.label}</button>)}</nav>
        <section className="settings-cards">{displayed.map(group => <div key={group.title} className="settings-card-group"><h3>{group.title}</h3><div>{group.items.map(item => <SettingCard item={item} key={item.title} />)}</div></div>)}</section>
      </div>
    </div>
  </AppShell>;
}
function SettingCard({ item }: { item: Setting }) {
  const content = <><span className="settings-card-icon"><Icon name={item.icon} size={21} /></span><span><b>{item.title}</b><small>{item.description}</small><em className={item.state === "Disponible" ? "available" : item.state === "Requiere configuración" ? "needs-setup" : ""}>{item.state}</em></span><i>→</i></>;
  return item.href ? <Link className="settings-card" href={item.href}>{content}</Link> : <article className="settings-card">{content}</article>;
}
