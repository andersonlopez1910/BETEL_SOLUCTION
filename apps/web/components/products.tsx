/**
 * Módulo "Productos y servicios" (/productos): submenús Gestión de productos / servicios (este archivo), Documentos
 * de productos / servicios (product-documents.tsx) y Costeo mensual (costing.tsx).
 *
 * Gestión (GET /v1/reports/products): búsqueda, filtros (tipo, estado, stock), descarga en Excel, "Ver reportes"
 * (más vendidos), "Crear / Importar" (crear producto o servicio, importar de Excel o CSV), selección para activar o
 * inactivar varios, y por fila Editar, Duplicar, Activar/Inactivar y Eliminar. El stock se calcula de compras y
 * ventas (ver apps/api/src/products.ts y docs/productos-y-servicios.md).
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import { downloadText, readSpreadsheet } from "../lib/spreadsheet";
import type { ReportColumn } from "../lib/report-export";
import { ActionMenu } from "./action-menu";
import { kardexHref } from "./kardex";
import {
  date,
  defaultPeriod,
  exportFromApi,
  money,
  ReportStatus,
  useReport,
  useSession,
} from "./billing-report-common";
import { FilterIcon } from "./billing-report-collections";
import { MonthlyCosting } from "./costing";
import { ProductDocuments } from "./product-documents";
import { SearchIllustration } from "./billing-report-quotes";
import { Modal } from "./collection-dialogs";
import { ProductDialog } from "./product-form";

/** [slug, nombre del submenú]. Orden y nombres de la referencia. */
const productTabs = [
  ["gestion", "Gestión de productos / servicios"],
  ["documentos", "Documentos de productos / servicios"],
  ["costeo", "Costeo mensual"],
] as const;

export function ProductsModule() {
  const params = useSearchParams();
  const requested = params.get("tab");
  const [slug] = productTabs.find(([tab]) => tab === requested) ?? productTabs[0];
  return (
    <div className="page-content">
      <nav className="report-tabs" aria-label="Productos y servicios">
        {productTabs.map(([tab, name]) => (
          <Link
            key={tab}
            href={`/productos?tab=${tab}`}
            scroll={false}
            aria-current={tab === slug ? "page" : undefined}
            className={tab === slug ? "active" : undefined}
          >
            {name}
          </Link>
        ))}
      </nav>
      {slug === "gestion" && <ProductManagement openCreate={params.get("new") === "product"} />}
      {slug === "documentos" && <ProductDocuments />}
      {slug === "costeo" && <MonthlyCosting />}
    </div>
  );
}

type ProductRow = {
  id: string;
  kind: "PRODUCT" | "SERVICE";
  name: string;
  sku: string | null;
  description: string | null;
  unit: string;
  unitPrice: string;
  taxRate: string;
  taxTreatment?: "TAXED" | "EXEMPT" | "EXCLUDED" | "OTHER";
  inventoryControlled?: boolean;
  configurationStatus?: "READY" | "INCOMPLETE";
  priceWithTax: string;
  active: boolean;
  stock: { inflow: string; outflow: string; quantity: string; state: "NEGATIVE" | "ZERO" | "POSITIVE" } | null;
  /** Parametrización tributaria: digitado y calculado por el motor único (apps/api/src/products.ts). */
  tax?: {
    gtin: string | null;
    category: string | null;
    unspscCode: string | null;
    billingChannel: string;
    costEntered: string;
    costIncludesVat: boolean;
    purchaseVatTreatment: string;
    purchaseVatRate: string;
    costBase: string;
    purchaseVat: string;
    vatDeductible: string;
    vatNonDeductible: string;
    accountingCost: string;
    priceEntered: string;
    priceIncludesTaxes: boolean;
    saleTaxTreatment: string;
    saleVatRate: string;
    priceBase: string;
    saleVat: string;
    incRate: string;
    saleInc: string;
    finalPrice: string;
    profit: string;
    margin: string;
  };
};
type ProductsResponse = { data: ProductRow[]; pagination: { page: number; pageSize: number; total: number } };

export const unitLabels: Record<string, string> = {
  UND: "unidad",
  SERV: "servicio",
  KG: "kilogramo",
  M: "metro",
  M2: "metro cuadrado",
  M3: "metro cúbico",
  L: "litro",
  GAL: "galón",
  CAJA: "caja",
  PAQ: "paquete",
  HORA: "hora",
};
const kindLabels = { PRODUCT: "Producto", SERVICE: "Servicio" } as const;
const statusLabels: Record<string, string> = { ALL: "Todos", ACTIVE: "Activo", INACTIVE: "Inactivo" };
const stockLabels: Record<string, string> = { NEGATIVE: "Negativo", ZERO: "En cero", POSITIVE: "Positivo" };
const quantity = (value: string) =>
  new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
const taxLabel = (rate: string) => (Number(rate) ? `IVA ${Number(rate)} %` : "Exento / 0 %");

type Filters = { search: string; kind: string; status: string; stock: string };
const noFilters: Filters = { search: "", kind: "", status: "ALL", stock: "" };

const yes = (value: boolean | undefined) => (value ? "SI" : "NO");
const num = (value: string | undefined) => (value === undefined ? null : Number(value));
const exportColumns: ReportColumn<ProductRow>[] = [
  { header: "Nombre", value: row => row.name },
  { header: "Código", value: row => row.sku ?? "" },
  { header: "Código de barras", value: row => row.tax?.gtin ?? "" },
  { header: "Categoría", value: row => row.tax?.category ?? "" },
  { header: "Tipo", value: row => (row.kind === "SERVICE" ? "SERVICIO" : "PRODUCTO") },
  { header: "Unidad", value: row => unitLabels[row.unit] ?? row.unit },
  { header: "UNSPSC", value: row => row.tax?.unspscCode ?? "" },
  { header: "Inventariable", value: row => yes(row.inventoryControlled) },
  { header: "Existencia", value: row => (row.stock ? Number(row.stock.quantity) : null) },
  { header: "Costo ingresado", value: row => row.tax?.costEntered, money: true },
  { header: "IVA incluido costo", value: row => yes(row.tax?.costIncludesVat) },
  { header: "Tratamiento IVA compra", value: row => row.tax?.purchaseVatTreatment ?? "" },
  { header: "Tarifa IVA compra", value: row => num(row.tax?.purchaseVatRate) },
  { header: "Base costo", value: row => row.tax?.costBase, money: true },
  { header: "IVA compra", value: row => row.tax?.purchaseVat, money: true },
  { header: "IVA descontable", value: row => row.tax?.vatDeductible, money: true },
  { header: "IVA no descontable", value: row => row.tax?.vatNonDeductible, money: true },
  { header: "Costo contable", value: row => row.tax?.accountingCost, money: true },
  { header: "Precio ingresado", value: row => row.tax?.priceEntered ?? row.unitPrice, money: true },
  { header: "Impuesto incluido venta", value: row => yes(row.tax?.priceIncludesTaxes) },
  { header: "Tratamiento tributario venta", value: row => row.tax?.saleTaxTreatment ?? "" },
  { header: "Tarifa IVA venta", value: row => num(row.tax?.saleVatRate ?? row.taxRate) },
  { header: "Base precio venta", value: row => row.tax?.priceBase ?? row.unitPrice, money: true },
  { header: "IVA venta", value: row => row.tax?.saleVat, money: true },
  { header: "INC", value: row => row.tax?.saleInc, money: true },
  { header: "Precio final venta", value: row => row.tax?.finalPrice ?? row.priceWithTax, money: true },
  { header: "Utilidad unitaria", value: row => row.tax?.profit, money: true },
  { header: "Margen bruto %", value: row => num(row.tax?.margin) },
  { header: "Canal facturación", value: row => row.tax?.billingChannel ?? "" },
  { header: "Estado", value: row => (row.active ? "Activo" : "Inactivo") },
];

type Dialog =
  | { kind: "form"; product: Partial<ProductRow> | null; mode: "create" | "edit" | "duplicate" }
  | { kind: "detail"; row: ProductRow }
  | { kind: "delete"; row: ProductRow }
  | { kind: "import" }
  | { kind: "top" };

function ProductManagement({ openCreate = false }: { openCreate?: boolean }) {
  const { company, canExport, canEditCatalog: canEdit, canDeleteProducts: canDelete } = useSession();
  const [applied, setApplied] = useState<Filters>(noFilters);
  const [draft, setDraft] = useState<Filters>(noFilters);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog | null>(() => (openCreate ? { kind: "form", product: null, mode: "create" } : null));
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const report = useReport<ProductsResponse>("/v1/reports/products", { ...applied, page, pageSize });
  const rows = report.data?.data ?? [];
  const total = report.data?.pagination.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const apply = (filters: Filters) => {
    setApplied(filters);
    setDraft(filters);
    setSearch(filters.search);
    setPage(1);
    setSelected(new Set());
  };
  const chips = [
    ...(applied.kind ? [{ label: `Tipo: ${kindLabels[applied.kind as "PRODUCT"]}`, clear: { kind: "" } }] : []),
    ...(applied.status !== "ALL"
      ? [{ label: `Estado: ${statusLabels[applied.status]}`, clear: { status: "ALL" } }]
      : []),
    ...(applied.stock ? [{ label: `Stock: ${stockLabels[applied.stock]}`, clear: { stock: "" } }] : []),
  ];

  const run = async (action: () => Promise<unknown>, done: string) => {
    setNotice(null);
    try {
      await action();
      setNotice({ kind: "ok", text: done });
      setSelected(new Set());
      report.reload();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };

  const download = async () => {
    setNotice(null);
    try {
      const { search: text, ...rest } = applied;
      await exportFromApi<ProductRow>("xlsx", "/v1/reports/products/export", { ...rest, search: text }, response => ({
        company,
        title: "Productos y servicios",
        period: { from: null, to: null },
        filters: [
          ...(applied.search ? [["Búsqueda", applied.search] as [string, string]] : []),
          ...chips.map(chip => chip.label.split(": ") as [string, string]),
        ],
        columns: exportColumns,
        rows: response.data,
        totals: [["Productos y servicios", String(response.data.length)]],
        fileName: "productos-y-servicios",
      }));
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };

  const pageIds = rows.map(row => row.id);
  const allOnPage = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <>
      <section className="panel collections quotes products-panel">
        <form
          className="quotes-toolbar"
          onSubmit={event => {
            event.preventDefault();
            apply({ ...applied, search: search.trim() });
          }}
        >
          <span className="collections-search products-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={search}
              onChange={event => {
                setSearch(event.target.value);
                if (!event.target.value && applied.search) apply({ ...applied, search: "" });
              }}
              placeholder="Buscar producto o servicio"
              aria-label="Buscar producto o servicio por nombre, código o descripción"
            />
          </span>
          <button
            type="button"
            className="secondary quotes-more"
            aria-expanded={showFilters}
            aria-controls="products-filters"
            onClick={() => {
              setDraft(applied);
              setShowFilters(!showFilters);
            }}
          >
            <FilterIcon /> Filtros
            {chips.length > 0 && <b className="quotes-count">{chips.length}</b>}
          </button>
          <span className="collections-spacer" />
          <button
            type="button"
            className="secondary imports-excel"
            onClick={download}
            disabled={!canExport || !total}
            title={
              !canExport
                ? "Tu rol no permite descargar"
                : !total
                  ? "No hay productos para descargar"
                  : "Descargar en Excel"
            }
            aria-label="Descargar en Excel"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 2h9l5 5v15H6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="m9.5 11 4 6m0-6-4 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <ActionMenu
            label="Ver reportes"
            className="secondary quotes-download"
            items={[
              {
                label: "Productos más vendidos",
                note: "Cantidades y ventas con IVA por período",
                onSelect: () => setDialog({ kind: "top" }),
              },
              {
                label: "Productos con stock negativo",
                onSelect: () => apply({ ...noFilters, stock: "NEGATIVE", status: "ACTIVE" }),
              },
            ]}
          >
            Ver reportes
          </ActionMenu>
          <ActionMenu
            label="Crear o importar"
            className="primary products-create"
            items={[
              {
                label: "Crear producto",
                disabled: !canEdit,
                onSelect: () => setDialog({ kind: "form", mode: "create", product: { kind: "PRODUCT" } }),
              },
              {
                label: "Crear servicio",
                disabled: !canEdit,
                onSelect: () => setDialog({ kind: "form", mode: "create", product: { kind: "SERVICE", unit: "SERV" } }),
              },
              {
                label: "Importar desde Excel o CSV",
                disabled: !canEdit,
                onSelect: () => setDialog({ kind: "import" }),
              },
            ]}
          >
            Crear / Importar <span aria-hidden="true">⌄</span>
          </ActionMenu>
        </form>

        {showFilters && (
          <form
            id="products-filters"
            className="collections-filters quotes-filters"
            onSubmit={event => {
              event.preventDefault();
              apply({ ...draft, search: search.trim() });
              setShowFilters(false);
            }}
          >
            <label className="field">
              Tipo
              <select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value })}>
                <option value="">Todos</option>
                <option value="PRODUCT">Producto</option>
                <option value="SERVICE">Servicio</option>
              </select>
            </label>
            <label className="field">
              Estado
              <select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}>
                {Object.entries(statusLabels).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Stock (productos)
              <select value={draft.stock} onChange={event => setDraft({ ...draft, stock: event.target.value })}>
                <option value="">Todos</option>
                {Object.entries(stockLabels).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div className="report-actions">
              <button type="submit" className="primary">
                Aplicar
              </button>
              <button type="button" className="secondary" onClick={() => setShowFilters(false)}>
                Cancelar
              </button>
            </div>
          </form>
        )}

        {chips.length > 0 && (
          <div className="quotes-chips">
            {chips.map(chip => (
              <span key={chip.label} className="quotes-chip">
                {chip.label}
                <button
                  type="button"
                  aria-label={`Quitar filtro ${chip.label}`}
                  onClick={() => apply({ ...applied, ...chip.clear })}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              className="report-link"
              onClick={() => apply({ ...noFilters, search: applied.search })}
            >
              Limpiar filtros
            </button>
          </div>
        )}

        {selected.size > 0 && (
          <div className="products-bulk" role="region" aria-label="Acciones con los seleccionados">
            <b>{selected.size} seleccionado(s)</b>
            <button
              type="button"
              className="secondary"
              disabled={!canEdit}
              onClick={() =>
                run(
                  () => apiPost("/v1/products/bulk-active", { ids: [...selected], active: true }),
                  "Seleccionados activados."
                )
              }
            >
              Activar
            </button>
            <button
              type="button"
              className="secondary danger"
              disabled={!canEdit}
              onClick={() =>
                run(
                  () => apiPost("/v1/products/bulk-active", { ids: [...selected], active: false }),
                  "Seleccionados inactivados."
                )
              }
            >
              Inactivar
            </button>
            <button type="button" className="report-link" onClick={() => setSelected(new Set())}>
              Quitar selección
            </button>
          </div>
        )}

        {notice && (
          <p className={notice.kind === "ok" ? "collections-notice" : "collections-notice is-error"} role="status">
            {notice.text}
          </p>
        )}
        <ReportStatus loading={report.loading && !report.data} error={report.error} />

        {report.data && (
          <>
            <div className="report-table-wrap">
              <table className="report-table collections-table products-table">
                <thead>
                  <tr>
                    <th className="products-check">
                      <input
                        type="checkbox"
                        checked={allOnPage}
                        aria-label="Seleccionar todos los de esta página"
                        onChange={() => {
                          const next = new Set(selected);
                          for (const id of pageIds) {
                            if (allOnPage) next.delete(id);
                            else next.add(id);
                          }
                          setSelected(next);
                        }}
                      />
                    </th>
                    <th>Tipo</th>
                    <th>Nombre</th>
                    <th>Código</th>
                    <th>Unidad</th>
                    <th className="num">Precios</th>
                    <th>Impuestos</th>
                    <th className="num">Stock</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className={row.active ? undefined : "is-cancelled"}>
                      <td className="products-check">
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggle(row.id)}
                          aria-label={`Seleccionar ${row.name}`}
                        />
                      </td>
                      <td>{kindLabels[row.kind]}</td>
                      <td className="products-name">
                        <button
                          type="button"
                          className="report-link collections-doc"
                          title={row.name}
                          onClick={() => setDialog({ kind: "detail", row })}
                        >
                          {row.name}
                        </button>
                      </td>
                      <td>{row.sku ?? "—"}</td>
                      <td>{unitLabels[row.unit] ?? row.unit}</td>
                      <td className="num">
                        <span className="products-value">
                          {money(row.unitPrice)}
                          <button
                            type="button"
                            className="products-more"
                            aria-label={`Ver precios de ${row.name}`}
                            onClick={() => setDialog({ kind: "detail", row })}
                          >
                            ⋯
                          </button>
                        </span>
                      </td>
                      <td>{taxLabel(row.taxRate)}</td>
                      <td className="num">
                        {row.stock ? (
                          <span className="products-value">
                            <span
                              className={`products-stock is-${row.stock.state.toLowerCase()}`}
                              title={`Stock ${stockLabels[row.stock.state].toLowerCase()}`}
                            >
                              {quantity(row.stock.quantity)}
                            </span>
                            <button
                              type="button"
                              className="products-more"
                              aria-label={`Ver stock de ${row.name}`}
                              onClick={() => setDialog({ kind: "detail", row })}
                            >
                              ⋯
                            </button>
                          </span>
                        ) : (
                          <span className="event-pending" title="Los servicios no manejan stock">
                            No aplica
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={row.active ? "products-status is-active" : "products-status"}>
                          <span aria-hidden="true">{row.active ? "✓" : "–"}</span> {row.active ? "Activo" : "Inactivo"}
                        </span>
                      </td>
                      <td>
                        <div className="split-button row-actions">
                          <button
                            type="button"
                            className="secondary pay-main"
                            disabled={!canEdit}
                            onClick={() => setDialog({ kind: "form", mode: "edit", product: row })}
                          >
                            Editar
                          </button>
                          <ActionMenu
                            label={`Más acciones de ${row.name}`}
                            className="secondary split-toggle"
                            items={[
                              { label: "Ver detalle", onSelect: () => setDialog({ kind: "detail", row }) },
                              ...(row.kind === "PRODUCT"
                                ? [{ label: "Ver kárdex", note: "Entradas, salidas y costo", href: kardexHref(row.id) }]
                                : []),
                              {
                                label: "Duplicar",
                                disabled: !canEdit,
                                onSelect: () =>
                                  setDialog({
                                    kind: "form",
                                    mode: "duplicate",
                                    product: { ...row, id: undefined, sku: null, name: `${row.name} (copia)` },
                                  }),
                              },
                              {
                                label: row.active ? "Inactivar" : "Activar",
                                disabled: !canEdit,
                                onSelect: () =>
                                  run(
                                    () => apiPost(`/v1/products/${row.id}/active`, { active: !row.active }),
                                    `${row.name} ${row.active ? "inactivado" : "activado"}.`
                                  ),
                              },
                              {
                                label: "Eliminar",
                                danger: true,
                                disabled: !canDelete,
                                note: canDelete ? "Solo si ningún documento lo usa" : "Tu rol no permite eliminar",
                                onSelect: () => setDialog({ kind: "delete", row }),
                              },
                            ]}
                          >
                            <span aria-hidden="true">⌄</span>
                          </ActionMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <div className="pay-empty">
                <SearchIllustration />
                {applied.search || chips.length ? (
                  <>
                    <h3>No se encontraron resultados para tu búsqueda.</h3>
                    <p>Modifica tus criterios de búsqueda o filtrado e inténtalo de nuevo.</p>
                  </>
                ) : (
                  <>
                    <h3>Aún no tienes productos ni servicios.</h3>
                    <p>Créalos uno a uno o impórtalos desde un archivo de Excel o CSV.</p>
                  </>
                )}
              </div>
            )}
            <div className="pay-pagination quotes-pagination">
              <label>
                Filas por página:
                <select
                  value={pageSize}
                  onChange={event => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  {[10, 25, 50, 100].map(size => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <span>
                {total ? (page - 1) * pageSize + 1 : 0} a {Math.min(page * pageSize, total)} de {total}
              </span>
              <button type="button" aria-label="Primera página" disabled={page <= 1} onClick={() => setPage(1)}>
                «
              </button>
              <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ‹
              </button>
              <span>
                Página <b>{total ? page : 0}</b> de <b>{pages}</b>
              </span>
              <button
                type="button"
                aria-label="Página siguiente"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                ›
              </button>
              <button type="button" aria-label="Última página" disabled={page >= pages} onClick={() => setPage(pages)}>
                »
              </button>
            </div>
          </>
        )}
      </section>

      {dialog?.kind === "form" && (
        <ProductDialog
          mode={dialog.mode}
          product={dialog.product}
          onClose={() => setDialog(null)}
          onSaved={name => {
            setDialog(null);
            setNotice({ kind: "ok", text: `${name} ${dialog.mode === "edit" ? "actualizado" : "creado"}.` });
            report.reload();
          }}
        />
      )}
      {dialog?.kind === "detail" && <ProductDetail row={dialog.row} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <Modal title={`Eliminar ${dialog.row.name}`} onClose={() => setDialog(null)}>
          <p className="report-dialog-text">
            Solo se puede eliminar si ningún documento (factura, cotización, remisión, compra o factura recurrente) lo
            usa. Si ya tiene historial, inactívalo.
          </p>
          <div className="report-dialog-actions">
            <button type="button" className="secondary" onClick={() => setDialog(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="primary danger"
              onClick={() => {
                const row = dialog.row;
                setDialog(null);
                run(() => apiDelete(`/v1/products/${row.id}`), `${row.name} eliminado.`);
              }}
            >
              Eliminar
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === "import" && (
        <ImportProductsDialog
          onClose={() => setDialog(null)}
          onImported={text => {
            setDialog(null);
            setNotice({ kind: "ok", text });
            report.reload();
          }}
        />
      )}
      {dialog?.kind === "top" && <TopProductsDialog onClose={() => setDialog(null)} />}
    </>
  );
}

/** Detalle: precios (sin y con IVA) y, en productos, entradas, salidas y stock. */
function ProductDetail({ row, onClose }: { row: ProductRow; onClose: () => void }) {
  return (
    <Modal title={row.name} onClose={onClose}>
      <dl className="document-meta products-detail">
        <div>
          <dt>Tipo y código</dt>
          <dd>
            {kindLabels[row.kind]} · {row.sku ?? "Sin código"} · {unitLabels[row.unit] ?? row.unit}
          </dd>
        </div>
        <div>
          <dt>Precio de venta sin IVA</dt>
          <dd>{money(row.unitPrice)}</dd>
        </div>
        <div>
          <dt>Impuesto</dt>
          <dd>{taxLabel(row.taxRate)}</dd>
        </div>
        <div>
          <dt>Precio con IVA</dt>
          <dd>
            <b>{money(row.priceWithTax)}</b>
          </dd>
        </div>
        {row.stock && (
          <>
            <div>
              <dt>Entradas (compras, saldo inicial y ajustes)</dt>
              <dd>{quantity(row.stock.inflow)}</dd>
            </div>
            <div>
              <dt>Salidas (facturas de venta y ajustes)</dt>
              <dd>{quantity(row.stock.outflow)}</dd>
            </div>
            <div>
              <dt>Stock</dt>
              <dd>
                <b className={`products-stock is-${row.stock.state.toLowerCase()}`}>{quantity(row.stock.quantity)}</b>
              </dd>
            </div>
          </>
        )}
        {row.description && (
          <div>
            <dt>Descripción</dt>
            <dd>{row.description}</dd>
          </div>
        )}
      </dl>
      {row.stock && (
        <p className="report-dialog-text">
          El stock se calcula con las compras registradas en Compras y gastos, el saldo inicial y los ajustes de
          inventario (Documentos de productos / servicios) y las facturas de venta emitidas. Un valor negativo indica
          que se ha vendido más de lo registrado como entrada.
        </p>
      )}
      <div className="report-dialog-actions">
        <button type="button" className="primary" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Modal>
  );
}

/** Plantilla con las 22 columnas de la importación (ver apps/api/src/product-import.ts). */
const TEMPLATE = [
  "Nombre;Código;Código de barras;Categoría;Tipo;Unidad;UNSPSC;Inventariable;Cantidad inicial;Costo unitario;IVA incluido costo;Tratamiento IVA compra;Tarifa IVA compra;Tratamiento IVA descontable;Porcentaje IVA descontable;Precio de venta;Impuesto incluido venta;Tratamiento tributario venta;Tarifa IVA venta;Tarifa INC;Canal de facturación;Descripción",
  "Tubo PVC 1/2;PVC-12;7701234567890;Tubería;PRODUCTO;unidad;40142000;SI;10;3000;SI;GRAVADO_19;19;DESCONTABLE_TOTAL;;5500;SI;IVA_19;19;;AMBOS;Presión",
  "Instalación de tubería;INST-01;;Servicios;SERVICIO;servicio;72151500;NO;;;;;;;;80000;NO;IVA_EXCLUIDO;0;;FE;Mano de obra",
  "Almuerzo ejecutivo;ALM-01;;Restaurante;PRODUCTO;unidad;;NO;;;;;;;;10800;SI;INC;0;8;POS;",
].join("\n") + "\n";

type PreviewRow = {
  row: number;
  status: "OK" | "WARNING" | "ERROR";
  messages: string[];
  name: string;
  sku: string | null;
  kind: "PRODUCT" | "SERVICE";
  values: {
    cost: number;
    costBase: number;
    purchaseVat: number;
    accountingCost: number;
    price: number;
    priceBase: number;
    saleVat: number;
    saleInc: number;
    finalPrice: number;
    margin: number;
  };
};
type Preview = { data: PreviewRow[]; summary: { total: number; ok: number; warnings: number; errors: number } };
const statusText = { OK: "Correcto", WARNING: "Advertencia", ERROR: "Error" } as const;

/**
 * Importar desde Excel o CSV en dos pasos: (1) vista previa calculada por la API con el motor tributario único
 * (estado por fila: Correcto, Advertencia o Error); (2) importar solo las filas sin error.
 */
function ImportProductsDialog({ onClose, onImported }: { onClose: () => void; onImported: (text: string) => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [filter, setFilter] = useState<"ALL" | "ERROR" | "WARNING">("ALL");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const template = () => downloadText("plantilla-productos.csv", TEMPLATE);

  const analyze = async (file: File) => {
    setState({ busy: true });
    setPreview(null);
    try {
      const read = await readSpreadsheet(file);
      if (!read.length) return setState({ busy: false, error: "El archivo no trae filas con datos." });
      setRows(read);
      setPreview(await apiPost<Preview>("/v1/products/import/preview", { rows: read }));
      setState({ busy: false });
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };

  const importValid = async () => {
    if (!rows) return;
    setState({ busy: true });
    try {
      const result = await apiPost<{ data: { created: number; errorCount: number } }>("/v1/products/import", { rows });
      const { created, errorCount } = result.data;
      onImported(
        errorCount
          ? `Se importaron ${created} producto(s) o servicio(s); ${errorCount} fila(s) con error no se importaron.`
          : `Se importaron ${created} producto(s) o servicio(s).`
      );
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };

  const importable = preview ? preview.summary.ok + preview.summary.warnings : 0;
  const visible = preview?.data.filter(row => filter === "ALL" || row.status === filter) ?? [];
  return (
    <Modal title="Importar productos y servicios" onClose={onClose} wide closeButton>
      <div className="import-preview">
        <p className="report-dialog-text">
          Sube un Excel (.xlsx) o CSV con las columnas de la plantilla. Betel valida cada fila y calcula base, IVA, INC y
          costo contable con su motor tributario <b>antes</b> de importar; las fórmulas del archivo no se usan.{" "}
          <button type="button" className="report-link" onClick={template}>
            Descargar plantilla
          </button>
        </p>
        <label className="field">
          Archivo
          <input
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void analyze(file);
            }}
          />
        </label>
        {state.busy && !preview && <p className="report-message">Analizando el archivo…</p>}
        {preview && (
          <>
            <div className="import-summary" role="status">
              <button type="button" className={filter === "ALL" ? "is-active" : undefined} onClick={() => setFilter("ALL")}>
                <b>{preview.summary.total}</b> filas
              </button>
              <span className="is-ok">
                <b>{preview.summary.ok}</b> correctas
              </span>
              <button type="button" className={filter === "WARNING" ? "is-active is-warning" : "is-warning"} onClick={() => setFilter("WARNING")}>
                <b>{preview.summary.warnings}</b> advertencias
              </button>
              <button type="button" className={filter === "ERROR" ? "is-active is-error" : "is-error"} onClick={() => setFilter("ERROR")}>
                <b>{preview.summary.errors}</b> errores
              </button>
            </div>
            <div className="report-table-wrap import-table">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>Producto</th>
                    <th>Código</th>
                    <th className="num">Costo</th>
                    <th className="num">Base costo</th>
                    <th className="num">IVA compra</th>
                    <th className="num">Costo contable</th>
                    <th className="num">Precio</th>
                    <th className="num">Base venta</th>
                    <th className="num">IVA venta</th>
                    <th className="num">Precio final</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(row => (
                    <tr key={row.row} className={`is-${row.status.toLowerCase()}`}>
                      <td>{row.row}</td>
                      <td>
                        {row.name || "—"}
                        {row.messages.length > 0 && (
                          <ul className="import-messages">
                            {row.messages.map(message => (
                              <li key={message}>{message}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td>{row.sku ?? "Automático"}</td>
                      <td className="num">{money(row.values.cost)}</td>
                      <td className="num">{money(row.values.costBase)}</td>
                      <td className="num">{money(row.values.purchaseVat)}</td>
                      <td className="num">{money(row.values.accountingCost)}</td>
                      <td className="num">{money(row.values.price)}</td>
                      <td className="num">{money(row.values.priceBase)}</td>
                      <td className="num">{money(row.values.saleVat + row.values.saleInc)}</td>
                      <td className="num">{money(row.values.finalPrice)}</td>
                      <td>
                        <span className={`import-status is-${row.status.toLowerCase()}`}>{statusText[row.status]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
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
          <button type="button" className="primary" disabled={state.busy || !importable} onClick={importValid}>
            {state.busy && preview ? "Importando…" : `Importar ${importable} fila(s) sin error`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

type TopRow = {
  id: string;
  name: string;
  sku: string | null;
  kind: "PRODUCT" | "SERVICE";
  unit: string;
  quantity: string;
  total: string;
  lines: number;
};

function TopProductsDialog({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState(defaultPeriod);
  const top = useReport<{ data: TopRow[]; period: { from: string; to: string } }>("/v1/reports/products/top", period);
  return (
    <Modal title="Productos más vendidos" onClose={onClose} wide>
      <div className="products-top-period">
        <label className="field">
          Desde
          <input
            type="date"
            value={period.from}
            max={period.to}
            onChange={event => setPeriod({ ...period, from: event.target.value })}
          />
        </label>
        <label className="field">
          Hasta
          <input
            type="date"
            value={period.to}
            min={period.from}
            onChange={event => setPeriod({ ...period, to: event.target.value })}
          />
        </label>
      </div>
      <ReportStatus loading={top.loading && !top.data} error={top.error} />
      {top.data &&
        (top.data.data.length ? (
          <div className="report-table-wrap aging-table">
            <table className="report-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Producto o servicio</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Ventas con IVA</th>
                </tr>
              </thead>
              <tbody>
                {top.data.data.map((row, index) => (
                  <tr key={row.id}>
                    <td>{index + 1}</td>
                    <td>
                      {row.name}
                      <small>
                        {row.sku ?? "Sin código"} · {kindLabels[row.kind]} · {row.lines} línea(s) de factura
                      </small>
                    </td>
                    <td className="num">
                      {quantity(row.quantity)} {unitLabels[row.unit] ?? row.unit}
                    </td>
                    <td className="num">
                      <b>{money(row.total)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="report-message">
            No hay facturas emitidas con productos del catálogo entre el {date(top.data.period.from)} y el{" "}
            {date(top.data.period.to)}.
          </p>
        ))}
      <div className="report-dialog-actions">
        <button type="button" className="primary" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
