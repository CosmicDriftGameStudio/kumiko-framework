import type { LetterAddress } from "./types.ts";

function normalizeAddressText(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ß", "ss")
    .replace(/str\./g, "strasse")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  return phrase.length > 0 && ` ${haystack} `.includes(` ${phrase} `);
}

function lastNameToken(name: string): string {
  const tokens = normalizeAddressText(name).split(" ");
  return tokens[tokens.length - 1] ?? "";
}

/** Whether the provider's recognized address zone (one text, lines joined by ", ") still holds the
 *  expected recipient: last name, street with house number, postal code and city. */
export function recognizedAddressMatches(expected: LetterAddress, recognized: string): boolean {
  const text = normalizeAddressText(recognized);
  return (
    containsPhrase(text, lastNameToken(expected.name)) &&
    containsPhrase(text, normalizeAddressText(`${expected.street} ${expected.houseNumber}`)) &&
    containsPhrase(text, normalizeAddressText(expected.postalCode)) &&
    containsPhrase(text, normalizeAddressText(expected.city))
  );
}
