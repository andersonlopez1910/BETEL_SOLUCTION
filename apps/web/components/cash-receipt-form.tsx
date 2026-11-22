/**
 * Formulario "Crear recibo de caja" (POST /v1/cash-receipts).
 *
 * 1. Se elige un cliente con facturas a crédito por cobrar (GET /v1/collections/pending-customers).
 * 2. Se listan sus facturas con saldo (GET /v1/collections/pending-invoices) y se indica cuánto se
 *    abona a cada una ("Pagar saldo" llena el saldo completo).
 * 3. El total del recibo es la suma de los abonos. La API vuelve a validar los saldos dentro de la
 *    transacción, así que dos personas no pueden abonar más que el saldo al mismo tiempo.
 */
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiPost } from "../lib/api";
import { date, money, ReportStatus, useReport } from "./billing-report-common";
import { methodLabels } from "./billing-report-collections";

type PendingCustomer = {
  id: string;
  legalName: string;
  identificationType: string;
  identificationNumber: string;
  invoiceCount: number;
  balance: string;
};
type PendingInvoice = {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string | null;
  status: string;
  total: string;
  applied: string;
  balance: string;
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
/** Centavos enteros para sumar sin errores de coma flotante. */
const cents = (value: string) => Math.round(Number(value || 0) * 100);

export function CashReceiptForm() {
  const router = useRouter();
  const customers = useReport<{ data: PendingCustomer[] }>("/v1/collections/pending-customers");
  // ?cliente=<id> llega desde la cartera o el estado de cuenta con el cliente ya elegido.
  const [customerId, setCustomerId] = useState(useSearchParams().get("cliente") ?? "");
  const invoices = useReport<{ data: PendingInvoice[] }>(customerId ? "/v1/collections/pending-invoices" : null, {
    customerId,
  });
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ date: today(), method: "CASH", reference: "", notes: "" });
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  const pending = customerId ? (invoices.data?.data ?? []) : [];
  const totalCents = pending.reduce((sum, invoice) => sum + cents(amounts[invoice.id] ?? ""), 0);
  const overBalance = pending.filter(invoice => cents(amounts[invoice.id] ?? "") > cents(invoice.balance));

  const chooseCustomer = (id: string) => {
    setCustomerId(id);
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
      .filter(invoice => cents(amounts[invoice.id] ?? "") > 0)
      .map(invoice => ({ invoiceId: invoice.id, amount: cents(amounts[invoice.id]!) / 100 }));
    if (!applications.length) return setState({ busy: false, error: "Indica cuánto se abona al menos a una factura." });
    setState({ busy: true });
    try {
      const created = await apiPost<{ data: { id: string } }>("/v1/cash-receipts", {
        customerId,
        date: form.date,
        method: form.method,
        reference: form.reference || undefined,
        notes: form.notes || undefined,
        applications,
      });
      router.push(`/recaudos/documento?type=CashReceipt&id=${created.data.id}&creado=1`);
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };

  // Sin permiso, la API responde 403 a la lista de clientes y ReportStatus muestra el mensaje.
  return (
    <form className="page-content receipt-form" onSubmit={submit}>
      <section className="panel">
        <div className="panel-head">
          <h2>Datos del recibo</h2>
          <Link href="/reportes/facturacion?tab=recaudos" className="report-link">
            ‹ Volver a Recaudos
          </Link>
        </div>
        <div className="receipt-fields">
          <label className="field receipt-customer">
            Cliente
            <select value={customerId} onChange={event => chooseCustomer(event.target.value)} required>
              <option value="">
                {customers.loading ? "Cargando clientes…" : "Selecciona un cliente con saldo pendiente"}
              </option>
              {customers.data?.data.map(customer => (
                <option key={customer.id} value={customer.id}>
                  {customer.legalName} · {customer.identificationNumber} · Saldo {money(customer.balance)}
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
              {Object.entries(methodLabels).map(([value, name]) => (
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
              placeholder="N.º de transferencia, voucher o cheque"
              maxLength={120}
            />
          </label>
          <label className="field receipt-notes">
            Observaciones
            <textarea value={form.notes} onChange={setField("notes")} maxLength={500} rows={2} />
          </label>
        </div>
        <ReportStatus loading={false} error={customers.error} />
        {customers.data && !customers.data.data.length && (
          <p className="report-message">
            No hay facturas a crédito con saldo pendiente. Las facturas de contado se recaudan al emitirse y no
            necesitan recibo de caja.
          </p>
        )}
      </section>

      {customerId && (
        <section className="panel report-table-panel">
          <div className="panel-head">
            <h2>Facturas por cobrar</h2>
            <span className="report-hint">Abona una o varias facturas; el total del recibo es la suma.</span>
          </div>
          <ReportStatus loading={invoices.loading} error={invoices.error} />
          {!invoices.loading && (
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
                    <th className="num">Valor a abonar</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(invoice => {
                    const over = cents(amounts[invoice.id] ?? "") > cents(invoice.balance);
                    return (
                      <tr key={invoice.id}>
                        <td>
                          <Link href={`/recaudos/documento?type=Invoice&id=${invoice.id}`} className="collections-doc">
                            {invoice.number}
                          </Link>
                          {invoice.status === "OVERDUE" && <small className="receipt-overdue">Vencida</small>}
                        </td>
                        <td>{date(invoice.issueDate)}</td>
                        <td>{date(invoice.dueDate)}</td>
                        <td className="num">{money(invoice.total)}</td>
                        <td className="num">{money(invoice.applied)}</td>
                        <td className="num">{money(invoice.balance)}</td>
                        <td className="num">
                          <div className="receipt-amount">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              max={invoice.balance}
                              inputMode="decimal"
                              value={amounts[invoice.id] ?? ""}
                              onChange={event => setAmounts({ ...amounts, [invoice.id]: event.target.value })}
                              aria-label={`Valor a abonar a ${invoice.number}`}
                              aria-invalid={over || undefined}
                            />
                            <button
                              type="button"
                              className="report-link"
                              onClick={() => setAmounts({ ...amounts, [invoice.id]: invoice.balance })}
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
          <span>Total del recibo</span>
          <b>{money(totalCents / 100)}</b>
        </div>
        {overBalance.length > 0 && (
          <p className="report-error" role="alert">
            El valor a abonar supera el saldo de: {overBalance.map(invoice => invoice.number).join(", ")}.
          </p>
        )}
        {state.error && (
          <p className="report-error" role="alert">
            {state.error}
          </p>
        )}
        <div className="report-actions">
          <Link href="/reportes/facturacion?tab=recaudos" className="secondary receipt-cancel">
            Cancelar
          </Link>
          <button
            type="submit"
            className="primary"
            disabled={state.busy || !customerId || totalCents <= 0 || overBalance.length > 0}
          >
            {state.busy ? "Guardando…" : "Guardar recibo de caja"}
          </button>
        </div>
      </section>
    </form>
  );
}
