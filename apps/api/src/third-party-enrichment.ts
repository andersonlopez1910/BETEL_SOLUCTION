import { get } from "node:https";

/**
 * Enriquecimiento de terceros: proveedores intercambiables y datos trazables.
 * Solo consulta el registro empresarial público; nunca intenta consultar ni automatizar DIAN.
 */
export type EnrichedField = { field: string; value: string; source: string; retrievedAt: string; confidence: "HIGH" | "MEDIUM" | "LOW" };
export type EnrichmentResult = { found: boolean; source: string; retrievedAt: string; fields: EnrichedField[]; merchantRegistered: boolean; raw: { chamberOfCommerce?: string; commercialRegistration?: string; economicActivityCode?: string } };

export interface ColombiaBusinessRegistryProvider {
  lookup(identificationNumber: string): Promise<EnrichmentResult>;
}

export function calculateNitCheckDigit(nit: string) {
  const weights = [71, 67, 59, 53, 47, 43, 41, 37, 29, 23, 19, 17, 13, 7, 3];
  const digits = nit.replace(/\D/g, "");
  const sum = [...digits].reverse().reduce((total, digit, index) => total + Number(digit) * weights[weights.length - 1 - index]!, 0);
  const residue = sum % 11;
  return residue > 1 ? 11 - residue : residue;
}

type RuesRow = Record<string, string | undefined>;
const value = (row: RuesRow, key: string) => row[key]?.trim() || undefined;
const readJson = (url: string, headers: Record<string, string>) =>
  new Promise<RuesRow[]>((resolve, reject) => {
    const request = get(url, { headers }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => (body += chunk));
      response.on("end", () => {
        if ((response.statusCode ?? 500) >= 400) return reject(new Error(`El registro empresarial respondió ${response.statusCode}.`));
        try { resolve(JSON.parse(body) as RuesRow[]); } catch { reject(new Error("El registro empresarial devolvió una respuesta inválida.")); }
      });
    });
    request.setTimeout(7000, () => request.destroy(new Error("Tiempo de espera agotado.")));
    request.on("error", reject);
  });

export class ColombiaRuesOpenDataProvider implements ColombiaBusinessRegistryProvider {
  private readonly endpoint = process.env.RUES_OPEN_DATA_URL ?? "https://www.datos.gov.co/resource/c82u-588k.json";
  async lookup(identificationNumber: string): Promise<EnrichmentResult> {
    const id = identificationNumber.replace(/\D/g, "");
    const where = `numero_identificacion='${id}' OR nit='${id}'`;
    {
      const rows = await readJson(`${this.endpoint}?$where=${encodeURIComponent(where)}&$limit=5`, process.env.SOCRATA_APP_TOKEN ? { "X-App-Token": process.env.SOCRATA_APP_TOKEN } : {});
      const row = rows.find(item => value(item, "numero_identificacion") === id || value(item, "nit") === id);
      const retrievedAt = new Date().toISOString();
      if (!row) return { found: false, source: "RUES_OPEN_DATA", retrievedAt, fields: [], merchantRegistered: false, raw: {} };
      const fields: EnrichedField[] = [];
      const add = (field: string, input?: string) => { if (input) fields.push({ field, value: input, source: "RUES_OPEN_DATA", retrievedAt, confidence: "HIGH" }); };
      add("legalName", value(row, "razon_social"));
      add("firstName", value(row, "primer_nombre")); add("middleName", value(row, "segundo_nombre"));
      add("firstSurname", value(row, "primer_apellido")); add("secondSurname", value(row, "segundo_apellido"));
      add("tradeName", value(row, "sigla")); add("verificationDigit", value(row, "digito_verificacion"));
      add("chamberOfCommerce", value(row, "camara_comercio")); add("commercialRegistration", value(row, "matricula"));
      add("economicActivityCode", value(row, "cod_ciiu_act_econ_pri"));
      const category = value(row, "categoria_matricula")?.toUpperCase() ?? "";
      return { found: true, source: "RUES_OPEN_DATA", retrievedAt, fields, merchantRegistered: Boolean(value(row, "matricula")) || category.includes("PERSONA NATURAL"), raw: { chamberOfCommerce: value(row, "camara_comercio"), commercialRegistration: value(row, "matricula"), economicActivityCode: value(row, "cod_ciiu_act_econ_pri") } };
    }
  }
}

export const getThirdPartyEnrichmentProvider = () => new ColombiaRuesOpenDataProvider();
