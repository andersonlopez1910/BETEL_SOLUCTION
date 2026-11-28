/**
 * Crear, editar o duplicar un producto o servicio con su parametrización tributaria completa.
 * Secciones: información general, inventario (solo productos), costo e IVA en compra, precio de venta e impuestos,
 * contabilidad y el resumen tributario en tiempo real. Los cálculos los hace el MOTOR ÚNICO
 * (@betel/contracts/tax-engine), el mismo que usa la API al guardar, la factura, la importación y los reportes.
 */
"use client";

import {
  BILLING_CHANNELS,
  computeCost,
  computeSale,
  DEDUCTIBLE_TREATMENTS,
  grossProfit,
  PURCHASE_VAT_TREATMENTS,
  SALE_TAX_TREATMENTS,
  saleTreatmentFromLegacy,
  type BillingChannel,
  type DeductibleTreatment,
  type PurchaseVatTreatment,
  type SaleTaxTreatment,
} from "@betel/contracts/tax-engine";
import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { money } from "./billing-report-common";
import { Modal } from "./collection-dialogs";
import { unitLabels } from "./products";

type Mode = "create" | "edit" | "duplicate";
type Account = { id: string; code: string; name: string };
type SavedProduct = {
  kind: "PRODUCT" | "SERVICE";
  sku: string | null;
  name: string;
  description: string | null;
  unit: string;
  gtin: string | null;
  category: string | null;
  unspscCode: string | null;
  billingChannel: BillingChannel;
  active: boolean;
  unitPrice: string;
  taxRate: string;
  taxTreatment: string;
  priceIncludesTaxes: boolean;
  priceEntered: string;
  saleTaxTreatment: SaleTaxTreatment;
  incRate: string;
  costEntered: string;
  costIncludesVat: boolean;
  purchaseVatTreatment: PurchaseVatTreatment;
  deductibleTreatment: DeductibleTreatment;
  deductiblePct: string;
  inventoryConfig: {
    controlled: boolean;
    minimumStock: string | null;
    maximumStock: string | null;
    valuationMethod: string | null;
    lotControl: boolean;
    serialControl: boolean;
    expiryControl: boolean;
  } | null;
  accountingConfig: Record<string, string | null> | null;
  taxConfig: { appliesInc: boolean; incRate: string | null } | null;
};

const empty = {
  kind: "PRODUCT" as "PRODUCT" | "SERVICE",
  name: "",
  sku: "",
  gtin: "",
  category: "",
  description: "",
  unit: "UND",
  unspscCode: "",
  active: true,
  // Inventario
  inventoryControlled: false,
  initialQuantity: "",
  minimumStock: "",
  maximumStock: "",
  valuationMethod: "WEIGHTED_AVERAGE",
  lotControl: false,
  expiryControl: false,
  serialControl: false,
  // Costo
  costAmount: "",
  costIncludesVat: true,
  purchaseTreatment: "GRAVADO_19" as PurchaseVatTreatment,
  deductible: "DESCONTABLE_TOTAL" as DeductibleTreatment,
  deductiblePct: "100",
  // Venta
  priceAmount: "",
  priceIncludesTax: true,
  saleTreatment: "IVA_19" as SaleTaxTreatment,
  incRate: "8",
  billingChannel: "AMBOS" as BillingChannel,
  // Contabilidad
  inventoryAccountId: "",
  costOfSalesAccountId: "",
  incomeAccountId: "",
  vatSalesAccountId: "",
  returnsAccountId: "",
};
type FormState = typeof empty;

/** Conserva el formulario a partir de un producto guardado (editar o duplicar). */
function fromSaved(saved: SavedProduct, mode: Mode): FormState {
  const legacyTreatment =
    saved.saleTaxTreatment ??
    saleTreatmentFromLegacy(saved.taxTreatment, Number(saved.taxRate), saved.taxConfig?.appliesInc ?? false);
  return {
    ...empty,
    kind: saved.kind,
    name: mode === "duplicate" ? `${saved.name} (copia)` : saved.name,
    sku: mode === "duplicate" ? "" : (saved.sku ?? ""),
    gtin: mode === "duplicate" ? "" : (saved.gtin ?? ""),
    category: saved.category ?? "",
    description: saved.description ?? "",
    unit: saved.unit,
    unspscCode: saved.unspscCode ?? "",
    active: saved.active,
    inventoryControlled: saved.inventoryConfig?.controlled ?? false,
    minimumStock: saved.inventoryConfig?.minimumStock ?? "",
    maximumStock: saved.inventoryConfig?.maximumStock ?? "",
    valuationMethod: saved.inventoryConfig?.valuationMethod ?? "WEIGHTED_AVERAGE",
    lotControl: saved.inventoryConfig?.lotControl ?? false,
    expiryControl: saved.inventoryConfig?.expiryControl ?? false,
    serialControl: saved.inventoryConfig?.serialControl ?? false,
    costAmount: Number(saved.costEntered) ? String(Number(saved.costEntered)) : "",
    costIncludesVat: saved.costIncludesVat,
    purchaseTreatment: saved.purchaseVatTreatment ?? "GRAVADO_19",
    deductible: saved.deductibleTreatment ?? "DESCONTABLE_TOTAL",
    deductiblePct: String(Number(saved.deductiblePct ?? 100)),
    priceAmount: String(Number(saved.priceEntered || saved.unitPrice)),
    priceIncludesTax: saved.priceIncludesTaxes,
    saleTreatment: legacyTreatment,
    incRate: Number(saved.incRate) ? String(Number(saved.incRate)) : "8",
    billingChannel: saved.billingChannel ?? "AMBOS",
    inventoryAccountId: saved.accountingConfig?.inventoryAccountId ?? "",
    costOfSalesAccountId: saved.accountingConfig?.costOfSalesAccountId ?? "",
    incomeAccountId: saved.accountingConfig?.incomeAccountId ?? "",
    vatSalesAccountId: saved.accountingConfig?.vatSalesAccountId ?? "",
    returnsAccountId: saved.accountingConfig?.returnsAccountId ?? "",
  };
}

function YesNo({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <span className="pf-yesno" role="radiogroup" aria-label={label}>
      {[true, false].map(option => (
        <button
          key={String(option)}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={value === option ? "is-selected" : undefined}
          onClick={() => onChange(option)}
        >
          {option ? "Sí" : "No"}
        </button>
      ))}
    </span>
  );
}

function Help({ children }: { children: React.ReactNode }) {
  return <small className="pf-help">{children}</small>;
}

export function ProductDialog({
  mode,
  product,
  onClose,
  onSaved,
}: {
  mode: Mode;
  product: { id?: string; kind?: "PRODUCT" | "SERVICE" } | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [form, setForm] = useState<FormState>({ ...empty, kind: product?.kind ?? "PRODUCT" });
  const [loading, setLoading] = useState(mode !== "create" && !!product?.id);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(current => ({ ...current, [key]: value }));
  const input =
    (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      set(key, event.target.value as never);

  useEffect(() => {
    apiGet<{ data: { id: string | null; code: string; name: string; postable: boolean; active: boolean }[] }>(
      "/v1/accounting/chart"
    ).then(
      response => setAccounts(response.data.filter(item => item.id && item.postable && item.active) as Account[]),
      () => undefined
    );
  }, []);
  useEffect(() => {
    if (mode === "create" || !product?.id) return;
    apiGet<{ data: { product: SavedProduct } }>(`/v1/products/${product.id}/configuration`).then(
      response => {
        setForm(fromSaved(response.data.product, mode));
        setLoading(false);
      },
      (error: Error) => {
        setState({ busy: false, error: error.message });
        setLoading(false);
      }
    );
  }, [mode, product?.id]);

  const isProduct = form.kind === "PRODUCT";
  const noun = isProduct ? "producto" : "servicio";
  const saleConfig = SALE_TAX_TREATMENTS[form.saleTreatment];
  // Motor tributario único: mismo cálculo que la API, la factura y la importación.
  const cost = computeCost({
    amount: Number(form.costAmount || 0),
    includesVat: form.costIncludesVat,
    treatment: form.purchaseTreatment,
    deductible: form.deductible,
    deductiblePct: Number(form.deductiblePct || 0),
  });
  const sale = computeSale({
    amount: Number(form.priceAmount || 0),
    includesTax: form.priceIncludesTax,
    treatment: form.saleTreatment,
    incRate: Number(form.incRate || 0),
  });
  const profit = grossProfit(sale.base, cost.accountingCost);
  const hasCost = Number(form.costAmount || 0) > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    const inventory = isProduct && form.inventoryControlled;
    const body = {
      kind: form.kind,
      sku: form.sku.trim() || undefined,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      unit: form.unit,
      gtin: form.gtin.trim() || undefined,
      category: form.category.trim() || undefined,
      unspscCode: form.unspscCode.trim() || undefined,
      billingChannel: form.billingChannel,
      // La API deriva base, tarifa y tratamiento con el motor; unitPrice se envía solo por compatibilidad.
      unitPrice: Number(form.priceAmount || 0),
      cost: hasCost
        ? {
            amount: Number(form.costAmount),
            includesVat: form.costIncludesVat,
            treatment: form.purchaseTreatment,
            deductible: form.deductible,
            deductiblePct: form.deductible === "DESCONTABLE_PARCIAL" ? Number(form.deductiblePct || 0) : undefined,
          }
        : undefined,
      sale: {
        amount: Number(form.priceAmount || 0),
        includesTax: form.priceIncludesTax,
        treatment: form.saleTreatment,
        incRate: saleConfig.inc ? Number(form.incRate || 0) : undefined,
      },
      initialQuantity: mode !== "edit" && inventory && Number(form.initialQuantity) > 0 ? Number(form.initialQuantity) : undefined,
      inventoryConfig: {
        controlled: inventory,
        valuationMethod: inventory ? (form.valuationMethod as "WEIGHTED_AVERAGE" | "FIFO" | "SPECIFIC_IDENTIFICATION") : undefined,
        minimumStock: inventory && form.minimumStock ? Number(form.minimumStock) : undefined,
        maximumStock: inventory && form.maximumStock ? Number(form.maximumStock) : undefined,
        initialCost: hasCost ? cost.accountingCost : undefined,
        lotControl: inventory && form.lotControl,
        expiryControl: inventory && form.expiryControl,
        serialControl: inventory && form.serialControl,
      },
      accountingConfig: {
        inventoryAccountId: (inventory && form.inventoryAccountId) || undefined,
        costOfSalesAccountId: (inventory && form.costOfSalesAccountId) || undefined,
        incomeAccountId: form.incomeAccountId || undefined,
        vatSalesAccountId: form.vatSalesAccountId || undefined,
        returnsAccountId: form.returnsAccountId || undefined,
      },
    };
    try {
      if (mode === "edit") await apiPut(`/v1/products/${product!.id}`, body);
      else await apiPost("/v1/products", body);
      onSaved(body.name);
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };

  const accountSelect = (key: keyof FormState, label: string, required = false) => (
    <label className="field">
      {label}
      <select value={form[key] as string} onChange={input(key)} required={required}>
        <option value="">{required ? "Selecciona una cuenta" : "Cuenta por defecto de Betel"}</option>
        {accounts.map(account => (
          <option value={account.id} key={account.id}>
            {account.code} — {account.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Modal
      title={mode === "edit" ? `Editar ${noun}` : mode === "duplicate" ? `Duplicar ${noun}` : "Nuevo producto o servicio"}
      onClose={onClose}
      wide
      closeButton
    >
      {loading ? (
        <p className="report-message">Cargando la configuración…</p>
      ) : (
        <form onSubmit={submit} className="pf-form">
          <div className="pf-kind" role="radiogroup" aria-label="Tipo">
            {(["PRODUCT", "SERVICE"] as const).map(value => (
              <label key={value} className={form.kind === value ? "is-selected" : undefined}>
                <input
                  type="radio"
                  name="product-kind"
                  checked={form.kind === value}
                  onChange={() =>
                    setForm(current => ({
                      ...current,
                      kind: value,
                      // Un servicio nunca es inventariable.
                      inventoryControlled: value === "SERVICE" ? false : current.inventoryControlled,
                      unit:
                        value === "SERVICE" && current.unit === "UND"
                          ? "SERV"
                          : value === "PRODUCT" && current.unit === "SERV"
                            ? "UND"
                            : current.unit,
                    }))
                  }
                />
                <b>{value === "PRODUCT" ? "Producto" : "Servicio"}</b>
                <small>{value === "PRODUCT" ? "Se compra y se vende; puede manejar inventario" : "Se presta; no maneja inventario"}</small>
              </label>
            ))}
          </div>

          <div className="pf-layout">
            <div className="pf-sections">
              <section className="pf-card">
                <h3>
                  <span>A</span> Información general
                </h3>
                <div className="pf-grid">
                  <label className="field pf-wide">
                    Nombre del {noun}
                    <input value={form.name} onChange={input("name")} minLength={2} maxLength={200} required autoFocus />
                  </label>
                  <label className="field">
                    Código interno
                    <input value={form.sku} onChange={input("sku")} maxLength={80} placeholder="Vacío: siguiente C-n" />
                  </label>
                  <label className="field">
                    Código de barras
                    <input value={form.gtin} onChange={input("gtin")} maxLength={40} placeholder="EAN / GTIN" />
                  </label>
                  <label className="field">
                    Categoría
                    <input value={form.category} onChange={input("category")} maxLength={80} placeholder="Ej.: Tubería" />
                  </label>
                  <label className="field">
                    Unidad de medida
                    <select value={form.unit} onChange={input("unit")}>
                      {Object.entries(unitLabels).map(([value, name]) => (
                        <option key={value} value={value}>
                          {name}
                        </option>
                      ))}
                      {!(form.unit in unitLabels) && <option value={form.unit}>{form.unit}</option>}
                    </select>
                  </label>
                  <label className="field">
                    Código UNSPSC
                    <input
                      value={form.unspscCode}
                      onChange={event => set("unspscCode", event.target.value.replace(/\D/g, "").slice(0, 8))}
                      inputMode="numeric"
                      placeholder="8 dígitos"
                    />
                  </label>
                  {mode === "edit" && (
                    <label className="field">
                      Estado
                      <input value={form.active ? "Activo" : "Inactivo"} readOnly />
                    </label>
                  )}
                  <label className="field pf-wide">
                    Descripción
                    <textarea value={form.description} onChange={input("description")} rows={2} maxLength={1000} />
                  </label>
                </div>
              </section>

              {isProduct && (
                <section className="pf-card">
                  <h3>
                    <span>B</span> Inventario
                  </h3>
                  <div className="pf-grid">
                    <div className="field">
                      Inventariable
                      <YesNo value={form.inventoryControlled} onChange={value => set("inventoryControlled", value)} label="Inventariable" />
                      <Help>Sí: Betel controla existencias, costo promedio y costo de ventas.</Help>
                    </div>
                    {form.inventoryControlled && (
                      <>
                        {mode !== "edit" && (
                          <label className="field">
                            Cantidad inicial
                            <input type="number" min="0" step="0.0001" value={form.initialQuantity} onChange={input("initialQuantity")} />
                            <Help>Se registra como saldo inicial al costo contable.</Help>
                          </label>
                        )}
                        <label className="field">
                          Stock mínimo
                          <input type="number" min="0" step="0.0001" value={form.minimumStock} onChange={input("minimumStock")} />
                        </label>
                        <label className="field">
                          Stock máximo
                          <input type="number" min="0" step="0.0001" value={form.maximumStock} onChange={input("maximumStock")} />
                        </label>
                        <label className="field">
                          Método de costeo
                          <select value={form.valuationMethod} onChange={input("valuationMethod")}>
                            <option value="WEIGHTED_AVERAGE">Promedio ponderado</option>
                            <option value="FIFO">PEPS / FIFO</option>
                            <option value="SPECIFIC_IDENTIFICATION">Identificación específica</option>
                          </select>
                        </label>
                        <label className="field">
                          Bodega inicial
                          <input value="Bodega principal" readOnly />
                          <Help>Betel maneja por ahora una sola bodega por empresa.</Help>
                        </label>
                        <div className="field pf-wide pf-checks">
                          <label>
                            <input type="checkbox" checked={form.lotControl} onChange={event => set("lotControl", event.target.checked)} /> Control
                            por lote
                          </label>
                          <label>
                            <input type="checkbox" checked={form.expiryControl} onChange={event => set("expiryControl", event.target.checked)} />{" "}
                            Fecha de vencimiento
                          </label>
                          <label>
                            <input type="checkbox" checked={form.serialControl} onChange={event => set("serialControl", event.target.checked)} />{" "}
                            Control por serial
                          </label>
                        </div>
                        {accountSelect("inventoryAccountId", "Cuenta de inventario", true)}
                        {accountSelect("costOfSalesAccountId", "Cuenta de costo de ventas", true)}
                      </>
                    )}
                  </div>
                </section>
              )}

              <section className="pf-card">
                <h3>
                  <span>C</span> Costo y tratamiento del IVA en compra
                </h3>
                <div className="pf-grid">
                  <label className="field">
                    Costo unitario
                    <input type="number" min="0" step="0.01" value={form.costAmount} onChange={input("costAmount")} placeholder="$ 0" />
                  </label>
                  <div className="field">
                    ¿El costo ingresado incluye IVA?
                    <YesNo value={form.costIncludesVat} onChange={value => set("costIncludesVat", value)} label="El costo incluye IVA" />
                    <Help>Seleccione Sí cuando el valor que está registrando ya contiene el IVA.</Help>
                  </div>
                  <label className="field">
                    Tratamiento de IVA en compra
                    <select value={form.purchaseTreatment} onChange={input("purchaseTreatment")}>
                      {Object.entries(PURCHASE_VAT_TREATMENTS).map(([value, config]) => (
                        <option key={value} value={value}>
                          {config.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Tarifa IVA compra
                    <input value={`${cost.rate} %`} readOnly />
                  </label>
                  <label className="field">
                    Tratamiento del IVA descontable
                    <select value={form.deductible} onChange={input("deductible")}>
                      {Object.entries(DEDUCTIBLE_TREATMENTS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {form.deductible === "DESCONTABLE_PARCIAL" && (
                    <label className="field">
                      Porcentaje IVA descontable
                      <input type="number" min="0" max="100" step="0.01" value={form.deductiblePct} onChange={input("deductiblePct")} required />
                    </label>
                  )}
                </div>
              </section>

              <section className="pf-card">
                <h3>
                  <span>D</span> Precio de venta e impuestos
                </h3>
                <div className="pf-grid">
                  <label className="field">
                    Precio de venta
                    <input type="number" min="0" step="0.01" value={form.priceAmount} onChange={input("priceAmount")} required placeholder="$ 0" />
                  </label>
                  <div className="field">
                    ¿El precio ingresado incluye impuesto?
                    <YesNo value={form.priceIncludesTax} onChange={value => set("priceIncludesTax", value)} label="El precio incluye impuesto" />
                    <Help>Seleccione Sí cuando el precio registrado corresponde al valor final que pagará el cliente.</Help>
                  </div>
                  <label className="field">
                    Tratamiento tributario de venta
                    <select value={form.saleTreatment} onChange={input("saleTreatment")}>
                      {Object.entries(SALE_TAX_TREATMENTS).map(([value, config]) => (
                        <option key={value} value={value}>
                          {config.label}
                        </option>
                      ))}
                    </select>
                    <Help>Define cómo Betel calculará y reportará los impuestos del {noun}.</Help>
                  </label>
                  <label className="field">
                    Tarifa IVA venta
                    <input value={`${saleConfig.vatRate} %`} readOnly />
                  </label>
                  {saleConfig.inc && (
                    <label className="field">
                      Tarifa INC
                      <input type="number" min="0" max="100" step="0.01" value={form.incRate} onChange={input("incRate")} required />
                    </label>
                  )}
                  <label className="field">
                    Canal de facturación
                    <select value={form.billingChannel} onChange={input("billingChannel")}>
                      {Object.entries(BILLING_CHANNELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              <section className="pf-card">
                <h3>
                  <span>E</span> Contabilidad
                </h3>
                <div className="pf-grid">
                  {accountSelect("incomeAccountId", "Cuenta de ingresos")}
                  {accountSelect("vatSalesAccountId", "Cuenta IVA generado")}
                  {accountSelect("returnsAccountId", "Cuenta de devoluciones")}
                </div>
                <Help>Sin selección se usan las cuentas por defecto de Betel (413595 ingresos y 240805 IVA generado).</Help>
              </section>
            </div>

            <aside className="pf-summary" aria-live="polite">
              <h3>Resumen tributario</h3>
              <dl>
                <div>
                  <dt>Costo ingresado</dt>
                  <dd>{money(cost.entered)}</dd>
                </div>
                <div>
                  <dt>Costo antes de IVA</dt>
                  <dd>{money(cost.base)}</dd>
                </div>
                <div>
                  <dt>IVA compra</dt>
                  <dd>{money(cost.vat)}</dd>
                </div>
                {cost.vatNonDeductible > 0 && (
                  <div>
                    <dt>IVA no descontable</dt>
                    <dd>{money(cost.vatNonDeductible)}</dd>
                  </div>
                )}
                <div className="is-strong">
                  <dt>Costo contable</dt>
                  <dd>{money(cost.accountingCost)}</dd>
                </div>
                <hr />
                <div>
                  <dt>Precio ingresado</dt>
                  <dd>{money(sale.entered)}</dd>
                </div>
                <div>
                  <dt>Precio antes de impuestos</dt>
                  <dd>{money(sale.base)}</dd>
                </div>
                <div>
                  <dt>IVA venta {sale.vatRate ? `(${sale.vatRate} %)` : ""}</dt>
                  <dd>{money(sale.vat)}</dd>
                </div>
                {saleConfig.inc && (
                  <div>
                    <dt>INC ({sale.incRate} %)</dt>
                    <dd>{money(sale.inc)}</dd>
                  </div>
                )}
                <div className="is-strong">
                  <dt>Precio final al cliente</dt>
                  <dd>{money(sale.total)}</dd>
                </div>
                <hr />
                <div className={profit.profit < 0 ? "is-negative" : "is-positive"}>
                  <dt>Utilidad bruta</dt>
                  <dd>{money(profit.profit)}</dd>
                </div>
                <div className={profit.profit < 0 ? "is-negative" : "is-positive"}>
                  <dt>Margen bruto</dt>
                  <dd>{profit.margin.toLocaleString("es-CO", { minimumFractionDigits: 2 })} %</dd>
                </div>
              </dl>
              {hasCost && sale.base < cost.accountingCost && (
                <p className="pf-warning">El precio de venta antes de impuestos es inferior al costo contable.</p>
              )}
              <small>Calculado con el motor tributario de Betel; al guardar, el servidor lo vuelve a calcular.</small>
            </aside>
          </div>

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
              {state.busy ? "Guardando…" : mode === "edit" ? "Guardar cambios" : `Crear ${noun}`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
