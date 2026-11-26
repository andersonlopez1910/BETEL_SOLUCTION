/**
 * "Ver factura recurrente" (GET /v1/recurring-invoices/:id): programación, ítems de la plantilla y las
 * facturas generadas. Permite activar o desactivar y generar ya la factura del período pendiente.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiPost } from "../lib/api";
import { date, invoiceStatusLabels, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { timesLabel } from "./billing-report-recurring";
import { frequencyLabels } from "./quote-form";

type RecurringDocument = {
  id: string;
  number: string;
  customer: { legalName: string; identificationType: string; identificationNumber: string; email: string | null };
  frequency: string;
  startDate: string;
  occurrences: number | null;
  generatedCount: number;
  nextRunDate: string | null;
  lastRunAt: string | null;
  active: boolean;
  paymentTerm: string;
  dueDays: number | null;
  currency: string;
  notes: string | null;
  createdBy: string | null;
  lines: {
    description: string;
    quantity: string;
    unitPrice: string;
    discountRate: string;
    taxRate: string;
    total: string;
  }[];
  totals: { label: string; value: string }[];
  runs: {
    periodDate: string;
    createdAt: string;
    invoice: { id: string; number: string; issueDate: string; status: string; total: string };
  }[];
};

export function RecurringDocumentView() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { company, canSalesDocs: canEdit } = useSession();
  const template = useReport<{ data: RecurringDocument }>(`/v1/recurring-invoices/${id}`);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(
    params.get("creada") ? { kind: "ok", text: "Factura recurrente guardada." } : null
  );
  const [busy, setBusy] = useState(false);
  const doc = template.data?.data;

  const run = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await apiPost(path, body);
      setNotice({ kind: "ok", text: done });
      template.reload();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-content">
      <div className="document-toolbar">
        <Link href="/reportes/facturacion?tab=facturas-recurrentes" className="report-link">
          ‹ Volver a Facturas recurrentes
        </Link>
        {doc && canEdit && (
          <div className="page-actions">
            <button
              type="button"
              className={doc.active ? "secondary danger" : "secondary"}
              disabled={busy}
              onClick={() =>
                run(
                  `/v1/recurring-invoices/${doc.id}/active`,
                  { active: !doc.active },
                  doc.active ? "Desactivada." : "Activada."
                )
              }
            >
              {doc.active ? "Desactivar" : "Activar"}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || !doc.active || !doc.nextRunDate}
              title={!doc.nextRunDate ? "Ya alcanzó el número de veces" : !doc.active ? "Está inactiva" : undefined}
              onClick={() =>
                run(`/v1/recurring-invoices/${doc.id}/generate`, {}, "Factura creada en borrador con la fecha de hoy.")
              }
            >
              Generar factura ahora
            </button>
          </div>
        )}
      </div>

      {notice && (
        <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
          {notice.text}
        </p>
      )}
      <ReportStatus loading={template.loading && !doc} error={template.error} />

      {doc && (
        <>
          <article className={`panel document-sheet${doc.active ? "" : " is-void"}`}>
            <header className="document-head">
              <div>
                <p className="eyebrow">{company}</p>
                <h2>Factura recurrente {doc.number}</h2>
                <p>
                  {frequencyLabels[doc.frequency]} desde el {date(doc.startDate)} · {timesLabel(doc)} facturas
                </p>
              </div>
              <div className="document-total">
                <span>Total por factura ({doc.currency})</span>
                <b>{money(doc.totals.at(-1)!.value)}</b>
                <span className={doc.active ? "pay-badge is-ok" : "pay-badge"}>
                  {doc.active ? "Activa" : "Inactiva"}
                </span>
              </div>
            </header>
            <dl className="document-meta">
              <div>
                <dt>Cliente</dt>
                <dd>
                  {doc.customer.legalName} · {doc.customer.identificationType} {doc.customer.identificationNumber}
                </dd>
              </div>
              <div>
                <dt>Próxima factura</dt>
                <dd>{doc.nextRunDate ? date(doc.nextRunDate) : "Finalizada (alcanzó el número de veces)"}</dd>
              </div>
              <div>
                <dt>Forma de pago</dt>
                <dd>{doc.paymentTerm === "CREDIT" ? `Crédito a ${doc.dueDays} días` : "Contado"}</dd>
              </div>
              {doc.createdBy && (
                <div>
                  <dt>Creada por</dt>
                  <dd>{doc.createdBy}</dd>
                </div>
              )}
              {doc.notes && (
                <div>
                  <dt>Observaciones</dt>
                  <dd>{doc.notes}</dd>
                </div>
              )}
            </dl>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Descripción</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Valor unitario</th>
                    <th className="num">Desc. %</th>
                    <th className="num">IVA %</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((line, index) => (
                    <tr key={index}>
                      <td>{line.description}</td>
                      <td className="num">{Number(line.quantity)}</td>
                      <td className="num">{money(line.unitPrice)}</td>
                      <td className="num">{Number(line.discountRate)} %</td>
                      <td className="num">{Number(line.taxRate)} %</td>
                      <td className="num">{money(line.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="document-totals">
              {doc.totals.map(item => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{money(item.value)}</dd>
                </div>
              ))}
            </dl>
          </article>

          <section className="panel report-table-panel">
            <div className="panel-head">
              <h2>Facturas generadas</h2>
              <span className="report-hint">Se crean en borrador con la fecha del día en que se generan.</span>
            </div>
            {doc.runs.length ? (
              <div className="report-table-wrap">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Período programado</th>
                      <th>Fecha de la factura</th>
                      <th>Factura</th>
                      <th>Estado</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.runs.map(run => (
                      <tr key={run.invoice.id}>
                        <td>{date(run.periodDate)}</td>
                        <td>{date(run.invoice.issueDate)}</td>
                        <td>{run.invoice.number}</td>
                        <td>{invoiceStatusLabels[run.invoice.status] ?? run.invoice.status}</td>
                        <td className="num">{money(run.invoice.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="report-message">Todavía no se ha generado ninguna factura.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
