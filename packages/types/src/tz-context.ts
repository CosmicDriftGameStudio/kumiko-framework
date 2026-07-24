// TzContext — the type contract for ctx.tz (pure types; the factory lives in
// @cosmicdrift/kumiko-framework, time/tz-context.ts).
//
// `Temporal` here is the ambient global from TypeScript's lib
// (lib.esnext.temporal) — at runtime the framework installs the polyfill.

import type { GeoAddress, GeoCoordinates, GeoTzProvider } from "./geo-tz";

// JSON form for wall-clock + TZ — see createLocatedTimestampField() in
// @cosmicdrift/kumiko-framework, engine/factories.ts. Two fields, foolproof.
export type LocatedTimestampJson = {
  /** Wall-clock ISO without offset, e.g. "2026-04-03T10:00:00" */
  readonly at: string;
  /** IANA zone, e.g. "Europe/Lisbon" */
  readonly tz: string;
};

export type TzContext = {
  /** Default TZ of the tenant (from tenant.timezone, default "UTC"). */
  readonly tenant: string;
  /** Display TZ of the current user (profile override, fallback tenant). */
  readonly user: string;

  /** Current moment as UTC instant. */
  now(): Temporal.Instant;
  /** Current moment as ZonedDateTime in the requested zone. */
  nowIn(tz: string): Temporal.ZonedDateTime;

  /** Today's calendar date in the requested zone. */
  today(tz: string): Temporal.PlainDate;
  /** Day boundaries (00:00 to 24:00 next day) as UTC instants — for DB range queries. */
  todayRange(tz: string): { readonly start: Temporal.Instant; readonly end: Temporal.Instant };

  /** Wall-clock string + IANA zone → ZonedDateTime. */
  parse(wallClock: string, tz: string): Temporal.ZonedDateTime;

  /** ZonedDateTime → UTC instant. */
  toInstant(zdt: Temporal.ZonedDateTime): Temporal.Instant;

  /** ZonedDateTime → JSON pair { at, tz } (API boundary). */
  toLocatedJson(zdt: Temporal.ZonedDateTime): LocatedTimestampJson;

  /** JSON pair { at, tz } → ZonedDateTime (wall-clock + IANA). */
  fromLocatedJson(obj: LocatedTimestampJson): Temporal.ZonedDateTime;

  /** Geo coordinates → IANA zone via the configured GeoTzProvider.
   *  Throws when no provider is configured (v1 default). */
  fromCoordinates(coords: GeoCoordinates): Promise<string>;
  /** Postal address → IANA zone via GeoTzProvider. Throws when no provider is
   *  configured OR the provider does not support fromAddress (the offline
   *  lat/lng provider does not). */
  fromAddress(address: GeoAddress): Promise<string>;
};

export type TzContextOptions = {
  /** Tenant default TZ. Default "UTC" when unset. */
  readonly tenant?: string;
  /** User override. Default = tenant. */
  readonly user?: string;
  /** Optional geo→zone adapter for ctx.tz.fromCoordinates / fromAddress.
   *  Without a provider those methods throw. */
  readonly geoTz?: GeoTzProvider;
};
