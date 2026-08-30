---
status: reference
verified: 2026-08-30
evidence: "framework#2479 (checkbox display columns/maxRows); framework#2494 (display/columns/maxRows in build-app-schema); framework#2511 (jsonb-containment filter); framework#2499 (multiSelect list columns via optionLabels)"
---

# MultiSelect-Feld: Checkbox-Sheet + List-Projection

Das `multiSelect`-Feld (jsonb, `options`-Liste, immer `NOT NULL`) wurde für
listen-/sheet-fähige Darstellung erweitert. Deklaration über
`createMultiSelectField({ options, display, columns, maxRows })`.

## Validierung (Boot-Validator)

`entity-handler.ts` prüft die Feld-Optionen beim Boot:

- `display: "checkboxes"` ist die Voraussetzung für `columns`/`maxRows`.
  `maxRows` **ohne** `display: "checkboxes"` wird abgelehnt.
- `maxRows` muss eine positive Ganzzahl (≥ 1) sein; nicht-Integer oder < 1
  schlägt fehl.
- `options` darf nicht leer sein.

## Sheet-Projection (fw#2494)

`display` / `columns` / `maxRows` **überleben** die Projection in
`build-app-schema` — sie stehen dem Renderer/Client-Schema auch nach dem
Build zur Verfügung, nicht nur im Create-/Edit-Formular. Grundlage dafür sind
die renderer-seitigen Property-Weiterleitungen (fw#2507).

## List-Column (optionLabels, fw#2499)

In `projectionList`-Screens rendert die Renderer-Column-Spalte MultiSelect-
Werte über `optionLabels` (Mensch-lesbare Labels statt nackter Option-Werte);
`columns`/`maxRows` steuern das Checkbox/Raster-Layout, wenn die Spalte als
Checkbox-Sheet dargestellt wird.

## Filter

MultiSelect-Filter nutzen **jsonb-Containment** (`@>`) statt skalarer
Gleichheit (fw#2511) — ein filter passt auf Datensätze, deren Tag-Array den
angefragten Wert enthält. `multiSelect` ist weiterhin immer `NOT NULL` mit
Default `{}` (Symmetrie zu embedded).
