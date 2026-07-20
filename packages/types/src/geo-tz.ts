// GeoTzProvider — optional adapter for geo-position → IANA zone. The framework
// defines ONLY the interface + injection seam (ctx.tz.fromCoordinates /
// fromAddress); a concrete implementation ships in a separate package
// (e.g. a geo-tz-based offline package). v1 default: no provider — the
// fromCoordinates/fromAddress methods throw clearly instead of silently guessing.
//
// `fromCoordinates` is the PRIMARY method: offline geo-tz libs resolve
// lat/lng → zone (exact, offline, free) — they don't know postal addresses.
// `fromAddress` is optional, for providers backed by a geocoding API (address →
// zone, online). This split keeps the interface compatible with both
// provider classes instead of forcing an address shape the offline case
// can't serve at all.

export type GeoCoordinates = {
  readonly latitude: number;
  readonly longitude: number;
};

export type GeoAddress = {
  readonly street?: string;
  readonly city?: string;
  readonly region?: string;
  readonly postalCode?: string;
  readonly country?: string;
};

export type GeoTzProvider = {
  /** Geo-coordinates → IANA zone (offline lat/lng → tz). */
  readonly fromCoordinates: (coords: GeoCoordinates) => string | Promise<string>;
  /** Optional: postal address → IANA zone (geocoding API provider). */
  readonly fromAddress?: (address: GeoAddress) => string | Promise<string>;
};
