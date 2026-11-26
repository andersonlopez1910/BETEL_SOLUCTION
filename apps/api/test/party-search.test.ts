import assert from "node:assert/strict";
import test from "node:test";
import { editDistance, normalizeText, partyScore, rankParties } from "../src/party-search.js";

const parties = [
  {
    legalName: "Distribuidora José Pérez S.A.S.",
    tradeName: "DisJosé",
    identificationNumber: "900123456",
    verificationDigit: "7",
    email: "ventas@disjose.co",
    phone: "310 555 1234",
  },
  {
    legalName: "Ferretería El Tornillo",
    tradeName: null,
    identificationNumber: "800987654",
    verificationDigit: "1",
    email: null,
    phone: null,
  },
  {
    legalName: "Juan Distribuciones",
    tradeName: null,
    identificationNumber: "1020304050",
    email: "juan@correo.com",
    phone: null,
  },
];
const names = (search: string) => rankParties(parties, search).map(party => party.legalName);

test("normaliza tildes, mayúsculas y signos", () => {
  assert.equal(normalizeText("  Ferretería  EL-Tornillo S.A.S. "), "ferreteria el tornillo s a s");
});

test("distancia de edición con corte", () => {
  assert.equal(editDistance("distribuidra", "distribuidora", 2), 1);
  assert.equal(editDistance("casa", "perro", 1), 2);
});

test("busca sin tildes ni mayúsculas, por palabras en cualquier orden", () => {
  assert.deepEqual(names("jose distribuidora"), ["Distribuidora José Pérez S.A.S."]);
  assert.deepEqual(names("FERRETERIA"), ["Ferretería El Tornillo"]);
});

test("busca por NIT con o sin dígito de verificación, con puntos o guiones", () => {
  assert.deepEqual(names("900.123"), ["Distribuidora José Pérez S.A.S."]);
  assert.deepEqual(names("900123456-7"), ["Distribuidora José Pérez S.A.S."]);
  assert.deepEqual(names("8009"), ["Ferretería El Tornillo"]);
});

test("busca por nombre comercial, correo y teléfono", () => {
  assert.deepEqual(names("disjose"), ["Distribuidora José Pérez S.A.S."]);
  assert.deepEqual(names("juan@correo"), ["Juan Distribuciones"]);
  assert.deepEqual(names("3105551"), ["Distribuidora José Pérez S.A.S."]);
});

test("tolera errores de tipeo y encuentra parecidos", () => {
  assert.deepEqual(names("distribuidra"), ["Distribuidora José Pérez S.A.S."]);
  assert.deepEqual(names("feretería"), ["Ferretería El Tornillo"]);
  // Mientras se escribe: el comienzo de una palabra con un error.
  assert.deepEqual(names("tornilo"), ["Ferretería El Tornillo"]);
});

test("ordena por parecido: lo que empieza por lo escrito va primero", () => {
  assert.deepEqual(names("distribu"), ["Distribuidora José Pérez S.A.S.", "Juan Distribuciones"]);
  assert.deepEqual(names("juan"), ["Juan Distribuciones"]);
});

test("sin coincidencias no devuelve nada; palabras cortas no toleran errores", () => {
  assert.deepEqual(names("zapatería"), []);
  assert.equal(partyScore(parties[1]!, "el tornillo xyz"), 0);
  assert.equal(partyScore(parties[1]!, "al"), 0);
});
