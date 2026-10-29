---
status: reference
verified: 2026-10-29
evidence: "samples/recipes/inspection-checklist/src/__tests__/feature.integration.test.ts, samples/recipes/inspection-checklist/src/__tests__/photos.integration.test.ts, packages/framework/src/engine/boot-validator/__tests__/field-conditions.test.ts, packages/framework/src/engine/__tests__/embedded-derived.test.ts, packages/framework/src/files/__tests__/file-field-slots.test.ts"
---

# Embedded-Liste als Checkliste

Eine Prüfliste ist ein `createEmbeddedListField` mit einer Zeile pro Prüfpunkt. Es gibt dafür
keinen eigenen Feldtyp. Das Rezept `samples/recipes/inspection-checklist` zeigt den ganzen Ablauf:
Plan, Protokoll aus dem Plan anlegen, Grenzwertvergleich, Befund und Fotos bei „nicht ok“.

## Feldzustand: `visibleWhen` und `requiredWhen`

Beide Optionen nehmen eine `FieldCondition` ohne `boolean` (`eq`, `ne`, `in`, `notIn`). Es gibt
sie an jedem Entity-Feld und an jedem Sub-Feld einer Embedded-Liste.

| Ebene | `field` der Bedingung | Pfad im Fehler |
|---|---|---|
| Entity-Feld | anderes Feld derselben Entity | `condition` |
| Sub-Feld | anderes Sub-Feld derselben Zeile | `checkpoints.0.finding` |

- Pflicht gilt nur, solange das Feld sichtbar ist: `required = sichtbar und (required oder requiredWhen)`.
- Der Server prüft `requiredWhen` im Executor bei create und update, nicht nur das Formular.
  Fehler kommen als `validation_error` mit `details.fields[{ path, code: "required" }]`.
- Beim update wird ein Feld nur geprüft, wenn es selbst oder eines seiner Bedingungsfelder sich
  geändert hat; eine Embedded-Liste nur, wenn sich ihr Wert geändert hat. Alte Datensätze bleiben
  so bearbeitbar.
- Ausgeblendete Werte bleiben gespeichert, sie werden nie still verworfen.
- Eine Screen-Angabe `visible`/`required` im `entityEdit` überschreibt den Entity-Default.

Boot prüft: das Bedingungsfeld existiert, ist nicht das Feld selbst, hat einen skalaren Typ, und
Vergleichswerte eines Select-Felds sind Optionen. `required: true` zusammen mit `requiredWhen`
oder `visibleWhen` ist ein Boot-Fehler (dafür gibt es `requiredWhen`).

## Grenzwertvergleich: `op: "inRange"`

```ts illustration
derived: {
  result: {
    op: "inRange",
    from: ["measured", "min", "max"],
    inside: "ok",
    outside: "not_ok",
    when: { field: "kind", eq: "measurement" },
  },
},
```

- `from` ist `[Wert, Minimum, Maximum]`, Grenzen inklusive. Fehlt eine Grenze, ist diese Seite
  offen; fehlen beide oder der Wert, wird die Zelle geleert.
- Ziel ist ein Select-Sub-Feld, das `inside` und `outside` als Optionen hat. Quellen müssen
  numerisch sein (number, decimal, money).
- `when` gibt es an jeder abgeleiteten Zelle. Gilt die Bedingung für eine Zeile nicht, ist die
  Zelle dort ein normales Eingabefeld und behält den gesendeten Wert. Ohne `when` wird immer
  abgeleitet.
- Server und Client rechnen mit derselben Funktion `withDerivedCells`. Der Server überschreibt
  einen vom Client gesendeten Wert, und `requiredWhen` sieht das abgeleitete Ergebnis.
- Numerische Operationen (`multiply`, `sum`, `subtract`, `percent`) brauchen jetzt ein
  numerisches Ziel-Sub-Feld; Boot lehnt andere Ziele ab.

## Fotos und Dateien pro Zeile

Sub-Felder vom Typ `images` (mit `capture`) und `files` mit `maxSize`, `accept`, `maxCount`. Der
Wert ist ein Array von FileRef-IDs.

- Upload: `POST /files` mit `entityType`, `fieldName` = das Embedded-Feld und zusätzlich
  `subField` = das Datei-Sub-Feld. `accept`/`maxSize` kommen vom Sub-Feld; `access.write` von
  Feld und Sub-Feld wird geprüft.
- `file_refs.fieldName` bleibt der Name des Embedded-Felds. Bindung beim Speichern,
  Mandanten-Check, Aufräumen entfernter Fotos, Lesezugriff über das Recht am Datensatz,
  DSGVO-Löschung (PII-Angabe des Embedded-Felds) und Retention laufen dadurch wie bei einem
  `images`-Feld auf oberster Ebene.
- Keine `variants` und kein `anonymousUpload` an Sub-Feldern.

## Darstellung

- Unter 640 px Breite rendert die Liste Karten statt einer Tabelle, mit Bedienelementen ab 44 px
  Höhe. Eine führende schreibgeschützte Textspalte (`readOnlyCells`) wird zum Kartentitel.
- `display: "radio"` an einem Select-Sub-Feld rendert Segmente; `optionTones` färbt das gewählte
  Segment (`ok`, `warn`, `bad`). Eine abgeleitete Select-Zelle erscheint als farbiges Badge.
- Pro Zeile ausgeblendete Zellen lassen in der Tabelle eine leere Zelle, in der Karte fehlen sie.
- Eine Checkliste mit vielen Spalten braucht am Edit-Screen `layout.width: "full"`. In der
  Standardbreite rutschen Ergebnis, Befund und Fotos sonst hinter den horizontalen Scroll.
