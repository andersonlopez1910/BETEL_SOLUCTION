import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const municipalitiesUrl = "https://www.datos.gov.co/resource/gdxc-w37w.json?$limit=5000";
const postalCodesUrl = "https://www.datos.gov.co/resource/ixig-z8b5.json?$limit=5000";
const output = resolve(import.meta.dirname, "..", "apps", "web", "data", "colombia-locations.json");

const [municipalitiesResponse, postalCodesResponse] = await Promise.all([fetch(municipalitiesUrl), fetch(postalCodesUrl)]);
if (!municipalitiesResponse.ok || !postalCodesResponse.ok) {
  throw new Error(`No fue posible descargar los catálogos oficiales: DIVIPOLA=${municipalitiesResponse.status}, 4-72=${postalCodesResponse.status}.`);
}

const rawMunicipalities = await municipalitiesResponse.json();
const rawPostalCodes = await postalCodesResponse.json();
const pad = (value, size) => String(value ?? "").replace(/\D/g, "").padStart(size, "0");
const postalCode = value => String(Math.round(Number(String(value).replace(",", ".")) * 1000)).padStart(6, "0");

const postalCodesByMunicipality = new Map();
for (const record of rawPostalCodes) {
  const municipalityCode = pad(record.codigo_municipio, 5);
  const code = postalCode(record.codigo_postal);
  if (!/^\d{5}$/.test(municipalityCode) || !/^\d{6}$/.test(code)) continue;
  const current = postalCodesByMunicipality.get(municipalityCode) ?? new Set();
  current.add(code);
  postalCodesByMunicipality.set(municipalityCode, current);
}

const municipalities = rawMunicipalities
  .filter(record => ["Municipio", "Isla"].includes(record.tipo_municipio))
  .map(record => ({
    code: pad(record.cod_mpio, 5),
    name: record.nom_mpio.trim(),
    departmentCode: pad(record.cod_dpto, 2),
    departmentName: record.dpto.trim(),
    type: record.tipo_municipio,
    postalCodes: [...(postalCodesByMunicipality.get(pad(record.cod_mpio, 5)) ?? new Set())].sort()
  }))
  .sort((a, b) => a.departmentName.localeCompare(b.departmentName, "es-CO") || a.name.localeCompare(b.name, "es-CO"));

const departments = [...new Map(municipalities.map(municipality => [municipality.departmentCode, { code: municipality.departmentCode, name: municipality.departmentName }])).values()]
  .sort((a, b) => a.name.localeCompare(b.name, "es-CO"));

if (municipalities.length < 1100 || departments.length < 32 || rawPostalCodes.length < 3000) {
  throw new Error("La descarga oficial está incompleta; el catálogo no fue actualizado.");
}

const catalog = {
  generatedAt: new Date().toISOString(),
  sources: { municipalities: municipalitiesUrl, postalCodes: postalCodesUrl },
  summary: { departments: departments.length, municipalities: municipalities.length, postalCodeAreas: rawPostalCodes.length },
  departments,
  municipalities
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(catalog)}\n`);
console.log(`Catálogo actualizado: ${departments.length} departamentos, ${municipalities.length} municipios/islas y ${rawPostalCodes.length} áreas postales.`);
