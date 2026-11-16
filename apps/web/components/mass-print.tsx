/**
 * Impresión masiva (/envio-masivo/imprimir?docs=Invoice:id,Quote:id,…): carga cada comprobante con la ruta
 * de detalle de su módulo, los muestra uno por página y abre el diálogo de impresión ("Guardar como PDF").
 */
"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { date, money, useSession } from "./billing-report-common";

type PrintableDocument = {
  title: string;
  number: string;
  date: string;
  status: string;
  customer: { legalName: string; identificationType: string; identificationNumber: string; email: string | null };
  lines: {
    description: string;
    quantity: string | null;
    unitPrice: string | null;
    taxRate: string | null;
    total: string;
  }[];
  totals: { label: string; value: string }[];
};

const detailPath = (type: string, id: string) =>
  type === "Quote"
    ? [`/v1/quotes/${id}`, {}]
    : type === "Delivery"
      ? [`/v1/deliveries/${id}`, {}]
      : ["/v1/collections/document", { type, id }];

export function MassPrint() {
  const docs = (useSearchParams().get("docs") ?? "")
    .split(",")
    .map(item => item.split(":"))
    .filter(([type, id]) => type && /^[0-9a-f-]{36}$/i.test(id ?? ""))
    .slice(0, 50);
  const { company } = useSession();
  const [state, setState] = useState<{ documents: PrintableDocument[]; errors: string[]; loading: boolean }>({
    documents: [],
    errors: [],
    loading: true,
  });
  const key = docs.map(doc => doc.join(":")).join(",");

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled(
      docs.map(([type, id]) => {
        const [path, params] = detailPath(type!, id!) as [string, Record<string, string>];
        return apiGet<{ data: PrintableDocument }>(path, params);
      })
    ).then(results => {
      if (cancelled) return;
      setState({
        documents: results.flatMap(result => (result.status === "fulfilled" ? [result.value.data] : [])),
        errors: results.flatMap(result => (result.status === "rejected" ? [(result.reason as Error).message] : [])),
        loading: false,
      });
      // Abre el diálogo de impresión cuando todo cargó.
      if (results.some(result => result.status === "fulfilled")) setTimeout(() => window.print(), 300);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return (
    <div className="page-content mass-print">
      <div className="document-toolbar">
        <span className="report-hint">
          {state.loading ? "Cargando comprobantes…" : `${state.documents.length} comprobante(s) listos para imprimir.`}
        </span>
        <button type="button" className="primary" onClick={() => window.print()} disabled={state.loading}>
          Imprimir / PDF
        </button>
      </div>
      {!docs.length && <p className="report-message">No se indicaron comprobantes para imprimir.</p>}
      {state.errors.map((error, index) => (
        <p key={index} className="report-error" role="alert">
          {error}
        </p>
      ))}
      {state.documents.map((doc, index) => (
        <article key={index} className="panel document-sheet print-sheet">
          <header className="document-head">
            <div>
              <p className="eyebrow">{company}</p>
              <h2>
                {doc.title} {doc.number}
              </h2>
              <p>{date(doc.date)}</p>
            </div>
            <div className="document-total">
              <span>Total</span>
              <b>{money(doc.totals.at(-1)!.value)}</b>
              {doc.status === "VOID" && <strong className="document-void">ANULADO</strong>}
            </div>
          </header>
          <dl className="document-meta">
            <div>
              <dt>Cliente</dt>
              <dd>
                {doc.customer.legalName} · {doc.customer.identificationType} {doc.customer.identificationNumber}
              </dd>
            </div>
          </dl>
          <table className="report-table">
            <thead>
              <tr>
                <th>Descripción</th>
                <th className="num">Cantidad</th>
                <th className="num">Valor unitario</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((line, lineIndex) => (
                <tr key={lineIndex}>
                  <td>{line.description}</td>
                  <td className="num">{line.quantity ? Number(line.quantity) : ""}</td>
                  <td className="num">{line.unitPrice ? money(line.unitPrice) : ""}</td>
                  <td className="num">{money(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="document-totals">
            {doc.totals.map(item => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{money(item.value)}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  );
}
