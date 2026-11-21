/**
 * Cuentas por pagar de un proveedor (/compras/proveedor?id=…, GET /v1/suppliers/:id/statement): saldos,
 * compras y gastos a crédito pendientes con días de vencido, y comprobantes de egreso de los últimos 12 meses
 * (con anulación). Se puede imprimir y registrar un pago.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { date, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { methodLabels } from "./billing-report-collections";
import { VoidDocumentDialog } from "./collection-dialogs";
import { purchaseHref } from "./purchases";
import { supplierPaymentHref } from "./purchase-suppliers";

type Statement = {
  supplier: {
    legalName: string;
    identificationType: string;
    identificationNumber: string;
    email: string | null;
    phone: string | null;
    active: boolean;
  };
  date: string;
  documents: {
    id: string;
    number: string;
    type: string;
    supplierInvoiceNumber: string | null;
    issueDate: string;
    dueDate: string | null;
    total: string;
    applied: string;
    balance: string;
    overdue: boolean;
    daysOverdue: number;
  }[];
  payments: {
    id: string;
    number: string;
    date: string;
    method: string;
    reference: string | null;
    total: string;
    status: string;
    voidReason: string | null;
    documents: { number: string; amount: string }[];
  }[];
  summary: { overdue: string; upcoming: string; credit: string; total: string };
};

export function SupplierStatement() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { company, canReceive: canPay } = useSession();
  const statement = useReport<{ data: Statement }>(`/v1/suppliers/${id}/statement`);
  const [voiding, setVoiding] = useState<Statement["payments"][number] | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(
    params.get("pago") ? { kind: "ok", text: `Comprobante de egreso ${params.get("pago")} registrado.` } : null
  );
  const doc = statement.data?.data;

  return (
    <div className="page-content">
      <div className="document-toolbar">
        <Link href="/compras?tab=proveedores" className="report-link">
          ‹ Volver a Proveedores
        </Link>
        {doc && (
          <div className="page-actions">
            <button type="button" className="secondary" onClick={() => window.print()}>
              Imprimir / PDF
            </button>
            {canPay && Number(doc.summary.total) > 0 && (
              <Link href={supplierPaymentHref(id)} className="primary">
                Registrar pago
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
              <h2>Cuentas por pagar</h2>
              <p>
                {doc.supplier.legalName} · {doc.supplier.identificationType} {doc.supplier.identificationNumber}
                {!doc.supplier.active && " · Proveedor inactivo"}
              </p>
            </div>
            <div className="document-total">
              <span>Total saldo</span>
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
            <div title="Betel aún no registra anticipos a proveedores">
              <span>Saldo a favor</span>
              <b>{money(doc.summary.credit)}</b>
            </div>
            <div>
              <span>Contacto</span>
              <b className="statement-contact">{doc.supplier.email ?? "Sin correo"}</b>
              {doc.supplier.phone && <small>{doc.supplier.phone}</small>}
            </div>
          </div>

          <h3 className="statement-title">Compras y gastos por pagar</h3>
          {doc.documents.length ? (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Comprobante</th>
                    <th>Factura proveedor</th>
                    <th>Fecha</th>
                    <th>Vencimiento</th>
                    <th className="num">Total</th>
                    <th className="num">Pagado</th>
                    <th className="num">Saldo</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.documents.map(document => (
                    <tr key={document.id}>
                      <td>
                        <Link href={purchaseHref("Purchase", document.id)} className="collections-doc">
                          {document.number}
                        </Link>
                        <small>{document.type}</small>
                      </td>
                      <td>{document.supplierInvoiceNumber ?? "—"}</td>
                      <td>{date(document.issueDate)}</td>
                      <td>{date(document.dueDate)}</td>
                      <td className="num">{money(document.total)}</td>
                      <td className="num">{money(document.applied)}</td>
                      <td className="num">
                        <b>{money(document.balance)}</b>
                      </td>
                      <td>
                        {document.overdue ? (
                          <span className="pay-badge is-bad">
                            Vencida{document.daysOverdue ? ` · ${document.daysOverdue} días` : ""}
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
            <p className="report-message">
              No hay compras ni gastos a crédito pendientes de pago. Las compras de contado y los documentos soporte se
              pagan al registrarse.
            </p>
          )}

          <h3 className="statement-title">Comprobantes de egreso (últimos 12 meses)</h3>
          {doc.payments.length ? (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Comprobante</th>
                    <th>Fecha</th>
                    <th>Medio de pago</th>
                    <th>Documentos pagados</th>
                    <th className="num">Valor</th>
                    <th className="no-print">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {doc.payments.map(payment => (
                    <tr key={payment.id} className={payment.status === "VOID" ? "is-cancelled" : undefined}>
                      <td>
                        <b>{payment.number}</b>
                        {payment.status === "VOID" && <small title={payment.voidReason ?? undefined}>Anulado</small>}
                      </td>
                      <td>{date(payment.date)}</td>
                      <td>
                        {methodLabels[payment.method] ?? payment.method}
                        {payment.reference && <small>{payment.reference}</small>}
                      </td>
                      <td>{payment.documents.map(item => `${item.number} (${money(item.amount)})`).join(", ")}</td>
                      <td className="num">{money(payment.total)}</td>
                      <td className="no-print">
                        {payment.status === "ACTIVE" && canPay && (
                          <button type="button" className="report-link danger" onClick={() => setVoiding(payment)}>
                            Anular
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="report-message">No hay pagos registrados en los últimos 12 meses.</p>
          )}
        </article>
      )}

      {voiding && (
        <VoidDocumentDialog
          title={`Anular ${voiding.number}`}
          description="El valor vuelve al saldo de los documentos pagados y se registra el asiento contable inverso. Esta acción no se puede deshacer."
          path={`/v1/supplier-payments/${voiding.id}/void`}
          confirmLabel="Anular pago"
          onClose={() => setVoiding(null)}
          onVoided={() => {
            setNotice({ kind: "ok", text: `${voiding.number} anulado.` });
            setVoiding(null);
            statement.reload();
          }}
        />
      )}
    </div>
  );
}
