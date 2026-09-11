---
status: reference
verified: 2026-09-11
evidence: "framework#2711 (SelectFieldDef.display / InputProps display); framework#2494 (display-Projection in build-app-schema); framework#2606 (Heuristik ohne Labellänge)"
---

# Select-Feld: Radio-Gruppe oder Dropdown anfordern

Ein `select`-Feld rendert im Web-Renderer entweder als sichtbare Radio-Gruppe
(WAI-ARIA `radiogroup`, eine Auswahl = ein Klick) oder als Combobox-Dropdown.
Ohne Angabe entscheidet eine Heuristik: höchstens 4 Optionen ergeben die
Radio-Gruppe, mehr ergeben das Dropdown. Die Labellänge zählt bewusst nicht —
Labels sind übersetzt, eine Längenschwelle hätte den Widget-Typ von der
aktiven UI-Sprache abhängig gemacht (framework#2606).

Die Heuristik ist ein Default, keine Vorgabe. Wer die Darstellung braucht,
fordert sie mit `display` an:

```ts
createSelectField({
  options: ["background-jobs", "inbound-mail", "search-index"],
  display: "radio",
});
```

| `display` | Ergebnis |
|---|---|
| `"radio"` | immer die Radio-Gruppe — auch bei mehr als 4 Optionen |
| `"dropdown"` | immer die Combobox — auch bei drei Optionen |
| weggelassen | die Heuristik entscheidet (unverändertes Verhalten) |

Eine leere `options`-Liste rendert auch mit `display: "radio"` das Dropdown —
eine Radio-Gruppe ohne Optionen wäre eine leere Gruppe ohne Bedienbarkeit.

## Was der Author übernimmt

`display: "radio"` schaltet die Heuristik ab, nicht nur ihre Schwelle. Eine
Gruppe mit acht langen Labels bricht in mehrere Zeilen um; das ist die
angeforderte Darstellung und der Renderer überstimmt sie nicht. Wer das nicht
will, lässt `display` weg.

## Imperative Nutzung

Dieselbe Anforderung gibt es am Primitive, für Screens die `Field` + `Input`
direkt mounten statt über eine EntityDefinition zu laufen:

```tsx
<Input kind="select" id={id} name={name} value={value} onChange={onChange}
       options={options} display="radio" />
```

`display` ist optional und eine Bitte, kein Vertrag: eigene
Primitives-Implementierungen dürfen es ignorieren und bei ihrer Darstellung
bleiben.

## Projection

`display` überlebt die Projection in `build-app-schema` (gemeinsamer
Durchlass mit `MultiSelectFieldDef.display`, fw#2494) — der Renderer sieht
den Hinweis auch im Client-Schema.
