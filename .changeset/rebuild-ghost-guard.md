---
"@cosmicdrift/kumiko-framework": minor
---

Rebuild-Cutover-Guard (#722): `rebuildProjection` bricht jetzt vor dem Shadow-Swap ab, wenn eine implizite Projection eine Live-Row ohne jegliches Event in ihren Source-Streams hält — der #498-Ghost, direkt eingefügt ohne `.created`-Event. Statt die Row beim Swap still zu wipen rollt der Rebuild zurück (Live-Tabelle unangetastet) und nennt die Ghost-IDs plus den Fix (`r.unmanagedTable` oder die fehlenden Events emittieren). Der Guard prüft nur Event-Existenz; legitime live≠replay-Divergenzen (blind-index-Recompute nach Key-Erase, `sensitive`-Strip, archivierte Streams, #494-Backfill) bleiben unangetastet. Column-level Drift-Detection ist offen in #916.
