/**
 * "Convertir en factura": crea una factura EN BORRADOR con las líneas de la cotización
 * (POST /v1/quotes/:id/invoice). La emisión DIAN y la contabilidad siguen siendo un paso aparte.
 */
"use client";

import { useState } from "react";
import { apiPost } from "../lib/api";
import { defaultPeriod } from "./billing-report-common";
import { Modal } from "./collection-dialogs";

export function ConvertQuoteDialog({
  quote,
  onClose,
  onConverted,
}: {
  quote: { id: string; number: string };
  onClose: () => void;
  onConverted: () => void;
}) {
  const today = defaultPeriod().to;
  const [form, setForm] = useState({ paymentMethod: "CASH", issueDate: today, dueDate: "" });
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [field]: event.target.value });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      await apiPost(`/v1/quotes/${quote.id}/invoice`, {
        paymentMethod: form.paymentMethod,
        issueDate: form.issueDate,
        ...(form.paymentMethod === "CREDIT" && { dueDate: form.dueDate }),
      });
      onConverted();
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };

  return (
    <Modal title={`Convertir ${quote.number} en factura`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="report-dialog-text">
          Se crea una factura en <b>borrador</b> con los mismos ítems y totales. La cotización queda como facturada; la
          factura se emite (DIAN y contabilidad) desde Ventas.
        </p>
        <label className="field">
          Forma de pago
          <select value={form.paymentMethod} onChange={set("paymentMethod")}>
            <option value="CASH">Contado</option>
            <option value="CREDIT">Crédito</option>
          </select>
        </label>
        <label className="field">
          Fecha de la factura
          <input type="date" value={form.issueDate} onChange={set("issueDate")} required />
        </label>
        {form.paymentMethod === "CREDIT" && (
          <label className="field">
            Vencimiento
            <input type="date" value={form.dueDate} onChange={set("dueDate")} min={form.issueDate} required />
          </label>
        )}
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
            {state.busy ? "Convirtiendo…" : "Crear factura en borrador"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
