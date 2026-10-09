---
status: reference
verified: 2026-10-09
evidence: "framework#2711 (SelectFieldDef.display / InputProps display); framework#2494 (display-Projection in build-app-schema); framework#2606; framework#3381 (Heuristik nach Optionszahl und Labellänge, radioVariant card, optionTones); optionsQuery: packages/renderer-web/src/__tests__/select-options-query.test.tsx, packages/framework/src/engine/__tests__/boot-validator-select-options-query.test.ts; description/group: packages/renderer-web/src/__tests__/select-options-description-group.test.tsx; conditionalOptions: packages/framework/src/__tests__/select-conditional-options.integration.test.ts, packages/framework/src/engine/__tests__/select-conditional-options.test.ts"
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

- `radioVariant: "card"` am Primitive (`Input kind="select"`) rendert die Radio-Liste als Karten. Eine `description` erscheint in beiden Varianten als Erklärzeile unter dem Label.
- `optionTones` am Feld (`{ [wert]: "ok" | "warn" | "bad" | "neutral" }`) färbt den Wert in Listen und Detail-Bändern als Status-Badge.

## Optionen aus einer Query

Ein `select`-Feld kann seine Optionen zur Laufzeit aus einer Query laden. Das
geht an Config-Keys (und damit im Settings-Hub) sowie an Feldern von
`configEdit`- und `actionForm`-Screens sowie in den `fieldDefs` einer `writeForm`-Section:

```ts
model: createTenantConfig("select", {
  mask: { title: "ai-provider-anthropic.model" },
  optionsQuery: "ai-foundation:query:model-options",
  optionsQueryPayload: { modality: "text", provider: "anthropic" },
}),
```

- Die Query liefert `{ rows: { value: string; label: string; description?: string; group?: string }[] }`. Labels und Beschreibungen erscheinen unübersetzt so, wie die Query sie liefert.
- `options` bleibt leer. Statische `options` und `optionsQuery` am selben Feld sind ein Boot-Fehler, ebenso `optionsQueryPayload` ohne `optionsQuery` und eine leere QN.
- `optionsQueryPayload` wird bei jedem Aufruf mitgeschickt. Ein Wert ist entweder fest (`string`, `number`, `boolean`) oder `{ field: "<name>" }`, dann nimmt der Renderer den aktuellen Wert dieses Feldes derselben Form (siehe „Abhängige Optionen“).
- Ohne `display` rendert das Feld ein Dropdown, damit die Darstellung nach dem Laden nicht umspringt. Ein gespeicherter Wert, der nicht im Ergebnis steht, bleibt mit seinem Rohwert sichtbar.
- Der Boot prüft, dass die QN einen registrierten Query-Handler trifft, bei Config-Keys und bei Screen-Feldern.
- Der Server prüft den geschriebenen Wert nicht gegen das Query-Ergebnis. Das Feature, das den Wert verwendet, validiert ihn dort selbst.
- Auf Entity-Feldern (auch eingebetteten) ist `optionsQuery` ein Boot-Fehler, weil der gespeicherte Wert sonst ungeprüft bliebe. Dort bleibt es bei statischen `options` oder einem `reference`-Feld.
- Config-Keys mit `optionsQuery` dürfen nicht `allowPerRequest` sein, ein Per-Request-Wert ginge ungeprüft durch.

### Beschreibung und Gruppen

Eine Zeile mit `description` zeigt unter dem Label eine gedämpfte zweite Zeile,
in der Combobox und in der Radio-Liste. Die Combobox-Suche trifft auch die
Beschreibung. Zeilen mit `group` stehen unter einer Gruppenüberschrift. Zeilen
ohne Gruppe kommen zuerst in ihrer Reihenfolge, danach die Gruppen in der
Reihenfolge, in der sie zum ersten Mal auftreten.

Tragen Optionen `description` oder `group`, rendert das Feld nie Segmente:
`display: "radio"` und die Heuristik ergeben dann die vertikale Radio-Liste.

```ts
// Query-Zeile für einen KI-Schritt
{ value: "reply-draft", label: "Antwort entwerfen", description: "Genutzt in: Tickets › Ticket bearbeiten" }
```

### Abhängige Optionen

Ein Select kann seine Optionen für den Wert eines anderen Feldes laden, zum
Beispiel die Modelle der gewählten Verbindung:

```ts
textModel: createTenantConfig("select", {
  optionsQuery: "ai-foundation:query:model-options",
  optionsQueryPayload: { modality: "text", connectionId: { field: "textConnection" } },
}),
```

- An Screen-Feldern (`configEdit`, `actionForm`, `writeForm`-`fieldDefs`) nennt `field` ein anderes Feld derselben Form. An Config-Keys nennt es einen anderen Key desselben Features, der auf derselben Settings-Maske liegt. Unbekannte Namen, der eigene Name und ein Key auf einer anderen Maske sind Boot-Fehler.
- Ist das Bezugsfeld leer, fehlt der Payload-Key ganz.
- Ändert sich der Wert des Bezugsfeldes, lädt das Select neu. Steht der gewählte Wert nicht in den neuen Zeilen, wird er geleert (`""`). Beim ersten Laden bleibt ein fehlender gespeicherter Wert sichtbar.

### Herkunftszeile im Settings-Hub

Die Herkunftszeile unter einem Feld einer `configEdit`-Maske („Standard ist …“)
und die Zeilen unter „Alle Ebenen anzeigen“ zeigen bei Select-Feldern das Label
der Option statt des Rohwerts, bei `optionsQuery` also den Namen statt einer ID.

## Optionen abhängig von einem anderen Feld

Ein Entity-Select kann einzelne seiner statischen Optionen nur anbieten, wenn
ein anderes Feld derselben Zeile einen bestimmten Wert hat. Beispiel: lange
Intervalle gibt es nur für Monitore vom Typ `heartbeat`.

```ts
intervalSeconds: createSelectField({
  options: ["60", "300", "3600", "86400"],
  default: "300",
  conditionalOptions: [
    { options: ["3600", "86400"], when: { field: "kind", eq: "heartbeat" } },
  ],
}),
```

- `when` ist eine `FieldCondition` (`eq`, `ne`, `in`, `notIn`), dieselbe Form wie
  `visible`/`required` an Layout-Feldern. Optionen ohne Regel sind immer verfügbar.
- Die Maske zeigt nur die verfügbaren Optionen und filtert neu, sobald sich das
  Bezugsfeld ändert. Ein gewählter Wert, der dadurch ungültig wird, bleibt
  sichtbar und wird als Feldfehler markiert („Für die aktuelle Auswahl nicht
  verfügbar.“). Er wird nicht still geleert.
- Der Server prüft dieselbe Regel bei jedem Create und Update gegen die Zeile
  nach dem Write (gespeicherte Zeile plus Änderungen). Ein Verstoß ergibt 422
  mit `reason: "select_option_not_available"` und `details.field`, `value`,
  `allowed` sowie `details.fields` für die Inline-Anzeige im Formular.
- Ein Update prüft nur, wenn sich das Select-Feld oder ein Bezugsfeld ändert.
  Alte Zeilen mit einem inzwischen ungültigen Wert bleiben für andere Felder
  editierbar.
- Ohne `display` rendert das Feld ein Dropdown, damit die Darstellung nicht
  umspringt, wenn sich das Bezugsfeld ändert und die Optionszahl schwankt. Ein
  ausdrückliches `display` bleibt bestehen.
- Nur an Entity-Feldern. An Screen-Formfeldern (`configEdit`, `actionForm`,
  Write-Form) und Config-Keys gibt es keine Serverprüfung, dort ist
  `conditionalOptions` ein Boot-Fehler.
- Boot-Fehler: Option nicht in `options`, Option in zwei Regeln, leere Regel,
  unbekanntes oder eigenes Bezugsfeld, `default` in einer Regel, Kombination
  mit `optionsQuery`.

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
