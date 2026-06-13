---
"@cosmicdrift/kumiko-framework": patch
---

`kumiko-schema apply` legt jetzt die Framework-Infra-Tabellen (event-store + pipeline-state: `kumiko_events`, `kumiko_snapshots`, `kumiko_archived_streams`, `kumiko_event_consumers`, `kumiko_projections`) idempotent mit an. Bisher erfasste `generate` nur Entity-read-Tabellen — eine Greenfield-DB (erste App ohne legacy-drizzle-Cutover) hatte daher kein `kumiko_events`, und `runProdApp` brach beim ersten event-store-Zugriff ab. Bestands-DBs sind über den `tableExists`-Gate unberührt (no-op).
