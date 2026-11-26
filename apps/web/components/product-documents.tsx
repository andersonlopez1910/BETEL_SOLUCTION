/**
 * Productos y servicios › Documentos de productos / servicios (/productos?tab=documentos): saldos iniciales y
 * ajustes de inventario (GET /v1/reports/inventory-documents).
 *
 * Búsqueda por tercero o comprobante, "Más filtros" (fecha de elaboración —últimos 30 días por defecto—, tipo de
 * transacción y estado) con etiquetas, Descargar, Importar (saldo inicial o ajuste desde Excel/CSV) y "Nuevo
 * documento". Reglas en apps/api/src/inventory.ts y docs/productos-y-servicios.md.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import { apiPost } from "../lib/api";
import type { ExportFormat, ReportColumn } from "../lib/report-export";
import { downloadText, readSpreadsheet } from "../lib/spreadsheet";
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
import { periodPresets, presetRange, SearchIllustration, type Preset } from "./billing-report-quotes";
import { Modal, VoidDocumentDialog } from "./collection-dialogs";

type DocumentType = "INITIAL" | "ADJUSTMENT";
type InventoryRow = {
  id: string;
  type: DocumentType;
  typeLabel: string;
  number: string;
  date: string;
  party: { id: string; legalName: string; identificationType: string; identificationNumber: string } | null;
  branch: string | null;
  total: string;
  currency: string;
  status: "ACTIVE" | "VOID";
  lineCount: number;
};
type InventoryResponse = { data: InventoryRow[]; pagination: { page: number; pageSize: number; total: number } };

export const inventoryTypeLabels: Record<DocumentType, string> = {
  INITIAL: "Saldo inicial",
  ADJUSTMENT: "Ajuste de inventario",
};
export const inventoryDocumentHref = (id: string) => `/productos/documentos/ver?id=${id}`;
export const newInventoryHref = (type: DocumentType) => `/productos/documentos/nuevo?tipo=${type}`;

type Filters = { search: string; preset: Preset; from: string; to: string; type: string; status: string };
const initialFilters = (): Filters => ({
  search: "",
  preset: "last30",
  ...presetRange("last30", defaultPeriod()),
  type: "",
  status: "",
});

const columns: ReportColumn<InventoryRow>[] = [
  { header: "Tipo transacción", value: row => row.typeLabel },
  { header: "Comprobante", value: row => row.number },
  { header: "Fecha elaboración", value: row => date(row.date) },
  {
    header: "Identificación",
    value: row => (row.party ? `${row.party.identificationType} ${row.party.identificationNumber}` : ""),
  },
  { header: "Sucursal", value: row => row.branch ?? "" },
  { header: "Tercero", value: row => row.party?.legalName ?? "" },
  { header: "Total", value: row => row.total, money: true },
  { header: "Moneda", value: row => row.currency },
  { header: "Estado", value: row => (row.status === "VOID" ? "Anulado" : "Vigente") },
];

export function ProductDocuments() {
  const { company, canExport, canInventory: canEdit } = useSession();
  const [applied, setApplied] = useState<Filters>(initialFilters);
  const [draft, setDraft] = useState<Filters>(applied);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: React.ReactNode } | null>(null);
  const [dialog, setDialog] = useState<
    { kind: "import"; type: DocumentType } | { kind: "void"; row: InventoryRow } | null
  >(null);
  const { preset: _preset, ...query } = applied;
  const params = { ...query, page, pageSize };
  const report = useReport<InventoryResponse>("/v1/reports/inventory-documents", params);
  const rows = report.data?.data ?? [];
  const total = report.data?.pagination.total ?? 0;
  const pages = Math.ceil(total / pageSize);

  const apply = (filters: Filters) => {
    const next = { ...filters, ...presetRange(filters.preset, filters) };
    setApplied(next);
    setDraft(next);
    setSearch(next.search);
    setPage(1);
  };
  const chips: { label: string; clear: Partial<Filters> }[] = [
    ...(applied.preset !== "all"
      ? [
          {
            label: `Fecha elaboración: ${applied.preset === "custom" ? `${date(applied.from)} – ${date(applied.to)}` : periodPresets[applied.preset]}`,
            clear: { preset: "all" as Preset },
          },
        ]
      : []),
    ...(applied.type
      ? [{ label: `Tipo: ${inventoryTypeLabels[applied.type as DocumentType]}`, clear: { type: "" } }]
      : []),
    ...(applied.status
      ? [{ label: `Estado: ${applied.status === "VOID" ? "Anulado" : "Vigente"}`, clear: { status: "" } }]
      : []),
  ];

  const exportDocuments = async (format: ExportFormat) => {
    setNotice(null);
    try {
      await exportFromApi<InventoryRow>(format, "/v1/reports/inventory-documents/export", query, response => ({
        company,
        title: "Documentos de productos / servicios",
        period: applied.preset === "all" ? { from: null, to: null } : { from: applied.from, to: applied.to },
        filters: [
          ...(applied.search ? [["Búsqueda", applied.search] as [string, string]] : []),
          ...chips.map(chip => chip.label.split(": ") as [string, string]),
        ],
        columns,
        rows: response.data,
        totals: [
          ["Documentos", String(response.data.length)],
          [
            "Total (vigentes)",
            money(
              response.data.filter(row => row.status === "ACTIVE").reduce((sum, row) => sum + Number(row.total), 0)
            ),
          ],
        ],
        fileName: "documentos-de-inventario",
      }));
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    }
  };

  return (
    <>
      <section className="panel collections quotes">
        <form
          className="quotes-toolbar"
          onSubmit={event => {
            event.preventDefault();
            apply({ ...applied, search: search.trim() });
          }}
        >
          <label className="quotes-user">
            <span>Tercero</span>
            <span className="collections-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={search}
                onChange={event => {
                  setSearch(event.target.value);
                  if (!event.target.value && applied.search) apply({ ...applied, search: "" });
                }}
                placeholder="Buscar por nombre, identificación o comprobante"
                aria-label="Buscar por tercero o comprobante"
              />
            </span>
          </label>
          <button
            type="button"
            className="secondary quotes-more"
            aria-expanded={showFilters}
            aria-controls="inventory-filters"
            onClick={() => {
              setDraft(applied);
              setShowFilters(!showFilters);
            }}
          >
            <FilterIcon /> Más filtros
            {chips.length > 0 && <b className="quotes-count">{chips.length}</b>}
          </button>
          <span className="collections-spacer" />
          <ActionMenu
            label="Descargar"
            className="secondary quotes-download"
            items={(["pdf", "xlsx", "csv"] as const).map(format => ({
              label: format === "xlsx" ? "Excel (XLSX)" : format.toUpperCase(),
              onSelect: () => exportDocuments(format),
              disabled: !canExport || !total,
              note: !canExport
                ? "Tu rol no permite descargar"
                : !total
                  ? "No hay documentos para descargar"
                  : undefined,
            }))}
          >
            ⤓ Descargar
          </ActionMenu>
          <ActionMenu
            label="Importar"
            className="secondary quotes-download"
            items={(["INITIAL", "ADJUSTMENT"] as const).map(type => ({
              label: `Importar ${inventoryTypeLabels[type].toLowerCase()}`,
              note: "Desde Excel o CSV",
              disabled: !canEdit,
              onSelect: () => {
                setNotice(null);
                setDialog({ kind: "import", type });
              },
            }))}
          >
            Importar ⌄
          </ActionMenu>
          <ActionMenu
            label="Nuevo documento"
            className="primary products-create"
            items={(["ADJUSTMENT", "INITIAL"] as const).map(type => ({
              label: inventoryTypeLabels[type],
              note:
                type === "INITIAL"
                  ? "Cantidades y costo con que empieza cada producto"
                  : "Entradas (sobrantes) y salidas (faltantes, mermas)",
              href: newInventoryHref(type),
              disabled: !canEdit,
            }))}
          >
            Nuevo documento <span aria-hidden="true">⌄</span>
          </ActionMenu>
        </form>

        {showFilters && (
          <form
            id="inventory-filters"
            className="collections-filters quotes-filters"
            onSubmit={event => {
              event.preventDefault();
              apply({ ...draft, search: search.trim() });
              setShowFilters(false);
            }}
          >
            <label className="field">
              Fecha elaboración
              <select
                value={draft.preset}
                onChange={event => setDraft({ ...draft, preset: event.target.value as Preset })}
              >
                {Object.entries(periodPresets).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {draft.preset === "custom" && (
              <>
                <label className="field">
                  Desde
                  <input
                    type="date"
                    value={draft.from}
                    onChange={event => setDraft({ ...draft, from: event.target.value })}
                    required
                  />
                </label>
                <label className="field">
                  Hasta
                  <input
                    type="date"
                    value={draft.to}
                    min={draft.from}
                    onChange={event => setDraft({ ...draft, to: event.target.value })}
                    required
                  />
                </label>
              </>
            )}
            <label className="field">
              Tipo transacción
              <select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value })}>
                <option value="">Todos</option>
                {Object.entries(inventoryTypeLabels).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Estado
              <select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}>
                <option value="">Todos</option>
                <option value="ACTIVE">Vigente</option>
                <option value="VOID">Anulado</option>
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
              onClick={() => apply({ ...initialFilters(), preset: "all", search: applied.search })}
            >
              Limpiar filtros
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
              <table className="report-table collections-table quotes-table">
                <thead>
                  <tr>
                    <th>Tipo transacción</th>
                    <th>Comprobante</th>
                    <th>Fecha elaboración</th>
                    <th>Identificación</th>
                    <th>Sucursal</th>
                    <th>Tercero</th>
                    <th className="num">Total</th>
                    <th>Moneda</th>
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className={row.status === "VOID" ? "is-cancelled" : undefined}>
                      <td>{row.typeLabel}</td>
                      <td>
                        <Link href={inventoryDocumentHref(row.id)} className="collections-doc">
                          {row.number}
                        </Link>
                        <small>
                          {row.lineCount} producto(s){row.status === "VOID" && " · Anulado"}
                        </small>
                      </td>
                      <td>{date(row.date)}</td>
                      <td>{row.party ? `${row.party.identificationType} ${row.party.identificationNumber}` : "—"}</td>
                      <td title="Betel aún no maneja sucursales">{row.branch ?? "—"}</td>
                      <td>{row.party?.legalName ?? "—"}</td>
                      <td className="num">{money(row.total)}</td>
                      <td>{row.currency}</td>
                      <td>
                        <ActionMenu
                          label={`Acciones de ${row.number}`}
                          className="secondary quotes-row-menu"
                          items={[
                            { label: "Ver documento", href: inventoryDocumentHref(row.id) },
                            {
                              label: "Anular",
                              danger: true,
                              disabled: !canEdit || row.status === "VOID",
                              note: row.status === "VOID" ? "Ya está anulado" : undefined,
                              onSelect: () => setDialog({ kind: "void", row }),
                            },
                          ]}
                        >
                          ⋯
                        </ActionMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <div className="pay-empty">
                <SearchIllustration />
                <h3>No se encontraron resultados para tu búsqueda.</h3>
                <p>Modifica tus criterios de búsqueda o filtrado e inténtalo de nuevo.</p>
              </div>
            )}
            <div className="pay-pagination quotes-pagination">
              <label>
                Items por página
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

      {dialog?.kind === "import" && (
        <ImportInventoryDialog
          type={dialog.type}
          onClose={() => setDialog(null)}
          onImported={result => {
            setDialog(null);
            setNotice({
              kind: "ok",
              text: (
                <>
                  Se creó{" "}
                  <Link href={inventoryDocumentHref(result.id)} className="collections-doc">
                    {result.number}
                  </Link>{" "}
                  con {result.lines} producto(s).
                </>
              ),
            });
            apply({ ...initialFilters(), preset: "all" });
            report.reload();
          }}
        />
      )}
      {dialog?.kind === "void" && (
        <VoidDocumentDialog
          title={`Anular ${dialog.row.number}`}
          description="Se reversan su efecto en el stock y su asiento contable. Esta acción no se puede deshacer."
          path={`/v1/inventory-documents/${dialog.row.id}/void`}
          confirmLabel="Anular documento"
          onClose={() => setDialog(null)}
          onVoided={() => {
            setNotice({ kind: "ok", text: `${dialog.row.number} anulado.` });
            setDialog(null);
            report.reload();
          }}
        />
      )}
    </>
  );
}

const templates: Record<DocumentType, string> = {
  INITIAL: "Código;Cantidad;Costo unitario\nC-1;10;2500\nC-2;4;18000\n",
  ADJUSTMENT: "Código;Cantidad;Costo unitario;Movimiento\nC-1;3;2500;Entrada\nC-2;1;18000;Salida\n",
};

function ImportInventoryDialog({
  type,
  onClose,
  onImported,
}: {
  type: DocumentType;
  onClose: () => void;
  onImported: (result: { id: string; number: string; lines: number }) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [documentDate, setDocumentDate] = useState(defaultPeriod().to);
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string; errors?: { row: number; message: string }[] }>({
    busy: false,
  });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setState({ busy: true });
    try {
      const rows = await readSpreadsheet(file);
      if (!rows.length) return setState({ busy: false, error: "El archivo no trae filas con datos." });
      const result = await apiPost<{ data: { id: string; number: string; lines: number } }>(
        "/v1/inventory-documents/import",
        {
          type,
          date: documentDate,
          notes: notes.trim() || undefined,
          rows,
        }
      );
      onImported(result.data);
    } catch (error) {
      // 422 con errores por fila: se muestran (el documento no se creó).
      const details = (error as { details?: { errors?: { row: number; message: string }[] } }).details;
      setState({ busy: false, error: (error as Error).message, errors: details?.errors });
    }
  };
  return (
    <Modal title={`Importar ${inventoryTypeLabels[type].toLowerCase()}`} onClose={onClose} wide>
      <form onSubmit={submit}>
        <p className="report-dialog-text">
          Sube un Excel (.xlsx) o CSV con los encabezados <b>Código</b> (del producto), <b>Cantidad</b> y{" "}
          <b>Costo unitario</b>
          {type === "ADJUSTMENT" && (
            <>
              {" "}
              y <b>Movimiento</b> (Entrada o Salida; una cantidad negativa también es salida)
            </>
          )}
          . Se crea un solo documento: si alguna fila tiene error no se crea y se indica qué corregir.{" "}
          <button
            type="button"
            className="report-link"
            onClick={() =>
              downloadText(`plantilla-${type === "INITIAL" ? "saldo-inicial" : "ajuste"}.csv`, templates[type])
            }
          >
            Descargar plantilla
          </button>
        </p>
        <label className="field">
          Fecha de elaboración
          <input
            type="date"
            value={documentDate}
            max={defaultPeriod().to}
            onChange={event => setDocumentDate(event.target.value)}
            required
          />
        </label>
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
        <label className="field">
          Observaciones (opcional)
          <input value={notes} onChange={event => setNotes(event.target.value)} maxLength={1000} />
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
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={state.busy || !file}>
            {state.busy ? "Importando…" : "Importar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
