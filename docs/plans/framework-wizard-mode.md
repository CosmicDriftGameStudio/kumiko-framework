---
status: in-progress
verified: 2026-08-12
issue: kumiko-framework#1883
next: Thema G — Gegenprobe-Nacharbeiten am gemergten form-draft-Code (kumiko-framework#1912 bis #1917), Reihenfolge 1912 → 1913 → 1914, parallel dazu 1915/1916/1917. Themen A-F (1884-1896) sind gebaut.
---

# Wizard im Framework: ein Layout-Modus, kein neuer Screen-Typ

Treiber: Offlot braucht den Fahrzeug-Wizard (VIN, Ficha, Fragen, Fotos), siehe
`offlot-privat/docs/framework-vorarbeit.md` P0. Phronexsis hat denselben Ablauf
schon von Hand gebaut.

Zweiter Treiber ist Solon (einbettbares Entity-Formular für die Übernahme aus
der Inbox). Die beiden überlappen weniger als es klingt: gemeinsam ist genau ein
Baustein, und Solons Schrittfolge ist etwas anderes als ein Formular-Wizard.
Beides ab dem Abschnitt "Solon" weiter unten.

## Die These

Kumiko hat den Wizard fast fertig, nur falsch verteilt. Ein mehrstufiges
Formular ist inhaltlich dasselbe wie ein einstufiges mit mehreren Sektionen,
der Unterschied ist reine Darstellung: Sektionen nacheinander statt
untereinander.

Also kein `type: "wizard"` und kein `<Wizard steps={...}>`-Widget, sondern:

```ts illustration
layout: { mode: "wizard", sections: [...] }
```

Was das kauft:

- `entityEdit`, `actionForm` und `configEdit` bekommen den Wizard in einem Diff,
  ohne neuen Renderer-Stack, ohne neuen Boot-Validator-Zweig, ohne neue
  Screen-Definition.
- Der Ablauf bleibt im deklarativen Screen-System. Phronexsis brauchte dafür
  `// kumiko-lint-ignore app-feature-structure ... no declarative type`
  (`phronexsis/src/features/organization/register/screens.ts:91`). Genau das
  fällt weg, und `kumiko-guard-ui` in den App-Repos ist ohne Ausnahme zufrieden.
- Alles was Formulare heute können (Feldtypen, `FieldConditions` mit
  visible/readonly/required, Server-Field-Errors, Dirty-Tracking) gilt im Wizard
  unverändert, weil es derselbe FormController bleibt.

Das war so vorgesehen: `packages/headless/src/form/types.ts:212` sagt beim
optionalen `submit`, das sei für den Fall "wenn ein multi-step wizard finer
control braucht". Der Erweiterungspunkt steht seit damals leer.

## Typ-Delta

`packages/types/src/screen.ts`, additiv, alles optional, kein Breaking Change:

```ts illustration
export type EditLayout = {
  readonly sections: readonly EditSectionSpec[];
  readonly width?: FormWidth;
  /** Default "single". "wizard" rendert je Sektion einen Schritt mit
   *  Fortschritt und Zurück/Weiter statt alle Sektionen untereinander. */
  readonly mode?: "single" | "wizard";
  /** Nur im Wizard-Modus: Zwischenstand serverseitig sichern, damit der
   *  Nutzer den Ablauf später auf einem anderen Gerät fortsetzt. */
  readonly draft?: boolean;
};
```

Mehr Typ-Fläche braucht der Kern nicht. Kein `steps`-Array (das sind die
Sektionen), kein Progress-Konfig (`ProgressBar` existiert in `renderer-web`),
keine Step-IDs (Index reicht, die Sektion hat schon `title`/`description`).

Zweite und einzige weitere neue API-Fläche ist ein kontrollierter Modus, der
Werte aus dem Formular heraus- und wieder hineinreicht. Er sitzt auf
`RenderEdit` (dazu unten mehr, Solon braucht denselben) und wird an
`ExtensionSectionProps` (`packages/renderer/src/app/extension-sections.tsx:30`)
durchgereicht:

```ts illustration
readonly values?: Readonly<Record<string, unknown>>;
readonly patch?: (next: Readonly<Record<string, unknown>>) => void;
```

Extension-Sektionen (`kind: "extension"`) sind heute schreib- und lesetot, sie
sehen nur `entityName`/`entityId`/`initialValues`. Mit diesen zwei Props trägt
derselbe Mechanismus drei Dinge, für die man sonst je ein deklaratives Konzept
erfinden müsste:

| Bedarf | Lösung über Extension-Sektion |
|---|---|
| Server-Roundtrip mitten drin (VIN-Decode) | Sektion ruft ihre Query, `patch()` schreibt das Ergebnis in die Folgefelder |
| Foto-Schritt | Sektion mountet `UploadZone`, `patch()` setzt die File-Refs |
| Review-Schritt (Zusammenfassung, keine Felder) | Sektion rendert `values` als `DetailList` |

Der Review-Schritt ist kein Randfall: Phronexsis' letzter Schritt ist genau das.

**Anforderung an `patch()`:** was hier ankommt, ist Formularzustand und muss
denselben Persistenzpfad nehmen wie Feldänderungen — in den `form-draft`-Blob,
nicht in `useState` der Extension-Sektion. Sonst zahlt jedes Fortsetzen den
Server-Roundtrip erneut, bei einer VIN-Abfrage mit begrenztem Freikontingent
kein Nebeneffekt, den man sich leisten will (kumiko-framework#1908).

## Die vier Anforderungen aus der Offlot-Vorarbeit

**Schritte und Fortschritt.** Sektionen sind die Schritte, `ProgressBar` plus
"Schritt X von Y" ist Chrome im `FormScreenShell`.

**Validierung pro Schritt.** `runValidate()` in `form-controller.ts:155` parst
heute schon das ganze Formular und filtert die Issues anschließend auf die
sichtbaren Felder (`hiddenFields`, Zeile 172 bis 180). Derselbe Filter, nur mit
den Feldnamen des aktuellen Schritts als Menge: `validate(scope?: readonly
string[])`. Kein Schema pro Schritt, kein zweiter Validierungspfad.

Zwei Stolperstellen, die im Bau geprüft gehören: `.refine()`/`.superRefine()`
liefert Issues mit Root-Pfad oder mit einem Pfad in einen anderen Schritt (die
gehören an den letzten Schritt, nicht an den ersten, der zufällig passt), und
bei `payloadMode: "changes"` unterscheidet sich die Pflichtfeld-Semantik vom
Create-Schema.

**Ein Schritt darf einen Server-Roundtrip machen.** Extension-Sektion mit
`patch`, siehe oben.

**Zwischenspeichern und später weitermachen.** Siehe nächster Abschnitt, das
ist die einzige echte Entscheidung hier.

## Resume-later: eigener Draft-Store, nicht die Domain-Entity

Naheliegend wäre: jeder Weiter-Klick schreibt in die echte Entity, Status
`draft`. Das kostet aber an drei Stellen:

- Die Domain-Entity muss Teilzustände akzeptieren, also Pflichtfelder
  aufweichen. Diese Last trägt dann jede App, die den Wizard benutzt.
- `actionForm` hat gar keine Entity, in die geschrieben werden könnte.
- Jeder Weiter-Klick erzeugt echte Domain-Events. Der Stream trägt das
  Wizard-Geklicke dauerhaft mit.

Empfehlung: ein kleines Bundled-Feature `form-draft`.

- Ein Aggregat pro `draftKey`, scoped auf `(tenant, user)`, Wert als
  JSONB-Blob. Im Edit-Fall bleibt er `${screenId}:${entityId}` — deterministisch,
  geräteübergreifend wiederfindbar, keine Änderung. Im Create-Fall
  (`entityId` ist `null`) reicht `${screenId}:new` allein nicht: derselbe
  Nutzer fängt sonst mehrere Datensätze auf demselben Schlüssel an und
  überschreibt oder liest beim Fortsetzen den falschen Stand — bei Offlot der
  Normalfall, wenn der Händler den Hof abläuft und mehrere Fahrzeuge parallel
  anfängt (kumiko-framework#1908). Dort wird der Schlüssel zu
  `${screenId}:new:${draftId}` mit einer beim ersten Schrittwechsel
  clientseitig erzeugten `draftId` (UUID), die der Client mit dem Draft
  mitführt, um ihn nach einem Reload wiederzufinden. `form-draft:query:list`
  bleibt trotzdem nötig — für den Fall, dass der Client die `draftId`
  verliert, oder der Nutzer von einem anderen Gerät aus fortsetzt.
- `form-draft:write:save` (Upsert bei Schrittwechsel), `form-draft:write:discard`
  (nach erfolgreichem Submit), `form-draft:query:get` (beim Mount),
  `form-draft:query:list` (offene Drafts eines Nutzers zu einem `screenId`).
  Ohne `list` ist ein Draft mit generierter `draftId` nicht wiederfindbar.
- Aufräum-Job löscht Drafts älter als N Tage, N als Config-Key. Trägt der Blob
  FileRefs (Foto-Schritt, siehe unten), gibt derselbe Job sie beim Löschen im
  Blob-Storage frei — sonst bleiben hochgeladene Fotos als Waisen liegen:
  bezahlt, unreferenziert, von nichts mehr erreichbar. **Dieselbe Freigabe
  gehört auch in den Discard-Pfad** (`form-draft:write:discard`, läuft bei
  jedem erfolgreichen Submit und jedem Abbruch) — der ist der weit häufigere
  Löschweg, nicht der Cleanup-Job (kumiko-framework#1915).

Der Blob trägt `stepIndex` mit, sonst hat man nur die Hälfte repariert:
Phronexsis hält den Schritt im `useState` und verliert ihn beim Reload. Wer nur
die Werte speichert, wirft den Nutzer beim Fortsetzen zurück auf Schritt 1
durch ein Formular, das schon ausgefüllt ist.

Das bedient alle drei Screen-Typen, hält den Domain-Stream sauber, bleibt
ES-konform (eigener Stream, kein Direct-Write) und funktioniert geräteüber-
greifend. Letzteres ist bei Offlot kein Detail: der Händler fotografiert am Hof
mit dem Telefon und macht im Büro am Rechner weiter. `localStorage` kann das
nicht und fällt damit raus, obwohl es die kürzeste Lösung wäre.

Der Draft-Teil ist bewusst als eigene Schicht auf dem Kern geschnitten, nicht
darin. Er kann später kommen, aber er darf nicht wegfallen: die Vorarbeit nennt
ihn im P0-Umfang.

**Grenze, die eingehalten werden muss:** `form-draft` hält ausschließlich noch
nicht geschriebene Eingaben und wird beim Submit gelöscht. Was einmal in einem
Domain-Stream steht, gehört nie in den Draft. Solons Teilabschluss (siehe unten)
sieht oberflächlich ähnlich aus, ist aber das Gegenteil: dort sind Datensätze
bereits angelegt und der Vorgang bleibt als Domain-Zustand offen. Wer Solons
Wiederaufnahme auf den Draft-Store legt, verliert beim Aufräum-Job committete
Datensätze.

**Ausnahme von dieser Grenze: der Foto-Schritt.** Ein Upload ist geschrieben,
sobald er läuft — die Datei liegt im Storage, der Blob hält nur die FileRef.
Damit der Aufräum-Job keine Waisen hinterlässt, kennt er die FileRefs im Blob
und gibt sie beim Löschen frei (Bullet oben). Bewusste Alternative dazu wäre
gewesen, Fotos vom ersten Upload an am Fahrzeug statt am Draft hängen zu
lassen — das widerspräche aber dem Rest des Schnitts, weil es den Datensatz
vor dem Submit voraussetzt (kumiko-framework#1908).

**Abnahme, sobald `form-draft` steht:**

- Bedingte Felder aus gepatchten Werten: dieselbe Sektion zeigt mal drei, mal
  elf Felder, gesteuert von Werten, die eine Extension-Sektion zur Laufzeit
  hineingeschrieben hat (VIN-Decode liefert je nach Land unterschiedlich
  viel). `FieldConditions` gelten unverändert, weil es derselbe Controller
  bleibt — einmal explizit geprüft, inklusive des Falls, dass der Anbieter
  nichts liefert und alle Felder wieder Eingabefelder werden.
- Telefon-Chrome: Fortschritt, Zurück/Weiter und Schritttitel auf 375px, ohne
  dass der Weiter-Knopf unter der eingeblendeten Tastatur verschwindet. Bei
  Offlot Abnahmekriterium, nicht Geschmack.

## Solon, Teil 1: das einbettbare Formular

Solons Anforderungsliste (`embeddable-entity-form-anforderungen.md`) will das
Entity-Formular in einem Dialog neben dem Inbox-Vorgang rendern, vorbelegt aus
der KI-Extraktion, gespeichert vom Aufrufer. Gegen den Code geprüft ist das
meiste davon schon gebaut, nur nie so benutzt worden:

| Anforderung | Stand |
|---|---|
| 1 ohne Screen/Route rendern | **da.** `RenderEdit` ist aus `@cosmicdrift/kumiko-renderer` exportiert (`renderer/src/index.ts:75`) und fasst weder Nav noch Router an |
| 2 Anlege-Modus mit Vorbelegung | **da.** `initial` plus `entityId: null`, kein Detail-Fetch |
| 3 Speichern von außen | **da.** `customSubmit` |
| 4 nur geänderte Felder | **da.** `payloadMode: "changes"` |
| 7 bedingte Sichtbarkeit, `sensitive` | **da.** derselbe Renderer, dieselben `FieldConditions` |
| 6 Validierung ohne Schreiben | fehlt nach außen, `controller.validate()` läuft nur intern im Submit |
| Werte und Dirty-State nach außen | fehlt, kein `onChange`, kein Ref |
| 5 Feldauswahl | fehlt, Felder kommen zwingend aus `layout.sections` |
| 8 gesperrtes Formular | fehlt, nur pro Feld `readOnly` |

Die ersten beiden Fehlstellen sind genau der kontrollierte Modus von oben: Werte
raus, Änderungen rein, validieren ohne zu schreiben. Das ist **eine** Änderung
für beide Treiber, und die Extension-Sektion des Wizards mountet danach schlicht
ein `EntityForm`. Punkt 5 und 8 sind zwei kleine, unabhängige Props, die Solons
eigenes Papier als verzichtbar einstuft.

Kein Hindernis: `useForm` ruft `useDispatcher()` unbedingt, das Formular braucht
also einen `DispatcherProvider` auch ohne eigenen Write. In einer App ist der
immer gemountet, das trifft nur Tests und Public-Surfaces.

Die Alternative aus dem Papier (statt einbetten auf die echte Maske navigieren
und zurückspringen) verliert an Solons eigenem Fall: bei zehn Vorschlägen sind
das zwanzig Kontextwechsel. Ihre Begründung stimmt inzwischen ohnehin nicht mehr:
kumiko-framework#1680 (Navigate-Parameter werden still ignoriert) und #1681
(kein Anlegen aus der Referenz-Auswahl) sind beide seit dem 1. August
geschlossen. Die Alternative scheitert also nicht mehr an der Technik, sondern
nur noch am Kontextwechsel.

## Solon, Teil 2: die Schrittfolge ist kein Wizard

Solons S1 bis S6 (frei anspringbare Schritte, überspringen legt nichts an,
Teilabschluss als gültiger Endzustand, Fremdschlüssel-Abhängigkeiten zwischen
Schritten, Sperrung mit Begründung, sichtbarer Fehlschlag pro Schritt) gehören
nicht in `mode: "wizard"` und sollten auch nicht dorthin wachsen.

Der Unterschied ist nicht graduell:

| | `mode: "wizard"` | Solons Strecke |
|---|---|---|
| Gegenstand | ein Datensatz | ein Vorgang mit N Datensätzen |
| Schritt ist | eine Feldgruppe | ein eigener Datensatz mit eigenem Write |
| Ergebnis | ein Submit | N Ergebnisse, jedes kann gelingen, abgelehnt werden oder scheitern |
| Reihenfolge | linear, alle Schritte gehören dazu | frei, Schritte dürfen offen bleiben |
| Abhängigkeiten | keine | Fremdschlüssel, die erst beim Anlegen entstehen |

Presst man S1 bis S6 in den Layout-Modus, verliert man den kleinen Kern und
bekommt trotzdem nicht, was Solon braucht: welcher Vorschlag welchen anderen
referenziert, ist Domänenwissen aus der Extraktion, das keine Layout-Definition
kennen kann.

Die passende Form für Solon ist keine Strecke, sondern eine **Prüfliste**: eine
Liste der Vorschläge, je Eintrag ein `StatusBadge` (offen, übernommen,
abgelehnt, fehlgeschlagen mit Grund), gesperrte Einträge mit Hinweis auf den
fehlenden Vorgänger. Ein Eintrag öffnet sein Formular im gemeinsamen `Drawer`,
nicht eingebettet in die Liste: der Bearbeiter muss das Dokument, aus dem der
Vorschlag stammt, beim Ausfüllen weiterlesen können. Nach dem Speichern
schließt der Drawer und der Bearbeiter landet wieder in der Liste, wo der
erledigte Vorschlag verschwunden ist — kein automatischer Sprung zum nächsten
Eintrag, die Reihenfolge bleibt seine Entscheidung. Das ist eine Ansicht in
Solon aus vorhandenen Widgets plus dem Formular aus Teil 1, und es erfüllt S1
bis S6 direkter als ein Wizard es je könnte: Nichtanfassen bedeutet dort von
selbst "nichts angelegt", was S2 fordert.

Framework-Anteil an Solons Strecke: nur Teil 1.

## Gegenprobe an Phronexsis

Der Wizard dort (`phronexsis/src/features/organization/web/company-setup-wizard.tsx`,
518 Zeilen handgeschrieben) auf dem Papier durchgespielt:

| Schritt | Im Modell |
|---|---|
| basics, industry, businessModel, systemsInventory, stage, goals | sechs `kind: "fields"`-Sektionen, Feldtypen sind alle vorhanden (text/select/number/multiSelect) |
| review | eine `kind: "extension"`-Sektion, rendert `values` |
| Fortschritt, Zurück/Weiter, Finish | Wizard-Chrome |
| Pflichtfeld `companyName` auf Schritt 1 | `validate(scope)` gegen das Entity-Schema, die handgeschriebene `trim() === ""`-Prüfung fällt weg |
| Version-Conflict beim Speichern | Submit-Fehler-Mapping des FormControllers, existiert |
| Post-Save `ensureDefaultDriverModel` | gehört auf den Server in den `organization:update`-Handler, nicht in den Client-Wizard |

Bleibt: eine Screen-Definition plus eine kleine Review-Komponente statt 518
Zeilen. Das ist gleichzeitig der Abnahmetest, denn Offlot hat noch keinen Code,
an dem sich der Entwurf blamieren könnte.

Nicht abgedeckt und bewusst weggelassen: bedingte Schritte (skip-if). Weder
Phronexsis noch Offlot brauchen sie. Wenn ein Fall auftaucht, bekommt
`EditSectionSpec` ein `visibleIf` mit derselben Condition-Sprache, die die
Felder schon benutzen.

## Nicht Teil davon

Die Bild-Pipeline (Verkleinern, Reihenfolge, Titelbild) ist in der Vorarbeit ein
eigener P0. Der Foto-**Schritt** ist Wizard-Arbeit, die Pipeline dahinter nicht.
Ebenso liegt der VIN-Decode-Aufruf selbst bei Offlot, der Wizard stellt nur den
Platz dafür bereit.

## Schnitt

1. `mode: "wizard"` plus Wizard-Chrome plus `validate(scope)`. Danach ist der
   Wizard benutzbar, solange kein Schritt Sonderverhalten braucht.
2. Kontrollierter Modus auf `RenderEdit` (Werte raus, `patch` rein,
   `validate()` ohne Schreiben), durchgereicht an `ExtensionSectionProps`.
   Danach gehen Review-Schritt, Foto-Schritt und Server-Roundtrip bei Offlot
   **und** das im Drawer geöffnete Formular bei Solon.
3. Bundled-Feature `form-draft` plus `layout.draft`.
4. Phronexsis-Wizard darauf umstellen, `kumiko-lint-ignore` entfernen. Beweis
   und Regressionsschutz in einem.

Schritt 1 und 2 zusammen sind der Blocker für Offlot, Schritt 3 vor dem
Foto-Schritt, weil ein Wizard mit Upload ohne Zwischenstand die schlechteste
Kombination ist. Solon braucht von der ganzen Liste nur Schritt 2, kann also
unabhängig davon losgehen, sobald der steht. Optional danach, aus Solons Liste
und dort selbst als verzichtbar markiert: Feldauswahl und gesperrtes Formular
als zwei kleine Props.
