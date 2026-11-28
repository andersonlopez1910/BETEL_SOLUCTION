import assert from "node:assert/strict";
import test from "node:test";
import { nextPosNumber, posExpiry, posResolutionText } from "../src/pos.js";

const settings = {
  posPrefix: "POS",
  posResolutionNumber: "18764000000000",
  posResolutionDate: new Date("2026-01-15"),
  posRangeFrom: 1,
  posRangeTo: 5000,
  posValidityMonths: 24,
};
const today = new Date("2026-11-27");

test("numeración POS dentro del rango de la resolución", () => {
  assert.deepEqual(nextPosNumber(settings, [], today), { number: 1 });
  assert.deepEqual(nextPosNumber(settings, [1, 2, 3], today), { number: 4 });
  assert.deepEqual(nextPosNumber({ ...settings, posRangeFrom: 100 }, [5], today), { number: 100 });
});

test("no se emite sin resolución, vencida, futura o con el rango agotado", () => {
  assert.match(
    (nextPosNumber({ ...settings, posResolutionNumber: null }, [], today) as { error: string }).error,
    /Configura la resolución/
  );
  assert.match((nextPosNumber(settings, [], new Date("2028-01-15")) as { error: string }).error, /vencida/);
  assert.match((nextPosNumber(settings, [], new Date("2026-01-01")) as { error: string }).error, /aún no está vigente/);
  assert.match(
    (nextPosNumber({ ...settings, posRangeTo: 2 }, [1, 2], today) as { error: string }).error,
    /agotó el rango/
  );
});

test("texto de la resolución y vencimiento", () => {
  assert.equal(
    posResolutionText(settings),
    "Resolución DIAN No. 18764000000000 del 2026-01-15, numeración POS-1 al POS-5000, vigencia 24 meses."
  );
  assert.equal(posExpiry(settings)?.toISOString().slice(0, 10), "2028-01-15");
});
