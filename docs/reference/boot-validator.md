---
status: reference
verified: 2026-08-30
evidence: "kumiko-framework#2509 (screen field refs vs query handler outputSchema); engine/boot-validator/*"
---

# Boot-Validator: Screen-Field-Refs + Query-OutputSchema

Der Boot-Validator (`packages/framework/src/engine/boot-validator/`) prüft beim
Boot die gesamte App-Deklaration und läuft **laut**, statt zur Laufzeit still zu
versagen. Ein Fehler fällt beim Boot-Schema-Check durch und stoppt den Start mit
einer präzisen Meldung — nicht als NPE/leere Zelle im fertigen Screen.

## Was validiert wird

Jede Screen-Referenz auf eine Query-Query-Spalte/Feld wird gegen das
`outputSchema` des passenden Query-Handlers abgeglichen
(`validateQueryOutputColumns`). Deckt der Handler das referenzierte Feld nicht
ab, schlägt der Boot fehl.

Betroffen je Screen-Typ:

- **`projectionList`** — jede List-Column (`rows[].<field>`) muss im Row-Shape des
  query-Handlers existieren (`checkProjectionListOutputColumns`).
- **`projectionDetail`** — Header-Felder (`title` / `subtitle` / `status`) und die
  Detail-Output-Felder müssen in der Handler-OutputSchema existieren
  (`checkProjectionDetailOutputFields`).
- **`dashboard`** — jedes Stat-Panel-Feld muss im outputSchema existieren
  (`checkDashboardStatPanelFields`).
- **`edit`-Layouts** — formular-Feld-Refs gegen den passenden handler
  (`checkEditLayoutOutputColumns`).
- Alle Screen-Typen global (`checkScreenOutputColumns`).

## Paged Handler: Envelope-Shape

`definePagedQueryHandler`-Handler müssen ihr outputSchema als **Paged-Envelope**
`{ rows: [...], nextCursor, total? }` beschreiben — nicht das nackte
Row-Schema. Fehlt das `rows`-Feld, meldet der Validator:

> Query handler "…" is a paged handler (definePagedQueryHandler) but its
> outputSchema does not describe the paged envelope { rows, nextCursor, total? }
> — it has no "rows" field. Did you pass the row schema instead of wrapping it
> in the envelope?

Das ist der typische Fehler: man übergibt das Row-Schema statt der Envelope.
(`checkPagedHandlerOutputSchemaShape`)

## Kernregel für Feature-Autoren

- Query-Handler immer mit vollständigem `outputSchema` deklarieren; Screen-Refs
  nur auf Felder, die darin vorkommen.
- Paged-Listen: outputSchema **immer** als Envelope wrappen.
- Boot-Test (`npm`/`bun` boot-test des Scaffolds) fängt Verstöße sofort — kein
  Commit ohne grünen Boot-Test.

Siehe auch: `docs/reference/app-feature-structure.md` (Screen-/Feature-Struktur),
`docs/guides/handler-context-and-embedded-fields.md` (Query-Handler-Kontext).
