import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@betel/db";
import { productQuerySchema } from "@betel/contracts";
import { nextProductCode, productFromRow, stockState } from "../src/products.js";

test("siguiente código automático", () => {
  assert.equal(nextProductCode([]), "C-1");
  assert.equal(nextProductCode(["C-1003", "c-7", null, "REF-99", "C-12A"]), "C-1004");
});

test("estado del stock", () => {
  assert.equal(stockState(new Prisma.Decimal(-3)), "NEGATIVE");
  assert.equal(stockState(new Prisma.Decimal(0)), "ZERO");
  assert.equal(stockState(new Prisma.Decimal("0.5")), "POSITIVE");
});

test("fila de Excel o CSV en español", () => {
  const row = productFromRow({
    Código: "C-55",
    Nombre: "  Tubo PVC 1/2  ",
    Tipo: "Producto",
    Unidad: "metro",
    "Precio de venta": "$ 5.500",
    "IVA %": "19%",
    Descripción: "Presión",
  });
  assert.deepEqual(row, {
    product: {
      sku: "C-55",
      name: "Tubo PVC 1/2",
      description: "Presión",
      kind: "PRODUCT",
      unit: "M",
      unitPrice: 5500,
      taxRate: 19,
    },
  });
});

test("precios con decimales y servicios", () => {
  assert.equal(
    productFromRow({ nombre: "Asesoría", tipo: "servicio", precio: "1.234,56" }).product?.unitPrice,
    1234.56
  );
  assert.equal(productFromRow({ name: "Pintura", price: "1,234.50", tax: "5" }).product?.unitPrice, 1234.5);
  const service = productFromRow({ nombre: "Instalación", tipo: "Servicio", precio: 80000, iva: 0 }).product!;
  assert.equal(service.kind, "SERVICE");
  assert.equal(service.taxRate, 0);
  assert.equal(service.unit, "SERV");
  assert.equal(service.sku, undefined);
});

test("filas inválidas", () => {
  assert.match(productFromRow({ nombre: "X", precio: 10 }).error!, /Nombre/);
  assert.match(productFromRow({ nombre: "Tornillo", precio: "" }).error!, /Precio/);
  assert.match(productFromRow({ nombre: "Tornillo", precio: 10, tipo: "kit" }).error!, /Tipo/);
  assert.match(productFromRow({ nombre: "Tornillo", precio: 10, iva: 150 }).error!, /IVA/);
});

test("filtros de la lista", () => {
  assert.deepEqual(productQuerySchema.parse({}), { status: "ALL", page: 1, pageSize: 10 });
  assert.equal(productQuerySchema.safeParse({ stock: "LOW" }).success, false);
});
