"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { apiGet, apiPut } from "../lib/api";
import ciiuCatalog from "../data/colombia-ciiu.json";
import ciiuRev4Catalog from "../data/colombia-ciiu-rev4.json";
import locationCatalog from "../data/colombia-locations.json";
import { Icon, type IconName } from "./brand";
import { useToast } from "./toast-provider";
import { OrganizationTaxCatalog } from "./organization-tax-catalog";

type Locations = {
  departments: { code: string; name: string }[];
  municipalities: { code: string; name: string; departmentCode: string; postalCodes: string[] }[];
};
type Responsibility = { code: string; description: string; active: boolean };
type Flags = {
  vatResponsible: boolean;
  withholdingAgent: boolean;
  selfWithholding: boolean;
  vatWithholdingAgent: boolean;
  largeTaxpayer: boolean;
  simpleRegime: boolean;
};
type Representative = {
  firstName?: string;
  middleName?: string;
  firstSurname?: string;
  secondSurname?: string;
  identificationType?: string;
  identificationNumber?: string;
  email?: string;
  phone?: string;
  role?: string;
  sameAsHolder?: boolean;
};
type Profile = {
  legalName: string;
  tradeName?: string | null;
  nit: string;
  verificationDigit?: string | null;
  personType?: "COMPANY" | "PERSON";
  identificationType?: string;
  societyType?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  firstSurname?: string | null;
  secondSurname?: string | null;
  departmentCode?: string | null;
  municipalityCode?: string | null;
  postalCode?: string | null;
  address?: string | null;
  addressComplement?: string | null;
  email?: string | null;
  electronicInvoiceEmail?: string | null;
  phoneCountryCode?: string | null;
  phone?: string | null;
  website?: string | null;
  contactName?: string | null;
  contactRole?: string | null;
  logoData?: string | null;
  economicActivityCode?: string | null;
  economicActivityName?: string | null;
  secondaryActivities?: unknown;
  vatResponsibility?: string | null;
  taxResponsibilities?: unknown;
  associatedTaxes?: unknown;
  taxFlags?: unknown;
  legalRepresentative?: unknown;
  currency?: string;
  foreignCurrencyEnabled?: boolean;
  enabledCurrencies?: unknown;
  dianEnabled?: boolean;
  updatedAt?: string;
};
type Form = Omit<
  Profile,
  | "secondaryActivities"
  | "taxResponsibilities"
  | "associatedTaxes"
  | "taxFlags"
  | "legalRepresentative"
  | "enabledCurrencies"
> & {
  personType: "COMPANY" | "PERSON";
  identificationType: string;
  currency: string;
  phoneCountryCode: string;
  secondaryActivities: string[];
  taxResponsibilities: Responsibility[];
  associatedTaxes: string[];
  taxFlags: Flags;
  legalRepresentative: Representative;
  enabledCurrencies: string[];
};

const locations = locationCatalog as Locations;
type EconomicActivity = { code: string; name: string; version?: string };
// Rev. 5 es la vigente; Rev. 4 se conserva para organizaciones con códigos históricos aún registrados.
const ciiuActivities: EconomicActivity[] = [
  ...(ciiuCatalog as EconomicActivity[]).map(activity => ({ ...activity, version: "Rev. 5 A.C. (vigente)" })),
  ...(ciiuRev4Catalog as EconomicActivity[]),
];
const tabs: { id: Tab; label: string; icon: IconName }[] = [
  { id: "identity", label: "Identidad", icon: "building" },
  { id: "location", label: "Ubicación y contacto", icon: "calendar" },
  { id: "tax", label: "Información tributaria", icon: "percent" },
  { id: "documents", label: "Facturación y documentos", icon: "document" },
  { id: "representative", label: "Representante legal", icon: "users" },
  { id: "accounting", label: "Preferencias contables", icon: "scale" },
];
type Tab = "identity" | "location" | "tax" | "documents" | "representative" | "accounting";
const emptyFlags: Flags = {
  vatResponsible: false,
  withholdingAgent: false,
  selfWithholding: false,
  vatWithholdingAgent: false,
  largeTaxpayer: false,
  simpleRegime: false,
};
const taxConditionOptions = [
  ["vatResponsible", "Responsable de IVA", "O-48"],
  ["withholdingAgent", "Agente de retención", "O-07"],
  ["selfWithholding", "Autorretenedor", "O-15"],
  ["vatWithholdingAgent", "Agente de retención de IVA", "O-23"],
  ["largeTaxpayer", "Gran contribuyente", "O-13"],
  ["simpleRegime", "Régimen SIMPLE", "O-47"],
] as const;

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function asResponsibilities(value: unknown): Responsibility[] {
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is Responsibility =>
            !!item && typeof item === "object" && typeof (item as Responsibility).code === "string"
        )
        .map(item => ({ code: item.code, description: item.description ?? "", active: item.active !== false }))
    : [];
}
function asFlags(value: unknown): Flags {
  return { ...emptyFlags, ...(value && typeof value === "object" ? value : {}) };
}
function asRepresentative(value: unknown): Representative {
  return value && typeof value === "object" ? (value as Representative) : {};
}
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== "" && item !== null && item !== undefined)
        .map(([key, item]) => [key, clean(item)])
    );
  return value;
}
function normalizeContactFields(form: Form) {
  const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");
  const emailValue = form.email?.trim() ?? "";
  const emailLooksLikePhone = /^\+?\d{7,15}$/.test(emailValue);
  const codeDigits = digits(form.phoneCountryCode);
  const longCountryCode = codeDigits.length > 4;
  const phoneDigits = digits(form.phone);
  const inferredPhone =
    phoneDigits || (emailLooksLikePhone ? digits(emailValue).slice(-10) : longCountryCode ? codeDigits.slice(-10) : "");
  const normalizedCode = longCountryCode
    ? codeDigits.startsWith("57")
      ? "+57"
      : `+${codeDigits.slice(0, 3)}`
    : form.phoneCountryCode;
  return {
    form: {
      ...form,
      email: emailLooksLikePhone ? null : form.email,
      phone: inferredPhone || form.phone,
      phoneCountryCode: normalizedCode,
    },
    corrected: emailLooksLikePhone || longCountryCode,
  };
}
async function prepareDocumentLogo(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Selecciona una imagen PNG, JPG o WebP.");
  if (file.size > 8 * 1024 * 1024) throw new Error("El archivo no puede superar 8 MB.");
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("No pudimos leer esta imagen."));
      element.src = source;
    });
    const scale = Math.min(1, 480 / image.naturalWidth, 180 / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Tu navegador no pudo preparar el logo.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const logo = canvas.toDataURL("image/jpeg", 0.82);
    if (logo.length > 250_000) throw new Error("Usa un logo más simple o de menor resolución.");
    return logo;
  } finally {
    URL.revokeObjectURL(source);
  }
}
function toForm(data: Profile): Form {
  return {
    ...data,
    personType: data.personType === "PERSON" ? "PERSON" : "COMPANY",
    identificationType: data.identificationType ?? "NIT",
    currency: data.currency ?? "COP",
    phoneCountryCode: data.phoneCountryCode ?? "+57",
    secondaryActivities: asArray(data.secondaryActivities),
    taxResponsibilities: asResponsibilities(data.taxResponsibilities),
    associatedTaxes: asArray(data.associatedTaxes),
    taxFlags: asFlags(data.taxFlags),
    legalRepresentative: asRepresentative(data.legalRepresentative),
    enabledCurrencies: asArray(data.enabledCurrencies),
  };
}
function nitDv(nit: string) {
  const weights = [71, 67, 59, 53, 47, 43, 41, 37, 29, 23, 19, 17, 13, 7, 3];
  const digits = nit.replace(/\D/g, "");
  if (!digits) return "";
  const total = digits
    .split("")
    .reverse()
    .reduce((sum, digit, index) => sum + Number(digit) * weights[weights.length - 1 - index]!, 0);
  const residue = total % 11;
  return String(residue > 1 ? 11 - residue : residue);
}
function field(
  label: string,
  name: keyof Form,
  form: Form,
  set: (name: keyof Form, value: string) => void,
  options: { type?: string; placeholder?: string; required?: boolean } = {}
) {
  return (
    <label className="organization-field">
      <span>
        {label}
        {options.required && <i> *</i>}
      </span>
      <input
        type={options.type ?? "text"}
        value={String(form[name] ?? "")}
        placeholder={options.placeholder}
        required={options.required}
        onChange={event => set(name, event.target.value)}
      />
    </label>
  );
}
function searchKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

function EconomicActivityPicker({
  code,
  name,
  onSelect,
}: {
  code?: string | null;
  name?: string | null;
  onSelect: (activity: EconomicActivity | null) => void;
}) {
  const display = code && name ? `${code} · ${name}` : (code ?? "");
  const [query, setQuery] = useState(display);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) setQuery(display);
  }, [display, open]);
  const matches = useMemo(() => {
    const term = searchKey(query.trim());
    if (!term) return ciiuActivities.slice(0, 8);
    return ciiuActivities.filter(item => item.code.includes(term) || searchKey(item.name).includes(term)).slice(0, 8);
  }, [query]);
  const choose = (activity: EconomicActivity) => {
    onSelect(activity);
    setQuery(`${activity.code} · ${activity.name}`);
    setOpen(false);
  };
  return (
    <div className="ciiu-picker">
      <label className="organization-field">
        <span>
          Actividad económica principal (CIIU){" "}
          <em title="Busca por el código CIIU o por palabras de la actividad económica.">?</em>
        </span>
        <input
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={query}
          placeholder="Busca por código o nombre de actividad"
          onFocus={() => setOpen(true)}
          onChange={event => {
            const value = event.target.value;
            setQuery(value);
            setOpen(true);
            if (!value.trim()) onSelect(null);
            const exact = ciiuActivities.find(item => item.code === value.trim());
            if (exact) choose(exact);
          }}
        />
      </label>
      {open && (
        <div className="ciiu-results" role="listbox">
          {matches.length ? (
            matches.map(item => (
              <button
                type="button"
                role="option"
                aria-selected={item.code === code}
                key={`${item.code}-${item.version}`}
                onMouseDown={event => event.preventDefault()}
                onClick={() => choose(item)}
              >
                <b>{item.code}</b>
                <span>
                  {item.name}
                  <small>{item.version}</small>
                </span>
              </button>
            ))
          ) : (
            <p>No encontramos una actividad CIIU con esa búsqueda.</p>
          )}
        </div>
      )}
      {code && name && (
        <p className="ciiu-selected">
          <b>{code}</b>
          <span>{name}</span>
        </p>
      )}
    </div>
  );
}

export function OrganizationProfile() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("identity");
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<{ data: Profile }>("/v1/organization/profile")
      .then(result => {
        const profile = toForm(result.data);
        setForm(profile);
        setSaved(profile);
      })
      .catch(error => toast.error({ title: "No pudimos cargar el perfil", description: error.message }))
      .finally(() => setLoading(false));
  }, [toast]);
  const dirty = useMemo(
    () => !!form && !!saved && JSON.stringify(clean(form)) !== JSON.stringify(clean(saved)),
    [form, saved]
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const set = (name: keyof Form, value: string) =>
    setForm(current => (current ? { ...current, [name]: value } : current));
  const update = (patch: Partial<Form>) => setForm(current => (current ? { ...current, ...patch } : current));
  const municipality = locations.municipalities.find(item => item.code === form?.municipalityCode);
  const municipalities = locations.municipalities.filter(item => item.departmentCode === form?.departmentCode);
  const fullHolderName = [form?.firstName, form?.middleName, form?.firstSurname, form?.secondSurname]
    .filter(Boolean)
    .join(" ");
  const issuerPhone = form?.phone ? [form.phoneCountryCode, form.phone].filter(Boolean).join(" ") : "";
  const issuerResponsibilities = form
    ? taxConditionOptions.filter(([key]) => form.taxFlags[key]).map(([, label, code]) => `${label} (${code})`)
    : [];
  const completed = form
    ? [
        form.legalName,
        form.nit,
        form.address,
        form.municipalityCode,
        form.email,
        form.electronicInvoiceEmail,
        form.economicActivityCode,
        form.legalRepresentative.firstName || form.personType === "PERSON",
      ].filter(Boolean).length
    : 0;
  const percent = Math.round((completed / 8) * 100);
  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const normalized = normalizeContactFields(form);
      const payload = clean({
        ...normalized.form,
        verificationDigit:
          normalized.form.identificationType === "NIT" ? nitDv(normalized.form.nit) : normalized.form.verificationDigit,
      });
      const result = await apiPut<{ data: Profile }>("/v1/organization/profile", payload);
      const profile = toForm(result.data);
      setForm(profile);
      setSaved(profile);
      toast.success({
        title: "Perfil actualizado",
        description: normalized.corrected
          ? "Guardamos el teléfono en su campo correcto y actualizamos el perfil."
          : "La información de la organización se guardó correctamente.",
      });
    } catch (error) {
      const message = (error as Error).message;
      toast.error({
        title: "No se pudo guardar el perfil",
        description:
          message === "Invalid email address"
            ? "Revisa que los campos de correo tengan una dirección válida."
            : message,
      });
    } finally {
      setSaving(false);
    }
  };
  const selectLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      update({ logoData: await prepareDocumentLogo(file) });
      toast.info({ title: "Logo preparado", description: "Guarda el perfil para aplicarlo a todos los documentos." });
    } catch (error) {
      toast.error({ title: "No pudimos cargar el logo", description: (error as Error).message });
    }
  };
  if (loading) return <div className="organization-loading">Cargando el perfil de la organización…</div>;
  if (!form) return <div className="organization-loading">No fue posible preparar el perfil.</div>;

  const title = form.personType === "PERSON" ? fullHolderName || form.legalName : form.legalName;
  return (
    <div className="organization-profile">
      <header className="organization-profile-head">
        <div>
          <p className="eyebrow">Organización</p>
          <h2>Perfil de la organización</h2>
          <p>
            Administra la información legal, tributaria y comercial que utiliza Betel en tus documentos y operaciones.
          </p>
        </div>
        <div className="profile-progress">
          <strong>{percent}% completado</strong>
          <div>
            <i style={{ width: `${percent}%` }} />
          </div>
          <small>{Math.max(0, 8 - completed)} datos prioritarios por completar.</small>
        </div>
      </header>
      <div className="organization-statuses">
        <span className={form.legalName && form.nit ? "ready" : "pending"}>● Información legal</span>
        <span className={form.economicActivityCode && form.vatResponsibility ? "ready" : "pending"}>
          ● Información tributaria
        </span>
        <span className={form.email && form.electronicInvoiceEmail ? "ready" : "pending"}>● Datos de contacto</span>
        <span className={form.dianEnabled ? "ready" : "pending"}>● Facturación electrónica</span>
      </div>
      <div className="organization-tabs" role="tablist">
        {tabs.map(item => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "active" : ""}
            onClick={() => setTab(item.id)}
            key={item.id}
          >
            <Icon name={item.icon} size={16} />
            {item.label}
          </button>
        ))}
      </div>
      <div className="organization-layout">
        <main>
          {tab === "identity" && (
            <section className="organization-card">
              <h3>Identidad de la organización</h3>
              <p>Datos que identifican al emisor en Betel y sus documentos.</p>
              <div className="organization-fields">
                <label className="organization-field">
                  <span>Tipo de persona</span>
                  <select
                    value={form.personType}
                    onChange={event =>
                      update({
                        personType: event.target.value as Form["personType"],
                        identificationType: event.target.value === "COMPANY" ? "NIT" : "CC",
                      })
                    }
                  >
                    <option value="COMPANY">Persona jurídica</option>
                    <option value="PERSON">Persona natural</option>
                  </select>
                </label>
                <label className="organization-field">
                  <span>Tipo de documento</span>
                  <select
                    value={form.identificationType}
                    onChange={event => set("identificationType", event.target.value)}
                  >
                    {form.personType === "COMPANY" ? (
                      <option value="NIT">NIT</option>
                    ) : (
                      <>
                        <option value="CC">Cédula de ciudadanía</option>
                        <option value="CE">Cédula de extranjería</option>
                        <option value="PPT">PPT</option>
                      </>
                    )}
                  </select>
                </label>
                {field("Número de identificación", "nit", form, set, { required: true })}
                <label className="organization-field">
                  <span>Dígito de verificación</span>
                  <input
                    value={form.identificationType === "NIT" ? nitDv(form.nit) : (form.verificationDigit ?? "")}
                    readOnly={form.identificationType === "NIT"}
                    onChange={event => set("verificationDigit", event.target.value)}
                  />
                </label>
              </div>
              {form.personType === "COMPANY" ? (
                <div className="organization-fields two">
                  {field("Razón social", "legalName", form, set, { required: true })}
                  {field("Nombre comercial", "tradeName", form, set)}
                  {field("Tipo societario", "societyType", form, set, {
                    placeholder: "Selecciona un valor de tu catálogo",
                  })}
                </div>
              ) : (
                <>
                  <div className="organization-fields two">
                    {field("Primer nombre", "firstName", form, set, { required: true })}
                    {field("Segundo nombre", "middleName", form, set)}
                    {field("Primer apellido", "firstSurname", form, set, { required: true })}
                    {field("Segundo apellido", "secondSurname", form, set)}
                  </div>
                  {field("Nombre comercial", "tradeName", form, set)}
                </>
              )}
              <div className="organization-note">
                <strong>Identidad visual</strong>
                <p>
                  El logo documental se administra en la pestaña Facturación y documentos. Se guarda con la organización
                  y se aplica a los documentos nuevos.
                </p>
              </div>
            </section>
          )}
          {tab === "location" && (
            <section className="organization-card">
              <h3>Ubicación y contacto</h3>
              <p>La ubicación se guarda con códigos de los catálogos colombianos; no como texto libre.</p>
              <div className="organization-subcard">
                <h4>Ubicación principal</h4>
                <div className="organization-fields two">
                  <label className="organization-field">
                    <span>País</span>
                    <input value="Colombia" readOnly />
                  </label>
                  <label className="organization-field">
                    <span>Departamento</span>
                    <select
                      value={form.departmentCode ?? ""}
                      onChange={event =>
                        update({ departmentCode: event.target.value, municipalityCode: "", postalCode: "" })
                      }
                    >
                      <option value="">Selecciona departamento</option>
                      {locations.departments.map(item => (
                        <option value={item.code} key={item.code}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="organization-field">
                    <span>Municipio</span>
                    <select
                      value={form.municipalityCode ?? ""}
                      disabled={!form.departmentCode}
                      onChange={event => {
                        const selected = locations.municipalities.find(item => item.code === event.target.value);
                        update({ municipalityCode: event.target.value, postalCode: selected?.postalCodes[0] ?? "" });
                      }}
                    >
                      <option value="">Selecciona municipio</option>
                      {municipalities.map(item => (
                        <option value={item.code} key={item.code}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {field("Código postal", "postalCode", form, set, {
                    placeholder: municipality?.postalCodes[0] ?? "Se completa con el municipio",
                  })}
                  {field("Dirección principal", "address", form, set)}
                  {field("Complemento", "addressComplement", form, set, { placeholder: "Oficina, local o bodega" })}
                </div>
              </div>
              <div className="organization-subcard">
                <h4>Contacto corporativo</h4>
                <div className="organization-fields two">
                  {field("Correo principal", "email", form, set, { type: "email" })}
                  {field("Correo para facturación electrónica", "electronicInvoiceEmail", form, set, { type: "email" })}
                  <label className="organization-field">
                    <span>Indicativo</span>
                    <input
                      value={form.phoneCountryCode}
                      onChange={event => set("phoneCountryCode", event.target.value)}
                    />
                  </label>
                  {field("Teléfono", "phone", form, set)}
                  {field("Sitio web", "website", form, set, { type: "url", placeholder: "https://" })}
                  {field("Persona de contacto", "contactName", form, set)}
                  {field("Cargo", "contactRole", form, set)}
                </div>
              </div>
            </section>
          )}
          {tab === "tax" && (
            <section className="organization-card">
              <h3>Información tributaria</h3>
              <p>Define cómo debe comportarse la organización frente a impuestos y documentos electrónicos.</p>
              <div className="organization-fields two">
                <EconomicActivityPicker
                  code={form.economicActivityCode}
                  name={form.economicActivityName}
                  onSelect={activity =>
                    update({ economicActivityCode: activity?.code ?? "", economicActivityName: activity?.name ?? "" })
                  }
                />
              </div>
              <OrganizationTaxCatalog />
              <div className="organization-subcard">
                <h4>Actividades secundarias</h4>
                <p className="muted">Agrega códigos CIIU ya validados por tu catálogo tributario.</p>
                <div className="tag-editor">
                  <input id="secondary-activity" placeholder="Código CIIU" />
                  <button
                    type="button"
                    onClick={() => {
                      const input = document.getElementById("secondary-activity") as HTMLInputElement | null;
                      if (input?.value.trim()) {
                        update({ secondaryActivities: [...form.secondaryActivities, input.value.trim()] });
                        input.value = "";
                      }
                    }}
                  >
                    Agregar actividad
                  </button>
                </div>
                <div className="profile-tags">
                  {form.secondaryActivities.map((item, index) => (
                    <span key={`${item}-${index}`}>
                      {item}
                      <button
                        type="button"
                        onClick={() =>
                          update({
                            secondaryActivities: form.secondaryActivities.filter((_, position) => position !== index),
                          })
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              <div className="organization-subcard">
                <h4>Condiciones especiales</h4>
                <div className="organization-toggles">
                  {taxConditionOptions.map(([key, label, code]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={form.taxFlags[key]}
                        onChange={event => update({ taxFlags: { ...form.taxFlags, [key]: event.target.checked } })}
                      />
                      <span>
                        {label}
                        <small>Responsabilidad {code}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </section>
          )}
          {tab === "documents" && (
            <section className="organization-card">
              <h3>Facturación y documentos</h3>
              <p>Así se utilizará la identidad empresarial en facturas, notas y certificados.</p>
              <div className="issuer-preview">
                <div className="document-logo-control">
                  <div className="document-logo-preview">
                    {form.logoData ? (
                      <img src={form.logoData} alt={`Logo de ${title || "la organización"}`} />
                    ) : (
                      <b>LOGO</b>
                    )}
                  </div>
                  <label className="document-logo-upload">
                    {form.logoData ? "Cambiar logo" : "Cargar logo"}
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={selectLogo} />
                  </label>
                  {form.logoData && (
                    <button type="button" className="document-logo-remove" onClick={() => update({ logoData: null })}>
                      Quitar
                    </button>
                  )}
                  <small>PNG, JPG o WebP · se normaliza para documentos.</small>
                </div>
                <div className="issuer-data-preview">
                  <small>VISTA PREVIA DEL EMISOR</small>
                  <strong>{title || "Tu organización"}</strong>
                  <span>
                    {form.identificationType} {form.nit}
                    {form.identificationType === "NIT" ? `-${nitDv(form.nit)}` : ""}
                  </span>
                  <span>
                    {[
                      form.address,
                      municipality?.name,
                      locations.departments.find(item => item.code === form.departmentCode)?.name,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Dirección pendiente"}
                  </span>
                  <span>{form.electronicInvoiceEmail || form.email || "Correo pendiente"}</span>
                  <span>{issuerPhone ? `Tel. ${issuerPhone}` : "Teléfono pendiente"}</span>
                  <span className="issuer-responsibilities">
                    {issuerResponsibilities.length
                      ? `Responsabilidades: ${issuerResponsibilities.join(" · ")}`
                      : "Responsabilidades pendientes"}
                  </span>
                </div>
              </div>
              <div className="dian-summary">
                <div>
                  <b>Facturación electrónica</b>
                  <span className={form.dianEnabled ? "ready-text" : "pending-text"}>
                    {form.dianEnabled ? "Configurada" : "Configuración incompleta"}
                  </span>
                </div>
                <p>
                  La resolución, el certificado y el ambiente se administran en la configuración DIAN para evitar
                  duplicar parámetros.
                </p>
              </div>
            </section>
          )}
          {tab === "representative" && (
            <section className="organization-card">
              <h3>Representante legal</h3>
              <p>Persona autorizada para representar a la organización.</p>
              {form.personType === "PERSON" && (
                <label className="same-holder">
                  <input
                    type="checkbox"
                    checked={form.legalRepresentative.sameAsHolder ?? false}
                    onChange={event =>
                      update({
                        legalRepresentative: event.target.checked
                          ? {
                              firstName: form.firstName ?? "",
                              middleName: form.middleName ?? "",
                              firstSurname: form.firstSurname ?? "",
                              secondSurname: form.secondSurname ?? "",
                              identificationType: form.identificationType,
                              identificationNumber: form.nit,
                              email: form.email ?? "",
                              phone: form.phone ?? "",
                              role: "Titular",
                              sameAsHolder: true,
                            }
                          : { ...form.legalRepresentative, sameAsHolder: false },
                      })
                    }
                  />
                  El titular es el representante legal
                </label>
              )}
              <RepresentativeFields
                value={form.legalRepresentative}
                onChange={legalRepresentative => update({ legalRepresentative })}
              />
            </section>
          )}
          {tab === "accounting" && (
            <section className="organization-card">
              <h3>Preferencias contables</h3>
              <p>Configuraciones globales que afectan el registro de las operaciones de la empresa.</p>
              <div className="organization-fields two">
                <label className="organization-field">
                  <span>
                    Moneda funcional{" "}
                    <em title="Moneda principal utilizada para registrar la contabilidad de la organización.">?</em>
                  </span>
                  <select value={form.currency} onChange={event => set("currency", event.target.value)}>
                    <option value="COP">COP · Peso colombiano</option>
                  </select>
                </label>
                <label className="same-holder">
                  <input
                    type="checkbox"
                    checked={form.foreignCurrencyEnabled ?? false}
                    onChange={event =>
                      update({
                        foreignCurrencyEnabled: event.target.checked,
                        enabledCurrencies: event.target.checked ? form.enabledCurrencies : [],
                      })
                    }
                  />
                  Operaciones en moneda extranjera
                </label>
              </div>
              {form.foreignCurrencyEnabled && (
                <div className="organization-subcard">
                  <h4>Monedas habilitadas</h4>
                  <p className="muted">
                    La tasa de cambio y la cuenta de diferencia en cambio se habilitarán cuando exista configuración
                    multi-moneda.
                  </p>
                  <div className="tag-editor">
                    <input id="foreign-currency" maxLength={3} placeholder="USD" />
                    <button
                      type="button"
                      onClick={() => {
                        const input = document.getElementById("foreign-currency") as HTMLInputElement | null;
                        const code = input?.value.trim().toUpperCase();
                        if (code && input && !form.enabledCurrencies.includes(code)) {
                          update({ enabledCurrencies: [...form.enabledCurrencies, code] });
                          input.value = "";
                        }
                      }}
                    >
                      Agregar moneda
                    </button>
                  </div>
                  <div className="profile-tags">
                    {form.enabledCurrencies.map(code => (
                      <span key={code}>
                        {code}
                        <button
                          type="button"
                          onClick={() =>
                            update({ enabledCurrencies: form.enabledCurrencies.filter(item => item !== code) })
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </main>
        <aside className="organization-sidebar">
          <h3>Estado de la organización</h3>
          <div className="side-percent">
            <b>{percent}%</b>
            <span>Perfil completado</span>
          </div>
          <ul>
            <li className={form.legalName && form.nit ? "done" : "todo"}>Identificación</li>
            <li className={form.municipalityCode && form.address ? "done" : "todo"}>Ubicación</li>
            <li className={form.economicActivityCode ? "done" : "todo"}>Datos tributarios</li>
            <li className={form.electronicInvoiceEmail ? "done" : "todo"}>Correo de facturación</li>
            <li className={form.legalRepresentative.firstName || form.personType === "PERSON" ? "done" : "todo"}>
              Representante legal
            </li>
          </ul>
          <hr />
          <h4>Facturación electrónica</h4>
          <p className={form.dianEnabled ? "ready-text" : "pending-text"}>
            ● {form.dianEnabled ? "DIAN conectada" : "Pendiente de configuración"}
          </p>
          <small>
            {form.updatedAt
              ? `Última actualización: ${new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(form.updatedAt))}`
              : "Aún sin actualizaciones"}
          </small>
        </aside>
      </div>
      <footer className="organization-savebar">
        <span>{dirty ? "Tienes cambios sin guardar" : "Últimos cambios guardados"}</span>
        <div>
          <button
            type="button"
            className="secondary"
            disabled={!dirty || saving}
            onClick={() => {
              if (saved) setForm(saved);
            }}
          >
            Cancelar cambios
          </button>
          <button type="button" className="primary" disabled={!dirty || saving} onClick={save}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </footer>
    </div>
  );
}

function RepresentativeFields({
  value,
  onChange,
}: {
  value: Representative;
  onChange: (next: Representative) => void;
}) {
  const set = (key: keyof Representative, next: string) => onChange({ ...value, [key]: next });
  return (
    <div className="organization-fields two">
      {(
        [
          ["Primer nombre", "firstName"],
          ["Segundo nombre", "middleName"],
          ["Primer apellido", "firstSurname"],
          ["Segundo apellido", "secondSurname"],
          ["Tipo de identificación", "identificationType"],
          ["Número", "identificationNumber"],
          ["Correo", "email"],
          ["Teléfono", "phone"],
          ["Cargo / calidad", "role"],
        ] as [string, keyof Representative][]
      ).map(([label, key]) => (
        <label className="organization-field" key={key}>
          <span>{label}</span>
          <input
            type={key === "email" ? "email" : "text"}
            value={String(value[key] ?? "")}
            onChange={event => set(key, event.target.value)}
          />
        </label>
      ))}
    </div>
  );
}
