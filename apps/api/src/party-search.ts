/**
 * Búsqueda de terceros por parecido (GET /v1/parties?search=).
 *
 * Cada palabra escrita debe aparecer en algún campo: razón social, nombre comercial, identificación (sin puntos ni
 * guiones, con o sin dígito de verificación), correo o teléfono. No distingue mayúsculas ni tildes, y tolera errores
 * de tipeo en palabras de 4 o más letras (1 letra de diferencia; 2 desde 8 letras). Los resultados se ordenan por
 * parecido: palabra exacta > empieza por > contiene > con error de tipeo.
 */

export type SearchableParty = {
  legalName: string;
  tradeName?: string | null;
  identificationNumber: string;
  verificationDigit?: string | null;
  email?: string | null;
  phone?: string | null;
};

/** Minúsculas, sin tildes ni signos; deja letras, números, @ y espacios. */
export function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Distancia de edición (Levenshtein) con corte: devuelve max + 1 si la supera. */
export function editDistance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length]!;
}

const typoAllowance = (token: string) => (token.length >= 8 ? 2 : token.length >= 4 ? 1 : 0);

/** Puntaje de una palabra contra un texto ya normalizado (0 = no aparece). */
function tokenScore(token: string, text: string) {
  if (!text) return 0;
  const words = text.split(" ");
  if (words.includes(token)) return 4;
  if (words.some(word => word.startsWith(token))) return 3;
  if (text.includes(token)) return 2;
  const allowance = typoAllowance(token);
  if (!allowance) return 0;
  // Error de tipeo contra una palabra completa o contra su comienzo (mientras se escribe).
  return words.some(
    word =>
      editDistance(token, word, allowance) <= allowance ||
      (word.length > token.length && editDistance(token, word.slice(0, token.length), allowance) <= allowance)
  )
    ? 1
    : 0;
}

/** Puntaje de parecido de un tercero con la búsqueda; 0 si alguna palabra no aparece. */
export function partyScore(party: SearchableParty, search: string) {
  const tokens = normalizeText(search).split(" ").filter(Boolean);
  if (!tokens.length) return 0;
  const names = normalizeText(`${party.legalName} ${party.tradeName ?? ""}`);
  const digits = party.identificationNumber.replace(/\D/g, "");
  const identification = `${digits} ${digits}${party.verificationDigit ?? ""}`;
  const contact = normalizeText(`${party.email ?? ""} ${(party.phone ?? "").replace(/\D/g, "")}`);
  let total = 0;
  for (const token of tokens) {
    const numeric = /^\d+$/.test(token);
    const score = Math.max(
      tokenScore(token, names),
      numeric
        ? identification.split(" ").some(value => value.startsWith(token))
          ? 5
          : identification.includes(token)
            ? 3
            : 0
        : 0,
      numeric ? (contact.includes(token) ? 2 : 0) : tokenScore(token, contact) > 1 ? 2 : 0
    );
    if (!score) return 0;
    total += score;
  }
  // Desempate: razón social que empieza por lo escrito.
  if (names.startsWith(tokens.join(" "))) total += 2;
  return total;
}

/** Ordena por parecido (y luego por nombre) y deja los `limit` primeros que coinciden. */
export function rankParties<T extends SearchableParty>(parties: T[], search: string, limit = 20) {
  return parties
    .map(party => ({ party, score: partyScore(party, search) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.party.legalName.localeCompare(b.party.legalName, "es"))
    .slice(0, limit)
    .map(item => item.party);
}
