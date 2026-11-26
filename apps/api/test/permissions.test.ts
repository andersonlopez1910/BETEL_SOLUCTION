import assert from "node:assert/strict";
import test from "node:test";
import {
  hasPermission,
  overridesFromMatrix,
  permissionMatrix,
  permissionsOf,
  PERMISSIONS,
} from "../src/permissions.js";

test("sin cambios, los permisos son los de siempre", () => {
  assert.equal(hasPermission("SALES", "invoices.create"), true);
  assert.equal(hasPermission("SALES", "invoices.issue"), false);
  assert.equal(hasPermission("VIEWER", "reports.export"), false);
  assert.equal(hasPermission("ADMIN", "users.manage"), true);
  assert.equal(hasPermission("SUPPORT", "reports.view"), false);
});

test("los cambios de la empresa aplican por rol y permiso", () => {
  const overrides = { SALES: { "invoices.issue": true, "chart.view": false } };
  assert.equal(hasPermission("SALES", "invoices.issue", overrides), true);
  assert.equal(hasPermission("SALES", "chart.view", overrides), false);
  assert.equal(hasPermission("ACCOUNTANT", "invoices.issue", overrides), true); // no cambia otros roles
});

test("el propietario siempre tiene todo", () => {
  assert.equal(hasPermission("OWNER", "users.manage", { OWNER: { "users.manage": false } }), true);
  assert.equal(permissionsOf("OWNER").length, PERMISSIONS.length);
});

test("de la tabla editada solo se guarda lo que difiere del valor por defecto", () => {
  const matrix = permissionMatrix();
  matrix.SALES["invoices.issue"] = true; // cambio
  matrix.VIEWER["reports.view"] = true; // igual al defecto
  matrix.OWNER["users.manage"] = false; // ignorado
  assert.deepEqual(overridesFromMatrix(matrix), { SALES: { "invoices.issue": true } });
  assert.deepEqual(overridesFromMatrix(permissionMatrix()), {});
});
