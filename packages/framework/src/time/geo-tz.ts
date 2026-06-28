// GeoTzProvider — optionaler Adapter Geo-Position → IANA-Zone. Das Framework
// definiert NUR das Interface + den Injection-Seam (ctx.tz.fromCoordinates /
// fromAddress); eine konkrete Implementation kommt aus einem separaten Paket
// (z.B. ein geo-tz-basiertes Offline-Paket). v1-Default: kein Provider — die
// fromCoordinates/fromAddress-Methoden werfen klar statt still falsch zu raten.
//
// `fromCoordinates` ist die PRIMÄRE Methode: Offline-geo-tz-Libs lösen
// lat/lng → Zone (genau, offline, kostenlos) — sie kennen keine Postadressen.
// `fromAddress` ist optional, für Provider die eine Geocoding-API (Adresse →
// Zone, online) anbinden. Diese Trennung hält das Interface kompatibel mit
// beiden Provider-Klassen, statt eine Adress-Form zu erzwingen die der
// Offline-Fall gar nicht bedienen kann.

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
  /** Geo-Koordinaten → IANA-Zone (offline lat/lng → tz). */
  readonly fromCoordinates: (coords: GeoCoordinates) => string | Promise<string>;
  /** Optional: Postadresse → IANA-Zone (Geocoding-API-Provider). */
  readonly fromAddress?: (address: GeoAddress) => string | Promise<string>;
};
