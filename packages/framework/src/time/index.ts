// Time module: Temporal polyfill + ctx.tz helper.
//
// Provides:
//   - ensureTemporalPolyfill: installs Temporal globally when needed
//   - getTemporal: type-safe access to globalThis.Temporal
//   - createTzContext: ctx.tz factory with now/today/parse/toLocatedJson/...
//   - LocatedTimestampJson: API-boundary form { at, tz }
//   - isValidIanaTimeZone: IANA time-zone name validation (type:"tz" fields)
//   - warnIfNonUtcServerTimeZone: boot warning for a non-UTC process time zone
//   - GeoTzProvider: optional geo-to-zone adapter (ctx.tz.fromCoordinates/fromAddress)

export { warnIfNonUtcServerTimeZone } from "./boot-tz-warning.ts";
export type { GeoTzProvider } from "./geo-tz.ts";
export { isValidIanaTimeZone } from "./iana.ts";
export { instantToLegacyDate, legacyDateToInstant } from "./legacy-date.ts";
export { ensureTemporalPolyfill, getTemporal } from "./polyfill.ts";
export {
  createTzContext,
  type TzContext,
} from "./tz-context.ts";
