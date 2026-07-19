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

export { warnIfNonUtcServerTimeZone } from "./boot-tz-warning";
export type { GeoAddress, GeoCoordinates, GeoTzProvider } from "./geo-tz";
export { isValidIanaTimeZone } from "./iana";
export { instantToLegacyDate, legacyDateToInstant } from "./legacy-date";
export { ensureTemporalPolyfill, getTemporal } from "./polyfill";
export {
  createTzContext,
  createTzContextAsync,
  type LocatedTimestampJson,
  type TzContext,
  type TzContextOptions,
} from "./tz-context";
