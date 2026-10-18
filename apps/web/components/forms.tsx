"use client";

import { useEffect, useMemo, useState } from "react";
import locationCatalog from "../data/colombia-locations.json";

type Line = { description: string; qty: number; price: number; tax: number };
type LocationCatalog = {
  departments: Array<{ code: string; name: string }>;
  municipalities: Array<{ code: string; name: string; departmentCode: string; departmentName: string; postalCodes: string[] }>;
};

const locations = locationCatalog as LocationCatalog;
const initial: Line[] = [{ description: "", qty: 1, price: 0, tax: 19 }];
const money = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

export function DocumentForm({ support = false }: { support?: boolean }) {
  const [lines, setLines] = useState<Line[]>(initial);
  const [sent, setSent] = useState(false);
  const update = (idx: number, key: keyof Line, value: string) => setLines(lines.map((line, index) => index === idx ? { ...line, [key]: key === "description" ? value : Number(value) } : line));
  const subtotal = lines.reduce((sum, line) => sum + line.qty * line.price, 0);
  const taxes = lines.reduce((sum, line) => sum + line.qty * line.price * line.tax / 100, 0);

  return <div className="document-card">
    <div className="form-grid document-meta">
      <Field label="Tipo" value={support ? "DS · Documento soporte" : "Factura electrónica de venta"} select />
      <Field label="Número" placeholder="Se asignará al emitir" />
      <Field label={support ? "Proveedor" : "Cliente"} placeholder="Buscar tercero…" />
      <Field label="Fecha de elaboración" value="18/10/2026" />
      <Field label="Contacto" placeholder="Seleccionar contacto" select />
    </div>
    <div className="line-table">
      <div className="line-head"><span>#</span><span>Producto / servicio</span><span>Descripción</span><span>Cant.</span><span>Valor unitario</span><span>IVA</span><span>Total</span><span /></div>
      {lines.map((line, index) => <div className="line-row" key={index}>
        <span>{index + 1}</span><input placeholder="Buscar" /><input value={line.description} onChange={event => update(index, "description", event.target.value)} placeholder="Descripción" />
        <input type="number" value={line.qty} onChange={event => update(index, "qty", event.target.value)} /><input type="number" value={line.price} onChange={event => update(index, "price", event.target.value)} />
        <select value={line.tax} onChange={event => update(index, "tax", event.target.value)}><option value="19">19%</option><option value="5">5%</option><option value="0">0%</option></select>
        <strong>{money.format(line.qty * line.price * (1 + line.tax / 100))}</strong><button onClick={() => setLines(lines.filter((_, lineIndex) => lineIndex !== index))} aria-label="Eliminar línea">⌫</button>
      </div>)}
    </div>
    <button type="button" className="text-button" onClick={() => setLines([...lines, { ...initial[0] }])}>＋ Agregar producto o servicio</button>
    <div className="payment-total"><div><h3>Formas de pago</h3><div className="payment-choice"><label><input type="radio" defaultChecked name="payment" /> Contado</label><label><input type="radio" name="payment" /> Crédito</label><select><option>Selecciona forma de pago</option><option>Transferencia</option><option>Tarjeta</option></select></div><label className="notes">Observaciones<textarea placeholder="Comentarios visibles en el documento para tu cliente…" /></label></div><dl><div><dt>Subtotal</dt><dd>{money.format(subtotal)}</dd></div><div><dt>Impuestos</dt><dd>{money.format(taxes)}</dd></div><div className="grand"><dt>Total neto</dt><dd>{money.format(subtotal + taxes)}</dd></div></dl></div>
    <footer className="form-footer"><button type="button" className="secondary">Cancelar</button><button type="button" className="secondary">Guardar borrador</button><button type="button" className="primary" onClick={() => setSent(true)}>{support ? "Emitir documento" : "Enviar a DIAN"}</button>{sent && <span className="success">✓ Borrador listo para validación</span>}</footer>
  </div>;
}

function Field({ label, value, placeholder, select }: { label: string; value?: string; placeholder?: string; select?: boolean }) {
  return <label className="field">{label}{select ? <select defaultValue={value}><option>{value ?? placeholder}</option></select> : <input defaultValue={value} placeholder={placeholder} />}</label>;
}

export function PartyForm() {
  const [saved, setSaved] = useState(false);
  const [departmentCode, setDepartmentCode] = useState("");
  const [municipalityCode, setMunicipalityCode] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [identification, setIdentification] = useState("");
  const municipalities = useMemo(() => locations.municipalities.filter(municipality => municipality.departmentCode === departmentCode), [departmentCode]);
  const municipality = useMemo(() => locations.municipalities.find(item => item.code === municipalityCode), [municipalityCode]);
  const postalCodes = municipality?.postalCodes ?? [];

  useEffect(() => {
    setMunicipalityCode("");
    setPostalCode("");
  }, [departmentCode]);

  useEffect(() => {
    setPostalCode(postalCodes[0] ?? "");
  }, [municipalityCode, postalCodes]);

  const postalHelp = !departmentCode
    ? "Selecciona primero el departamento y luego el municipio."
    : !municipalityCode
      ? "El código postal se cargará al elegir el municipio."
      : postalCodes.length === 0
        ? "No hay código postal asociado en el catálogo 4-72. Verifica la dirección antes de guardar."
        : postalCodes.length === 1
          ? "Código postal oficial asociado al municipio seleccionado."
          : `${postalCodes.length} códigos postales disponibles. Selecciona el correspondiente a la dirección.`;

  return <form className="party-form" onSubmit={event => { event.preventDefault(); setSaved(true); }}>
    <div className="form-banner"><b>Tipo de tercero</b><label><input type="checkbox" defaultChecked /> Cliente</label><label><input type="checkbox" /> Proveedor</label></div>
    <div className="party-columns">
      <section>
        <h2>Datos básicos <span>*</span></h2>
        <div className="two-col">
          <Field label="Tipo de persona" value="Persona jurídica" select />
          <Field label="Tipo de identificación" value="NIT" select />
          <label className="field">Número de identificación<input name="identificationNumber" inputMode="numeric" value={identification} onChange={event => setIdentification(event.target.value.replace(/\D/g, ""))} placeholder="900 000 000" /><small className="field-help">Autocompletado DIAN pendiente de autorización; este dato no se consulta ni transmite todavía.</small></label>
          <Field label="Dígito de verificación" placeholder="0" />
          <Field label="Razón social" placeholder="Nombre o razón social" />
          <Field label="Nombre comercial" placeholder="Opcional" />
          <div className="location-block" aria-label="Ubicación fiscal del tercero">
            <div className="location-block-head"><span>Ubicación fiscal</span><p>Selecciona primero el departamento y después la ciudad o municipio.</p></div>
            <div className="location-grid">
              <label className="field location-field">Departamento <span className="required">*</span><select name="departmentCode" value={departmentCode} onChange={event => setDepartmentCode(event.target.value)} required><option value="">Selecciona un departamento</option>{locations.departments.map(department => <option value={department.code} key={department.code}>{department.name}</option>)}</select></label>
              <span className="location-connector" aria-hidden="true">→</span>
              <label className="field location-field">Ciudad / municipio <span className="required">*</span><select name="municipalityCode" value={municipalityCode} onChange={event => setMunicipalityCode(event.target.value)} disabled={!departmentCode} required><option value="">{departmentCode ? "Selecciona una ciudad o municipio" : "Selecciona primero el departamento"}</option>{municipalities.map(item => <option value={item.code} key={item.code}>{item.name} · {item.code}</option>)}</select><small className="field-help">{departmentCode ? `${municipalities.length} municipios o ciudades disponibles.` : "Se habilita al elegir un departamento."}</small></label>
            </div>
          </div>
          <label className="field field-full">Dirección<input placeholder="Dirección principal" /></label>
        </div>
      </section>
      <section>
        <h2>Facturación y envío</h2>
        <div className="two-col">
          <Field label="Nombre del contacto" placeholder="Nombre completo" />
          <Field label="Correo electrónico" placeholder="correo@empresa.co" />
          <Field label="Indicativo y teléfono" placeholder="+57 300 000 0000" />
          <Field label="Régimen IVA" value="Responsable de IVA" select />
          <label className="field">Código postal{postalCodes.length > 1 ? <select name="postalCode" value={postalCode} onChange={event => setPostalCode(event.target.value)} disabled={!municipalityCode}><option value="">Selecciona el código postal</option>{postalCodes.map(code => <option value={code} key={code}>{code}</option>)}</select> : <input name="postalCode" value={postalCode} readOnly placeholder="Se asignará al elegir municipio" aria-describedby="postal-code-help" />}<small id="postal-code-help" className="field-help">{postalHelp}</small></label>
          <Field label="Responsabilidades fiscales" value="R-99-PN · No aplica" select />
        </div>
        <label className="check"><input type="checkbox" /> Contacto marcado como pagador</label>
      </section>
    </div>
    <section className="contacts"><h2>⌄ Contactos</h2><p>Agrega los responsables de compras, facturación y pagos.</p></section>
    <div className="sticky-actions"><button type="button" className="secondary">Cancelar</button><button className="primary">Guardar tercero</button>{saved && <span className="success">✓ Tercero creado correctamente</span>}</div>
  </form>;
}
