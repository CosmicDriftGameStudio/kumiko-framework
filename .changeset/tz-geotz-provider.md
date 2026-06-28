---
"@cosmicdrift/kumiko-framework": minor
---

Timezones (#268, item 13): `GeoTzProvider` interface + injection seam.

`ctx.tz` gains `fromCoordinates(coords)` and `fromAddress(address)` — both delegate to an optional `GeoTzProvider` injected via the app context (`buildServer({ context: { geoTzProvider } })` or `runProdApp`/`runDevApp({ extraContext: { geoTzProvider } })`). With no provider configured they throw a clear, actionable error (v1 ships no auto-lookup).

`fromCoordinates` is the primary method — offline geo-tz libraries resolve lat/lng → zone (they don't take postal addresses); `fromAddress` is optional, for geocoding-API providers. New exports from `@cosmicdrift/kumiko-framework/time`: `GeoTzProvider`, `GeoCoordinates`, `GeoAddress`.

Interface + seam only — a concrete provider (e.g. an offline geo-tz package) ships separately.
