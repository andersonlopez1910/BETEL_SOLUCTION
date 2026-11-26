/**
 * "Nueva Compra / Gasto / Doc Soporte" (/compras/nuevo?tipo=PURCHASE|EXPENSE|SUPPORT).
 *
 * Compra y gasto: factura del proveedor, fecha, forma de pago (vencimiento si es a crédito) e ítems
 * → POST /v1/purchases (se contabiliza al guardar). Documento soporte (proveedor no obligado a facturar):
 * ítems sin descuento → POST /v1/support-documents y, si se marca, POST /v1/support-documents/:id/issue
 * para contabilizarlo. Los ítems usan el mismo editor de los documentos de venta.
 */
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiPost } from "../lib/api";
import { defaultPeriod, money, ReportStatus, useReport, useSession } from "./billing-report-common";
import { CreateCustomerDialog } from "./billing-report-portfolio";
import { purchaseHref, purchaseTypeLabels } from "./purchases";
import { LineItemsEditor, newLine, preview, toApiLines, type Line } from "./quote-form";

type Supplier = { id: string; legalName: string; identificationType: string; identificationNumber: string };

export function PurchaseForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { canPurchase: canRegister } = useSession();
  const today = defaultPeriod().to;
  const initialType = params.get("tipo");
  const [type, setType] = useState(initialType && initialType in purchaseTypeLabels ? initialType : "PURCHASE");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const suppliers = useReport<{ data: Supplier[] }>("/v1/purchases/suppliers", { search: query });
  const [form, setForm] = useState({
    supplierId: "",
    supplierInvoiceNumber: "",
    issueDate: today,
    paymentMethod: "CASH",
    dueDate: "",
    notes: "",
    issueNow: true,
  });
  const [lines, setLines] = useState<Line[]>([{ ...newLine(), taxRate: "0" }]);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const [creating, setCreating] = useState(false);
  const support = type === "SUPPORT";
  const totals = preview(support ? lines.map(line => ({ ...line, discountRate: "0" })) : lines);
  const set =
    (field: "supplierId" | "supplierInvoiceNumber" | "issueDate" | "paymentMethod" | "dueDate" | "notes") =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [field]: event.target.value });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    try {
      if (support) {
        const created = await apiPost<{ data: { id: string } }>("/v1/support-documents", {
          supplierId: form.supplierId,
          issueDate: form.issueDate,
          lines: toApiLines(lines, false).map(({ productId: _productId, ...line }) => line),
        });
        if (form.issueNow) await apiPost(`/v1/support-documents/${created.data.id}/issue`);
        router.push(`${purchaseHref("Support", created.data.id)}&creado=1`);
      } else {
        const created = await apiPost<{ data: { id: string } }>("/v1/purchases", {
          type,
          supplierId: form.supplierId,
          supplierInvoiceNumber: form.supplierInvoiceNumber.trim(),
          issueDate: form.issueDate,
          paymentMethod: form.paymentMethod,
          ...(form.paymentMethod === "CREDIT" && { dueDate: form.dueDate }),
          notes: form.notes || undefined,
          lines: toApiLines(lines),
        });
        router.push(`${purchaseHref("Purchase", created.data.id)}&creado=1`);
      }
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };

  if (suppliers.error && !canRegister)
    return (
      <div className="page-content">
        <ReportStatus loading={false} error={suppliers.error} />
      </div>
    );

  return (
    <form className="page-content receipt-form" onSubmit={submit}>
      <section className="panel">
        <div className="panel-head">
          <h2>Datos del documento</h2>
          <Link href="/compras?tab=documentos" className="report-link">
            ‹ Volver a Compras y gastos
          </Link>
        </div>
        <div className="purchase-types" role="radiogroup" aria-label="Tipo de documento">
          {Object.entries(purchaseTypeLabels).map(([value, name]) => (
            <label key={value} className={type === value ? "is-selected" : undefined}>
              <input type="radio" name="tipo" value={value} checked={type === value} onChange={() => setType(value)} />
              <b>{name}</b>
              <small>
                {value === "PURCHASE"
                  ? "Mercancía o activos con factura del proveedor"
                  : value === "EXPENSE"
                    ? "Servicios, arriendos y otros gastos con factura"
                    : "Compra a quien no está obligado a facturar"}
              </small>
            </label>
          ))}
        </div>
        <div className="receipt-fields">
          <div className="field receipt-customer">
            Proveedor
            <div className="pay-invoice-search">
              <input
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    setQuery(search);
                  }
                }}
                placeholder="Buscar por nombre o identificación"
                aria-label="Buscar proveedor"
              />
              <button type="button" className="secondary" onClick={() => setQuery(search)}>
                Buscar
              </button>
              <button type="button" className="secondary" onClick={() => setCreating(true)}>
                ＋ Crear proveedor
              </button>
            </div>
            <select value={form.supplierId} onChange={set("supplierId")} required aria-label="Proveedor">
              <option value="">{suppliers.loading ? "Cargando proveedores…" : "Selecciona un proveedor"}</option>
              {suppliers.data?.data.map(supplier => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.legalName} · {supplier.identificationType} {supplier.identificationNumber}
                </option>
              ))}
            </select>
            {suppliers.data && !suppliers.data.data.length && (
              <small className="report-hint">No hay proveedores con esa búsqueda. Créalo con “Crear proveedor”.</small>
            )}
          </div>
          {!support && (
            <label className="field">
              Factura del proveedor
              <input
                value={form.supplierInvoiceNumber}
                onChange={set("supplierInvoiceNumber")}
                placeholder="Ej. FE-1234"
                maxLength={40}
                required
              />
            </label>
          )}
          <label className="field">
            Fecha de elaboración
            <input type="date" value={form.issueDate} onChange={set("issueDate")} max={today} required />
          </label>
          {!support && (
            <label className="field">
              Forma de pago
              <select value={form.paymentMethod} onChange={set("paymentMethod")}>
                <option value="CASH">Contado</option>
                <option value="CREDIT">Crédito</option>
              </select>
            </label>
          )}
          {!support && form.paymentMethod === "CREDIT" && (
            <label className="field">
              Vencimiento
              <input type="date" value={form.dueDate} onChange={set("dueDate")} min={form.issueDate} required />
            </label>
          )}
          {support ? (
            <label className="field purchase-issue">
              <span>
                <input
                  type="checkbox"
                  checked={form.issueNow}
                  onChange={event => setForm({ ...form, issueNow: event.target.checked })}
                />{" "}
                Contabilizar al guardar
              </span>
              <small>Sin marcar queda en borrador y se contabiliza después desde la lista.</small>
            </label>
          ) : (
            <label className="field receipt-notes">
              Observaciones
              <textarea value={form.notes} onChange={set("notes")} maxLength={2000} rows={2} />
            </label>
          )}
        </div>
      </section>

      <LineItemsEditor lines={lines} setLines={setLines} discount={!support} />

      <section className="panel receipt-footer">
        <div>
          <span>Total {purchaseTypeLabels[type]?.toLowerCase()}</span>
          <b>{money(totals.total)}</b>
        </div>
        {state.error && (
          <p className="report-error" role="alert">
            {state.error}
          </p>
        )}
        <div className="report-actions">
          <Link href="/compras?tab=documentos" className="secondary receipt-cancel">
            Cancelar
          </Link>
          <button type="submit" className="primary" disabled={state.busy || !form.supplierId || !canRegister}>
            {state.busy ? "Guardando…" : `Guardar ${purchaseTypeLabels[type]?.toLowerCase()}`}
          </button>
        </div>
      </section>

      {creating && (
        <CreateCustomerDialog
          supplier
          supplierOnly
          onClose={() => setCreating(false)}
          onCreated={(name, id) => {
            setCreating(false);
            setSearch(name);
            setQuery(name);
            setForm(current => ({ ...current, supplierId: id }));
          }}
        />
      )}
    </form>
  );
}
