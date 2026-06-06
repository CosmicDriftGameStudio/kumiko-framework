---
"@cosmicdrift/kumiko-bundled-features": minor
---

feat(cap-counter): `enforceStockCap` für Bestands-Caps (max N Entities)

Reine Funktion für Stock-Caps (Bestand: „max 5 Components") neben den metered
Flow-Caps (`enforceCap`/`enforceRollingCap`). Der Caller zählt die Projektion
live (`count(*) WHERE tenant_id`) und übergibt `current` — kein gespeicherter
Counter, kein Increment/Decrement, drift-frei (Delete gibt den Slot sofort
frei). Gibt ein `StockCapResult` zurück statt zu werfen: der Caller entscheidet
den HTTP-Status (ein erreichtes Stock-Limit heißt „Upgrade nötig", nicht 429).
Nutzt die bestehenden `CAP_TOLERANCES` (`hardSlot` = exakte Grenze, kein Buffer).
