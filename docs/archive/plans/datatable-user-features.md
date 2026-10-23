---
status: shipped
verified: 2026-10-23
issue: kumiko-framework#3956
evidence: "Released in @cosmicdrift/kumiko-framework 0.389.0 (#3973). Plan #3964; rounds #3967 (R1), #3970 (R2), #3966 (R3), #3981 (R4), #3978 (R5), #3971 (R6); groupBy replacement #3991; bundledLists #3995 and #3996."
track: framework
depends: []
---

# DataTable: Nutzerfunktionen für Listen

Die Listen in allen Kumiko-Apps laufen über eine DataTable-Primitive. Sie kann
sortieren, suchen, facettiert filtern, blättern, Zeilen aufklappen und Aktionen
pro Zeile zeigen. Was fehlt, sind die Handgriffe, die Nutzer von Tabellen
erwarten: Spalten wählen, pinnen und ziehen, gruppieren, mehrere Zeilen auf
einmal bearbeiten, nach Excel exportieren und einen Filter nicht verlieren,
wenn sie kurz in einen Datensatz springen. Dieser Plan beschreibt, was davon
ins Framework kommt, wie es konfiguriert wird und in welchen Runden es gebaut
wird.

Marc hat am 2026-10-22 entschieden:

- Alles ist Opt-in. Ohne Konfiguration verhält sich jede Liste wie heute.
- Zustand wird pro Browser-Session gemerkt, nicht auf dem Server. Es geht
  darum, beim Hin- und Herspringen den Filter nicht zu verlieren.
- Ein Reset-Button setzt die ganze Liste zurück, nicht nur die Facets.
- „Actions“ heißt Mehrfachauswahl per Checkbox mit mehreren Bulk-Aktionen.
- Export nur als xlsx. Wer exportiert, öffnet die Datei in Excel.
- Keine gespeicherten Ansichten.
- Spalten ein- und ausblenden, umsortieren, Dichte, Summenzeile,
  Zahlenbereich als Filter und Tastaturnavigation kommen mit.
- Jede Funktion bekommt E2E-Tests, damit Fix-Runden klein bleiben.
- Gruppen und Summen rechnet der Server über die ganze Treffermenge, nie über
  die geladene Seite. Sonst wachsen Summen beim Scrollen, und eine Gruppe
  zeigt nur die Zeilen einer Seite.

## Ist-Stand

Belegt am 2026-10-22 im Framework-Checkout (0.386.0):

- Kette: `packages/types/src/screen-entity-list.ts` und `screen-projection.ts`
  (Schema) → `packages/renderer/src/app/entity-list-screen.tsx` und
  `projection-list-body.tsx` → `packages/renderer/src/components/render-list.tsx`
  → `packages/renderer/src/web/primitives/data-table.tsx`. Keine App überschreibt
  die DataTable-Primitive, eine native DataTable gibt es nicht.
- Listenzustand lebt nur in der URL (`packages/renderer/src/hooks/use-list-url-state.ts`):
  Sortierung, Suche, Seite, Seitengröße, Facets, Datumsbereich, pro Screen-Id
  namespaced. Ein Speicher pro Session fehlt. `localStorage` und
  `sessionStorage` sind im geteilten Renderer-Layer per Guard verboten, in
  `packages/renderer/src/web/**` erlaubt (`floating-panel.tsx` nutzt sie schon).
- Filter-Reset: `onFilterReset` → `clearFilters` löscht Facets, Datumsbereich
  und Seite. Suche, Sortierung und Seitengröße bleiben. Der Button sitzt im
  Facet-Cluster, eine Liste ohne Facets hat keinen Reset.
- Gruppierung: vor Runde 4 renderte die Primitive klappbare Gruppen
  (`rowGrouping`) aus der relatedList-Konfig `groupBy`. Beides ist mit #3979
  entfernt, Gruppen kommen nur noch über `table.grouping` vom Server.
- Aktionen: `rowActions` (writeHandler, navigate, drawer, clientAction),
  `toolbarActions`, Confirm, Icons, Sichtbarkeit pro Zeile, Modus inline oder
  Kebab. Mehrfachauswahl fehlt.
- Spalten: `ListColumnSpec` kennt keine Breite, kein Pinnen, keine
  Sichtbarkeit. Nur die Aktionsspalte ist ab `md` sticky rechts. Zellen
  umbrechen (`max-w-xs whitespace-normal`), die Tabelle nutzt Auto-Layout.
- Drag: `packages/renderer/src/web/widgets/use-pointer-drag.ts` existiert mit
  Tastatur-Unterstützung (`arrowKeyDelta`) und wird von Drawer und
  FloatingPanel genutzt.
- Filter-Operatoren: `ScreenFilterOp` kennt `lt`, `gt`, `lte`, `gte` für
  Zahlen und Zeiten. Ein Zahlenbereich als Facet fehlt.
- Export: nur `saveBlobAsFile` in `web/lib`. Kein Listen-Export, keine
  xlsx-Abhängigkeit im Workspace.
- E2E: `packages/renderer/e2e` läuft gegen einen MockDispatcher ohne DB
  (`packages/renderer/playwright.config.ts`), `samples/apps/styleguide/e2e`
  hat Screenshot- und Tabellen-Specs gegen den echten Stack.
- Pagination: `pages` blättert per Offset, `infinite` per Cursor mit
  `loadMore` (`entity-list-screen.tsx`). Auf projectionList ist `infinite`
  heute ein No-op (`projection-list-body.tsx`).
- Suche mit Meilisearch: `list` in
  `packages/framework/src/db/event-store-executor-read.ts` holt aus dem
  Adapter nur Kandidaten-Ids, höchstens 1000, danach `searchTruncated`.
  Filter, Sortierung und Seiten laufen in Postgres.
- Aggregation: `tenantDb.aggregate` mit `AggregateSpec` in
  `packages/framework/src/db/tenant-db.ts` und `db/aggregate-sql.ts`. Der
  Spec kennt ein Measure (`count`, `countDistinct`, `sum`, `avg`), das
  Ergebnis ist `number | null` (`::float8`-Cast in `db/query.ts`), `min`
  und `max` fehlen. Die Where-Klausel der Liste (`ListWhere` aus Ownership,
  Parent-Ref, Tenant- und Soft-Delete-Scope, Filtern und Such-Ids in
  `event-store-executor-read.ts`) ist davon getrennt; `aggregateWhere`
  nimmt nur ein `WhereObject`. Eine Screen-Query, die aggregiert, fehlt.
- Field-Read-Gate: `fieldReadClause` liefert `pass`, `empty` oder `sql`.
  Ein Filter auf ein Feld ohne Leserecht wird zu `FALSE`, eine Sortierung
  fällt still weg, damit die Existenz eines Feldes nicht verraten wird.
- relatedList-`groupBy` gruppierte vor #3979 clientseitig über die geladene
  Seite (`{count}`, `{lastDate}`).

## Ziel und Nicht-Ziele

Ziel: Jede entityList, projectionList und relatedList kann per Schema die
folgenden Funktionen einschalten. Nutzer bedienen sie in der Tabelle selbst
oder über ein Ansicht-Menü in der Toolbar. Der Zustand überlebt Navigation
innerhalb der Session.

Nicht-Ziele:

- Keine Persistenz auf dem Server, keine Ansichten pro User.
- Keine gespeicherten oder geteilten Ansichten.
- Kein CSV, kein PDF.
- Keine Auswahl „alle Treffer über alle Seiten“. Bulk gilt für geladene Zeilen.
- Keine clientseitige Gruppierung oder Summe über geladene Zeilen. Beides
  rechnet der Server über die ganze Treffermenge. Das frühere `groupBy` auf
  relatedList ist mit #3979 durch `table.grouping` ersetzt, auch auf
  expandableRow (dort ohne `userChoice`).

## Entscheidungen

### Ein `table`-Block im Schema, alles aus per Default

entityList, projectionList und relatedList bekommen ein optionales Feld
`table`. Jeder Schlüssel schaltet eine Funktion ein. Fehlt der Block, ändert
sich nichts. Der Boot-Validator prüft Feldnamen, Typen und Kombinationen.

```ts illustration
table: {
  rememberState: true,
  resetAll: true,
  columnPicker: true,
  pinning: true,
  resizing: true,
  density: { default: "comfortable", userChoice: true },
  grouping: { field: "status", userChoice: true, fields: ["status", "owner"] },
  totals: [{ field: "amount", kind: "sum" }],
  keyboardNavigation: true,
  export: { xlsx: true, maxRows: 10000 },
},
bulkActions: [{ id: "archive", rowAction: "archive" }],
```

Spalten bekommen drei neue optionale Felder auf `ListColumnSpec`: `pinned`
(`"left" | "right"`), `width` und `minWidth` in Pixeln, `hidden` als
Startzustand für den Spalten-Picker. Sie wirken nur, wenn die passende
Funktion im `table`-Block an ist.

Verworfen: Funktionen app-weit per Boot-Option einschalten. Das Schema pro
Screen ist die Stelle, an der ein Agent eine Liste liest und versteht; eine
globale Option versteckt das Verhalten. Eine App, die alles überall will,
schreibt sich einen Helfer, der den Block in jede Screen-Definition mischt.

### Session-Speicher hinter einer Schnittstelle, URL bleibt Wahrheit

Der geteilte Renderer-Layer bekommt einen `ListStateStore`-Kontext mit
`read(screenId)` und `write(screenId, state)`. Die Default-Implementierung ist
eine Map im Speicher, sie überlebt Routenwechsel in der SPA. Der Web-Layer
registriert in der App-Shell eine Implementierung auf `sessionStorage`, Schlüssel
`kumiko.list.<tenantId>.<userId>.<screenId>`. Der Store-Provider beobachtet
die Session-Identität (tenantId, userId); fällt sie weg oder wechselt sie,
löscht er alle `kumiko.list.*`-Einträge. Im Renderer gibt es keinen
Logout-Hook (`logout()` liegt im Auth-Feature), deshalb hängt das Leeren an
der Identität und nicht an einem Event. Sonst stellt ein Tab Facet-Ids aus
Tenant A in Tenant B wieder her, und ein Suchtext mit PII überlebt die
Abmeldung. Gelesener Zustand läuft an der
Grenze durch ein Zod-Schema; unbekannte Spalten oder Felder werden still
verworfen. Nur `packages/renderer/src/web/**` darf `sessionStorage` anfassen,
der Guard bleibt wie er ist.

Die URL bleibt die Quelle für Sortierung, Suche, Seite, Seitengröße und Filter.
Mit `rememberState` schreibt jede Änderung in den Store. Beim Mount ohne
Listen-Parameter in der URL stellt der Screen den gespeicherten Zustand per
`replace` in die URL. Ein Link mit Parametern gewinnt immer. Ansichtsdaten
(Spaltenwahl, Reihenfolge, Pins, Breiten, Dichte, Gruppierung) liegen nur im
Store, nie in der URL.

Verworfen: Persistenz über das `config`-Feature mit User-Scope. Marc will
keinen Server-Zustand für Tabellen. Verworfen: nur In-Memory ohne
`sessionStorage`. Ein Reload würde den Filter verlieren, und das ist der Fall,
den Nutzer am ehesten bemerken.

### Reset setzt alles zurück

`resetAll` ersetzt den Facet-Reset durch einen Button, der Suche, Sortierung,
Seitengröße, Facets und Datumsbereich auf den Screen-Default stellt und den
Store-Eintrag löscht. Er erscheint, sobald irgendetwas vom Default abweicht,
auch ohne Facets. Ein zweiter Punkt „Ansicht zurücksetzen“ im Ansicht-Menü
stellt Spalten, Pins, Breiten, Dichte und Gruppierung zurück.

### Ansicht-Menü in der Toolbar

Ein Button mit Spalten-Icon rechts in der Toolbar öffnet ein Menü. Es zeigt nur
Abschnitte, deren Funktion an ist: Spalten (Checkboxen, Reihenfolge per Pfeil
und Drag), Pin links oder rechts pro Spalte, Dichte, Gruppieren nach, Ansicht
zurücksetzen. Unter `md` gilt das Karten-Layout: Spaltenwahl, Dichte und
Gruppierung wirken dort, Pins, Breiten und Reihenfolge nicht.

### Pinnen und Breiten

Gepinnte Spalten werden `position: sticky` mit summierten Offsets. Offsets
kommen aus gemessenen Breiten per `ResizeObserver`, ohne `resizing` aus dem
Auto-Layout. Die Aktionsspalte bleibt die äußerste rechte sticky Spalte.
Z-Index-Reihenfolge: Header über Pins über Aktionen über Zellen; ein Test
deckt den Fall „letzte Datenspalte rutscht unter die Aktionsspalte“ ab, der
schon einmal gefixt wurde.

Mit `resizing` wechselt die Tabelle auf `table-layout: fixed` mit `colgroup`.
Ohne `resizing` bleibt das Auto-Layout, damit bestehende Listen unverändert
aussehen. Der Griff sitzt am rechten Rand des Headers, nutzt `usePointerDrag`
und reagiert auf Pfeiltasten. `width` und `minWidth` aus dem Schema sind
Startwerte, Nutzerwerte landen im Store.

### Gruppierung rechnet der Server, die Gruppe ist die Einheit

`table.grouping` nimmt `field`, `label`, `labels` und `collapsedWhen` plus
`userChoice` und `fields`; `dateField` entfällt, ein Datum je Gruppe liefert
ein `max`-Measure. Das frühere `groupBy` auf relatedList ist mit #3979
entfernt: relatedList und expandableRow gruppieren über `table.grouping` auf
dem Server-Pfad, die gebundene Query muss `aggregate` annehmen. Ein
expandableRow nimmt nur `grouping` mit festem `field`, ohne `userChoice`.

Die `list`-Query bekommt ein optionales Payload `aggregate` mit `groupBy`
(ein Feld) und `measures` (Feld plus `sum`, `avg`, `count`, `min`, `max`).
Mit `aggregate` antwortet die Query mit `groups` statt `rows`: je Gruppe
Schlüssel, Anzahl und Measures, über dieselbe Where-Klausel wie die Liste
(Ownership, Parent-Ref, Screen-Filter, Suche). Ohne `groupBy` liefert sie eine
Zeile mit den Measures über die ganze Treffermenge, das ist die Summenzeile.
Der Server erweitert die vorhandene Aggregationsschicht statt eine zweite zu
bauen: `AggregateSpec` und `aggregateMeasureSql` bekommen mehrere Measures
und `min`/`max` mit typisiertem Ergebnis (Zahlen als number, money als
Integer in Minor-Units, date und timestamp als ISO-String); die bestehenden
Aufrufer in `metrics/compute.ts` und `audit/run-escape-hatch-retention.ts`
laufen weiter. Der Aufbau der Where-Klausel in `list()` wird in eine
Funktion extrahiert, die Liste und Aggregation gemeinsam nutzen;
`aggregateWhere` und `tenantDb.aggregate` bleiben außen vor. Gruppenfeld
und Measure-Felder laufen durch dasselbe Field-Read-Gate wie Sortierung und
Filter, ohne 403, weil ein Fehler die Existenz des Feldes verraten würde:
`empty` ergibt keine Gruppen beziehungsweise `null`, bei `sql` begrenzt
`FILTER (WHERE …)` jedes Measure und ein CASE den Gruppenschlüssel auf
lesbare Zeilen, damit die Zahlen zur Liste passen. Ein verschlüsseltes oder
Secret-Feld (`holdsCiphertextOrSecret`) ergibt 400 zur Laufzeit und wird im
Screen-Schema vom Boot-Validator abgelehnt. Der Aggregations-Builder wird
für eigene Query-Handler exportiert, damit eine projectionList-Query
`aggregate` annehmen kann. Höchstens 200 Gruppen (`MAX_LIST_LIMIT`),
darüber antwortet die Query mit `truncated: true` und die Toolbar bittet um
einen Filter.

Der Client lädt bei aktiver Gruppierung zuerst die Gruppen, dann je
aufgeklappter Gruppe ihre Zeilen über die normale `list`-Query mit dem Filter
`groupField eq <Schlüssel>`, Seitengröße wie die Liste, Cursor oder Seite pro
Gruppe, „mehr laden“ am Gruppenende. Zeilen laden erst, wenn der Gruppenkopf
sichtbar wird, höchstens vier Gruppen gleichzeitig. Eine zugeklappte Gruppe
stellt keine Query. Pages und Infinite verhalten sich im Gruppenmodus gleich,
die Gesamt-Seitenleiste verschwindet. Der Gruppenkopf zeigt Anzahl und
Measures vom Server, die sich beim Scrollen nicht ändern.

projectionList und relatedList: `table.grouping` und `table.totals` sind
dort nur erlaubt, wenn das Query-Schema `aggregate` annimmt, nach demselben
Muster wie `searchable` gegen `search`
(`boot-validator/projection-list-screens.ts`). Der Boot-Validator lehnt den
Block sonst ab.
Bei Meilisearch-Suche gehen dieselben Kandidaten-Ids in die Gruppen-Query,
die Kappung bei 1000 Treffern und ihr Hinweis gelten wie heute.

Verworfen: Gruppen clientseitig über die geladene Seite mit Sortierzwang.
Eine Gruppe zeigt dann nur die Zeilen einer Seite, beim Nachladen wächst sie,
eine zugeklappte Gruppe lädt still durch, und Summen je Gruppe wären
Seiten-Summen. Marc hat am 2026-10-22 entschieden, dass das nicht reicht.

### Bulk-Aktionen rufen die Zeilen-Aktion pro Zeile auf

`bulkActions` verweist auf vorhandene `rowActions` vom Kind writeHandler.
clientAction ist Client-Code ohne Server-Command und lässt sich nicht für
mehrere Zeilen anstoßen; navigate und drawer passen nicht. Der Boot-Validator
lehnt alle drei ab. Mit mindestens einer Bulk-Aktion bekommt die Tabelle eine
Checkbox-Spalte links, eine Header-Checkbox für die geladenen Zeilen und eine
Leiste „n ausgewählt“ mit den Aktionen. Die Ausführung schickt pro Zeile einen
eigenen `/api/write`-Call, höchstens vier gleichzeitig. Zeilen, bei denen
`visible` die Aktion ausblendet, werden übersprungen und im Banner gezählt.
Abbrechen startet keine neuen Calls, laufende enden normal. Das Ergebnis landet
in einem Banner: wie viele erfolgreich, wie viele gescheitert, wie viele
übersprungen; die gescheiterten bleiben ausgewählt. Danach lädt die Liste neu.
Confirm gilt einmal für die ganze Auswahl, der Text nennt die Anzahl.

Verworfen: `/api/batch`. Der Batch läuft atomar in einer Transaktion
(`packages/framework/src/pipeline/dispatcher.ts`), eine abgelehnte Zeile rollt
alle anderen zurück. Damit gäbe es weder einen Teilerfolg im Banner noch eine
bleibende Auswahl der gescheiterten Zeilen. Verworfen: ein eigener
Bulk-Handler mit `ids[]`. Er bräuchte eine zweite Autorisierung und zweite
Validierung für denselben Vorgang. Einzel-Calls nutzen die vorhandenen Handler,
Zugriff und Audit gelten pro Zeile.

### xlsx-Export über eine Framework-Route

`table.export.xlsx` zeigt einen Export-Button in der Toolbar. Der Client
schickt an `POST /api/export/xlsx` nur die Screen-Id, das aktuelle Payload
(Suche, Sortierung, Filter, ohne Seite) und die Ids der sichtbaren Spalten.
Query-QN, Spaltenliste, Labels und `maxRows` liest der Server aus dem
registrierten Screen-Schema; eine Spalten-Id, die das Schema nicht kennt, führt
zu 400. So kann ein Client keine beliebige QN exportieren. Der Server liest
über `dispatcher.query` mit der Session des Nutzers, Rollen und Tenant-Scope
gelten wie bei `/api/query`. Weil `MAX_LIST_LIMIT` 200 Zeilen pro Seite erlaubt,
blättert die Route über `nextCursor`; 10000 Zeilen sind rund 50 Seiten. Sobald
`maxRows + 1` Zeilen gelesen sind, antwortet die Route mit 413, ohne vorherige
Count-Query, und die Toolbar sagt, dass der Nutzer filtern soll. `maxRows`
Default 10000. Zahlen, Geld, Datum und Zeitstempel werden als Excel-Typen
geschrieben, Select-Werte mit ihrem Label, alle Textwerte als String, auch
wenn sie mit `=` beginnen. Dateiname `<screenId>-<YYYY-MM-DD>.xlsx`.

Die Route steht nicht auf der PAT-Allowlist in
`packages/framework/src/api/pat-route-guard.ts`; Export gibt es nur mit
Browser-Session. Eine eigene Route statt einer Erweiterung von `/api/query` ist
nötig, weil die Antwort binär ist und keine Query-Semantik trägt. Offen für
Runde 6: ob projectionList-Queries ohne Cursor auskommen; dann blättert die
Route dort über Offset.

Bibliothek: `write-excel-file` (MIT, keine Node-Stream-Abhängigkeit). Vor der
Umsetzung einmal unter Bun gegen den Lizenz-Guard und einen Smoke-Test prüfen.
Scheitert das, ist die Alternative ein eigener Writer über `fflate` plus
SpreadsheetML, etwa 200 Zeilen. Verworfen: SheetJS Community Edition wegen
Lizenz- und CVE-Historie, `exceljs` wegen Größe.

### Zahlenbereich als Facet

Felder vom Typ number, decimal, money und bigInt mit `filterable: true`
können per `facets: { amount: { display: "range" } }` zwei Eingaben „von“
und „bis“ bekommen, analog zum Datumsbereich. URL-Schlüssel
`<screenId>.f.<field>.min` und `.max`, Payload-Filter `gte` und `lte`. Geld
wird in der Feldwährung eingegeben und als Minor-Units gesendet.

### Dichte, Summen, Tastatur

- `density`: `compact` setzt Zeilenhöhe 32 px und Zellen-Padding 4 px,
  `comfortable` behält die heutigen Werte. Mit `userChoice` steht die Wahl im
  Ansicht-Menü.
- `totals`: eine Fußzeile unter den Zeilen, je Eintrag `sum`, `avg`, `count`,
  `min` oder `max`, vom Server über die ganze Treffermenge mit den aktuellen
  Filtern und der Suche (`aggregate` ohne `groupBy`). Formatierung über
  denselben Zell-Renderer wie die Spalte. Die Fußzeile lädt mit der Liste neu,
  auch bei Live-Updates.
- `keyboardNavigation`: Roving Tabindex auf den Zeilen. Pfeil hoch und runter
  bewegen, Home und Ende springen, Enter löst die Zeilen-Aktion aus, Leertaste
  wählt bei Bulk aus. Fokus-Ring über Theme-Token.

### Jede Funktion neben der Primitive, nicht darin

`data-table.tsx` hat 971 Zeilen, die Grenze liegt seit
2026-10-22 bei 1200. Jede Funktion kommt als eigener Hook oder eigene
Teilkomponente unter
`packages/renderer/src/web/primitives/data-table/` (Ansicht-Menü, Pins,
Resize-Griff, Auswahl-Leiste, Export-Button); die Primitive verdrahtet sie nur.
Der Store, das Gruppen-Modell und die Aggregations-Payloads liegen im
geteilten Layer unter `packages/renderer/src/hooks` und `components`. Runde 1
legt den Schnitt fest, jede weitere Runde folgt ihm.

Marc hat am 2026-10-22 ergänzt: keine God-Files. Die großen Dateien der Kette
(`data-table.tsx` 971, `entity-list-screen.tsx` 799, `render-list.tsx` 781,
`projection-list-body.tsx` 417 Zeilen) und `event-store-executor-read.ts`
(348) wachsen in keiner Runde; jede neue Datei hat eine Verantwortung und
höchstens 300 Zeilen. Der File-Size-Guard (1200) ist die Obergrenze, nicht das
Ziel. Im Executor folgt die Aggregation dem Muster der
`event-store-executor-read-*`-Module, der Export bekommt ein eigenes
Verzeichnis `api/export/` mit getrennten Modulen für Route, Schema-Auflösung,
Paging und Writer.

### Texte, Docs, Guards

- Alle neuen Texte als `kumiko.list.*`-Schlüssel in den Renderer-Defaults und
  in `locale-de`, `locale-es`, `locale-fr`, `locale-it`. Die Boot-Regel
  „jede Locale für jeden Schlüssel“ gilt.
- Je Runde ein `.changeset/<name>.md` mit `kumiko-changes`-Block.
- Das Recipe `samples/recipes/record-detail-layout` oder ein neues Recipe
  `list-table-options` zeigt den `table`-Block mit allen Schlüsseln, getestet.
- `bun run gen:agent-docs` nach jeder Runde, der Drift-Guard prüft
  `agents/widgets.md`.
- `docs/reference/renderer-widget-options.md` bekommt einen Abschnitt
  „DataTable `table`-Block“. Nebenbefund aus dem Check: `onFilterReset` fehlte dort, es kam in
  Runde 1 mit rein (`rowGrouping` ist mit #3979 entfernt).
- Die Docs-Site in kumiko-platform zieht nach dem letzten Release nach.

## Runden

Jede Runde ist ein PR in kumiko-framework, von einem Agent in einem Lauf
fertig, mit Unit-Tests im Renderer, Boot-Validator-Tests, E2E-Spec in
`packages/renderer/e2e` gegen den MockDispatcher und, wo das Bild sich ändert,
einem Screenshot-Spec im Styleguide unter dem `screenshots`-Pfad, der außerhalb
der CI mit `bun run shots` läuft. E2E-Selektoren gehen über Rolle, `aria-label`
oder Text, nie über `data-testid`. Der Styleguide bekommt
eine Beispiel-Liste, in der alle Funktionen an sind. Runde 1 legt das Recipe
`samples/recipes/list-table-options` an, jede weitere Runde erweitert es.

### Runde 1: Zustand und Ansicht-Menü

`table`-Block in types und Boot-Validator, `ListStateStore` mit
Session-Implementierung und Zod-Grenze, `rememberState`, `resetAll`,
`columnPicker` mit Sichtbarkeit und Reihenfolge, `density`, das Ansicht-Menü,
i18n in fünf Locales, Doku-Abschnitt, Datei-Schnitt neben der Primitive. E2E:
Filter setzen, in einen Datensatz springen, zurück, Filter steht; Reset setzt
Suche und Sortierung zurück; Spalte ausblenden und umsortieren überlebt
Navigation; Logout leert den Store.

### Runde 2: Spaltenlayout

`pinned`, `width`, `minWidth` auf `ListColumnSpec`, `pinning` und `resizing`
im Block, Pin-Abschnitt im Ansicht-Menü, Griff im Header, Messung per
`ResizeObserver`, Z-Index-Regel, `keyboardNavigation` mit Roving Tabindex.
E2E: Pin links und horizontal scrollen, Breite ziehen und per Tastatur ändern,
Reload behält die Breite, Pfeiltasten und Enter. Screenshot im Styleguide.

### Runde 3: Aggregation im Server

`aggregate`-Payload auf der `list`-Query in types und Executor als eigenes
Modul `event-store-executor-read-aggregate.ts`, Where-Aufbau aus `list()`
extrahiert, `AggregateSpec` und `aggregate-sql.ts` um mehrere Measures und
`min`/`max` mit typisiertem Ergebnis erweitert, Field-Read-Gate per
`FILTER` und CASE, 400 für verschlüsselte und Secret-Felder, Builder-Export
für eigene Query-Handler, Gruppen-Cap mit `truncated`. Integration-Tests
mit `setupTestStack`: Gruppen und Summen stimmen mit den Zeilen überein;
ein Filter, eine Suche über den Search-Adapter und eine Ownership-Klausel
wirken auf beide gleich; bei zeilenabhängigem Leserecht zählen Zeilen ohne
Leserecht nicht, Liste und Aggregation stimmen überein; ein Feld ohne
Leserecht ergibt keine Gruppen und keinen Fehler; `groupBy` auf einer
Reference-Spalte gruppiert nach der Id und liefert das Label mit; die
metrics- und audit-Tests bleiben grün.

### Runde 4: Gruppierung, Summen, Zahlenbereich im Renderer

`grouping` und `totals` im `table`-Block mit den Boot-Validator-Regeln
(Felder des Screens, verschlüsselte und Secret-Felder, Typ je Measure,
Query-Schema-Regel für projectionList und relatedList), geteiltes
Gruppen-Modell, Zeilen pro Gruppe mit eigenem Cursor, Laden bei
Sichtbarkeit, `userChoice` im Menü, `totals`-Fußzeile vom Server,
`display: "range"` für Zahlen-Facets mit URL- und Payload-Mapping.
`buildTableItems` in der Primitive bekommt Server-Gruppen statt geladener
Zeilen, nur das Rendering der Gruppenköpfe bleibt. Der MockDispatcher
beantwortet `aggregate` über alle Fixture-Zeilen. E2E in beiden
Pagination-Modi: Gruppieren nach Status, Gruppenkopf zeigt die Gesamtzahl
über alle Seiten, Gruppe zuklappen stellt keine Query, Nachladen in einer
Gruppe ändert ihre Summe nicht, Betrag von bis filtert Zeilen und Summe.
Größe L, bleibt ein PR.

### Runde 5: Bulk-Aktionen

`bulkActions` in types und Boot-Validator, Checkbox-Spalte und
Header-Checkbox, Auswahl-Leiste, Ausführung pro Zeile mit vier parallelen
Calls, Ergebnis-Banner, Karten-Layout, Leertaste wählt aus. Der MockDispatcher
in `packages/renderer/e2e/fixtures/mock-dispatcher.ts` beantwortet `write` pro
Zeile und kann eine Zeile gezielt ablehnen. E2E: drei Zeilen wählen,
archivieren, Banner zeigt 3, Liste lädt neu; eine Zeile scheitert, bleibt
ausgewählt. Integration-Test über den echten Stack mit `setupTestStack`: eine
Zeile ohne Zugriff wird abgelehnt, die anderen gehen durch.

### Runde 6: xlsx-Export

Route `POST /api/export/xlsx` im Framework mit Schema-Auflösung über die
Screen-Id, Bibliothek nach Smoke-Test, Cursor-Paging, Typ-Mapping, `maxRows`,
Toolbar-Button, Dateiname. Integration-Test über den echten Stack: Datei
öffnen, Spalten und Typen prüfen, Tenant-Scope greift, 413 über `maxRows`,
unbekannte Screen-Id oder Spalte ergibt 400, PAT wird abgelehnt, ein Wert
`=1+1` landet als Text und nicht als Formel. E2E in `packages/renderer/e2e`
gegen den MockDispatcher: der Button schickt Screen-Id, Payload ohne Seite
und sichtbare Spalten, eine 413-Antwort zeigt den Filter-Hinweis. E2E in
`samples/apps/use-all-bundled`: Download landet mit den gefilterten Zeilen.

### Checkliste nach den Runden

- Styleguide-Beispielliste in der Galerie und in den Docs-Screenshots.
- Docs-Site in kumiko-platform: Seite „Listen“ um den `table`-Block ergänzen.
- App-Bumps nach dem letzten Release. Ob eine App Funktionen einschaltet,
  entscheidet Marc pro App; der Bump allein ändert nichts.
- relatedList: der Block gilt dort mit denselben Regeln, Abnahme im Recipe
  `record-detail-layout`.

## Akzeptanz

- Eine Liste ohne `table`-Block und ohne `bulkActions` rendert byte-gleich wie
  vor dem Plan. Ein Snapshot-Test im Renderer belegt das.
- Jede Funktion hat einen E2E-Spec, der den Nutzerweg nachspielt, und einen
  Boot-Validator-Test, der eine falsche Konfiguration ablehnt.
- Der Guard für Renderer-Grenzen bleibt grün, `sessionStorage` steht nur
  unter `packages/renderer/src/web/**`.
- Alle neuen Texte existieren in den fünf Locales, `kumiko-schema validate`
  läuft in CI durch.
- Summen und Gruppenzahlen ändern sich beim Blättern, Nachladen und
  Zuklappen nicht. Ein E2E-Spec belegt das in beiden Pagination-Modi.
- Zeilen ohne Leserecht fließen nicht in Gruppen oder Summen. Bei
  zeilenabhängigem Leserecht stimmen Liste und Aggregation überein.
- Screenshot-Abnahme durch Marc für Runde 2 und Runde 4, bevor sie gemergt
  werden.

## Risiken

- Drei sticky Ebenen im Header. Der Test aus dem früheren Bug bleibt im
  Lauf, bevor Pins dazukommen.
- `table-layout: fixed` ändert, wie lange Texte umbrechen. Deshalb nur mit
  `resizing`, und die Styleguide-Screenshots zeigen beide Zustände.
- Einzel-Calls für viele Zeilen dauern bei langsamen Handlern. Die Leiste
  zeigt den Fortschritt als Zähler, Abbrechen startet keine neuen Calls. Die
  Obergrenze ist die Seitengröße, höchstens 100 Zeilen pro Auswahl.
- Gruppen laden je eine Query. Mit Laden bei Sichtbarkeit und höchstens vier
  parallelen Queries hängt die Last an der Seitengröße, nicht an der
  Gruppenzahl.
- Die Suche kappt bei 1000 Kandidaten. Gruppen und Summen zeigen dann
  denselben Hinweis wie die Liste, nie stillschweigend eine kleinere Menge.
- `write-excel-file` unter Bun ist nicht belegt. Der Smoke-Test ist der erste
  Schritt in Runde 6, die Alternative steht oben.
