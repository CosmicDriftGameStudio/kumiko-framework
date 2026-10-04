// @runtime client
// Crypto-free so the browser panel can share the locale rule with the server.
export const CONSENT_LOCALES = ["de", "en"] as const;
export type ConsentLocale = (typeof CONSENT_LOCALES)[number];
export const FALLBACK_CONSENT_LOCALE: ConsentLocale = "en";

function isConsentLocale(value: string): value is ConsentLocale {
  return CONSENT_LOCALES.some((locale) => locale === value);
}

/** Exact match, else the language part ("de-AT" → "de"), else the fallback. */
export function resolveConsentLocale(input?: string): ConsentLocale {
  if (input === undefined) return FALLBACK_CONSENT_LOCALE;
  const lower = input.toLowerCase();
  if (isConsentLocale(lower)) return lower;
  const language = lower.split("-")[0] ?? "";
  return isConsentLocale(language) ? language : FALLBACK_CONSENT_LOCALE;
}
