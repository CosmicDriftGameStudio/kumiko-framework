export type Formality = "formal" | "informal";

// BCP-47 private-use subtag: a translation bundle keyed "de-x-formal" holds the
// formal ("Sie") wording and only needs the keys that differ from plain "de".
export function formalLocaleTag<Locale extends string>(locale: Locale): `${Locale}-x-formal` {
  return `${locale}-x-formal`;
}
