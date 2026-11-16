/**
 * Módulo "Reporte de facturación": barra horizontal con las nueve pestañas y el contenido de la activa.
 *
 * La pestaña activa va en la URL (?tab=ventas) para poder compartir el enlace y usar Atrás/Adelante.
 *
 * Datos reales: Ventas, Recaudos y Clientes consultan la API (/v1/reports/billing/*). Las demás pestañas
 * dependen de módulos que aún no existen en Betel (no hay tablas de pagos, cotizaciones, etc.)
 * y muestran ese estado en lugar de datos inventados. Ver docs/reporte-facturacion.md.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ActionMenu, type ActionMenuItem } from "./action-menu";
import { CollectionsReport } from "./billing-report-collections";
import { CustomersReport } from "./billing-report-customers";
import { SalesReport } from "./billing-report-sales";

/** [slug de la URL, nombre de la pestaña, módulo de origen que falta (si aplica)]. Orden y nombres definitivos. */
const reportTabs = [
  ["ventas", "Ventas", null],
  ["recaudos", "Recaudos", null],
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
      {slug === "recaudos" && <CollectionsReport />}
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

const pending = (label: string): ActionMenuItem => ({
  label,
  disabled: true,
  note: "Módulo pendiente: aún no se puede crear",
});

/**
 * Documentos de la cabecera. Los que no tienen tablas ni pantalla todavía (tareas 20 y 24) se muestran
 * deshabilitados y lo dicen, en lugar de llevar a una pantalla vacía. El documento de ingreso es el
 * recibo de caja de Recaudos.
 */
const invoiceDocuments: ActionMenuItem[] = [
  pending("Factura recurrente"),
  pending("Nota crédito"),
  pending("Nota débito"),
  { label: "Documento de ingreso", href: "/recaudos/nuevo", note: "Recibo de caja" },
];
const otherDocuments: ActionMenuItem[] = [pending("Remisión"), pending("Cotización")];

/**
 * Botones de la cabecera del reporte: "Crear factura" abre la factura nueva y su flecha despliega los
 * demás documentos de venta; "Remisión y cotización" agrupa esos dos documentos.
 */
export function CreateDocumentActions() {
  return (
    <>
      <div className="split-button">
        <Link href="/facturacion/nueva" className="primary">
          ＋ Crear factura
        </Link>
        <ActionMenu label="Otros documentos de venta" items={invoiceDocuments} className="primary split-toggle">
          <span aria-hidden="true">⌄</span>
        </ActionMenu>
      </div>
      {/* Mismo aspecto de botón dividido, en blanco. Como no hay pantalla de destino, todo el botón abre el menú. */}
      <ActionMenu label="Crear remisión o cotización" items={otherDocuments} className="secondary split-secondary">
        <span>Remisión y cotización</span>
        <span className="split-caret" aria-hidden="true">
          ⌄
        </span>
      </ActionMenu>
    </>
  );
}
