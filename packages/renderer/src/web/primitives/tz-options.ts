// Curated fallback list for runtimes without Intl.supportedValuesOf (pre
// ES2022). Covers the most common zones; modern browsers + Bun return the
// full IANA list.
const FALLBACK_ZONES: readonly string[] = [
  "UTC",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "Europe/Madrid",
  "America/New_York",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
];

export const TZ_OPTIONS: readonly { readonly value: string; readonly label: string }[] = (
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : FALLBACK_ZONES
).map((zone) => ({ value: zone, label: zone }));
