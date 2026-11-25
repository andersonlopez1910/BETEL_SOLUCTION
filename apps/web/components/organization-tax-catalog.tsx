"use client";
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "../lib/api";
import { useToast } from "./toast-provider";
type Tax = {
  id: string;
  code: string;
  name: string;
  shortName?: string | null;
  category: string;
  requiresRate: boolean;
  requiresMunicipality: boolean;
  configurationOptions?: {
    vatOptions?: Array<{ value: string; label: string; responsibilityCode: string }>;
  } | null;
};
type Config = {
  taxCatalogItemId: string;
  active: boolean;
  rate?: string | null;
  municipalityCode?: string | null;
  additionalConfig?: { vatOptions?: string[] } | null;
  status?: string;
  taxCatalogItem?: Tax;
};
const title: Record<string, string> = {
  TAX: "Impuestos y contribuciones",
  WITHHOLDING: "Retenciones",
  CONTRIBUTION: "Contribuciones",
  SURCHARGE: "Sobretasas",
  OTHER: "Otras figuras",
};
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export function OrganizationTaxCatalog() {
  const toast = useToast(),
    [catalog, setCatalog] = useState<Tax[]>([]),
    [configs, setConfigs] = useState<Config[]>([]),
    [search, setSearch] = useState(""),
    [open, setOpen] = useState(false);
  const load = () =>
    Promise.all([
      apiGet<{ data: Tax[] }>("/v1/tax-catalog"),
      apiGet<{ data: Config[] }>("/v1/organization/tax-configurations"),
    ])
      .then(([a, b]) => {
        setCatalog(a.data);
        setConfigs(b.data);
      })
      .catch(e => toast.error({ title: "No pudimos cargar los tributos", description: e.message }));
  useEffect(() => {
    void load();
  }, []);
  const map = useMemo(() => new Map(catalog.map(x => [x.id, x])), [catalog]);
  const selected = configs
    .map(x => ({ ...x, taxCatalogItem: x.taxCatalogItem ?? map.get(x.taxCatalogItemId) }))
    .filter((x): x is Config & { taxCatalogItem: Tax } => !!x.taxCatalogItem);
  const candidates = catalog.filter(
    x =>
      x.category !== "WITHHOLDING" &&
      !configs.some(c => c.taxCatalogItemId === x.id) &&
      norm(`${x.code} ${x.name} ${x.shortName ?? ""}`).includes(norm(search))
  );
  const save = (next: Config[]) => {
    setConfigs(next);
    return apiPut<{ data: Config[] }>("/v1/organization/tax-configurations", {
      configurations: next.map(({ taxCatalogItem, ...config }) => {
        // La API admite propiedades opcionales, no valores null. La respuesta de
        // Prisma usa null para columnas vacías, por eso se construye un payload limpio.
        const payload: Record<string, unknown> = {
          taxCatalogItemId: config.taxCatalogItemId,
          active: config.active,
        };
        if (config.rate !== undefined && config.rate !== null && config.rate !== "") payload.rate = Number(config.rate);
        if (config.municipalityCode) payload.municipalityCode = config.municipalityCode;
        if (config.additionalConfig) payload.additionalConfig = config.additionalConfig;
        return payload;
      }),
    })
      .then(r => setConfigs(r.data))
      .catch(e => {
        toast.error({ title: "No se pudo guardar", description: e.message });
        void load();
      });
  };
  const add = (tax: Tax) => {
    void save([...configs, { taxCatalogItemId: tax.id, active: true }]);
    setOpen(false);
    setSearch("");
  };
  const edit = (id: string, patch: Partial<Config>) =>
    void save(configs.map(c => (c.taxCatalogItemId === id ? { ...c, ...patch } : c)));
  return (
    <div className="tax-manager">
      <div className="tax-manager-head">
        <div>
          <h4>Tributos activos</h4>
          <p>Habilita solo los que use la organización. No se aplican automáticamente a cada factura.</p>
        </div>
        <button type="button" className="secondary compact" onClick={() => setOpen(!open)}>
          + Agregar tributo
        </button>
      </div>
      {open && (
        <div className="tax-search">
          <input
            autoFocus
            placeholder="Buscar tributo: renta, carbono, IVA…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {candidates.slice(0, 12).map(t => (
            <button type="button" key={t.id} onClick={() => add(t)}>
              <small>{title[t.category] ?? "Tributo"}</small>
              <b>{t.shortName ?? t.name}</b>
              <span>{t.name}</span>
            </button>
          ))}
        </div>
      )}
      <TaxSection
        heading="Impuestos y contribuciones"
        items={selected.filter(x => x.taxCatalogItem.category !== "WITHHOLDING")}
        edit={edit}
        remove={id => void save(configs.filter(config => config.taxCatalogItemId !== id))}
      />
      <RetentionChecklist catalog={catalog} configs={configs} add={add} edit={edit} />
    </div>
  );
}
function TaxSection({
  heading,
  items,
  edit,
  remove,
}: {
  heading: string;
  items: (Config & { taxCatalogItem: Tax })[];
  edit: (id: string, p: Partial<Config>) => void;
  remove: (id: string) => void;
}) {
  return (
    <section className="tax-section">
      <h5>{heading}</h5>
      {items.length ? (
        items.map(x => <TaxCard key={x.taxCatalogItemId} config={x} edit={edit} remove={remove} />)
      ) : (
        <p className="tax-none">Aún no hay figuras activas.</p>
      )}
    </section>
  );
}
function TaxCard({
  config,
  edit,
  remove,
}: {
  config: Config & { taxCatalogItem: Tax };
  edit: (id: string, p: Partial<Config>) => void;
  remove: (id: string) => void;
}) {
  const t = config.taxCatalogItem,
    vatOptions = t.configurationOptions?.vatOptions ?? [],
    pending =
      config.active &&
      ((t.code === "IVA" && (!vatOptions.length || !config.additionalConfig?.vatOptions?.length)) ||
        (t.code !== "IVA" && t.requiresRate && !config.rate) ||
        (t.requiresMunicipality && !config.municipalityCode));
  return (
    <article className="tax-card">
      <div>
        <b>{t.shortName ?? t.name}</b>
        <span>{t.name}</span>
        <em className={pending ? "pending" : config.active ? "active" : "inactive"}>
          {!config.active ? "Inactivo" : pending ? "Pendiente de configurar" : "Activo"}
        </em>
      </div>
      <div className="tax-card-actions">
        <label className="tax-switch">
          <input
            type="checkbox"
            checked={config.active}
            onChange={e => edit(config.taxCatalogItemId, { active: e.target.checked })}
          />
          Activo
        </label>
        <button type="button" className="tax-delete" onClick={() => remove(config.taxCatalogItemId)}>
          Eliminar
        </button>
      </div>
      {t.code === "IVA" && (
        <div className="vat-options">
          {vatOptions.map(option => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={config.additionalConfig?.vatOptions?.includes(option.value) ?? false}
                onChange={event => {
                  const current = config.additionalConfig?.vatOptions ?? [];
                  const vatOptions = event.target.checked
                    ? [...current, option.value]
                    : current.filter(value => value !== option.value);
                  edit(config.taxCatalogItemId, {
                    active: event.target.checked ? true : config.active,
                    additionalConfig: { ...config.additionalConfig, vatOptions },
                  });
                }}
              />
              <span>
                {option.label}
                <small>Responsabilidad {option.responsibilityCode}</small>
              </span>
            </label>
          ))}
        </div>
      )}
      {config.active && t.code !== "IVA" && (t.requiresRate || t.requiresMunicipality) && (
        <div className="tax-settings">
          {t.requiresRate && (
            <label>
              Tarifa %
              <input
                type="number"
                min="0"
                max="100"
                step="0.0001"
                value={config.rate ?? ""}
                onChange={e => edit(config.taxCatalogItemId, { rate: e.target.value })}
              />
            </label>
          )}
          {t.requiresMunicipality && (
            <label>
              Código municipio
              <input
                value={config.municipalityCode ?? ""}
                onChange={e => edit(config.taxCatalogItemId, { municipalityCode: e.target.value })}
              />
            </label>
          )}
        </div>
      )}
    </article>
  );
}
function RetentionChecklist({
  catalog,
  configs,
  add,
  edit,
}: {
  catalog: Tax[];
  configs: Config[];
  add: (tax: Tax) => void;
  edit: (id: string, patch: Partial<Config>) => void;
}) {
  const retentions = catalog.filter(tax => tax.category === "WITHHOLDING");
  return (
    <section className="tax-section retention-checklist">
      <h5>Retenciones</h5>
      <p>Marca únicamente las retenciones que la organización esté obligada a aplicar.</p>
      <div>
        {retentions.map(tax => {
          const config = configs.find(item => item.taxCatalogItemId === tax.id);
          return (
            <article key={tax.id}>
              <label>
                <input
                  type="checkbox"
                  checked={config?.active ?? false}
                  onChange={event => {
                    if (event.target.checked && config) edit(tax.id, { active: true });
                    else if (event.target.checked) add(tax);
                    else if (config) edit(tax.id, { active: false });
                  }}
                />
                <span>
                  <b>{tax.shortName ?? tax.name}</b>
                  <small>{tax.name}</small>
                </span>
              </label>
              {config?.active && tax.requiresRate && (
                <label className="retention-rate">
                  Tarifa %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.0001"
                    value={config.rate ?? ""}
                    onChange={event => edit(tax.id, { rate: event.target.value })}
                  />
                </label>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
