/**
 * Ver documento de Compras y gastos (/compras/documento?kind=Purchase|Support&id=…,
 * GET /v1/purchases/document): detalle imprimible; anular una compra o gasto y contabilizar un
 * documento soporte en borrador.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiPost } from "../lib/api";
import { date, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { VoidDocumentDialog } from "./collection-dialogs";

type PurchaseDocument = {
  kind: "Purchase" | "Support";
  id: string;
  type: string;
  title: string;
  number: string;
  supplierInvoiceNumber: string | null;
  date: string;
  dueDate: string | null;
  paymentTerm: string | null;
  status: string;
  dianStatus: string | null;
  supplier: { legalName: string; identificationType: string; identificationNumber: string; email: string | null };
  notes: string | null;
  voidReason: string | null;
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
};

export function PurchaseDocumentView() {
  const params = useSearchParams();
  const kind = params.get("kind") ?? "";
  const id = params.get("id") ?? "";
  const { company, canReceive: canRegister } = useSession();
  const document = useReport<{ data: PurchaseDocument }>("/v1/purchases/document", { kind, id });
  const [voiding, setVoiding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(
    params.get("creado") ? { kind: "ok", text: "Documento guardado." } : null
  );
  const doc = document.data?.data;
  const isVoid = doc?.status === "VOID";

  const issue = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await apiPost(`/v1/support-documents/${id}/issue`);
      setNotice({ kind: "ok", text: "Documento soporte contabilizado." });
      document.reload();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-content">
      <div className="document-toolbar">
        <Link href="/compras?tab=documentos" className="report-link">
          ‹ Volver a Compras y gastos
        </Link>
        {doc && (
          <div className="page-actions">
            <button type="button" className="secondary" onClick={() => window.print()}>
              Imprimir / PDF
            </button>
            {doc.kind === "Support" && doc.status === "DRAFT" && canRegister && (
              <button type="button" className="primary" onClick={issue} disabled={busy}>
                {busy ? "Contabilizando…" : "Contabilizar"}
              </button>
            )}
            {doc.kind === "Purchase" && !isVoid && canRegister && (
              <button type="button" className="secondary danger" onClick={() => setVoiding(true)}>
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
        <article className={`panel document-sheet${isVoid ? " is-void" : ""}`}>
          <header className="document-head">
            <div>
              <p className="eyebrow">{company}</p>
              <h2>
                {doc.title} {doc.number}
              </h2>
              <p>
                {date(doc.date)}
                {doc.supplierInvoiceNumber && ` · Factura del proveedor ${doc.supplierInvoiceNumber}`}
              </p>
            </div>
            <div className="document-total">
              <span>Total</span>
              <b>{money(doc.totals.at(-1)!.value)}</b>
              {isVoid && <strong className="document-void">ANULADO</strong>}
              {doc.status === "DRAFT" && <span className="pay-badge is-pending">Borrador</span>}
            </div>
          </header>
          <dl className="document-meta">
            <div>
              <dt>Proveedor</dt>
              <dd>
                {doc.supplier.legalName} · {doc.supplier.identificationType} {doc.supplier.identificationNumber}
              </dd>
            </div>
            {doc.paymentTerm && (
              <div>
                <dt>Forma de pago</dt>
                <dd>{doc.paymentTerm === "CREDIT" ? `Crédito · vence ${date(doc.dueDate)}` : "Contado"}</dd>
              </div>
            )}
            {doc.dianStatus && (
              <div>
                <dt>Envío a la DIAN</dt>
                <dd>
                  {doc.status === "DRAFT"
                    ? "Sin contabilizar"
                    : doc.dianStatus === "PENDING"
                      ? "Pendiente de transmisión"
                      : doc.dianStatus}
                </dd>
              </div>
            )}
            {doc.createdBy && (
              <div>
                <dt>Registrado por</dt>
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
                  <th className="num">Cantidad</th>
                  <th className="num">Valor unitario</th>
                  {doc.kind === "Purchase" && <th className="num">Desc. %</th>}
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
                    {doc.kind === "Purchase" && <td className="num">{Number(line.discountRate)} %</td>}
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
      )}

      {doc && voiding && (
        <VoidDocumentDialog
          title={`Anular ${doc.number}`}
          description="Se registra el asiento contable inverso y el documento deja de sumar. Esta acción no se puede deshacer."
          path={`/v1/purchases/${doc.id}/void`}
          confirmLabel="Anular documento"
          onClose={() => setVoiding(false)}
          onVoided={() => {
            setVoiding(false);
            setNotice({ kind: "ok", text: `${doc.number} anulado.` });
            document.reload();
          }}
        />
      )}
    </div>
  );
}
