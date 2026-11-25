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

const exportColumns: ReportColumn<ProductRow>[] = [
  { header: "Tipo", value: row => kindLabels[row.kind] },
  { header: "Nombre", value: row => row.name },
  { header: "Código", value: row => row.sku ?? "" },
  { header: "Unidad", value: row => unitLabels[row.unit] ?? row.unit },
  { header: "Precio sin IVA", value: row => row.unitPrice, money: true },
  { header: "IVA %", value: row => Number(row.taxRate).toString() },
  { header: "Precio con IVA", value: row => row.priceWithTax, money: true },
  { header: "Stock", value: row => (row.stock ? Number(row.stock.quantity).toFixed(2) : "No aplica") },
  { header: "Estado", value: row => (row.active ? "Activo" : "Inactivo") },
  { header: "Descripción", value: row => row.description ?? "" },
];

type Dialog =
  | { kind: "form"; product: Partial<ProductRow> | null; mode: "create" | "edit" | "duplicate" }
  | { kind: "detail"; row: ProductRow }
  | { kind: "delete"; row: ProductRow }
  | { kind: "import" }
  | { kind: "top" };

function ProductManagement({ openCreate = false }: { openCreate?: boolean }) {
  const { company, canExport, canEmail: canEdit, canReceive: canDelete } = useSession();
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

/** Crear, editar o duplicar un producto o servicio. */
function ProductDialog({
  mode,
  product,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit" | "duplicate";
  product: Partial<ProductRow> | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [form, setForm] = useState({
    kind: product?.kind ?? "PRODUCT",
    sku: product?.sku ?? "",
    name: product?.name ?? "",
    description: product?.description ?? "",
    unit: product?.unit ?? "UND",
    unitPrice: product?.unitPrice ? String(Number(product.unitPrice)) : "",
    taxRate: product?.taxRate ? String(Number(product.taxRate)) : "19",
    taxTreatment: product?.taxTreatment ?? (Number(product?.taxRate) === 0 ? "EXEMPT" : "TAXED"),
    priceIncludesTaxes: false,
    inventoryControlled: product?.inventoryControlled ?? false,
    valuationMethod: "WEIGHTED_AVERAGE",
    initialCost: "",
    netRealizableValue: "",
    inventoryAccountId: "",
    costOfSalesAccountId: "",
  });
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const [accounts, setAccounts] = useState<{ id: string; code: string; name: string }[]>([]);
  const set =
    (field: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [field]: event.target.value });
  useEffect(() => {
    apiGet<{ data: { data: { id: string | null; code: string; name: string; postable: boolean; active: boolean }[] } }>(
      "/v1/accounting/chart"
    ).then(
      response => setAccounts(response.data.data.filter(item => item.id && item.postable && item.active) as { id: string; code: string; name: string }[]),
      () => undefined
    );
  }, []);
  useEffect(() => {
    if (mode !== "edit" || !product?.id) return;
    apiGet<{
      data: {
        product: {
          taxTreatment: "TAXED" | "EXEMPT" | "EXCLUDED" | "OTHER";
          priceIncludesTaxes: boolean;
          inventoryConfig: { controlled: boolean; valuationMethod: string | null; initialCost: string | null; netRealizableValue: string | null } | null;
          accountingConfig: { inventoryAccountId: string | null; costOfSalesAccountId: string | null } | null;
        };
      };
    }>(`/v1/products/${product.id}/configuration`).then(
      response => {
        const saved = response.data.product;
        setForm(current => ({
          ...current,
          taxTreatment: saved.taxTreatment,
          priceIncludesTaxes: saved.priceIncludesTaxes,
          inventoryControlled: saved.inventoryConfig?.controlled ?? false,
          valuationMethod: saved.inventoryConfig?.valuationMethod ?? "WEIGHTED_AVERAGE",
          initialCost: saved.inventoryConfig?.initialCost ?? "",
          netRealizableValue: saved.inventoryConfig?.netRealizableValue ?? "",
          inventoryAccountId: saved.accountingConfig?.inventoryAccountId ?? "",
          costOfSalesAccountId: saved.accountingConfig?.costOfSalesAccountId ?? "",
        }));
      },
      () => undefined
    );
  }, [mode, product?.id]);
  const rate = form.taxTreatment === "TAXED" ? Number(form.taxRate || 0) : 0;
  const enteredPrice = Number(form.unitPrice || 0);
  const basePrice = form.priceIncludesTaxes ? enteredPrice / (1 + rate / 100) : enteredPrice;
  const taxValue = basePrice * rate / 100;
  const withTax = basePrice + taxValue;
  const cost = Number(form.initialCost || 0);
  const noun = form.kind === "SERVICE" ? "servicio" : "producto";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ busy: true });
    const body = {
      kind: form.kind,
      sku: form.sku.trim() || undefined,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      unit: form.unit,
      unitPrice: Number(basePrice.toFixed(2)),
      taxRate: rate,
      taxTreatment: form.taxTreatment,
      priceIncludesTaxes: form.priceIncludesTaxes,
      inventoryConfig: {
        controlled: form.kind === "PRODUCT" && form.inventoryControlled,
        valuationMethod: form.kind === "PRODUCT" && form.inventoryControlled ? form.valuationMethod as "WEIGHTED_AVERAGE" | "FIFO" | "SPECIFIC_IDENTIFICATION" : undefined,
        initialCost: form.initialCost ? Number(form.initialCost) : undefined,
        netRealizableValue: form.netRealizableValue ? Number(form.netRealizableValue) : undefined,
      },
      accountingConfig: {
        inventoryAccountId: form.inventoryAccountId || undefined,
        costOfSalesAccountId: form.costOfSalesAccountId || undefined,
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

  return (
    <Modal
      title={mode === "edit" ? `Editar ${noun}` : mode === "duplicate" ? `Duplicar ${noun}` : "Nuevo producto o servicio"}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="events-form">
        <p className="product-form-intro events-form-full">Configura la información comercial, tributaria, contable y de inventario del concepto.</p>
        <div className="purchase-types events-form-full" role="radiogroup" aria-label="Tipo">
          {(["PRODUCT", "SERVICE"] as const).map(value => (
            <label key={value} className={form.kind === value ? "is-selected" : undefined}>
              <input
                type="radio"
                name="product-kind"
                checked={form.kind === value}
                onChange={() =>
                  setForm({
                    ...form,
                    kind: value,
                    unit:
                      value === "SERVICE" && form.unit === "UND"
                        ? "SERV"
                        : value === "PRODUCT" && form.unit === "SERV"
                          ? "UND"
                          : form.unit,
                  })
                }
              />
              <b>{kindLabels[value]}</b>
              <small>{value === "PRODUCT" ? "Se compra y se vende; maneja stock" : "Se presta; no maneja stock"}</small>
            </label>
          ))}
        </div>
        <label className="field events-form-full">
          Nombre
          <input value={form.name} onChange={set("name")} minLength={2} maxLength={200} required autoFocus />
        </label>
        <label className="field">
          Código
          <input
            value={form.sku}
            onChange={set("sku")}
            maxLength={80}
            placeholder="Vacío: se asigna el siguiente C-n"
          />
        </label>
        <label className="field">
          Unidad de medida
          <select value={form.unit} onChange={set("unit")}>
            {Object.entries(unitLabels).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
            {!(form.unit in unitLabels) && <option value={form.unit}>{form.unit}</option>}
          </select>
        </label>
        <label className="field">
          Precio de venta (sin IVA)
          <input type="number" min="0" step="0.01" value={form.unitPrice} onChange={set("unitPrice")} required />
        </label>
        <label className="field">
          Tratamiento IVA
          <select
            value={form.taxTreatment}
            onChange={event => {
              const taxTreatment = event.target.value as typeof form.taxTreatment;
              setForm({ ...form, taxTreatment, taxRate: taxTreatment === "TAXED" ? form.taxRate || "19" : "0" });
            }}
          >
            <option value="TAXED">Gravado</option>
            <option value="EXEMPT">Exento</option>
            <option value="EXCLUDED">Excluido</option>
            <option value="OTHER">No sujeto / otro</option>
          </select>
        </label>
        <label className="field">
          Tarifa IVA
          <select value={form.taxRate} disabled={form.taxTreatment !== "TAXED"} onChange={set("taxRate")}>
            <option value="19">19 %</option>
            <option value="5">5 %</option>
            <option value="0">0 %</option>
            {!["19", "5", "0"].includes(form.taxRate) && <option value={form.taxRate}>{form.taxRate} %</option>}
          </select>
        </label>
        <p className="report-dialog-text events-form-full">
          Base: <b>{money(basePrice)}</b> · IVA: <b>{money(taxValue)}</b> · Precio final: <b>{money(withTax)}</b>
        </p>
        <label className="field events-form-full checkbox-field">
          <input type="checkbox" checked={form.priceIncludesTaxes} onChange={event => setForm({ ...form, priceIncludesTaxes: event.target.checked })} />
          El precio digitado incluye impuestos
        </label>
        {form.kind === "PRODUCT" && (
          <details className="product-section events-form-full">
            <summary>Inventario y costos</summary>
            <div className="product-section-grid">
              <label className="field checkbox-field product-wide"><input type="checkbox" checked={form.inventoryControlled} onChange={event => setForm({ ...form, inventoryControlled: event.target.checked })} /> Controlar existencias</label>
              {form.inventoryControlled && <>
                <label className="field">Método de valoración<select value={form.valuationMethod} onChange={set("valuationMethod")}><option value="WEIGHTED_AVERAGE">Promedio ponderado</option><option value="FIFO">PEPS / FIFO</option><option value="SPECIFIC_IDENTIFICATION">Identificación específica</option></select></label>
                <label className="field">Costo inicial<input type="number" min="0" step="0.01" value={form.initialCost} onChange={set("initialCost")} /></label>
                <label className="field">Valor Neto Realizable <small title="Valor estimado de venta menos los costos necesarios para terminarlo y venderlo.">ⓘ</small><input type="number" min="0" step="0.01" value={form.netRealizableValue} onChange={set("netRealizableValue")} /></label>
                <label className="field">Cuenta de inventario<select value={form.inventoryAccountId} onChange={set("inventoryAccountId")} required><option value="">Selecciona una cuenta</option>{accounts.map(account => <option value={account.id} key={account.id}>{account.code} — {account.name}</option>)}</select></label>
                <label className="field">Cuenta costo de ventas<select value={form.costOfSalesAccountId} onChange={set("costOfSalesAccountId")} required><option value="">Selecciona una cuenta</option>{accounts.map(account => <option value={account.id} key={account.id}>{account.code} — {account.name}</option>)}</select></label>
                {form.netRealizableValue && Number(form.netRealizableValue) < cost && <p className="product-warning product-wide">El Valor Neto Realizable es inferior al costo. Revise si procede reconocer deterioro; no se generará automáticamente.</p>}
              </>}
            </div>
          </details>
        )}
        <aside className="product-live-summary events-form-full"><b>{form.kind === "PRODUCT" ? "Producto" : "Servicio"}: {form.name || "Sin nombre"}</b><span>Base {money(basePrice)} · IVA {money(taxValue)} · Final {money(withTax)}</span><span>Costo {money(cost)} · Margen estimado {money(basePrice - cost)} ({basePrice ? ((basePrice - cost) / basePrice * 100).toFixed(1) : "0"}%)</span><span>{form.taxTreatment === "TAXED" ? `Gravado ${rate}%` : form.taxTreatment === "EXEMPT" ? "Exento" : form.taxTreatment === "EXCLUDED" ? "Excluido" : "No sujeto"} · Inventariable: {form.kind === "PRODUCT" && form.inventoryControlled ? "Sí" : "No"}</span></aside>
        <label className="field events-form-full">
          Descripción (opcional)
          <textarea value={form.description} onChange={set("description")} rows={2} maxLength={1000} />
        </label>
        {state.error && (
          <p className="report-error events-form-full" role="alert">
            {state.error}
          </p>
        )}
        <div className="report-dialog-actions events-form-full">
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={state.busy}>
            {state.busy ? "Guardando…" : mode === "edit" ? "Guardar cambios" : `Crear ${noun}`}
          </button>
        </div>
      </form>
    </Modal>
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

const TEMPLATE =
  "Nombre;Código;Tipo;Unidad;Precio;IVA;Descripción\nTubo PVC 1/2;;Producto;unidad;5500;19;Presión\nInstalación;;Servicio;servicio;80000;0;\n";

function ImportProductsDialog({ onClose, onImported }: { onClose: () => void; onImported: (text: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<{ busy: boolean; error?: string; errors?: { row: number; message: string }[] }>({
    busy: false,
  });
  const template = () => downloadText("plantilla-productos.csv", TEMPLATE);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setState({ busy: true });
    try {
      const rows = await readSpreadsheet(file);
      if (!rows.length) return setState({ busy: false, error: "El archivo no trae filas con datos." });
      const result = await apiPost<{
        data: { created: number; errorCount: number; errors: { row: number; message: string }[] };
      }>("/v1/products/import", { rows });
      const { created, errorCount, errors } = result.data;
      if (errorCount && !created) return setState({ busy: false, error: "No se creó ningún producto.", errors });
      if (errorCount)
        return setState({
          busy: false,
          error: `Se crearon ${created}; ${errorCount} fila(s) no se importaron. Corrígelas y vuelve a subir solo esas filas.`,
          errors,
        });
      onImported(`Se importaron ${created} producto(s) o servicio(s).`);
    } catch (error) {
      setState({ busy: false, error: (error as Error).message });
    }
  };
  return (
    <Modal title="Importar productos y servicios" onClose={onClose} wide>
      <form onSubmit={submit}>
        <p className="report-dialog-text">
          Sube un archivo de Excel (.xlsx) o CSV con una fila de encabezados: <b>Nombre</b> (obligatorio), Código, Tipo
          (Producto o Servicio), Unidad, Precio (sin IVA) e IVA (19, 5 o 0), y Descripción. Sin código se asigna el
          siguiente C-n; los códigos que ya existen no se importan.{" "}
          <button type="button" className="report-link" onClick={template}>
            Descargar plantilla
          </button>
        </p>
        <label className="field">
          Archivo
          <input
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            onChange={event => {
              setFile(event.target.files?.[0] ?? null);
              setState({ busy: false });
            }}
          />
        </label>
        {state.error && (
          <div className="report-error" role="alert">
            <p>{state.error}</p>
            {state.errors && state.errors.length > 0 && (
              <ul className="products-import-errors">
                {state.errors.slice(0, 20).map(item => (
                  <li key={`${item.row}-${item.message}`}>
                    Fila {item.row}: {item.message}
                  </li>
                ))}
                {state.errors.length > 20 && <li>…y {state.errors.length - 20} más.</li>}
              </ul>
            )}
          </div>
        )}
        <div className="report-dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            {state.errors ? "Cerrar" : "Cancelar"}
          </button>
          <button type="submit" className="primary" disabled={state.busy || !file}>
            {state.busy ? "Importando…" : "Importar"}
          </button>
        </div>
      </form>
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
