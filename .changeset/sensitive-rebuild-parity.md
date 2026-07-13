---
"@cosmicdrift/kumiko-framework": minor
---

Sensitive-Rebuild-Parität (#967): Event-Payloads tragen für `sensitive`-Felder
den Tabellen-Ciphertext statt sie zu strippen — `rebuildProjection` reproduziert
sensitive Spalten + Blind-Index jetzt byte-gleich (Live==Rebuild by-construction,
einzige legitime Divergenz bleibt Crypto-Shredding). BREAKING: `sensitive: true`
ohne `pii`/`userOwned`/`tenantOwned` oder `encrypted: true` ist jetzt ein
Boot-Fehler (zero-legacy, kein Backfill). Das caller-facing Event-Echo in
Write-Responses strippt sensitive Felder weiterhin (#820).
