// ctx.tz — die Feature-Code-API für TZ-Operationen.
//
// Eine konsistente Form für jeden Date/Time-Bedarf im Handler-Code:
//   - "Jetzt als UTC-Instant"        → ctx.tz.now()
//   - "Heute in Tenant-TZ"           → ctx.tz.today(ctx.tz.tenant)
//   - "Wall-Clock parsen"            → ctx.tz.parse("2026-04-03T10:00", "Europe/Lisbon")
//   - "ZonedDateTime → JSON-Pair"    → ctx.tz.toLocatedJson(zdt)
//   - "JSON-Pair → ZonedDateTime"    → ctx.tz.fromLocatedJson({ at, tz })
//
// Feature-Code soll NICHT mehr `new Date()` aufrufen — die Lint-Regel dafür
// kommt in einer späteren Iteration, wenn alle existing usages migriert sind.
//
// `tenant` + `user` sind die TZ-Defaults für den aktuellen Request. Aktueller
// Stand: beide default auf "UTC" — sobald tenant.timezone +
// user.timezone Felder existieren, lese ich sie aus dem Request-Context.
//
// Die reinen Type-Contracts (TzContext, TzContextOptions, LocatedTimestampJson)
// leben in @cosmicdrift/kumiko-types/tz-context — hier nur die Factories.

import type { TzContext, TzContextOptions } from "@cosmicdrift/kumiko-types/tz-context";
import { ensureTemporalPolyfill, getTemporal } from "./polyfill";

export type {
  LocatedTimestampJson,
  TzContext,
  TzContextOptions,
} from "@cosmicdrift/kumiko-types/tz-context";

/**
 * Factory: erzeugt einen TzContext für den aktuellen Request.
 * Erwartet dass ensureTemporalPolyfill() bereits gelaufen ist (passiert beim
 * Framework-Boot). Wenn nicht, wirft getTemporal() — kein silent failure.
 */
export function createTzContext(options: TzContextOptions = {}): TzContext {
  const T = getTemporal();
  const tenant = options.tenant ?? "UTC";
  const user = options.user ?? tenant;
  const geoTz = options.geoTz;

  return {
    tenant,
    user,
    now: () => T.Now.instant(), // @wrapper-known semantic-alias
    nowIn: (tz: string) => T.Now.zonedDateTimeISO(tz), // @wrapper-known semantic-alias
    today: (tz: string) => T.Now.plainDateISO(tz), // @wrapper-known semantic-alias
    todayRange: (tz: string) => {
      const today = T.Now.plainDateISO(tz);
      const startZdt = today.toZonedDateTime({ timeZone: tz });
      const endZdt = today.add({ days: 1 }).toZonedDateTime({ timeZone: tz });
      return { start: startZdt.toInstant(), end: endZdt.toInstant() };
    },
    parse: (wallClock: string, tz: string) => T.PlainDateTime.from(wallClock).toZonedDateTime(tz),
    toInstant: (zdt) => zdt.toInstant(),
    toLocatedJson: (zdt) => ({
      // Wall-Clock OHNE Offset (kein "Z", kein "+01:00") plus IANA-Name.
      // .toPlainDateTime().toString() liefert "YYYY-MM-DDTHH:MM:SS[.fff]"
      // ohne Offset — exakt unser Vertrag.
      at: zdt.toPlainDateTime().toString(),
      tz: zdt.timeZoneId,
    }),
    fromLocatedJson: (obj) => T.PlainDateTime.from(obj.at).toZonedDateTime(obj.tz),
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

/**
 * Convenience: stellt sicher dass der Polyfill geladen ist UND erzeugt
 * den TzContext in einem await. Bevorzugt verwenden in Boot-Code.
 */
export async function createTzContextAsync(options?: TzContextOptions): Promise<TzContext> {
  await ensureTemporalPolyfill();
  return createTzContext(options);
}
