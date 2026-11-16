/**
 * "Ver documento" de Recaudos: factura o recibo de caja (GET /v1/collections/document?type=&id=).
 * Muestra el detalle, permite imprimir / guardar como PDF, enviar por correo y (recibos) anular,
 * y lista el historial de envíos por correo.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { longDate } from "./billing-report-collections";
import { SendEmailDialog, sendDocumentEmail, VoidReceiptDialog } from "./collection-dialogs";

type CollectionDocument = {
  type: "Invoice" | "CashReceipt";
  id: string;
  number: string;
  title: string;
  date: string;
  status: string;
  customer: { legalName: string; identificationType: string; identificationNumber: string; email: string | null };
  total: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  voidReason: string | null;
  createdBy: string | null;
  lines: {
    description: string;
    quantity: string | null;
    unitPrice: string | null;
    taxRate: string | null;
    total: string;
  }[];
  totals: { label: string; value: string }[];
  emails: {
    recipient: string;
    status: string;
    error: string | null;
    createdAt: string;
    sentBy: { displayName: string } | null;
  }[];
};

export function CollectionDocumentView() {
  const params = useSearchParams();
  const type = params.get("type") ?? "";
  const id = params.get("id") ?? "";
  const { company, canEmail, canReceive } = useSession();
  const document = useReport<{ data: CollectionDocument }>("/v1/collections/document", { type, id });
  const [dialog, setDialog] = useState<"email" | "void" | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(
    params.get("creado") ? { kind: "ok", text: "Recibo de caja guardado." } : null
  );
  const [sending, setSending] = useState(false);
  const doc = document.data?.data;
  const isReceipt = doc?.type === "CashReceipt";
  const isVoid = doc?.status === "VOID";

  const send = async () => {
    if (!doc) return;
    setSending(true);
    setNotice(null);
    try {
      const result = await sendDocumentEmail(doc);
      setNotice({ kind: "ok", text: `Enviado a ${result.data.recipient}.` });
      document.reload();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page-content">
      <div className="document-toolbar">
        <Link href="/reportes/facturacion?tab=recaudos" className="report-link">
          ‹ Volver a Recaudos
        </Link>
        {doc && (
          <div className="page-actions">
            <button type="button" className="secondary" onClick={() => window.print()}>
              Imprimir / PDF
            </button>
            {canEmail && (
              <>
                <button type="button" className="secondary" onClick={() => setDialog("email")}>
                  Enviar a otro correo
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={send}
                  disabled={sending || !doc.customer.email}
                  title={doc.customer.email ? `Enviar a ${doc.customer.email}` : "El cliente no tiene correo"}
                >
                  {sending ? "Enviando…" : "Enviar por correo"}
                </button>
              </>
            )}
            {isReceipt && canReceive && !isVoid && (
              <button type="button" className="secondary danger" onClick={() => setDialog("void")}>
                Anular
              </button>
            )}
          </div>
        )}
      </div>

      {notice && (
        <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
          {notice.text}
        </p>
      )}
      <ReportStatus loading={document.loading && !doc} error={document.error} />

      {doc && (
        <>
          <article className={`panel document-sheet${isVoid ? " is-void" : ""}`}>
            <header className="document-head">
              <div>
                <p className="eyebrow">{company}</p>
                <h2>
                  {doc.title} {doc.number}
                </h2>
                <p>{longDate(doc.date)}</p>
              </div>
              <div className="document-total">
                <span>{isReceipt ? "Total recibido" : "Total"}</span>
                <b>{money(doc.total)}</b>
                {isVoid && <strong className="document-void">ANULADO</strong>}
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
                <dt>Correo del cliente</dt>
                <dd>{doc.customer.email ?? "Sin correo registrado"}</dd>
              </div>
              {doc.method && (
                <div>
                  <dt>Medio de pago</dt>
                  <dd>
                    {doc.method}
                    {doc.reference ? ` · Ref. ${doc.reference}` : ""}
                  </dd>
                </div>
              )}
              {doc.createdBy && (
                <div>
                  <dt>Elaborado por</dt>
                  <dd>{doc.createdBy}</dd>
                </div>
              )}
              {doc.voidReason && (
                <div>
                  <dt>Motivo de anulación</dt>
                  <dd>{doc.voidReason}</dd>
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
                    {!isReceipt && (
                      <>
                        <th className="num">Cantidad</th>
                        <th className="num">Valor unitario</th>
                        <th className="num">IVA</th>
                      </>
                    )}
                    <th className="num">{isReceipt ? "Valor abonado" : "Total"}</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((line, index) => (
                    <tr key={index}>
                      <td>{line.description}</td>
                      {!isReceipt && (
                        <>
                          <td className="num">{line.quantity}</td>
                          <td className="num">{line.unitPrice && money(line.unitPrice)}</td>
                          <td className="num">{line.taxRate} %</td>
                        </>
                      )}
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

          <section className="panel report-table-panel document-emails">
            <div className="panel-head">
              <h2>Envíos por correo</h2>
            </div>
            {doc.emails.length ? (
              <ul>
                {doc.emails.map((email, index) => (
                  <li key={index}>
                    <span className={email.status === "SENT" ? "email-badge is-sent" : "email-badge is-failed"}>
                      {email.status === "SENT" ? "Enviado" : "Falló"}
                    </span>
                    {email.recipient} · {new Date(email.createdAt).toLocaleString("es-CO")}
                    {email.sentBy && ` · ${email.sentBy.displayName}`}
                    {email.error && <small> · {email.error}</small>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="report-message">Este documento no se ha enviado por correo.</p>
            )}
          </section>
        </>
      )}

      {doc && dialog === "email" && (
        <SendEmailDialog
          document={{ type: doc.type, id: doc.id, number: doc.number, customerEmail: doc.customer.email }}
          onClose={() => setDialog(null)}
          onSent={recipient => {
            setDialog(null);
            setNotice({ kind: "ok", text: `Enviado a ${recipient}.` });
            document.reload();
          }}
        />
      )}
      {doc && dialog === "void" && (
        <VoidReceiptDialog
          receipt={{ id: doc.id, number: doc.number }}
          onClose={() => setDialog(null)}
          onVoided={() => {
            setDialog(null);
            setNotice({ kind: "ok", text: `Recibo ${doc.number} anulado.` });
            document.reload();
          }}
        />
      )}
    </div>
  );
}
