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
// `tenant` + `user` are the TZ defaults for the current request — resolved
// by buildHandlerContext (tenant:config:timezone, then SessionUser.timezone,
// falling back to "UTC" at each step) and passed in via TzContextOptions.
// This factory itself stays a pure default-filler.
//
// The pure type contracts (TzContext, TzContextOptions, LocatedTimestampJson)
// live in @cosmicdrift/kumiko-types/tz-context — only the factories are here.

import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { Clock, TzContext, TzContextOptions } from "@cosmicdrift/kumiko-types/tz-context";

// Back-compat shim: re-exported so existing `from "@cosmicdrift/kumiko-framework/time/tz-context"`
// imports keep working. Prefer importing from @cosmicdrift/kumiko-types/tz-context directly in
// new code — drop this re-export once no framework-path imports remain.
export type {
  Clock,
  LocatedTimestampJson,
  TzContext,
  TzContextOptions,
} from "@cosmicdrift/kumiko-types/tz-context";

const SYSTEM_CLOCK: Clock = {
  now: () => Temporal.Now.instant(), // @wrapper-known semantic-alias
};

/**
 * Factory: creates a TzContext for the current request.
 * Uses the kumiko-types Temporal module export (not globalThis.Temporal) so
 * buildHandlerContext stays ambient-free.
 */
export function createTzContext(options: TzContextOptions = {}): TzContext {
  const tenant = options.tenant ?? "UTC";
  const user = options.user ?? tenant;
  const geoTz = options.geoTz;
  const clock = options.clock ?? SYSTEM_CLOCK;
  const nowIn = (tz: string) => clock.now().toZonedDateTimeISO(tz);

  return {
    tenant,
    user,
    now: () => clock.now(),
    nowIn,
    today: (tz: string) => nowIn(tz).toPlainDate(),
    todayRange: (tz: string) => {
      const today = nowIn(tz).toPlainDate();
      const startZdt = today.toZonedDateTime({ timeZone: tz });
      const endZdt = today.add({ days: 1 }).toZonedDateTime({ timeZone: tz });
      return { start: startZdt.toInstant(), end: endZdt.toInstant() };
    },
    parse: (wallClock: string, tz: string) =>
      Temporal.PlainDateTime.from(wallClock).toZonedDateTime(tz),
    toInstant: (zdt) => zdt.toInstant(),
    toLocatedJson: (zdt) => ({
      // Wall-clock WITHOUT offset (no "Z", no "+01:00") plus the IANA name.
      // .toPlainDateTime().toString() returns "YYYY-MM-DDTHH:MM:SS[.fff]"
      // without an offset — exactly our contract.
      at: zdt.toPlainDateTime().toString(),
      tz: zdt.timeZoneId,
    }),
    fromLocatedJson: (obj) => Temporal.PlainDateTime.from(obj.at).toZonedDateTime(obj.tz),
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
  };
}
