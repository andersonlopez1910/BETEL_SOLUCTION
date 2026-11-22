/**
 * "Registrar pago a proveedor" — comprobante de egreso (/compras/pago/nuevo?proveedor=…, POST /v1/supplier-payments).
 *
 * 1. Se elige un proveedor con compras o gastos a crédito por pagar (GET /v1/supplier-payments/pending-suppliers).
 * 2. Se listan sus documentos con saldo y se indica cuánto se paga a cada uno ("Pagar saldo" llena el saldo).
 * 3. El total es la suma. La API vuelve a validar los saldos dentro de la transacción.
 */
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiPost } from "../lib/api";
import { date, money, ReportStatus, useReport } from "./billing-report-common";
import { methodLabels } from "./billing-report-collections";
import { purchaseHref } from "./purchases";

type PendingSupplier = {
  id: string;
  legalName: string;
  identificationNumber: string;
  documentCount: number;
  balance: string;
};
type PendingDocument = {
  id: string;
  number: string;
  type: string;
  supplierInvoiceNumber: string | null;
  issueDate: string;
  dueDate: string | null;
  overdue: boolean;
  total: string;
  applied: string;
  balance: string;
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
/** Centavos enteros para sumar sin errores de coma flotante. */
const cents = (value: string) => Math.round(Number(value || 0) * 100);
/** Medios de un egreso (el pago en línea es solo de recaudos). */
const paymentMethods = Object.entries(methodLabels).filter(([value]) => value !== "ONLINE");

export function SupplierPaymentForm() {
  const router = useRouter();
  const suppliers = useReport<{ data: PendingSupplier[] }>("/v1/supplier-payments/pending-suppliers");
  const [supplierId, setSupplierId] = useState(useSearchParams().get("proveedor") ?? "");
  const documents = useReport<{ data: PendingDocument[] }>(
    supplierId ? "/v1/supplier-payments/pending-documents" : null,
    { supplierId }
  );
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ date: today(), method: "BANK_TRANSFER", reference: "", notes: "" });
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  const pending = supplierId ? (documents.data?.data ?? []) : [];
  const totalCents = pending.reduce((sum, document) => sum + cents(amounts[document.id] ?? ""), 0);
  const overBalance = pending.filter(document => cents(amounts[document.id] ?? "") > cents(document.balance));
  const backHref = supplierId ? `/compras/proveedor?id=${supplierId}` : "/compras?tab=proveedores";

  const chooseSupplier = (id: string) => {
    setSupplierId(id);
    setAmounts({});
    setState({ busy: false });
  };
  const setField =
    (field: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [field]: event.target.value });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const applications = pending
      .filter(document => cents(amounts[document.id] ?? "") > 0)
      .map(document => ({ purchaseDocumentId: document.id, amount: cents(amounts[document.id]!) / 100 }));
    if (!applications.length) return setState({ busy: false, error: "Indica cuánto se paga al menos a un documento." });
    setState({ busy: true });
    try {
      const created = await apiPost<{ data: { number: string } }>("/v1/supplier-payments", {
        supplierId,
        date: form.date,
        method: form.method,
        reference: form.reference || undefined,
        notes: form.notes || undefined,
        applications,
      });
      router.push(`/compras/proveedor?id=${supplierId}&pago=${created.data.number}`);
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };

  // Sin permiso, la API responde 403 a la lista de proveedores y ReportStatus muestra el mensaje.
  return (
    <form className="page-content receipt-form" onSubmit={submit}>
      <section className="panel">
        <div className="panel-head">
          <h2>Datos del pago</h2>
          <Link href={backHref} className="report-link">
            ‹ Volver
          </Link>
        </div>
        <div className="receipt-fields">
          <label className="field receipt-customer">
            Proveedor
            <select value={supplierId} onChange={event => chooseSupplier(event.target.value)} required>
              <option value="">
                {suppliers.loading ? "Cargando proveedores…" : "Selecciona un proveedor con saldo por pagar"}
              </option>
              {suppliers.data?.data.map(supplier => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.legalName} · {supplier.identificationNumber} · Saldo {money(supplier.balance)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Fecha
            <input type="date" value={form.date} onChange={setField("date")} max={today()} required />
          </label>
          <label className="field">
            Medio de pago
            <select value={form.method} onChange={setField("method")}>
              {paymentMethods.map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Referencia
            <input
              value={form.reference}
              onChange={setField("reference")}
              placeholder="N.º de transferencia o cheque"
              maxLength={120}
            />
          </label>
          <label className="field receipt-notes">
            Observaciones
            <textarea value={form.notes} onChange={setField("notes")} maxLength={500} rows={2} />
          </label>
        </div>
        <ReportStatus loading={false} error={suppliers.error} />
        {suppliers.data && !suppliers.data.data.length && (
          <p className="report-message">
            No hay compras ni gastos a crédito con saldo por pagar. Las compras de contado y los documentos soporte se
            pagan al registrarse.
          </p>
        )}
        {suppliers.data && supplierId && !suppliers.data.data.some(supplier => supplier.id === supplierId) && (
          <p className="report-message">Este proveedor no tiene saldo por pagar.</p>
        )}
      </section>

      {supplierId && (
        <section className="panel report-table-panel">
          <div className="panel-head">
            <h2>Compras y gastos por pagar</h2>
            <span className="report-hint">Paga uno o varios documentos; el total del comprobante es la suma.</span>
          </div>
          <ReportStatus loading={documents.loading} error={documents.error} />
          {!documents.loading && (
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
                    <th className="num">Valor a pagar</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(document => {
                    const over = cents(amounts[document.id] ?? "") > cents(document.balance);
                    return (
                      <tr key={document.id}>
                        <td>
                          <Link href={purchaseHref("Purchase", document.id)} className="collections-doc">
                            {document.number}
                          </Link>
                          {document.overdue && <small className="receipt-overdue">Vencida</small>}
                        </td>
                        <td>{document.supplierInvoiceNumber ?? "—"}</td>
                        <td>{date(document.issueDate)}</td>
                        <td>{date(document.dueDate)}</td>
                        <td className="num">{money(document.total)}</td>
                        <td className="num">{money(document.applied)}</td>
                        <td className="num">{money(document.balance)}</td>
                        <td className="num">
                          <div className="receipt-amount">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              max={document.balance}
                              inputMode="decimal"
                              value={amounts[document.id] ?? ""}
                              onChange={event => setAmounts({ ...amounts, [document.id]: event.target.value })}
                              aria-label={`Valor a pagar de ${document.number}`}
                              aria-invalid={over || undefined}
                            />
                            <button
                              type="button"
                              className="report-link"
                              onClick={() => setAmounts({ ...amounts, [document.id]: document.balance })}
                            >
                              Pagar saldo
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="panel receipt-footer">
        <div>
          <span>Total del comprobante de egreso</span>
          <b>{money(totalCents / 100)}</b>
        </div>
        {overBalance.length > 0 && (
          <p className="report-error" role="alert">
            El valor a pagar supera el saldo de: {overBalance.map(document => document.number).join(", ")}.
          </p>
        )}
        {state.error && (
          <p className="report-error" role="alert">
            {state.error}
          </p>
        )}
        <div className="report-actions">
          <Link href={backHref} className="secondary receipt-cancel">
            Cancelar
          </Link>
          <button
            type="submit"
            className="primary"
            disabled={state.busy || !supplierId || totalCents <= 0 || overBalance.length > 0}
          >
            {state.busy ? "Guardando…" : "Guardar pago"}
          </button>
        </div>
      </section>
    </form>
  );
}
