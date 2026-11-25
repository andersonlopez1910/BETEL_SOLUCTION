import assert from "node:assert/strict";
import test from "node:test";
import { calculateNitCheckDigit } from "../src/third-party-enrichment.js";

test("calcula el dígito de verificación de un NIT", () => {
  assert.equal(calculateNitCheckDigit("900999001"), 1);
  assert.equal(calculateNitCheckDigit("860002964"), 4);
});
