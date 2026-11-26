/**
 * "Ver cotización" (GET /v1/quotes/:id) y "Ver remisión" (GET /v1/deliveries/:id): detalle imprimible
 * con acciones para enviar por correo,
 * convertir en factura en borrador y anular, más el historial de envíos.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiPost } from "../lib/api";
import { date, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { quoteBadge, quoteStatusLabels } from "./billing-report-quotes";
import { SendEmailDialog, VoidDocumentDialog } from "./collection-dialogs";
import { ConvertQuoteDialog } from "./quote-dialogs";
import { deliveryTypeLabels } from "./quote-form";

type QuoteDocument = {
  id: string;
  number: string;
  date: string;
  validUntil: string | null;
  transactionType?: string;
  status: string;
  currency: string;
  customer: { legalName: string; identificationType: string; identificationNumber: string; email: string | null };
  notes: string | null;
  voidReason: string | null;
  createdBy: string | null;
  invoice: { id: string; status: string } | null;
  lines: {
    description: string;
    quantity: string;
    unitPrice: string;
    discountRate: string;
    taxRate: string;
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

/** Diferencias entre cotización y remisión. */
const kinds = {
  quote: { api: "/v1/quotes", tab: "cotizaciones", back: "Cotizaciones", title: "Cotización", noun: "la cotización" },
  delivery: { api: "/v1/deliveries", tab: "remisiones", back: "Remisiones", title: "Remisión", noun: "la remisión" },
} as const;

export const QuoteDocumentView = () => <SalesDocumentView kind="quote" />;
export const DeliveryDocumentView = () => <SalesDocumentView kind="delivery" />;

function SalesDocumentView({ kind }: { kind: keyof typeof kinds }) {
  const config = kinds[kind];
  const Noun = config.noun.charAt(0).toUpperCase() + config.noun.slice(1);
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { company, canSalesDocs: canQuote } = useSession();
  const quote = useReport<{ data: QuoteDocument }>(`${config.api}/${id}`);
  const [dialog, setDialog] = useState<"email" | "void" | "convert" | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(
    params.get("creada") ? { kind: "ok", text: `${config.title} guardada.` } : null
  );
  const [sending, setSending] = useState(false);
  const doc = quote.data?.data;
  const open = doc?.status === "OPEN" || doc?.status === "EXPIRED";

  const done = (text: string) => {
    setDialog(null);
    setNotice({ kind: "ok", text });
    quote.reload();
  };
  const send = async () => {
    setSending(true);
    setNotice(null);
    try {
      const result = await apiPost<{ data: { recipient: string } }>(`${config.api}/${id}/email`);
      done(`Enviada a ${result.data.recipient}.`);
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page-content">
      <div className="document-toolbar">
        <Link href={`/reportes/facturacion?tab=${config.tab}`} className="report-link">
          ‹ Volver a {config.back}
        </Link>
        {doc && (
          <div className="page-actions">
            <button type="button" className="secondary" onClick={() => window.print()}>
              Imprimir / PDF
            </button>
            {canQuote && doc.status !== "VOID" && (
              <>
                <button type="button" className="secondary" onClick={() => setDialog("email")}>
                  Enviar a otro correo
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={send}
                  disabled={sending || !doc.customer.email}
                  title={doc.customer.email ? `Enviar a ${doc.customer.email}` : "El cliente no tiene correo"}
                >
                  {sending ? "Enviando…" : "Enviar por correo"}
                </button>
              </>
            )}
            {canQuote && open && (
              <>
                <button type="button" className="secondary danger" onClick={() => setDialog("void")}>
                  Anular
                </button>
                <button type="button" className="primary" onClick={() => setDialog("convert")}>
                  Convertir en factura
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {notice && (
        <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
          {notice.text}
        </p>
      )}
      <ReportStatus loading={quote.loading && !doc} error={quote.error} />

      {doc && (
        <>
          <article className={`panel document-sheet${doc.status === "VOID" ? " is-void" : ""}`}>
            <header className="document-head">
              <div>
                <p className="eyebrow">{company}</p>
                <h2>
                  {config.title} {doc.number}
                </h2>
                <p>
                  Elaborada el {date(doc.date)}
                  {doc.validUntil && ` · Válida hasta el ${date(doc.validUntil)}`}
                  {doc.transactionType && ` · Tipo: ${deliveryTypeLabels[doc.transactionType]}`}
                </p>
              </div>
              <div className="document-total">
                <span>Total ({doc.currency})</span>
                <b>{money(doc.totals.at(-1)!.value)}</b>
                <span className={quoteBadge[doc.status]}>{quoteStatusLabels[doc.status]}</span>
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
              {doc.createdBy && (
                <div>
                  <dt>Elaborada por</dt>
                  <dd>{doc.createdBy}</dd>
                </div>
              )}
              {doc.invoice && (
                <div>
                  <dt>Factura</dt>
                  <dd>
                    {doc.invoice.status === "DRAFT" ? "Creada en borrador (pendiente de emitir en Ventas)" : "Emitida"}
                  </dd>
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
              <p className="report-message">{Noun} no se ha enviado por correo.</p>
            )}
          </section>
        </>
      )}

      {doc && dialog === "email" && (
        <SendEmailDialog
          document={{ type: "Quote", id: doc.id, number: doc.number, customerEmail: doc.customer.email }}
          send={to => apiPost(`${config.api}/${doc.id}/email`, { to })}
          onClose={() => setDialog(null)}
          onSent={recipient => done(`Enviada a ${recipient}.`)}
        />
      )}
      {doc && dialog === "void" && (
        <VoidDocumentDialog
          title={`Anular ${config.noun.slice(3)} ${doc.number}`}
          description={`${Noun} queda anulada y ya no se podrá enviar ni convertir en factura.`}
          path={`${config.api}/${doc.id}/void`}
          confirmLabel={`Anular ${config.noun.slice(3)}`}
          onClose={() => setDialog(null)}
          onVoided={() => done(`${config.title} ${doc.number} anulada.`)}
        />
      )}
      {doc && dialog === "convert" && (
        <ConvertQuoteDialog
          path={`${config.api}/${doc.id}/invoice`}
          noun={Noun}
          quote={{ id: doc.id, number: doc.number }}
          onClose={() => setDialog(null)}
          onConverted={() => done("Factura creada en borrador. Se emite desde Ventas.")}
        />
      )}
    </div>
  );
}
