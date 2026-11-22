/**
 * Página pública de pago (/pago?token=…): la abre el cliente desde el link que le envía la empresa.
 * No usa sesión: el token del link identifica el pago (GET /v1/public/payments/:token).
 *
 * Con la pasarela de PRUEBAS el cliente elige el medio y se simula la respuesta de la entidad
 * (aprobado o rechazado). Con una pasarela real esta página redirigirá al checkout del proveedor.
 */
"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { money } from "./billing-report-common";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type PublicPayment = {
  company: string;
  customer: string;
  invoice: string;
  reference: string;
  amount: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  mode: "sandbox" | "production" | null;
};

const methods = [
  ["PSE", "PSE (débito a cuenta)"],
  ["CARD", "Tarjeta de crédito o débito"],
  ["NEQUI", "Nequi"],
] as const;

export function PaymentCheckout() {
  const token = useSearchParams().get("token") ?? "";
  const url = `${API_URL}/v1/public/payments/${encodeURIComponent(token)}`;
  const [payment, setPayment] = useState<PublicPayment | null>(null);
  const [error, setError] = useState("");
  const [method, setMethod] = useState<string>("PSE");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    fetch(url)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Link de pago no válido.");
        setPayment(body.data);
      })
      .catch((failure: Error) =>
        setError(
          failure.message === "Failed to fetch" ? "No se pudo conectar con el servidor de pagos." : failure.message
        )
      );
  }, [url]);

  const simulate = async (result: "APPROVED" | "REJECTED") => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${url}/sandbox`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result, method }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo procesar el pago.");
      setReason(body.data.rejectionReason);
      setPayment(current => current && { ...current, status: body.data.status });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="checkout">
      <section className="checkout-card">
        <p className="checkout-brand">
          B<span>e</span>tel <small>Pagos en línea</small>
        </p>
        {error && !payment && (
          <p className="report-error" role="alert">
            {error}
          </p>
        )}
        {!payment && !error && <p className="report-message">Cargando…</p>}
        {payment && (
          <>
            {payment.mode === "sandbox" && (
              <p className="pay-sandbox">
                Entorno de <b>pruebas</b>: no se cobra dinero real.
              </p>
            )}
            <h1>{payment.company}</h1>
            <dl className="checkout-detail">
              <div>
                <dt>Cliente</dt>
                <dd>{payment.customer}</dd>
              </div>
              <div>
                <dt>Factura</dt>
                <dd>{payment.invoice}</dd>
              </div>
              <div>
                <dt>Referencia</dt>
                <dd>{payment.reference}</dd>
              </div>
            </dl>
            <p className="checkout-amount">
              <span>Valor a pagar</span>
              <b>{money(payment.amount)}</b>
            </p>

            {payment.status === "PENDING" && payment.mode === "sandbox" && (
              <>
                <fieldset className="checkout-methods">
                  <legend>Medio de pago</legend>
                  {methods.map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="method"
                        value={value}
                        checked={method === value}
                        onChange={() => setMethod(value)}
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <div className="checkout-actions">
                  <button type="button" className="primary" disabled={busy} onClick={() => simulate("APPROVED")}>
                    Simular pago aprobado
                  </button>
                  <button
                    type="button"
                    className="secondary danger"
                    disabled={busy}
                    onClick={() => simulate("REJECTED")}
                  >
                    Simular pago rechazado
                  </button>
                </div>
              </>
            )}
            {payment.status === "PENDING" && payment.mode !== "sandbox" && (
              <p className="report-message">La pasarela de pagos no está disponible en este momento.</p>
            )}
            {payment.status === "APPROVED" && (
              <p className="checkout-result is-ok" role="status">
                ✓ Pago aprobado. {payment.company} recibirá la confirmación.
              </p>
            )}
            {payment.status === "REJECTED" && (
              <p className="checkout-result is-bad" role="status">
                ✕ Pago rechazado.{reason ? ` ${reason}` : ""} Comunícate con {payment.company} para un nuevo link.
              </p>
            )}
            {payment.status === "CANCELLED" && (
              <p className="checkout-result" role="status">
                Este link fue anulado por {payment.company}.
              </p>
            )}
            {error && (
              <p className="report-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
