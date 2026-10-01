---
status: reference
verified: 2026-10-01
evidence: "framework#2711 (SelectFieldDef.display / InputProps display); framework#2494 (display-Projection in build-app-schema); framework#2606; framework#3381 (Heuristik nach Optionszahl und Labellänge, radioVariant card, optionTones); optionsQuery: packages/renderer-web/src/__tests__/select-options-query.test.tsx, packages/framework/src/engine/__tests__/boot-validator-select-options-query.test.ts"
---

# Select-Feld: Segmente, Radio-Liste oder Dropdown

Ein `select`-Feld rendert im Web-Renderer als Segment-Steuerung, als vertikale
Radio-Liste (WAI-ARIA `radiogroup`) oder als Combobox-Dropdown. Ohne Angabe
entscheidet eine Heuristik über die Optionszahl und die Länge der
übersetzten Labels:

| Optionen | Labels | Darstellung |
|---|---|---|
| bis 3 | alle höchstens 16 Zeichen | Segmente |
| bis 3 | mindestens eines länger | Radio-Liste |
| 4 oder mehr | egal | Dropdown |

Die Labels sind übersetzt, die Darstellung kann also mit der UI-Sprache
wechseln. Wer sie festlegen will, nutzt `display` (framework#2606, #3381).

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
| `"radio"` | immer die Segmente, auch bei mehr als 3 Optionen |
| `"dropdown"` | immer die Combobox — auch bei drei Optionen |
| weggelassen | die Heuristik oben entscheidet |

Eine leere `options`-Liste rendert immer das Dropdown.

## Was der Author übernimmt

`display: "radio"` schaltet die Heuristik ab, nicht nur ihre Schwelle. Eine
Segment-Gruppe mit acht langen Labels bricht in mehrere Zeilen um; das ist die
angeforderte Darstellung und der Renderer überstimmt sie nicht. Wer das nicht
will, lässt `display` weg.

## Radio-Karten und Status-Töne

- `radioVariant: "card"` am Primitive (`Input kind="select"`) rendert die Radio-Liste als Karten. Jede Option kann eine `description` mit einer Erklärzeile tragen.
- `optionTones` am Feld (`{ [wert]: "ok" | "warn" | "bad" | "neutral" }`) färbt den Wert in Listen und Detail-Bändern als Status-Badge.

## Optionen aus einer Query

Ein `select`-Feld kann seine Optionen zur Laufzeit aus einer Query laden. Das
geht an Config-Keys (und damit im Settings-Hub) sowie an Feldern von
`configEdit`- und `actionForm`-Screens:

```ts
model: createTenantConfig("select", {
  mask: { title: "ai-provider-anthropic.model" },
  optionsQuery: "ai-foundation:query:model-options",
  optionsQueryPayload: { modality: "text", provider: "anthropic" },
}),
```

- Die Query liefert `{ rows: { value: string; label: string }[] }`. Die Labels erscheinen unübersetzt so, wie die Query sie liefert.
- `options` bleibt leer. Statische `options` und `optionsQuery` am selben Feld sind ein Boot-Fehler, ebenso `optionsQueryPayload` ohne `optionsQuery` und eine leere QN.
- `optionsQueryPayload` ist statisch und wird bei jedem Aufruf mitgeschickt. Eine Abhängigkeit von anderen Formularfeldern gibt es nicht. Hängen die Optionen vom gewählten Provider ab, trennt man das über die vorhandenen Plugin-Panels mit `visibleWhen`, jeder Provider mit eigenem Key und eigenem Payload.
- Ohne `display` rendert das Feld ein Dropdown, damit die Darstellung nach dem Laden nicht umspringt. Ein gespeicherter Wert, der nicht im Ergebnis steht, bleibt mit seinem Rohwert sichtbar.
- Der Boot prüft, dass die QN einen registrierten Query-Handler trifft, bei Config-Keys und bei Screen-Feldern.
- Der Server prüft den geschriebenen Wert nicht gegen das Query-Ergebnis. Das Feature, das den Wert verwendet, validiert ihn dort selbst.
- Auf Entity-Feldern (auch eingebetteten) ist `optionsQuery` ein Boot-Fehler, weil der gespeicherte Wert sonst ungeprüft bliebe. Dort bleibt es bei statischen `options` oder einem `reference`-Feld.
- Config-Keys mit `optionsQuery` dürfen nicht `allowPerRequest` sein, ein Per-Request-Wert ginge ungeprüft durch.

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
