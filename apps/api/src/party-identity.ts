/** Normaliza una identificación sin alterar letras válidas de documentos extranjeros. */
export function normalizePartyIdentification(
  identificationType: string,
  rawIdentificationNumber: string,
  rawVerificationDigit?: string
) {
  const raw = rawIdentificationNumber.trim();
  const nitParts = identificationType === "NIT" ? raw.match(/^(.*?)-\s*(\d)$/) : null;
  const identificationNumber = (nitParts ? nitParts[1] : raw).replace(/[\s.-]/g, "").toUpperCase();
  const verificationDigit = rawVerificationDigit?.replace(/\D/g, "").slice(-1) || nitParts?.[2];
  return { identificationNumber, verificationDigit };
}
