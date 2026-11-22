import type { LetterAddress } from "./types.ts";

function normalizeAddressText(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ß", "ss")
    .replace(/str(?:\.|\b)/g, "strasse")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/(\d) ([a-z])\b/g, "$1$2")
    .trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  return phrase.length > 0 && ` ${haystack} `.includes(` ${phrase} `);
}

const LEGAL_FORM_TOKENS: ReadonlySet<string> = new Set([
  "gmbh",
  "mbh",
  "ag",
  "kg",
  "ug",
  "ohg",
  "gbr",
  "ev",
  "co",
]);

// The last word that is no legal form: "Muster GmbH & Co. KG" is told by "muster", not by "kg".
function nameToken(name: string): string {
  const tokens = normalizeAddressText(name.replace(/\be\.\s?v\b\.?/gi, "ev")).split(" ");
  const distinctive = tokens.filter((token) => !LEGAL_FORM_TOKENS.has(token));
  return distinctive[distinctive.length - 1] ?? tokens[tokens.length - 1] ?? "";
}

// The zone starts with the sender line, then an empty line, then the recipient. Without that
// separator the whole text counts.
function recipientPart(recognized: string): string {
  const lines = recognized.split(",").map((line) => line.trim());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const separator = lines.lastIndexOf("");
  return (separator === -1 ? lines : lines.slice(separator + 1)).join(" ");
}

/** Whether the recipient part of the provider's recognized address zone (one text, lines joined by ", ")
 *  still holds the expected recipient: the distinctive name word, street with house number, postal code and city. */
export function recognizedAddressMatches(expected: LetterAddress, recognized: string): boolean {
  const text = normalizeAddressText(recipientPart(recognized));
  return (
    containsPhrase(text, nameToken(expected.name)) &&
    containsPhrase(text, normalizeAddressText(`${expected.street} ${expected.houseNumber}`)) &&
    containsPhrase(text, normalizeAddressText(expected.postalCode)) &&
    containsPhrase(text, normalizeAddressText(expected.city))
  );
}
