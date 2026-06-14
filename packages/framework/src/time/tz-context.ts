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

import { ensureTemporalPolyfill, getTemporal } from "./polyfill";

// JSON-Form für Wall-Clock+TZ — siehe locatedTimestamp(name) Helper in
// engine/factories.ts. Zwei Felder, idiotensicher.
export type LocatedTimestampJson = {
  /** Wall-Clock-ISO ohne Offset, z.B. "2026-04-03T10:00:00" */
  readonly at: string;
  /** IANA-Zone, z.B. "Europe/Lisbon" */
  readonly tz: string;
};

export type TzContext = {
  /** Default-TZ des Mandanten (aus tenant.timezone, default "UTC"). */
  readonly tenant: string;
  /** Anzeige-TZ des aktuellen Users (User-Profil-Override, fallback Tenant). */
  readonly user: string;

  /** Aktueller Moment als UTC-Instant. */
  now(): Temporal.Instant;
  /** Aktueller Moment als ZonedDateTime in der gewünschten Zone. */
  nowIn(tz: string): Temporal.ZonedDateTime;

  /** Heutiges Kalender-Datum in der gewünschten Zone. */
  today(tz: string): Temporal.PlainDate;
  /** Tagesgrenzen (00:00 bis 24:00 nächster Tag) als UTC-Instants — für DB-Range-Queries. */
  todayRange(tz: string): { readonly start: Temporal.Instant; readonly end: Temporal.Instant };

  /** Wall-Clock-String + IANA-Zone → ZonedDateTime. */
  parse(wallClock: string, tz: string): Temporal.ZonedDateTime;

  /** ZonedDateTime → UTC-Instant. */
  toInstant(zdt: Temporal.ZonedDateTime): Temporal.Instant;

  /** ZonedDateTime → JSON-Pair { at, tz } (API-Boundary). */
  toLocatedJson(zdt: Temporal.ZonedDateTime): LocatedTimestampJson;

  /** JSON-Pair { at, tz } → ZonedDateTime (Wall-Clock + IANA). */
  fromLocatedJson(obj: LocatedTimestampJson): Temporal.ZonedDateTime;
};

export type TzContextOptions = {
  /** Tenant-Default-TZ. Default "UTC" wenn nicht gesetzt. */
  readonly tenant?: string;
  /** User-Override. Default = tenant. */
  readonly user?: string;
};

/**
 * Factory: erzeugt einen TzContext für den aktuellen Request.
 * Erwartet dass ensureTemporalPolyfill() bereits gelaufen ist (passiert beim
 * Framework-Boot). Wenn nicht, wirft getTemporal() — kein silent failure.
 */
export function createTzContext(options: TzContextOptions = {}): TzContext {
  const T = getTemporal();
  const tenant = options.tenant ?? "UTC";
  const user = options.user ?? tenant;

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
