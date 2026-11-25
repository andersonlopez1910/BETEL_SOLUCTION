import assert from "node:assert/strict";
import test from "node:test";
import { normalizePartyIdentification } from "../src/party-identity.js";

test("normaliza separadores y separa el dígito de verificación del NIT", () => {
  assert.deepEqual(normalizePartyIdentification("NIT", "900.999.001-1"), {
    identificationNumber: "900999001",
    verificationDigit: "1",
  });
});

test("normaliza espacios, puntos y guiones sin cambiar documentos alfanuméricos", () => {
  assert.deepEqual(normalizePartyIdentification("CC", " 1.111-111  "), {
    identificationNumber: "1111111",
    verificationDigit: undefined,
  });
  assert.deepEqual(normalizePartyIdentification("PA", " ab- 123 "), {
    identificationNumber: "AB123",
    verificationDigit: undefined,
  });
});
