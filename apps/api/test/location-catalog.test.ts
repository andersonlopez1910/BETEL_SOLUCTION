import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

type Catalog = {
  summary: { departments: number; municipalities: number; postalCodeAreas: number };
  municipalities: Array<{ code: string; postalCodes: string[] }>;
};

const catalog = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../web/data/colombia-locations.json"), "utf8")) as Catalog;

test("el catálogo geográfico conserva cobertura nacional y códigos postales de Bogotá", () => {
  assert.ok(catalog.summary.departments >= 32);
  assert.ok(catalog.summary.municipalities >= 1100);
  assert.ok(catalog.summary.postalCodeAreas >= 3000);
  const bogota = catalog.municipalities.find(municipality => municipality.code === "11001");
  assert.ok(bogota);
  assert.ok(bogota.postalCodes.includes("110111"));
  assert.ok(bogota.postalCodes.every(code => /^\d{6}$/.test(code)));
});
