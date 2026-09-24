---
status: reference
verified: 2026-09-24
evidence: "kumiko-framework#2345 (enumOption); #2332 (unit); packages/types/src/screen.ts (FieldFormatRegistry); packages/headless/src/format"
---

# Field-Formats: deklarative Wert-Formatierung (`FormatSpec`)

Felder können Werte client-seitig deklarativ formatieren, ohne den Rohwert
im Store/Schema zu verändern. `FormatSpec` ist ein **JSON-sicherer**
Wert-Formatter (kein Code im Schema) — deklariert auf Screen-Column-/Field-
Ebene und über die `FieldFormatRegistry` registriert
(`packages/types/src/screen.ts`). Registry-Keys: `timestamp`, `date`,
`boolean`, `currency`, `priority`, `number`, `decimal`, `bigInt`, `unit`,
`enumOption` (alle über die `[K in keyof FieldFormatRegistry]`-Struktur
dediziert typisiert, kein offener `string`).

## `unit` (fw#2332)

```
{ format: "unit", unit: "m2", unitDisplay: "short" }   // → "58 m²"
```

- CLDR/`Intl.NumberFormat`-korrekt und locale-abhängig.
- `unitDisplay` steuert `long`/`short`/`narrow`.
- Hinweis: `style:"unit"` mit `unit:"percent"` **multipliziert nicht** mit 100
  (anders als `style:"percent"`) — Prozent als `unit` ist Roh-anteilig.

## `enumOption` (fw#2345)

```
{ format: "enumOption", keyPrefix: "jobstatus" }
```

- Löst einen Enum-Wert client-seitig in ein **übersetztes Label** auf.
- Der i18n-Schlüssel folgt der Konvention
  `<keyPrefix>:<value>` (bzw. die `option:`-Option-Label-Konvention) mit
  **Fallback auf den Rohwert**, wenn nicht übersetzt (gleiche Regel wie
  `buildOptionLabels`).
- Einsatz: `projectionDetail`-Felder und `entityList`/`projectionList`/
  `relatedList`-Column-Werte, die sonst nackte Option-Werte zeigten.

## `number` / `decimal` / `bigInt` grouping (fw#3234)

Tausendertrennzeichen sind standardmäßig an (`Intl.NumberFormat`s
`useGrouping`), locale-abhängig über `spec.locale` bzw. die aktive
App-Locale. `{ format: "number", grouping: false }` schaltet sie ab. Gilt
sowohl im headless `applyFormatSpec`-Pfad (Columns) als auch im read-only
`RenderField`-Pfad (`field.grouping`, ohne eigenen `renderer`) — beide teilen
dieselbe `Intl.NumberFormat`-Semantik, unabhängig voneinander implementiert.

## Anwendung

Formate werden dort gesetzt, wo Feld-Darstellung deklariert wird (Screen-
Columns / Detail-Felder / Tabelle). Der Renderer (`render-field`, Renderer-
`DataTableCell`) wendet das `format`-Spec an; `readOnly`-Pfade nutzen die
aktive App-Locale (LocaleProvider).
