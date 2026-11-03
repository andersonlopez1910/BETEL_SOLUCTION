/**
 * Módulo "Reporte de facturación": barra horizontal con las nueve pestañas y el contenido de la activa.
 *
 * La pestaña activa va en la URL (?tab=ventas) para poder compartir el enlace y usar Atrás/Adelante.
 *
 * Datos reales: Ventas y Clientes consultan la API (/v1/reports/billing/*). Las demás pestañas
 * dependen de módulos que aún no existen en Betel (no hay tablas de pagos, cotizaciones, etc.)
 * y muestran ese estado en lugar de datos inventados. Ver docs/reporte-facturacion.md.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CustomersReport } from "./billing-report-customers";
import { SalesReport } from "./billing-report-sales";

/** [slug de la URL, nombre de la pestaña, módulo de origen que falta (si aplica)]. Orden y nombres definitivos. */
const reportTabs = [
  ["ventas", "Ventas", null],
  ["recaudos", "Recaudos", "Recaudos (pagos y abonos de facturas)"],
  [
    "gestion-cobro",
    "Gestión de cobro cartera Betel",
    "Gestión de cobro de cartera (cuentas por cobrar y gestiones de cobro)",
  ],
  ["cotizaciones", "Cotizaciones", "Cotizaciones"],
  ["remisiones", "Remisiones", "Remisiones"],
  ["facturas-recurrentes", "Facturas recurrentes", "Facturas recurrentes"],
  ["envio-masivo", "Envío masivo", "Envío masivo de documentos (registro de correos enviados)"],
  ["clientes", "Clientes", null],
  ["seguimiento-comercial", "Seguimiento comercial", "Seguimiento comercial (oportunidades y contactos)"],
] as const;

export function BillingReport() {
  const requested = useSearchParams().get("tab");
  const [slug, label, missingModule] = reportTabs.find(([tab]) => tab === requested) ?? reportTabs[0];
  return (
    <div className="page-content">
      <nav className="report-tabs" aria-label="Reportes de facturación">
        {reportTabs.map(([tab, name]) => (
          <Link
            key={tab}
            href={`/reportes/facturacion?tab=${tab}`}
            scroll={false}
            aria-current={tab === slug ? "page" : undefined}
            className={tab === slug ? "active" : undefined}
          >
            {name}
          </Link>
        ))}
      </nav>
      {slug === "ventas" && <SalesReport />}
      {slug === "clientes" && <CustomersReport />}
      {missingModule && <UnavailableReport name={label} module={missingModule} />}
    </div>
  );
}

/** Estado honesto de un reporte cuyo módulo de origen no existe todavía. */
function UnavailableReport({ name, module }: { name: string; module: string }) {
  return (
    <section className="panel report-unavailable">
      <h2>{name}: sin fuente de datos</h2>
      <p>
        Este reporte se alimenta del módulo de <b>{module}</b>, que todavía no existe en Betel. Para no mostrar
        información ficticia, no se presentan cifras ni filtros hasta que ese módulo registre datos.
      </p>
      <p>
        Cuando el módulo exista, el reporte se conectará aquí con los mismos filtros, indicadores y exportaciones de
        Ventas. El detalle está en <code>docs/reporte-facturacion.md</code>.
      </p>
    </section>
  );
}

/**
 * Documentos que se crearán desde la cabecera cuando exista su módulo. Ninguno tiene tablas ni
 * pantalla todavía (tareas 19, 20 y 24), así que sus opciones se muestran deshabilitadas y lo dicen,
 * en lugar de llevar a una pantalla vacía.
 */
const invoiceDocuments = ["Factura recurrente", "Nota crédito", "Nota débito", "Documento de ingreso"] as const;
const otherDocuments = ["Remisión", "Cotización"] as const;

/**
 * Botones de la cabecera del reporte: "Crear factura" abre la factura nueva y su flecha despliega los
 * demás documentos de venta; "Remisión y cotización" agrupa esos dos documentos.
 */
export function CreateDocumentActions() {
  return (
    <>
      <PendingDocumentMenu id="other-documents-menu" label="Crear remisión o cotización" documents={otherDocuments}>
        Remisión y cotización ⌄
      </PendingDocumentMenu>
      <div className="split-button">
        <Link href="/facturacion/nueva" className="primary">
          ＋ Crear factura
        </Link>
        <PendingDocumentMenu
          id="invoice-documents-menu"
          label="Otros documentos de venta"
          documents={invoiceDocuments}
          triggerClassName="primary split-toggle"
        >
          <span aria-hidden="true">⌄</span>
        </PendingDocumentMenu>
      </div>
    </>
  );
}

/** Botón con menú desplegable de documentos pendientes: animado, clic fuera o Escape cierran, flechas navegan. */
function PendingDocumentMenu({
  id,
  label,
  documents,
  triggerClassName = "secondary",
  children,
}: {
  id: string;
  label: string;
  documents: readonly string[];
  triggerClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const items = () => Array.from(anchorRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) anchorRef.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
  };

  // Al abrir se enfoca la primera opción; clic fuera o Escape cierran.
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && close(true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
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
      close();
    }
  };

  return (
    <div className="popover-anchor" ref={anchorRef}>
      <button
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {children}
      </button>
      <div
        id={id}
        role="menu"
        aria-label={label}
        className={`popover settings-menu create-document-menu${open ? " is-open" : ""}`}
        onKeyDown={onMenuKeyDown}
      >
        {documents.map(name => (
          <button type="button" role="menuitem" aria-disabled="true" tabIndex={-1} key={name}>
            {name}
            <small>Módulo pendiente: aún no se puede crear</small>
          </button>
        ))}
      </div>
    </div>
  );
}
