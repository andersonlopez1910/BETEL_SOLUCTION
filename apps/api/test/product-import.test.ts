import assert from "node:assert/strict";
import test from "node:test";
import { computeCost, computeSale } from "@betel/contracts";
import { analyzeImport } from "../src/product-import.js";

const empty = { existingCodes: new Set<string>(), existingBarcodes: new Set<string>() };
const base = {
  Nombre: "Tubo PVC 1/2",
  Tipo: "PRODUCTO",
  Unidad: "unidad",
  "Costo unitario": "3000",
  "IVA incluido costo": "SI",
  "Tratamiento IVA compra": "GRAVADO_19",
  "Tarifa IVA compra": "19",
  "Precio de venta": "5500",
  "Impuesto incluido venta": "SI",
  "Tratamiento tributario venta": "IVA_19",
  "Tarifa IVA venta": "19",
};

test("Caso 5: la fila importada da los mismos cálculos que la creación manual", () => {
  const [row] = analyzeImport([base], empty);
  assert.equal(row!.status, "OK", row!.messages.join(" "));
  const cost = computeCost({
    amount: 3000,
    includesVat: true,
    treatment: "GRAVADO_19",
    deductible: "DESCONTABLE_TOTAL",
  });
  const sale = computeSale({ amount: 5500, includesTax: true, treatment: "IVA_19" });
  assert.deepEqual(row!.values, {
    cost: 3000,
    costBase: cost.base,
    purchaseVat: cost.vat,
    accountingCost: cost.accountingCost,
    price: 5500,
    priceBase: sale.base,
    saleVat: sale.vat,
    saleInc: 0,
    finalPrice: sale.total,
    margin: 45.45,
  });
  assert.deepEqual([row!.values.costBase, row!.values.priceBase, row!.values.saleVat], [2521.01, 4621.85, 878.15]);
});

test("errores de la especificación: IVA incluido sin tarifa, servicio inventariable", () => {
  const rows = analyzeImport(
    [
      { ...base, "Tratamiento tributario venta": "", "Tarifa IVA venta": "" },
      {
        Nombre: "Instalación",
        Tipo: "SERVICIO",
        Inventariable: "SI",
        "Precio de venta": "80000",
        "Impuesto incluido venta": "NO",
        "Tratamiento tributario venta": "IVA_EXCLUIDO",
      },
    ],
    empty
  );
  assert.equal(rows[0]!.status, "ERROR");
  assert.match(rows[0]!.messages.join(" "), /IVA incluido pero no se indicó la tarifa/);
  assert.equal(rows[1]!.status, "ERROR");
  assert.match(rows[1]!.messages.join(" "), /Servicio marcado como inventariable/);
});

test("advertencia: precio de venta inferior al costo contable", () => {
  const [row] = analyzeImport([{ ...base, "Precio de venta": "2000" }], empty);
  assert.equal(row!.status, "WARNING");
  assert.match(row!.messages.join(" "), /inferior al costo contable/);
  assert.ok(row!.payload, "una advertencia sí se importa");
});

test("tarifas coherentes con el tratamiento y 0 % sin clasificar", () => {
  const rows = analyzeImport(
    [
      { ...base, "Tarifa IVA venta": "5" },
      { ...base, "Tratamiento tributario venta": "", "Tarifa IVA venta": "0", "Impuesto incluido venta": "NO" },
      { ...base, "Tratamiento tributario venta": "IVA_EXENTO", "Tarifa IVA venta": "0" },
    ],
    empty
  );
  assert.match(rows[0]!.messages.join(" "), /debe ser 19 para IVA_19/);
  assert.match(rows[1]!.messages.join(" "), /IVA_EXENTO, IVA_EXCLUIDO, NO_GRAVADO/);
  assert.equal(rows[2]!.status, "OK");
  assert.equal(rows[2]!.values.saleVat, 0);
});

test("exento, excluido y no gravado se importan con códigos distintos", () => {
  const rows = analyzeImport(
    ["IVA_EXENTO", "IVA_EXCLUIDO", "NO_GRAVADO"].map(treatment => ({
      Nombre: `Ítem ${treatment}`,
      "Precio de venta": "1000",
      "Impuesto incluido venta": "NO",
      "Tratamiento tributario venta": treatment,
    })),
    empty
  );
  assert.deepEqual(
    rows.map(row => (row.payload?.sale as { treatment: string }).treatment),
    ["IVA_EXENTO", "IVA_EXCLUIDO", "NO_GRAVADO"]
  );
});

test("códigos duplicados son error y códigos de barras duplicados, advertencia", () => {
  const rows = analyzeImport(
    [
      { ...base, Código: "PVC-1", "Código de barras": "7701" },
      { ...base, Nombre: "Otro", Código: "pvc-1", "Código de barras": "7701" },
      { ...base, Nombre: "Tercero", Código: "EXISTE" },
    ],
    { existingCodes: new Set(["existe"]), existingBarcodes: new Set() }
  );
  assert.equal(rows[0]!.status, "OK");
  assert.equal(rows[1]!.status, "ERROR");
  assert.match(rows[1]!.messages.join(" "), /repetido en el archivo \(fila 2\)/);
  assert.match(rows[1]!.messages.join(" "), /código de barras 7701 se repite/);
  assert.match(rows[2]!.messages.join(" "), /ya existe en Betel/);
});

test("IVA parcialmente descontable requiere porcentaje; inventariable requiere unidad", () => {
  const rows = analyzeImport(
    [
      { ...base, "Tratamiento IVA descontable": "DESCONTABLE_PARCIAL" },
      { ...base, Unidad: "", Inventariable: "SI" },
    ],
    empty
  );
  assert.match(rows[0]!.messages.join(" "), /porcentaje entre 0 y 100/);
  assert.match(rows[1]!.messages.join(" "), /requiere unidad de medida/);
});

test("la plantilla anterior se sigue aceptando (precio sin IVA)", () => {
  const [row] = analyzeImport([{ Nombre: "Codo", Precio: "5.500", IVA: "19" }], empty);
  assert.equal(row!.status, "OK", row!.messages.join(" "));
  assert.deepEqual([row!.values.priceBase, row!.values.saleVat, row!.values.finalPrice], [5500, 1045, 6545]);
});
