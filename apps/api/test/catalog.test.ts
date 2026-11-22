import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@betel/db";
import { catalogReports, resolveParams } from "../src/catalog/index.js";
import { accumulate, columnTotals, lineAmounts } from "../src/catalog/common.js";

const d = (value: number) => new Prisma.Decimal(value);

test("base e IVA de un renglón con descuento", () => {
  // 2 × 10.000 con 10 % de descuento = 18.000 de base; IVA 19 % = 3.420; total 21.420.
  const { base, tax } = lineAmounts({ quantity: d(2), unitPrice: d(10000), discountRate: d(10), lineTotal: d(21420) });
  assert.equal(base.toFixed(2), "18000.00");
  assert.equal(tax.toFixed(2), "3420.00");
});

test("totales solo de columnas sumables", () => {
  const totals = columnTotals(
    [
      { key: "name", label: "Producto" },
      { key: "quantity", label: "Cantidad", type: "number" },
      { key: "base", label: "Base", type: "money" },
      { key: "price", label: "Precio", type: "money", sum: false },
      { key: "share", label: "%", type: "percent" },
    ],
    [
      { name: "A", quantity: "1.5", base: "100.10", price: "5.00", share: "40.0" },
      { name: "B", quantity: "2", base: "50.00", price: "7.00", share: "60.0" },
    ]
  );
  assert.deepEqual(totals, { name: "Total", quantity: "3.5", base: "150.10" });
  assert.equal(columnTotals([{ key: "x", label: "X", type: "money" }], []), undefined);
});

test("acumula por clave", () => {
  const groups = accumulate(
    [
      { k: "a", v: 1 },
      { k: "b", v: 2 },
      { k: "a", v: 3 },
    ],
    item => item.k,
    () => ({ sum: 0 }),
    (acc, item) => {
      acc.sum += item.v;
    }
  );
  assert.deepEqual(
    [...groups.entries()],
    [
      ["a", { sum: 4 }],
      ["b", { sum: 2 }],
    ]
  );
});

test("filtros por defecto en hora de Colombia", () => {
  // 21-nov-2026 03:00 UTC = 20-nov-2026 22:00 en Bogotá.
  const params = resolveParams({ partyKind: "CUSTOMER" }, new Date("2026-11-21T03:00:00Z"));
  assert.equal(params.date.toISOString().slice(0, 10), "2026-11-20");
  assert.equal(params.from.toISOString().slice(0, 10), "2026-11-01");
  assert.equal(params.year, 2026);
});

test("ids únicos y filtros válidos en el catálogo", () => {
  const ids = catalogReports.map(report => report.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 45);
  for (const report of catalogReports) {
    assert.ok(report.roles.length > 0, report.id);
    assert.ok(
      report.roles.every(role => ["OWNER", "ADMIN", "ACCOUNTANT", "SALES", "VIEWER"].includes(role)),
      report.id
    );
  }
});
