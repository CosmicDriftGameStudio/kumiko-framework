// ctx.tz — the feature-code API for TZ operations.
//
// A consistent shape for every date/time need in handler code:
//   - "now as a UTC instant"          → ctx.tz.now()
//   - "today in the tenant's TZ"      → ctx.tz.today(ctx.tz.tenant)
//   - "parse a wall-clock string"     → ctx.tz.parse("2026-04-03T10:00", "Europe/Lisbon")
//   - "ZonedDateTime → JSON pair"     → ctx.tz.toLocatedJson(zdt)
//   - "JSON pair → ZonedDateTime"     → ctx.tz.fromLocatedJson({ at, tz })
//
// Feature code should no longer call `new Date()` — the lint rule for that
// lands in a later iteration, once all existing usages are migrated.
//
// `tenant` + `user` are the TZ defaults for the current request. Currently
// both default to "UTC" — once tenant.timezone + user.timezone fields
// exist, they get read from the request context here.
//
// The pure type contracts (TzContext, TzContextOptions, LocatedTimestampJson)
// live in @cosmicdrift/kumiko-types/tz-context — only the factories are here.

import type { TzContext, TzContextOptions } from "@cosmicdrift/kumiko-types/tz-context";
import { Temporal as TemporalPolyfill } from "temporal-polyfill";
import { ensureTemporalPolyfill } from "./polyfill";

// Back-compat shim: re-exported so existing `from "@cosmicdrift/kumiko-framework/time/tz-context"`
// imports keep working. Prefer importing from @cosmicdrift/kumiko-types/tz-context directly in
// new code — drop this re-export once no framework-path imports remain.
export type {
  LocatedTimestampJson,
  TzContext,
  TzContextOptions,
} from "@cosmicdrift/kumiko-types/tz-context";

/**
 * Factory: creates a TzContext for the current request.
 * Uses temporal-polyfill's module export (not globalThis.Temporal) so
 * buildHandlerContext stays ambient-free (fw#1525/#1550).
 */
export function createTzContext(options: TzContextOptions = {}): TzContext {
  const tenant = options.tenant ?? "UTC";
  const user = options.user ?? tenant;
  const geoTz = options.geoTz;

  return {
    tenant,
    user,
    now: () => TemporalPolyfill.Now.instant(), // @wrapper-known semantic-alias
    nowIn: (tz: string) => TemporalPolyfill.Now.zonedDateTimeISO(tz), // @wrapper-known semantic-alias
    today: (tz: string) => TemporalPolyfill.Now.plainDateISO(tz), // @wrapper-known semantic-alias
    todayRange: (tz: string) => {
      const today = TemporalPolyfill.Now.plainDateISO(tz);
      const startZdt = today.toZonedDateTime({ timeZone: tz });
      const endZdt = today.add({ days: 1 }).toZonedDateTime({ timeZone: tz });
      return { start: startZdt.toInstant(), end: endZdt.toInstant() };
    },
    parse: (wallClock: string, tz: string) =>
      TemporalPolyfill.PlainDateTime.from(wallClock).toZonedDateTime(tz),
    toInstant: (zdt) => zdt.toInstant(),
    toLocatedJson: (zdt) => ({
      // Wall-clock WITHOUT offset (no "Z", no "+01:00") plus the IANA name.
      // .toPlainDateTime().toString() returns "YYYY-MM-DDTHH:MM:SS[.fff]"
      // without an offset — exactly our contract.
      at: zdt.toPlainDateTime().toString(),
      tz: zdt.timeZoneId,
    }),
    fromLocatedJson: (obj) => TemporalPolyfill.PlainDateTime.from(obj.at).toZonedDateTime(obj.tz),
    fromCoordinates: async (coords) => {
      if (geoTz === undefined) {
        throw new Error(
          "ctx.tz.fromCoordinates requires a GeoTzProvider — inject one via the app context (e.g. buildServer({ context: { geoTzProvider } }) or runProdApp({ extraContext: { geoTzProvider } })) or install a provider package.",
        );
      }
      return geoTz.fromCoordinates(coords);
    },
    fromAddress: async (address) => {
      if (geoTz === undefined) {
        throw new Error(
          "ctx.tz.fromAddress requires a GeoTzProvider — inject one via the app context (e.g. buildServer({ context: { geoTzProvider } }) or runProdApp({ extraContext: { geoTzProvider } })) or install a provider package.",
        );
      }
      if (geoTz.fromAddress === undefined) {
        throw new Error(
          "ctx.tz.fromAddress requires a GeoTzProvider that implements fromAddress (geocoding). Offline lat/lng providers only support fromCoordinates.",
        );
      }
      return geoTz.fromAddress(address);
    },
    // @cast-boundary temporal-polyfill-vs-ambient: same TC39 Temporal values at
    // runtime; TzContext is typed against ambient Temporal from temporal-spec.
  } as TzContext;
}

/**
 * Convenience: ensures the polyfill is loaded AND creates the TzContext in
 * one await. Prefer this in boot code.
 */
export async function createTzContextAsync(options?: TzContextOptions): Promise<TzContext> {
  await ensureTemporalPolyfill();
  return createTzContext(options);
}
