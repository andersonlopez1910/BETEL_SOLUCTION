/**
 * Ver documento de inventario (/productos/documentos/ver?id=…, GET /v1/inventory-documents/:id): renglones con
 * entradas y salidas, totales, impresión y anulación.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { date, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { VoidDocumentDialog } from "./collection-dialogs";
import { unitLabels } from "./products";

type InventoryDetail = {
  id: string;
  typeLabel: string;
  number: string;
  date: string;
  party: { legalName: string; identificationType: string; identificationNumber: string } | null;
  total: string;
  currency: string;
  status: "ACTIVE" | "VOID";
  notes: string | null;
  voidReason: string | null;
  createdBy: string | null;
  inflow: string;
  outflow: string;
  lines: {
    id: string;
    product: { name: string; sku: string | null; unit: string };
    direction: "IN" | "OUT";
    quantity: string;
    unitCost: string;
    total: string;
  }[];
};

const quantity = (value: string) =>
  new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));

export function InventoryDocumentView() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { company, canReceive: canEdit } = useSession();
  const detail = useReport<{ data: InventoryDetail }>(`/v1/inventory-documents/${id}`);
  const [voiding, setVoiding] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    params.get("creado") ? "Documento guardado; el stock ya refleja estos movimientos." : null
  );
  const doc = detail.data?.data;
  const isVoid = doc?.status === "VOID";

  return (
    <div className="page-content">
      <div className="document-toolbar">
        <Link href="/productos?tab=documentos" className="report-link">
          ‹ Volver a Documentos de productos / servicios
        </Link>
        {doc && (
          <div className="page-actions">
            <button type="button" className="secondary" onClick={() => window.print()}>
              Imprimir / PDF
            </button>
            {!isVoid && canEdit && (
              <button type="button" className="secondary danger" onClick={() => setVoiding(true)}>
                Anular
              </button>
            )}
          </div>
        )}
      </div>
      {notice && (
        <p className="collections-notice" role="status">
          {notice}
        </p>
      )}
      <ReportStatus loading={detail.loading && !doc} error={detail.error} />

      {doc && (
        <article className={`panel document-sheet${isVoid ? " is-void" : ""}`}>
          <header className="document-head">
            <div>
              <p className="eyebrow">{company}</p>
              <h2>
                {doc.typeLabel} {doc.number}
              </h2>
              <p>{date(doc.date)}</p>
            </div>
            <div className="document-total">
              <span>Total (entradas − salidas)</span>
              <b>{money(doc.total)}</b>
              {isVoid && <strong className="document-void">ANULADO</strong>}
            </div>
          </header>
          <dl className="document-meta">
            <div>
              <dt>Tercero</dt>
              <dd>
                {doc.party
                  ? `${doc.party.legalName} · ${doc.party.identificationType} ${doc.party.identificationNumber}`
                  : "—"}
              </dd>
            </div>
            {doc.createdBy && (
              <div>
                <dt>Registrado por</dt>
                <dd>{doc.createdBy}</dd>
              </div>
            )}
            {doc.notes && (
              <div>
                <dt>Observaciones</dt>
                <dd>{doc.notes}</dd>
              </div>
            )}
            {doc.voidReason && (
              <div>
                <dt>Motivo de anulación</dt>
                <dd>{doc.voidReason}</dd>
              </div>
            )}
          </dl>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Movimiento</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Costo unitario</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {doc.lines.map(line => (
                  <tr key={line.id}>
                    <td>
                      {line.product.name}
                      <small>
                        {line.product.sku ?? "Sin código"} · {unitLabels[line.product.unit] ?? line.product.unit}
                      </small>
                    </td>
                    <td>
                      <span className={line.direction === "IN" ? "pay-badge is-ok" : "pay-badge is-bad"}>
                        {line.direction === "IN" ? "Entrada" : "Salida"}
                      </span>
                    </td>
                    <td className="num">{quantity(line.quantity)}</td>
                    <td className="num">{money(line.unitCost)}</td>
                    <td className="num">{money(line.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="document-totals">
            <div>
              <dt>Entradas</dt>
              <dd>{money(doc.inflow)}</dd>
            </div>
            <div>
              <dt>Salidas</dt>
              <dd>{money(doc.outflow)}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{money(doc.total)}</dd>
            </div>
          </dl>
        </article>
      )}

      {doc && voiding && (
        <VoidDocumentDialog
          title={`Anular ${doc.number}`}
          description="Se reversan su efecto en el stock y su asiento contable. Esta acción no se puede deshacer."
          path={`/v1/inventory-documents/${doc.id}/void`}
          confirmLabel="Anular documento"
          onClose={() => setVoiding(false)}
          onVoided={() => {
            setVoiding(false);
            setNotice(`${doc.number} anulado.`);
            detail.reload();
          }}
        />
      )}
    </div>
  );
}
