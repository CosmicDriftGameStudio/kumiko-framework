---
"@cosmicdrift/kumiko-framework": patch
---

`executor.detail` liefert jetzt die Stream-Version statt der Read-Row-Version. Lifecycle-Writes via `ctx.appendEvent` bumpen den Event-Stream, ohne `row.version` anzufassen — ein entityEdit, das `detail.version` als optimistic-lock-Basis lädt, lief danach in ein garantiertes `version_conflict` (Prod-Repro: `incident:open` appended das Eröffnungs-Update → Stream v2, Row v1 → Incident-Edit konnte nie speichern). Die Policy „stream-version authoritative" galt im Update-Pfad bereits; detail zieht nach.
