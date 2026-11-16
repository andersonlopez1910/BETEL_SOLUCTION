/**
 * Diálogos de Recaudos: enviar un documento a un correo escrito a mano y anular un recibo de caja.
 * Usan <dialog> nativo (modal, foco atrapado y Escape para cerrar los da el navegador).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { apiPost } from "../lib/api";

export type DocumentRef = { type: "Invoice" | "CashReceipt"; id: string; number: string; customerEmail: string | null };

/** Envía un documento por correo. Sin `to` la API usa el correo del cliente. */
export const sendDocumentEmail = (document: { type: string; id: string }, to?: string) =>
  apiPost<{ data: { recipient: string } }>("/v1/documents/email", {
    documentType: document.type,
    documentId: document.id,
    ...(to && { to }),
  });

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="report-dialog" aria-label={title} onClose={onClose}>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

/** "Enviar a otro correo": propone el correo del cliente y permite cambiarlo. */
export function SendEmailDialog({
  document,
  onClose,
  onSent,
}: {
  document: DocumentRef;
  onClose: () => void;
  onSent: (recipient: string) => void;
}) {
  const [to, setTo] = useState(document.customerEmail ?? "");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      const result = await sendDocumentEmail(document, to.trim());
      onSent(result.data.recipient);
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  return (
    <Modal title={`Enviar ${document.number} por correo`} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          Correo de destino
          <input type="email" value={to} onChange={event => setTo(event.target.value)} required autoFocus />
        </label>
        {state.error && (
          <p className="report-error" role="alert">
            {state.error}
          </p>
        )}
        <div className="report-dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={state.busy}>
            {state.busy ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Anulación de un recibo de caja: pide el motivo (queda en el recibo y en la auditoría). */
export function VoidReceiptDialog({
  receipt,
  onClose,
  onVoided,
}: {
  receipt: { id: string; number: string };
  onClose: () => void;
  onVoided: () => void;
}) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      await apiPost(`/v1/cash-receipts/${receipt.id}/void`, { reason: reason.trim() });
      onVoided();
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  return (
    <Modal title={`Anular recibo ${receipt.number}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="report-dialog-text">
          El valor del recibo vuelve al saldo de las facturas abonadas y se registra el asiento contable inverso. Esta
          acción no se puede deshacer.
        </p>
        <label className="field">
          Motivo de la anulación
          <input value={reason} onChange={event => setReason(event.target.value)} minLength={3} required autoFocus />
        </label>
        {state.error && (
          <p className="report-error" role="alert">
            {state.error}
          </p>
        )}
        <div className="report-dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary danger" disabled={state.busy}>
            {state.busy ? "Anulando…" : "Anular recibo"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
