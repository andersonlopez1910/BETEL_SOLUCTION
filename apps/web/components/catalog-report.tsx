/**
 * Pantalla genérica de un reporte del catálogo (/reportes/ver?id=...). Los filtros salen de la definición del reporte
 * en la API (apps/api/src/catalog): período, fecha de corte, año, búsqueda, clientes/proveedores, cuenta o producto.
 * Descarga en PDF, Excel o CSV con `export=1` (la API valida el rol y lo registra en la auditoría).
 * «Países, departamentos y ciudades» (id localidades) se arma en el navegador con el catálogo DANE de data/.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { exportReport, type ExportFormat, type ReportColumn } from "../lib/report-export";
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
import { presetRange, type Preset } from "./billing-report-quotes";
import { PeriodPicker } from "./ledger-reports";

type ParamName = "period" | "date" | "year" | "search" | "partyKind" | "account" | "product";
type CatalogEntry = { id: string; title: string; params: ParamName[] };
type Column = { key: string; label: string; type?: "text" | "money" | "number" | "date" | "percent"; sum?: boolean };
type Cell = string | number | null;
type Row = Record<string, Cell>;
type ReportResponse = {
  title: string;
  columns: Column[];
  data: Row[];
  totals?: Row;
  notes: string[];
  truncated: boolean;
  period: { from: string | null; to: string | null };
};

const numberFormat = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 });
function formatCell(value: Cell, type: Column["type"]) {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "money") return money(value);
  if (type === "number") return numberFormat.format(Number(value));
  if (type === "percent") return `${value} %`;
  if (type === "date") return date(String(value));
  return String(value);
}
const isNumeric = (type: Column["type"]) => type === "money" || type === "number" || type === "percent";

const back = (
  <Link href="/reportes" className="report-link">
    ‹ Volver a Reportes
  </Link>
);

function useCatalog() {
  return useReport<{ data: CatalogEntry[] }>("/v1/reports/catalog");
}

export function CatalogReportPage() {
  const id = useSearchParams().get("id") ?? "";
  const catalog = useCatalog();
  if (id === "localidades") return <LocationsReport />;
  const entry = catalog.data?.data.find(report => report.id === id);
  if (catalog.loading && !catalog.data) return <ReportStatus loading error={undefined} />;
  if (catalog.error) return <ReportStatus loading={false} error={catalog.error} />;
  if (!entry)
    return (
      <div className="page-content">
        {back}
        <p className="collections-notice is-error" role="alert">
          El reporte no existe o tu rol no tiene acceso a él.
        </p>
      </div>
    );
  return <CatalogReportView key={entry.id} entry={entry} />;
}

function CatalogReportView({ entry }: { entry: CatalogEntry }) {
  const { company, canExport } = useSession();
  const has = (name: ParamName) => entry.params.includes(name);
  const today = defaultPeriod().to;
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState(() => presetRange("month", defaultPeriod()));
  const [cutoff, setCutoff] = useState(today);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [partyKind, setPartyKind] = useState<"CUSTOMER" | "SUPPLIER">("CUSTOMER");
  const [account, setAccount] = useState("");
  const [product, setProduct] = useState("");
  const [error, setError] = useState<string | null>(null);

  const accounts = useReport<{ data: { code: string; name: string }[] }>(
    has("account") ? "/v1/accounting/chart" : null
  );
  const products = useReport<{ data: { id: string; sku: string | null; name: string }[] }>(
    has("product") ? "/v1/reports/catalog-options/products" : null
  );

  const params = useMemo(
    () => ({
      ...(has("period") && range),
      ...(has("date") && { date: cutoff }),
      ...(has("year") && { year }),
      ...(has("search") && search && { search }),
      ...(has("partyKind") && { partyKind }),
      ...(has("account") && account && { account }),
      ...(has("product") && product && { product }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry.id, range, cutoff, year, search, partyKind, account, product]
  );
  const report = useReport<ReportResponse>(`/v1/reports/catalog/${entry.id}`, params);
  const data = report.data;

  const download = async (format: ExportFormat) => {
    setError(null);
    try {
      await exportFromApi<Row>(format, `/v1/reports/catalog/${entry.id}`, { ...params, export: "1" }, raw => {
        const response = raw as unknown as ReportResponse;
        const columns: ReportColumn<Row>[] = response.columns.map(column => ({
          header: column.label,
          value: row => (column.type === "date" && row[column.key] ? date(String(row[column.key])) : row[column.key]),
          money: column.type === "money",
        }));
        const totals: [string, string][] = response.totals
          ? response.columns
              .filter(
                column =>
                  response.totals![column.key] != null &&
                  isNumeric(column.type) &&
                  column.key !== response.columns[0]!.key
              )
              .map(column => [column.label, formatCell(response.totals![column.key]!, column.type)])
          : [];
        const filters: [string, string][] = [];
        if (has("partyKind")) filters.push(["Tercero", partyKind === "CUSTOMER" ? "Clientes" : "Proveedores"]);
        if (has("account") && account) filters.push(["Cuenta", account]);
        if (has("search") && search) filters.push(["Búsqueda", search]);
        if (has("product") && product)
          filters.push(["Producto", products.data?.data.find(item => item.id === product)?.name ?? product]);
        return {
          company,
          title: response.title,
          period: response.period as { from: string; to: string },
          filters,
          columns,
          rows: response.data,
          totals,
          fileName: `${entry.id}-${response.period.to ?? today}`,
        };
      });
    } catch (exportError) {
      setError((exportError as Error).message);
    }
  };

  const years = Array.from({ length: 6 }, (_, index) => Number(today.slice(0, 4)) - index);
  return (
    <div className="page-content">
      <div className="document-toolbar">
        <div className="catalog-heading">
          {back}
          <h2>{entry.title}</h2>
        </div>
        <div className="page-actions">
          <ActionMenu
            label="Descargar"
            className="secondary quotes-download"
            items={(["pdf", "xlsx", "csv"] as const).map(format => ({
              label: format === "xlsx" ? "Excel (XLSX)" : format.toUpperCase(),
              onSelect: () => download(format),
              disabled: !canExport || !data?.data.length,
            }))}
          >
            ⤓ Descargar
          </ActionMenu>
        </div>
      </div>
      <section className="panel">
        <div className="banks-period catalog-filters">
          {has("partyKind") && (
            <label className="field">
              Ver
              <select value={partyKind} onChange={event => setPartyKind(event.target.value as "CUSTOMER" | "SUPPLIER")}>
                <option value="CUSTOMER">Clientes (cuentas por cobrar)</option>
                <option value="SUPPLIER">Proveedores (cuentas por pagar)</option>
              </select>
            </label>
          )}
          {has("account") && (
            <label className="field">
              Cuenta
              <select value={account} onChange={event => setAccount(event.target.value)}>
                <option value="">Elige una cuenta…</option>
                {accounts.data?.data.map(item => (
                  <option key={item.code} value={item.code}>
                    {item.code} {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {has("product") && (
            <label className="field">
              Producto
              <select value={product} onChange={event => setProduct(event.target.value)}>
                <option value="">Elige un producto…</option>
                {products.data?.data.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.sku ? `${item.sku} · ` : ""}
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {has("period") && (
            <PeriodPicker
              preset={preset}
              range={range}
              onChange={(nextPreset, nextRange) => {
                setPreset(nextPreset);
                setRange(nextRange);
              }}
            />
          )}
          {has("date") && (
            <label className="field">
              Fecha de corte
              <input
                type="date"
                value={cutoff}
                onChange={event => event.target.value && setCutoff(event.target.value)}
              />
            </label>
          )}
          {has("year") && (
            <label className="field">
              Año
              <select value={year} onChange={event => setYear(Number(event.target.value))}>
                {years.map(value => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          )}
          {has("search") && (
            <form
              className="catalog-search"
              onSubmit={event => {
                event.preventDefault();
                setSearch(searchText.trim());
              }}
            >
              <label className="field">
                Buscar
                <input
                  type="search"
                  value={searchText}
                  placeholder="Nombre, identificación, correo…"
                  onChange={event => setSearchText(event.target.value)}
                />
              </label>
              <button type="submit" className="secondary">
                Buscar
              </button>
            </form>
          )}
        </div>
        {error && (
          <p className="report-error" role="alert">
            {error}
          </p>
        )}
        <ReportStatus loading={report.loading && !data} error={report.error} />
        {data && (
          <>
            {data.truncated && (
              <p className="collections-notice is-error" role="status">
                Se muestran las primeras 5.000 filas. Acota el período o la búsqueda para ver el resto.
              </p>
            )}
            <div className="report-table-wrap">
              <table className="report-table catalog-table">
                <thead>
                  <tr>
                    {data.columns.map(column => (
                      <th key={column.key} className={isNumeric(column.type) ? "num" : undefined}>
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((row, index) => (
                    <tr key={index}>
                      {data.columns.map(column => (
                        <td key={column.key} className={isNumeric(column.type) ? "num" : undefined}>
                          {formatCell(row[column.key] ?? null, column.type)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {data.totals && data.data.length > 0 && (
                  <tfoot>
                    <tr>
                      {data.columns.map((column, index) => (
                        <th key={column.key} className={isNumeric(column.type) ? "num" : undefined}>
                          {index === 0
                            ? "Total"
                            : data.totals![column.key] != null
                              ? formatCell(data.totals![column.key]!, column.type)
                              : ""}
                        </th>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
              {!data.data.length && <p className="report-message">No hay información para los filtros elegidos.</p>}
            </div>
            {data.notes.length > 0 && (
              <ul className="report-footnote catalog-notes">
                {data.notes.map(note => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ─── Países, departamentos y ciudades (catálogo DANE en el navegador) ─────────

type Municipality = {
  code: string;
  name: string;
  departmentCode: string;
  departmentName: string;
  type: string;
  postalCodes: string[];
};
type Locations = {
  departments: { code: string; name: string }[];
  municipalities: Municipality[];
  summary: Record<string, number>;
};

function LocationsReport() {
  const { company } = useSession();
  const [catalog, setCatalog] = useState<Locations | null>(null);
  const [department, setDepartment] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    let cancelled = false;
    import("../data/colombia-locations.json").then(
      module => !cancelled && setCatalog(module.default as unknown as Locations)
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const rows = useMemo(() => {
    if (!catalog) return [];
    const text = search.trim().toLocaleLowerCase("es");
    return catalog.municipalities.filter(
      item =>
        (!department || item.departmentCode === department) &&
        (!text || item.name.toLocaleLowerCase("es").includes(text) || item.code.includes(text))
    );
  }, [catalog, department, search]);
  const columns: ReportColumn<Municipality>[] = [
    { header: "País", value: () => "Colombia" },
    { header: "Código departamento", value: row => row.departmentCode },
    { header: "Departamento", value: row => row.departmentName },
    { header: "Código DANE", value: row => row.code },
    { header: "Municipio", value: row => row.name },
    { header: "Tipo", value: row => row.type },
    { header: "Códigos postales", value: row => row.postalCodes.join(" ") },
  ];
  const download = (format: ExportFormat) =>
    exportReport(format, {
      company,
      title: "Países, departamentos y ciudades",
      period: { from: null, to: null },
      filters: department
        ? [["Departamento", catalog?.departments.find(item => item.code === department)?.name ?? department]]
        : [],
      columns,
      rows,
      totals: [["Municipios", String(rows.length)]],
      fileName: "paises-departamentos-ciudades",
    });
  return (
    <div className="page-content">
      <div className="document-toolbar">
        <div className="catalog-heading">
          {back}
          <h2>Países, departamentos y ciudades</h2>
        </div>
        <div className="page-actions">
          <ActionMenu
            label="Descargar"
            className="secondary quotes-download"
            items={(["pdf", "xlsx", "csv"] as const).map(format => ({
              label: format === "xlsx" ? "Excel (XLSX)" : format.toUpperCase(),
              onSelect: () => download(format),
              disabled: !rows.length,
            }))}
          >
            ⤓ Descargar
          </ActionMenu>
        </div>
      </div>
      <section className="panel">
        <div className="banks-period catalog-filters">
          <label className="field">
            Departamento
            <select value={department} onChange={event => setDepartment(event.target.value)}>
              <option value="">Todos</option>
              {catalog?.departments.map(item => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Buscar municipio
            <input
              type="search"
              value={search}
              placeholder="Nombre o código DANE"
              onChange={event => setSearch(event.target.value)}
            />
          </label>
        </div>
        <ReportStatus loading={!catalog} error={undefined} />
        {catalog && (
          <>
            <p className="collections-notice" role="status">
              Colombia: {catalog.departments.length} departamentos y {catalog.municipalities.length} municipios
              (DIVIPOLA del DANE). Mostrando {rows.length}.
            </p>
            <div className="report-table-wrap">
              <table className="report-table catalog-table">
                <thead>
                  <tr>
                    {columns.map(column => (
                      <th key={column.header}>{column.header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 300).map(row => (
                    <tr key={row.code}>
                      {columns.map(column => (
                        <td key={column.header}>{column.value(row)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 300 && (
                <p className="report-message">Se muestran 300 de {rows.length}; la descarga incluye todos.</p>
              )}
            </div>
            <p className="report-footnote">Betel opera solo en Colombia; el catálogo no incluye otros países.</p>
          </>
        )}
      </section>
    </div>
  );
}
