import assert from "node:assert/strict";
import test from "node:test";
import { canManage, createUserSchema, updateUserSchema } from "../src/users.js";

const owner = { userId: "o1", role: "OWNER" as const };
const admin = { userId: "a1", role: "ADMIN" as const };
const seller = { userId: "s1", role: "SALES" as const, active: true };

test("propietario y administrador gestionan usuarios (el permiso users.manage se valida antes)", () => {
  assert.equal(canManage(owner, null, { role: "SALES" }, 1), null);
  assert.equal(canManage(admin, null, { role: "ACCOUNTANT" }, 1), null);
});

test("solo un propietario asigna o modifica el rol Propietario", () => {
  assert.match(canManage(admin, null, { role: "OWNER" }, 1)!, /Solo un propietario/);
  assert.match(
    canManage(admin, { userId: "o2", role: "OWNER", active: true }, { active: false }, 2)!,
    /Solo un propietario/
  );
  assert.equal(canManage(owner, seller, { role: "OWNER" }, 1), null);
});

test("nadie cambia su propio rol ni se desactiva", () => {
  const self = { userId: "a1", role: "ADMIN" as const, active: true };
  assert.match(canManage(admin, self, { role: "SALES" }, 1)!, /propio rol/);
  assert.match(canManage(admin, self, { active: false }, 1)!, /propio usuario/);
  assert.equal(canManage(admin, self, { role: "ADMIN" }, 1), null);
});

test("siempre queda al menos un propietario activo", () => {
  const otherOwner = { userId: "o2", role: "OWNER" as const, active: true };
  assert.match(canManage(owner, otherOwner, { role: "ADMIN" }, 1)!, /al menos un propietario/);
  assert.equal(canManage(owner, otherOwner, { role: "ADMIN" }, 2), null);
  assert.equal(canManage(owner, { ...otherOwner, active: false }, { active: true }, 1), null);
});

test("valida datos: correo, nombre, celular de 10 dígitos y rol", () => {
  const ok = createUserSchema.parse({
    displayName: "Ana Ruiz",
    email: " ANA@Empresa.co ",
    phone: "300 123 4567",
    role: "SALES",
  });
  assert.deepEqual(ok, { displayName: "Ana Ruiz", email: "ana@empresa.co", phone: "3001234567", role: "SALES" });
  assert.equal(
    createUserSchema.parse({ displayName: "Ana Ruiz", email: "a@b.co", phone: "", role: "VIEWER" }).phone,
    null
  );
  assert.equal(
    createUserSchema.safeParse({ displayName: "Ana", email: "a@b.co", phone: "300123", role: "SALES" }).success,
    false
  );
  assert.equal(
    createUserSchema.safeParse({ displayName: "Ana Ruiz", email: "no-es-correo", role: "SALES" }).success,
    false
  );
  assert.equal(createUserSchema.safeParse({ displayName: "Ana Ruiz", email: "a@b.co", role: "ROOT" }).success, false);
  assert.equal(updateUserSchema.safeParse({}).success, false);
});
