// Time-Modul: Temporal-Polyfill + ctx.tz Helper.
//
// Aktueller Stand (Iteration 1-4 von Gap-03 in samples/beammycar/MIGRATION.md):
//   - ensureTemporalPolyfill: installiert Temporal global wenn nötig
//   - getTemporal: type-safer Zugriff auf globalThis.Temporal
//   - createTzContext: ctx.tz Factory mit now/today/parse/toLocatedJson/...
//   - LocatedTimestampJson: API-Boundary-Form { at, tz }
//   - isValidIanaTimeZone: IANA-Zonennamen-Validierung (type:"tz"-Felder)
//   - warnIfNonUtcServerTimeZone: Boot-Warnung bei nicht-UTC Prozess-TZ
//   - GeoTzProvider: optionaler Geo→Zone-Adapter (ctx.tz.fromCoordinates/fromAddress)

export { warnIfNonUtcServerTimeZone } from "./boot-tz-warning.ts";
export type { GeoAddress, GeoCoordinates, GeoTzProvider } from "./geo-tz.ts";
export { isValidIanaTimeZone } from "./iana.ts";
export { instantToLegacyDate, legacyDateToInstant } from "./legacy-date.ts";
export { ensureTemporalPolyfill, getTemporal } from "./polyfill.ts";
export {
  type Clock,
  createTzContext,
  createTzContextAsync,
  type LocatedTimestampJson,
  type TzContext,
  type TzContextOptions,
} from "./tz-context.ts";
