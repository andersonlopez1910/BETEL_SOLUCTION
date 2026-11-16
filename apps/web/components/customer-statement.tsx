/**
 * Estado de cuenta de un cliente (/clientes/estado-de-cuenta?id=…, GET /v1/customers/:id/statement):
 * saldos, facturas pendientes con días de mora y recibos de los últimos 12 meses. Se puede imprimir,
 * enviar por correo y registrar un recibo de caja.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiPost } from "../lib/api";
import { date, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { methodLabels } from "./billing-report-collections";
import { SendEmailDialog } from "./collection-dialogs";

type Statement = {
  customer: {
    legalName: string;
    identificationType: string;
    identificationNumber: string;
    email: string | null;
    phone: string | null;
    active: boolean;
  };
  date: string;
  invoices: {
    id: string;
    number: string;
    issueDate: string;
    dueDate: string | null;
    total: string;
    applied: string;
    balance: string;
    overdue: boolean;
    daysOverdue: number;
  }[];
  receipts: { id: string; number: string; date: string; method: string; total: string; status: string }[];
  summary: { overdue: string; upcoming: string; credit: string; total: string };
};

export function CustomerStatement() {
  const id = useSearchParams().get("id") ?? "";
  const { company, canEmail, canReceive } = useSession();
  const statement = useReport<{ data: Statement }>(`/v1/customers/${id}/statement`);
  const [dialog, setDialog] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const doc = statement.data?.data;

  const send = async () => {
    setSending(true);
    setNotice(null);
    try {
      const result = await apiPost<{ data: { recipient: string } }>(`/v1/customers/${id}/statement/email`);
      setNotice({ kind: "ok", text: `Estado de cuenta enviado a ${result.data.recipient}.` });
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page-content">
      <div className="document-toolbar">
        <Link href="/reportes/facturacion?tab=clientes" className="report-link">
          ‹ Volver a Clientes
        </Link>
        {doc && (
          <div className="page-actions">
            <button type="button" className="secondary" onClick={() => window.print()}>
              Imprimir / PDF
            </button>
            {canEmail && (
              <>
                <button type="button" className="secondary" onClick={() => setDialog(true)}>
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
            {canReceive && Number(doc.summary.total) > 0 && (
              <Link href={`/recaudos/nuevo?cliente=${id}`} className="primary">
                Registrar recibo de caja
              </Link>
            )}
          </div>
        )}
      </div>

      {notice && (
        <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
          {notice.text}
        </p>
      )}
      <ReportStatus loading={statement.loading && !doc} error={statement.error} />

      {doc && (
        <article className="panel document-sheet">
          <header className="document-head">
            <div>
              <p className="eyebrow">{company}</p>
              <h2>Estado de cuenta</h2>
              <p>
                {doc.customer.legalName} · {doc.customer.identificationType} {doc.customer.identificationNumber}
                {!doc.customer.active && " · Cliente inactivo"}
              </p>
            </div>
            <div className="document-total">
              <span>Total cartera</span>
              <b>{money(doc.summary.total)}</b>
              <span>Corte: {date(doc.date)}</span>
            </div>
          </header>

          <div className="statement-kpis">
            <div className={Number(doc.summary.overdue) > 0 ? "is-bad" : undefined}>
              <span>Saldo vencido</span>
              <b>{money(doc.summary.overdue)}</b>
            </div>
            <div>
              <span>Saldo por vencer</span>
              <b>{money(doc.summary.upcoming)}</b>
            </div>
            <div title="Betel aún no registra anticipos ni saldos a favor">
              <span>Saldo a favor</span>
              <b>{money(doc.summary.credit)}</b>
            </div>
            <div>
              <span>Contacto</span>
              <b className="statement-contact">{doc.customer.email ?? "Sin correo"}</b>
              {doc.customer.phone && <small>{doc.customer.phone}</small>}
            </div>
          </div>

          <h3 className="statement-title">Facturas pendientes</h3>
          {doc.invoices.length ? (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Factura</th>
                    <th>Emisión</th>
                    <th>Vencimiento</th>
                    <th className="num">Total</th>
                    <th className="num">Abonado</th>
                    <th className="num">Saldo</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.invoices.map(invoice => (
                    <tr key={invoice.id}>
                      <td>
                        <Link href={`/recaudos/documento?type=Invoice&id=${invoice.id}`} className="collections-doc">
                          {invoice.number}
                        </Link>
                      </td>
                      <td>{date(invoice.issueDate)}</td>
                      <td>{date(invoice.dueDate)}</td>
                      <td className="num">{money(invoice.total)}</td>
                      <td className="num">{money(invoice.applied)}</td>
                      <td className="num">
                        <b>{money(invoice.balance)}</b>
                      </td>
                      <td>
                        {invoice.overdue ? (
                          <span className="pay-badge is-bad">
                            Vencida{invoice.daysOverdue ? ` · ${invoice.daysOverdue} días` : ""}
                          </span>
                        ) : (
                          <span className="pay-badge is-ok">Por vencer</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="report-message">El cliente no tiene facturas pendientes de pago.</p>
          )}

          <h3 className="statement-title">Recibos de caja (últimos 12 meses)</h3>
          {doc.receipts.length ? (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Recibo</th>
                    <th>Fecha</th>
                    <th>Medio de pago</th>
                    <th className="num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.receipts.map(receipt => (
                    <tr key={receipt.id} className={receipt.status === "VOID" ? "is-cancelled" : undefined}>
                      <td>
                        <Link
                          href={`/recaudos/documento?type=CashReceipt&id=${receipt.id}`}
                          className="collections-doc"
                        >
                          {receipt.number}
                        </Link>
                        {receipt.status === "VOID" && <small> · Anulado</small>}
                      </td>
                      <td>{date(receipt.date)}</td>
                      <td>{methodLabels[receipt.method] ?? receipt.method}</td>
                      <td className="num">{money(receipt.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="report-message">No hay recibos de caja en los últimos 12 meses.</p>
          )}
        </article>
      )}

      {doc && dialog && (
        <SendEmailDialog
          document={{ type: "Statement", id, number: "el estado de cuenta", customerEmail: doc.customer.email }}
          send={to => apiPost(`/v1/customers/${id}/statement/email`, { to })}
          onClose={() => setDialog(false)}
          onSent={recipient => {
            setDialog(false);
            setNotice({ kind: "ok", text: `Estado de cuenta enviado a ${recipient}.` });
          }}
        />
      )}
    </div>
  );
}
