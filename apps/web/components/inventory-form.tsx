/**
 * "Nuevo documento" de inventario (/productos/documentos/nuevo?tipo=INITIAL|ADJUSTMENT, POST /v1/inventory-documents).
 *
 * Fecha de elaboración, tercero opcional, observaciones y renglones: producto (buscador sobre los productos activos),
 * movimiento (entrada o salida; el saldo inicial solo tiene entradas), cantidad y costo unitario. El total es
 * entradas − salidas. La API valida, numera (SI-n / AJ-n), mueve el stock y contabiliza.
 */
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiGet, apiPost } from "../lib/api";
import { defaultPeriod, money, useSession } from "./billing-report-common";
import { inventoryDocumentHref, inventoryTypeLabels } from "./product-documents";
import { unitLabels } from "./products";

type CatalogProduct = { id: string; name: string; sku: string | null; unit: string };
type Party = { id: string; legalName: string; identificationType: string; identificationNumber: string };
type Line = { product: CatalogProduct; direction: "IN" | "OUT"; quantity: string; unitCost: string };

const cents = (value: number) => Math.round(value * 100) / 100;

export function InventoryForm() {
  const router = useRouter();
  const requested = useSearchParams().get("tipo");
  const type = requested === "INITIAL" ? "INITIAL" : "ADJUSTMENT";
  const { canReceive: canEdit } = useSession();
  const today = defaultPeriod().to;
  const [form, setForm] = useState({ date: today, notes: "" });
  const [party, setParty] = useState<Party | null>(null);
  const [partySearch, setPartySearch] = useState("");
  const [parties, setParties] = useState<Party[] | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [products, setProducts] = useState<CatalogProduct[] | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  const findProducts = async () => {
    try {
      const result = await apiGet<{ data: CatalogProduct[] }>("/v1/products", {
        kind: "PRODUCT",
        search: productSearch.trim(),
      });
      setProducts(result.data);
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  const findParties = async () => {
    try {
      const result = await apiGet<{ data: Party[] }>("/v1/parties", { search: partySearch.trim() });
      setParties(result.data);
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  const addProduct = (product: CatalogProduct) => {
    if (lines.some(line => line.product.id === product.id)) return;
    setLines([...lines, { product, direction: "IN", quantity: "1", unitCost: "" }]);
  };
  const update = (index: number, patch: Partial<Line>) =>
    setLines(lines.map((line, position) => (position === index ? { ...line, ...patch } : line)));

  const valued = lines.map(line => ({
    ...line,
    total: cents(Number(line.quantity || 0) * Number(line.unitCost || 0)),
  }));
  const inflow = cents(valued.filter(line => line.direction === "IN").reduce((sum, line) => sum + line.total, 0));
  const outflow = cents(valued.filter(line => line.direction === "OUT").reduce((sum, line) => sum + line.total, 0));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!lines.length) return setState({ busy: false, error: "Agrega al menos un producto." });
    setState({ busy: true });
    try {
      const created = await apiPost<{ data: { id: string } }>("/v1/inventory-documents", {
        type,
        date: form.date,
        partyId: party?.id,
        notes: form.notes.trim() || undefined,
        lines: lines.map(line => ({
          productId: line.product.id,
          direction: type === "INITIAL" ? "IN" : line.direction,
          quantity: Number(line.quantity),
          unitCost: Number(line.unitCost),
        })),
      });
      router.push(`${inventoryDocumentHref(created.data.id)}&creado=1`);
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };

  return (
    <form className="page-content receipt-form" onSubmit={submit}>
      <section className="panel">
        <div className="panel-head">
          <h2>{inventoryTypeLabels[type]}</h2>
          <Link href="/productos?tab=documentos" className="report-link">
            ‹ Volver a Documentos de productos / servicios
          </Link>
        </div>
        <p className="report-hint">
          {type === "INITIAL"
            ? "Registra las cantidades y el costo con que empieza cada producto. Se contabiliza contra utilidades acumuladas (370505)."
            : "Las entradas registran sobrantes (ingreso 429595) y las salidas faltantes o mermas (gasto 519595)."}
        </p>
        <div className="receipt-fields">
          <label className="field">
            Fecha de elaboración
            <input
              type="date"
              value={form.date}
              max={today}
              onChange={event => setForm({ ...form, date: event.target.value })}
              required
            />
          </label>
          <div className="field receipt-customer">
            Tercero (opcional)
            {party ? (
              <span className="inventory-party">
                <b>{party.legalName}</b> · {party.identificationType} {party.identificationNumber}{" "}
                <button type="button" className="report-link" onClick={() => setParty(null)}>
                  Quitar
                </button>
              </span>
            ) : (
              <>
                <div className="pay-invoice-search">
                  <input
                    type="search"
                    value={partySearch}
                    onChange={event => setPartySearch(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        findParties();
                      }
                    }}
                    placeholder="Nombre o identificación"
                    aria-label="Buscar tercero"
                  />
                  <button type="button" className="secondary" onClick={findParties}>
                    Buscar
                  </button>
                </div>
                {parties && (
                  <div className="inventory-results" role="list">
                    {parties.length ? (
                      parties.slice(0, 8).map(item => (
                        <button
                          key={item.id}
                          type="button"
                          role="listitem"
                          className="secondary"
                          onClick={() => setParty(item)}
                        >
                          {item.legalName} · {item.identificationNumber}
                        </button>
                      ))
                    ) : (
                      <small>No hay terceros con esa búsqueda.</small>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <label className="field receipt-notes">
            Observaciones
            <textarea
              value={form.notes}
              onChange={event => setForm({ ...form, notes: event.target.value })}
              maxLength={1000}
              rows={2}
            />
          </label>
        </div>
      </section>

      <section className="panel report-table-panel">
        <div className="panel-head">
          <h2>Productos</h2>
          <span className="report-hint">Solo productos (los servicios no manejan inventario).</span>
        </div>
        <div className="pay-invoice-search inventory-product-search">
          <input
            type="search"
            value={productSearch}
            onChange={event => setProductSearch(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault();
                findProducts();
              }
            }}
            placeholder="Buscar producto por nombre o código"
            aria-label="Buscar producto"
          />
          <button type="button" className="secondary" onClick={findProducts}>
            Buscar
          </button>
        </div>
        {products && (
          <div className="inventory-results" role="list">
            {products.length ? (
              products.slice(0, 12).map(product => {
                const added = lines.some(line => line.product.id === product.id);
                return (
                  <button
                    key={product.id}
                    type="button"
                    role="listitem"
                    className="secondary"
                    disabled={added}
                    onClick={() => addProduct(product)}
                  >
                    {added ? "✓ " : "＋ "}
                    {product.name} · {product.sku ?? "sin código"}
                  </button>
                );
              })
            ) : (
              <small>No hay productos activos con esa búsqueda.</small>
            )}
          </div>
        )}
        {lines.length > 0 && (
          <div className="report-table-wrap">
            <table className="report-table inventory-lines">
              <thead>
                <tr>
                  <th>Producto</th>
                  {type === "ADJUSTMENT" && <th>Movimiento</th>}
                  <th className="num">Cantidad</th>
                  <th className="num">Costo unitario</th>
                  <th className="num">Total</th>
                  <th>
                    <span className="sr-only">Quitar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {valued.map((line, index) => (
                  <tr key={line.product.id}>
                    <td>
                      {line.product.name}
                      <small>
                        {line.product.sku ?? "Sin código"} · {unitLabels[line.product.unit] ?? line.product.unit}
                      </small>
                    </td>
                    {type === "ADJUSTMENT" && (
                      <td>
                        <select
                          value={line.direction}
                          onChange={event => update(index, { direction: event.target.value as "IN" | "OUT" })}
                          aria-label={`Movimiento de ${line.product.name}`}
                        >
                          <option value="IN">Entrada</option>
                          <option value="OUT">Salida</option>
                        </select>
                      </td>
                    )}
                    <td className="num">
                      <input
                        type="number"
                        min="0.0001"
                        step="any"
                        value={line.quantity}
                        onChange={event => update(index, { quantity: event.target.value })}
                        aria-label={`Cantidad de ${line.product.name}`}
                        required
                      />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitCost}
                        onChange={event => update(index, { unitCost: event.target.value })}
                        aria-label={`Costo unitario de ${line.product.name}`}
                        required
                      />
                    </td>
                    <td className="num">{money(line.total)}</td>
                    <td>
                      <button
                        type="button"
                        className="report-link danger"
                        onClick={() => setLines(lines.filter((_, position) => position !== index))}
                        aria-label={`Quitar ${line.product.name}`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel receipt-footer">
        <div>
          <span>
            Entradas {money(inflow)}
            {type === "ADJUSTMENT" && ` · Salidas ${money(outflow)}`}
          </span>
          <b>{money(cents(inflow - outflow))}</b>
        </div>
        {state.error && (
          <p className="report-error" role="alert">
            {state.error}
          </p>
        )}
        <div className="report-actions">
          <Link href="/productos?tab=documentos" className="secondary receipt-cancel">
            Cancelar
          </Link>
          <button type="submit" className="primary" disabled={state.busy || !lines.length || !canEdit}>
            {state.busy ? "Guardando…" : `Guardar ${inventoryTypeLabels[type].toLowerCase()}`}
          </button>
        </div>
      </section>
    </form>
  );
}
