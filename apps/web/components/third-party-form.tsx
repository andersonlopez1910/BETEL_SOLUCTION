"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, apiGet, apiPost } from "../lib/api";
import locationCatalog from "../data/colombia-locations.json";
import { useToast } from "./toast-provider";

type PersonType = "COMPANY" | "PERSON";
type FoundField = { field: string; value: string; source: string; retrievedAt: string; confidence: "HIGH" | "MEDIUM" | "LOW" };
type Enrichment = { found: boolean; verificationDigit?: string; fields: FoundField[]; merchantRegistered: boolean; raw: { chamberOfCommerce?: string; commercialRegistration?: string; economicActivityCode?: string } };
type Locations = { departments: { code: string; name: string }[]; municipalities: { code: string; name: string; departmentCode: string; postalCodes: string[] }[] };
type ExistingParty = { id: string; legalName: string; identificationType: string; identificationNumber: string; verificationDigit: string | null; isCustomer: boolean; isSupplier: boolean; isPayer: boolean; active: boolean };
type DuplicateCheck = { data: { exists: boolean; party?: ExistingParty } };

const locations = locationCatalog as Locations;
const naturalTypes = [["RC", "11 · Registro civil"], ["TI", "12 · Tarjeta de identidad"], ["CC", "13 · Cédula de ciudadanía"], ["TE", "21 · Tarjeta de extranjería"], ["CE", "22 · Cédula de extranjería"], ["PA", "41 · Pasaporte"], ["DIE", "42 · Documento extranjero"], ["PEP", "47 · PEP"], ["PPT", "48 · PPT"]] as const;
const legalTypes = [["NIT", "31 · NIT"], ["DIE", "42 · Entidad extranjera"], ["PA", "41 · Pasaporte / extranjero"]] as const;

function partyDocument(party: ExistingParty) {
  return `${party.identificationType} ${party.identificationNumber}${party.verificationDigit ? `-${party.verificationDigit}` : ""}`;
}

export function ThirdPartyForm() {
  const toast = useToast();
  const [type, setType] = useState<PersonType>("COMPANY");
  const [idType, setIdType] = useState("NIT");
  const [id, setId] = useState("");
  const [dv, setDv] = useState("");
  const [v, setV] = useState<Record<string, string>>({ legalName: "", tradeName: "", firstName: "", middleName: "", firstSurname: "", secondSurname: "", email: "", phone: "", address: "", vatResponsibility: "NOT_RESPONSIBLE" });
  const [department, setDepartment] = useState("");
  const [municipalityCode, setMunicipalityCode] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [roles, setRoles] = useState({ customer: true, supplier: false, payer: false });
  const [enriched, setEnriched] = useState<Enrichment | null>(null);
  const [metadata, setMetadata] = useState<FoundField[]>([]);
  const [duplicate, setDuplicate] = useState<ExistingParty | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (field: string, value: string) => setV(current => ({ ...current, [field]: value }));
  const fullName = useMemo(() => [v.firstName, v.middleName, v.firstSurname, v.secondSurname].filter(Boolean).join(" "), [v]);
  const municipalities = useMemo(() => locations.municipalities.filter(item => item.departmentCode === department), [department]);
  const municipality = locations.municipalities.find(item => item.code === municipalityCode);

  useEffect(() => { setIdType(type === "COMPANY" ? "NIT" : "CC"); setId(""); setDv(""); setDuplicate(null); }, [type]);
  useEffect(() => { setMunicipalityCode(""); setPostalCode(""); }, [department]);
  useEffect(() => { setPostalCode(municipality?.postalCodes[0] ?? ""); }, [municipalityCode]);
  useEffect(() => {
    if (id.length < 3) { setDuplicate(null); return; }
    let disposed = false;
    const timer = window.setTimeout(() => {
      apiGet<DuplicateCheck>("/v1/parties/duplicate-check", { identificationType: idType, identificationNumber: id })
        .then(result => { if (!disposed) setDuplicate(result.data.party ?? null); })
        .catch(() => { if (!disposed) setDuplicate(null); });
    }, 350);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [id, idType]);

  const showDuplicate = (party: ExistingParty) => {
    const roleHint = roles.supplier && party.isCustomer && !party.isSupplier
      ? " Ya existe como cliente; edítalo para habilitar también el rol de proveedor."
      : party.active ? " Ya se encuentra registrado en Betel." : " El registro existe, pero está inactivo.";
    toast.warning({ title: "El tercero ya existe", description: `${party.legalName} · ${partyDocument(party)}.${roleHint}` });
  };
  const enrich = async () => {
    setBusy(true); setError("");
    try {
      const response = await apiPost<{ data: Enrichment }>("/v1/third-parties/enrich", { identificationType: idType, identificationNumber: id });
      setEnriched(response.data);
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  };
  const accept = () => {
    if (!enriched) return;
    const update = Object.fromEntries(enriched.fields.map(field => [field.field, field.value]));
    setV(current => ({ ...current, ...update, chamberOfCommerce: enriched.raw.chamberOfCommerce ?? current.chamberOfCommerce, commercialRegistration: enriched.raw.commercialRegistration ?? current.commercialRegistration, economicActivityCode: enriched.raw.economicActivityCode ?? current.economicActivityCode }));
    setMetadata(enriched.fields);
    if (enriched.verificationDigit) setDv(enriched.verificationDigit);
    setEnriched(null);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (duplicate) { showDuplicate(duplicate); return; }
    setBusy(true); setError("");
    try {
      const payload = {
        kind: type, identificationType: idType, identificationNumber: id, verificationDigit: idType === "NIT" ? dv : undefined,
        legalName: type === "PERSON" ? fullName : v.legalName, firstName: type === "PERSON" ? v.firstName || undefined : undefined,
        middleName: type === "PERSON" ? v.middleName || undefined : undefined, firstSurname: type === "PERSON" ? v.firstSurname || undefined : undefined,
        secondSurname: type === "PERSON" ? v.secondSurname || undefined : undefined, tradeName: type === "COMPANY" ? v.tradeName || undefined : undefined,
        email: v.email || undefined, phone: v.phone || undefined, address: v.address || undefined, municipalityCode: municipalityCode || undefined,
        postalCode: postalCode || undefined, vatResponsibility: v.vatResponsibility, taxResponsibilities: [],
        chamberOfCommerce: v.chamberOfCommerce || undefined, commercialRegistration: v.commercialRegistration || undefined,
        economicActivityCode: v.economicActivityCode || undefined, enrichmentMetadata: metadata.length ? metadata : undefined,
        isCustomer: roles.customer, isSupplier: roles.supplier, isPayer: roles.payer,
      };
      const response = await apiPost<{ data: { legalName: string } }>("/v1/parties", payload);
      toast.success({ title: "Tercero creado correctamente", description: `${response.data.legalName} fue registrado correctamente.` });
      setId(""); setDv(""); setDuplicate(null); setMetadata([]); setDepartment(""); setMunicipalityCode(""); setPostalCode("");
      setV({ legalName: "", tradeName: "", firstName: "", middleName: "", firstSurname: "", secondSurname: "", email: "", phone: "", address: "", vatResponsibility: "NOT_RESPONSIBLE" });
      setRoles({ customer: true, supplier: false, payer: false });
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && reason.details?.code === "THIRD_PARTY_ALREADY_EXISTS") {
        const existing = reason.details.thirdParty as ExistingParty | undefined;
        if (existing) { setDuplicate(existing); showDuplicate(existing); }
        else toast.warning({ title: "El tercero ya existe", description: "El tercero ya se encuentra registrado en el sistema." });
      } else {
        setError("No pudimos crear el tercero. Revisa la información e inténtalo nuevamente.");
        toast.error({ title: "No pudimos crear el tercero", description: "Revisa la información e inténtalo nuevamente." });
      }
    } finally { setBusy(false); }
  };
  const types = type === "COMPANY" ? legalTypes : naturalTypes;

  return <form className="third-party-form" onSubmit={submit}>
    <section className="third-party-card"><div className="third-party-title"><span className="eyebrow">MAESTRO DE TERCEROS</span><h2>Datos básicos</h2><p>Define la identidad y los datos tributarios del tercero.</p></div><div className="third-party-grid">
      <label>Tipo de persona<select value={type} onChange={event => setType(event.target.value as PersonType)}><option value="COMPANY">Persona jurídica</option><option value="PERSON">Persona natural</option></select></label>
      <label>Tipo de identificación<select value={idType} onChange={event => { setIdType(event.target.value); setDuplicate(null); }}>{types.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label>
      <label className="identification-field">Número de identificación<div><input value={id} onChange={event => setId(event.target.value.replace(/\D/g, ""))} inputMode="numeric" required /><button type="button" className="smart-button" disabled={id.length < 3 || busy} onClick={() => void enrich()}>✦ Terminar con IA</button></div><small>{duplicate ? <span className="duplicate-field-warning">Este tercero ya se encuentra registrado: {duplicate.legalName} · {partyDocument(duplicate)}.</span> : "Consulta pública RUES; no inventa ni guarda datos automáticamente."}</small></label>
      {idType === "NIT" && <label>Dígito de verificación<input value={dv} readOnly placeholder="Se calcula al consultar" /></label>}
      {type === "COMPANY" ? <><label>Razón social<input value={v.legalName} onChange={event => set("legalName", event.target.value)} required /></label><label>Nombre comercial<input value={v.tradeName} onChange={event => set("tradeName", event.target.value)} /></label></> : <><label>Primer nombre<input value={v.firstName} onChange={event => set("firstName", event.target.value)} required /></label><label>Segundo nombre<input value={v.middleName} onChange={event => set("middleName", event.target.value)} /></label><label>Primer apellido<input value={v.firstSurname} onChange={event => set("firstSurname", event.target.value)} required /></label><label>Segundo apellido<input value={v.secondSurname} onChange={event => set("secondSurname", event.target.value)} /></label><label className="third-party-wide">Nombre completo<input value={fullName} readOnly /></label></>}
    </div></section>
    <div className="third-party-columns"><section className="third-party-card"><h2>Facturación y envío</h2><div className="third-party-grid"><label>Correo electrónico<input type="email" value={v.email} onChange={event => set("email", event.target.value)} /></label><label>Teléfono<input value={v.phone} onChange={event => set("phone", event.target.value)} /></label><label>Tratamiento IVA<select value={v.vatResponsibility} onChange={event => set("vatResponsibility", event.target.value)}><option value="NOT_RESPONSIBLE">No responsable de IVA</option><option value="RESPONSIBLE">Responsable de IVA</option><option value="SIMPLE">Régimen SIMPLE</option></select></label><label>Responsabilidades fiscales<select><option>R-99-PN · No aplica</option><option>O-13 · Gran contribuyente</option><option>O-15 · Autorretenedor</option></select></label></div><div className="party-role-switch"><label><input type="checkbox" checked={roles.customer} onChange={event => setRoles({ ...roles, customer: event.target.checked })} /> Cliente</label><label><input type="checkbox" checked={roles.supplier} onChange={event => setRoles({ ...roles, supplier: event.target.checked })} /> Proveedor</label><label><input type="checkbox" checked={roles.payer} onChange={event => setRoles({ ...roles, payer: event.target.checked })} /> Pagador</label></div></section><section className="third-party-card"><h2>Ubicación comercial</h2><div className="third-party-grid"><label>Departamento<select value={department} onChange={event => setDepartment(event.target.value)}><option value="">Selecciona…</option>{locations.departments.map(item => <option value={item.code} key={item.code}>{item.name}</option>)}</select></label><label>Municipio<select value={municipalityCode} disabled={!department} onChange={event => setMunicipalityCode(event.target.value)}><option value="">Selecciona…</option>{municipalities.map(item => <option value={item.code} key={item.code}>{item.name}</option>)}</select></label><label>Dirección<input value={v.address} onChange={event => set("address", event.target.value)} /></label><label>Código postal<input value={postalCode} onChange={event => setPostalCode(event.target.value)} maxLength={6} /></label></div></section></div>
    {(v.chamberOfCommerce || v.commercialRegistration || v.economicActivityCode) && <section className="third-party-card registry-card"><h2>Información registral</h2><p>{v.chamberOfCommerce && `Cámara: ${v.chamberOfCommerce}`} {v.commercialRegistration && ` · Matrícula: ${v.commercialRegistration}`} {v.economicActivityCode && ` · CIIU: ${v.economicActivityCode}`}</p></section>}
    {error && <p className="third-party-error" role="alert">{error}</p>}
    <footer className="third-party-actions"><button type="button" className="secondary" onClick={() => history.back()}>Cancelar</button><button className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar tercero"}</button></footer>
    {enriched && <div className="enrichment-backdrop" role="dialog" aria-modal="true"><div className="enrichment-modal"><h2>{enriched.found ? "Encontramos información para este tercero" : "No encontramos información pública"}</h2>{enriched.found ? <><p>{enriched.merchantRegistered && "Comerciante registrado · "}Fuente: Registro Mercantil / Datos Abiertos.</p><dl>{enriched.fields.map(field => <div key={field.field}><dt>{field.field}</dt><dd>{field.value}<small>{field.source} · confianza alta</small></dd></div>)}</dl><div className="enrichment-actions"><button type="button" className="secondary" onClick={() => setEnriched(null)}>Cancelar</button><button type="button" className="primary" onClick={accept}>Usar estos datos</button></div></> : <><p>El registro público no devolvió una coincidencia exacta. Puedes completar los datos manualmente.</p><button type="button" className="primary" onClick={() => setEnriched(null)}>Continuar</button></>}</div></div>}
  </form>;
}
