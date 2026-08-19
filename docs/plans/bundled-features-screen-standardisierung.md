---
status: plan
verified: 2026-08-19
evidence: "offlot Mount-Punkte (Marc, 2026-08-19); Referenz-Pattern: kumiko-enterprise/packages/kumiko-credit/src/feature.ts (credit-list)"
---

# Bundled-Features: Screen-Standardisierung

## Kernbefund

Das Framework erzwingt in den App-Repos deklarative Screens und bricht die
Regel bei sich selbst.

**17 von 19 Screens in `packages/bundled-features` sind `type: "custom"`**,
also handgeschriebenes TSX. Deklarativ sind nur `cap-counter` (entityList) und
`sessions` (projectionList + projectionDetail).

Der Grund ist eine Guard-Lücke, keine technische Notwendigkeit:

| Guard | Was er prüft | Scannt bundled-features? |
|---|---|---|
| `guard-app-feature-structure` | verbietet `type:"custom"` ohne Allowlist-Tag | **nein**, nur App-Repos |
| `guard-i18n-ui-strings` | verbietet Literal-UI-Text | **nein**, nur App-Repos |
| `guard-no-raw-hooks` | erzwingt `useQuery`/`useMutation` | **nein**, nur App-Repos |
| `guard-no-custom-primitives` | erzwingt Framework-Widgets | **nein**, nur App-Repos |
| `guard-raw-classname` / `guard-no-inline-styles` | Theme-Tokens statt Tailwind | **nein**, nur App-Repos |
| `guard-primitives-discipline` | Primitives-Nutzung | ja (`--strict-bundled`) |
| `guard-no-logic-in-views` | Logik gehört nach `lib/` | nein (Glob greift nur `samples/apps`) |

Die UI-Guards laufen über `infra/guards/run-ui-guards.ts` und sind ein Opt-in
der App-CI (`ui-guards`-Input in `_app-test.yml`). Die Framework-CI ruft sie
nicht auf. Ergebnis: money-horse muss für jeden custom-Screen einen
`// kumiko-lint-ignore app-feature-structure <Grund>` setzen und begründen,
`bundled-features` darf 17 Stück ohne ein Wort Begründung haben.

Zweite Ironie: `docs/reference/app-feature-structure.md:8` nennt
`packages/bundled-features/src/tenant/` als **Referenz** für App-Autoren.
Genau dieses Feature ist der schlimmste Fall im Repo.

### Ziel-Pattern

`kumiko-enterprise/packages/kumiko-credit/src/feature.ts` (`credit-list`) ist
die Referenz, die Marc benannt hat. Alles, was die sechs Screens vermissen
lassen, ist dort eine Deklaration:

```ts
r.screen({
  id: "credit-list",
  type: "entityList",
  entity: ENTITY_NAME,
  columns: [...],
  defaultSort: { field: "start", dir: "desc" },
  searchable: true,
  slots: { header: { react: { __component: "CreditCapChip" } } },
  rowActions: [ /* navigate mit rowClick, writeHandler mit confirm */ ],
  toolbarActions: [ /* "+ Neu" */ ],
  access: { openToAll: true },
});
```

Suche, Sort, Pager, Empty-State, Loading, Error, Row-Actions,
Confirm-Dialoge, volle Screen-Breite: alles geschenkt. Null Zeilen TSX.

### Warum die Screens unterschiedlich aussehen

Zwei getrennte Fehlerklassen, die in den sechs Mount-Punkten gemischt
auftreten:

1. **Struktur** (die 4 custom-Screens): jeder Autor hat Shell, Empty-State,
   Loading und Spalten neu erfunden.
2. **Contract** (die 2 deklarativen Screens): der Screen verspricht eine
   Fähigkeit, die der Server nicht liefert. Kein Boot-Validator fängt das.

Punkt 2 ist der wichtigere Befund. Ein Screen einfach auf `projectionList`
umzustellen reicht nicht, wenn der Query-Handler den Contract bricht.
Genau das ist `session-list` heute: deklarativ **und** kaputt.

### Der "100 % width marker"

Geklärt, und die Antwort ist erfreulich: es gibt zwei Fälle.

- **Listen** (`entityList`/`projectionList`) rendern über `RenderList` ganz
  ohne Shell und füllen die Content-Breite von sich aus
  (`renderer/src/app/kumiko-screen.tsx:1330`).
- **Forms** (`entityEdit`/`configEdit`/`actionForm`) rendern über
  `FormScreenShell` mit Default `maxWidth="3xl"` = `max-w-3xl mx-auto`
  (`renderer-web/src/primitives/index.tsx:1715-1728`). Der Marker ist
  `layout: { width: "full" }` (`types/src/screen.ts:604-611`).

Die drei custom-Screens (members, delivery-log, profile-picker) wrappen ihre
**Liste** in `FormScreenShell` ohne `maxWidth`. Deswegen sind sie schmal und
zentriert. Das ist kein fehlendes Flag, sondern der falsche Wrapper, und es
verschwindet mit der Umstellung auf deklarativ von selbst.

Nur bei `tenant-settings-tenant` (ein echtes Form) ist es wirklich das
fehlende `layout.width: "full"`.

---

## Phase 0: die Guard-Lücke schließen

Ohne diesen Schritt ist alles Folgende Handarbeit, die beim nächsten Feature
wieder zerfällt. Er kommt zuerst, weil er die Arbeit der Phasen 2 und 3
überhaupt erst messbar macht.

### 0.1 UI-Guards auf bundled-features ausweiten

**Datei:** `infra/guards/run-ui-guards.ts`

Die sechs UI-Guards bekommen `packages/bundled-features/src` als zusätzlichen
Scan-Root, wenn das Repo `kumiko-framework` ist. Mechanik analog
`guard-primitives-discipline.ts:33` (`scope: "bundled-features"`).

**Datei:** `kumiko-framework/bin/kumiko-legacy.ts` (~Zeile 227-254)

`run-ui-guards` in die Framework-eigene `bun kumiko check`-Kette aufnehmen.

**Erwartung:** Der Lauf ist rot. Das ist der Zweck. Der Output ist die
verbindliche Arbeitsliste für Phase 3.

### 0.2 Bestandsaufnahme statt Blanko-Baseline

Jeder der 17 custom-Screens bekommt **entweder** ein Ticket in Phase 3
**oder** einen Allowlist-Tag mit echter Begründung:

```ts
// kumiko-lint-ignore app-feature-structure <Grund, warum deklarativ nicht reicht>
```

Kein Baseline-File, keine Sammelausnahme. Ein Tag pro Screen, jeder mit einem
Satz, der einen Reviewer überzeugen muss. Wo kein solcher Satz existiert, ist
der Screen ein Umbau-Ticket.

Für die vier Screens aus Phase 2 gibt es keinen Tag. Sie werden umgebaut.

### 0.3 Doku-Referenz korrigieren

**Datei:** `kumiko-framework/docs/reference/app-feature-structure.md:8`

`src/tenant/` als Referenzbeispiel ersetzen, sobald Phase 2.1 durch ist (dann
ist tenant tatsächlich vorbildlich). Bis dahin auf `src/sessions/` zeigen.

---

## Phase 1: Framework-Fixes

Diese vier Punkte sind die Ursachen hinter den gemeldeten Symptomen. Sie
gehören vor die Screen-Umbauten, weil die Umbauten sonst in dieselben Löcher
laufen.

### 1.1 PagedRows-Contract absichern

**Symptom:** `/session-list` ist leer, obwohl der User eingeloggt und Admin
ist und Rows existieren.

**Ursache:** `bundled-features/src/sessions/handlers/list.query.ts:14-25` gab
ein nacktes Array zurück. Der Renderer liest
`rowsQuery.data?.rows ?? []` (`renderer/src/app/kumiko-screen.tsx`). Auf einem
Array ist `.rows` `undefined`, der Fallback griff, die Tabelle blieb leer. Die
Query selbst antwortete mit 200. Kein Fehler, kein Log, nichts.

**Ein Einzelfall, kein Sweep.** In `packages/bundled-features` gibt es genau
einen `projectionList`-Screen (`sessions/feature.ts:218`), gebunden an
`sessions/handlers/list.query.ts`. Nur dieser Handler war betroffen. Die
sieben anderen Kandidaten mit nacktem Array-Return
(personal-access-tokens/list, secrets/list, sessions/mine, template-resolver/
list, tenant/members, tenant/active-tenant-ids, tenant/resolve-user-ids)
speisen keinen `projectionList`-Screen, der nackte Array-Return ist dort kein
Bug.

**Fix:** Kein Boot-Check, sondern ein Laufzeit-Guard im Renderer
(`ProjectionListBody` in `kumiko-screen.tsx`), der die tatsächliche Antwort
prüft (`rowsQuery.data.rows` muss ein Array sein) und statt einer leeren
Tabelle einen Error-Banner zeigt, wenn nicht. Kein Boot-Check, weil
`QueryHandlerDef` kein deklariertes Output-Schema trägt
(`packages/types/src/handlers.ts`): ein Boot-Check könnte korrekten Code
(fremde Repos liefern bereits `{ rows, nextCursor }`, ohne ein Runtime-Brand
zu tragen; die Inline-Form `r.queryHandler(name, schema, fn, opts)` kann
strukturell nie ein Brand tragen) nicht von falschem unterscheiden und würde
False Positives auf korrektem Code produzieren. `definePagedQueryHandler` /
`isPagedQueryHandler` (`framework/src/engine/define-handler.ts`) bleiben als
optionale Typ-Hilfe erhalten, ohne Boot-Verdrahtung.

`sessions/handlers/list.query.ts` ist auf `definePagedQueryHandler`
umgestellt und liefert jetzt `{ rows, nextCursor: null }`.

**Test:** Component-Test im Renderer (`ProjectionListBody`), der eine Query
mit nacktem Array-Return rendert und den Error-Banner
(`kumiko-screen-projection-list-bad-shape`) statt einer leeren Tabelle
erwartet. Plus der bestehende Integration-Test auf `session-list`, der über
echtes HTTP `{ rows: [...] }` bekommt und mindestens eine Zeile sieht.

### 1.2 `searchable: true` ohne Suchindex ablehnen

**Symptom:** `/export-job-list`, Sucheingabe wirft.

**Ursache:** `user-data-rights/screens.ts:32` setzt `searchable: true`. Die
Entity `export-job` hat aber weder searchable Felder noch einen verdrahteten
SearchAdapter. `event-store-executor-read.ts:81-92` wirft dann bewusst
`UnprocessableError("search_adapter_not_wired")` (das ist fw#2032, korrektes
Fail-Loud). Der Renderer hat mit `schema.searchAdapterMissing` bereits ein
Gate (`kumiko-screen.tsx:1303-1310`), das aber app-global ist und nicht pro
Entity greift.

**Fix:** Boot-Validator lehnt `searchable: true` ab, wenn die Entity keine
`searchable: true`-Felder hat. Das ist die statisch prüfbare Bedingung und
deckt den Fall ab. Fehlermeldung nennt Screen-Id, Entity und die Auflösung
(Feld auf `searchable` setzen oder `searchable` am Screen weglassen).

**Der Check gilt nur für `entityList`.** Eine `projectionList` hat keine
Entity, ihre Suche läuft im Query-Handler und braucht keinen SearchAdapter.
Ohne diese Einschränkung würde 1.2 den `/members`-Screen aus 2.6d beim Boot
failen lassen, der genau so gebaut ist.

**Sofortmaßnahme im selben PR:** `searchable: true` in
`user-data-rights/screens.ts:32` entfernen. Der Default (`false`, weil keine
searchable Felder) ist korrekt.

**Offen:** Ob `export-job` stattdessen einen Suchindex bekommen soll, ist eine
Produktentscheidung. Siehe offene Fragen.

### 1.3 configEdit-Generator: Breite und Section-Description

**Symptom:** `/tenant-settings-tenant` ist schmal und hat keine
Card-Description.

**Ursache:** `framework/src/engine/build-config-feature-schema.ts`,
`buildScreen()` (~Zeile 228-244) erzeugt:

```ts
const section: EditFieldsSection = {
  title: `${feature}.settings`,
  fields: keys.map(fieldId),
};
return { id: shortId, type: "configEdit", scope, configKeys, fields,
         fieldLabels, layout: { sections: [section] }, access };
```

Weder `description` (existiert: `types/src/screen.ts:571`) noch `width`
(existiert: `types/src/screen.ts:611`) werden gesetzt.

**Fix, drei Zeilen:**

```ts
const section: EditFieldsSection = {
  title: `${feature}.settings`,
  description: `${feature}.settings.description`,
  fields: keys.map(fieldId),
};
// ...
layout: { sections: [section], width: "full" },
```

**Nachzug:** Jedes Feature mit masked Config-Keys braucht den neuen i18n-Key
`<feature>.settings.description`. Betroffen sind alle Features, die
`createTenantConfig`/`createSystemConfig`/`createUserConfig` mit `mask`
nutzen. Der Renderer muss einen fehlenden Key still ignorieren, nicht den
rohen Key rendern (Memory: `reference_kumiko_nav_label_needs_dot_to_be_translated`
beschreibt genau diese Klasse). Prüfen, ob `description` denselben
Fallback-Pfad nimmt wie `title`, sonst dort mitfixen.

### 1.4 Locale als Select

**Symptom:** Default-Locale ist ein freies Textfeld.

**Ursache:** `bundled-features/src/tenant-settings/config.ts:36-41`:

```ts
locale: createTenantConfig("text", {
  default: opts.defaultLocale ?? "en",
  pattern: LOCALE_PATTERN,   // ^[a-z]{2}(-[A-Z]{2})?$
  ...
}),
```

`currency` daneben ist bereits `createTenantConfig("select", { options: DEFAULT_CURRENCIES })`.
Der Generator unterstützt Select (`deriveField`, `build-config-feature-schema.ts:245-258`).
Es fehlt schlicht die Options-Liste.

**Fix, symmetrisch zu currency:**

1. `DEFAULT_LOCALES` in `framework/src/engine/field-helpers.ts` neben
   `DEFAULT_CURRENCIES` (Zeile 5).
2. `TenantSettingsKeyOptions.locales?: readonly string[]` analog `currencies`.
3. `locale: createTenantConfig("select", { default: ..., options: opts.locales ?? DEFAULT_LOCALES, ... })`.
4. `LOCALE_PATTERN` entfällt, das Select validiert strenger.

**Offen:** Was gehört in `DEFAULT_LOCALES`? Es gibt heute keine zentrale
Locale-Konstante im Framework. Die Bundles fahren `de`/`en`/`es`. Siehe
offene Fragen.

---

### 1.5 `lastSeenAt` auf der Session

Ein Feld für Aktivität existiert nirgends. `store_user_sessions`
(`sessions/schema/user-session.ts:42`) hat `createdAt` und `expiresAt`, es
entsteht eine Row pro Login (`sessions/session-callbacks.ts:79`), Logout
setzt nur `revokedAt` statt zu löschen (`session-callbacks.ts:112`), und der
Cleanup-Job ist manuell getriggert (`sessions/feature.ts:171`) und löscht nur
nach Ablauf plus Retention-Fenster (`sessions/jobs/cleanup.ts:13`).

MAX(createdAt) wäre damit als "letzter Login" technisch brauchbar. Es ist
aber der Login und nicht die Aktivität. Entscheidung: eigenes Feld.

- `lastSeenAt: createTimestampField()` auf `user-session.ts`, plus Migration.
  Nullable, weil Bestands-Sessions keinen Wert haben.
- **Verifiziert, dass ein Per-Request-Hook existiert:** `authMiddleware` ruft
  bei jedem `/api/*`-Request `sessionChecker` auf (`api/server.ts:660`,
  `api/auth-middleware.ts:293`), und der lädt die Session-Row bereits per
  `fetchOne` (`session-callbacks.ts:118`), ohne Cache oder TTL davor.
  `lastSeenAt` ist damit echte Aktivität und nicht bloss der letzte Refresh.
- Ort: `sessions/session-callbacks.ts`, in `sessionChecker` nach der
  Validierung und vor dem `return { status: "live" }` (heute Zeile 178).
- Der bestehende `fetchOne` zieht `lastSeenAt` einfach mit. **Kein zusätzlicher
  SELECT**, nur ein bedingter UPDATE, wenn der gelesene Wert älter als eine
  Stunde ist. Ein Write pro Session und Stunde statt einem pro Request. Die
  Schwelle als Konstante im Modul, nicht als Config, solange niemand danach
  fragt.
- Der Write läuft ausserhalb der Request-Transaktion und darf fehlschlagen,
  ohne den Request zu kippen. Ein verpasstes Aktivitäts-Update ist kein Fehler.
- Test über `setupTestStack` und echtes HTTP: zwei Requests kurz
  hintereinander erzeugen genau einen Write, ein dritter nach simuliertem
  Zeitsprung einen zweiten.

Nutzen über `/members` hinaus: `/session-list` bekommt dieselbe Spalte
gratis, und die Retention-Policies unter `data-retention/`, die "last login"
heute nur in Prosa erwähnen, bekommen ein reales Feld.

---

## Phase 2: die sechs Screens

Reihenfolge nach Aufwand aufsteigend, damit früh etwas sichtbar wird.

### 2.1 `/session-list` (S)

Bereits `projectionList` und richtig deklariert
(`bundled-features/src/sessions/feature.ts:216-238`). Der einzige Fehler ist
der Query-Contract.

- Der leere Table ist durch **1.1** erledigt.
- `mine.query.ts` bleibt liegen. Der nackte Array-Return ist dort kein Bug,
  weil kein `projectionList`-Screen daran hängt. Wird mitgezogen, sobald
  einer entsteht.
- **Offen: Sort und Pager fehlen weiterhin.** `sortable`/`paginated` leitet
  buildAppSchema aus dem Zod-Schema des Handlers ab. `user-session:list` hat
  `z.object({})`, also weder `sort` noch `cursor`, also bleibt die Liste ohne
  beides. `definePagedQueryHandler` ändert daran nichts, es prägt nur den
  Rückgabetyp. Wer Sort und Pager will, muss das Input-Schema um `sort`,
  `cursor` und `limit` erweitern und den Handler danach auswerten lassen.
- Nav-Icon ist gesetzt (`icon: "list"`), Breite ist korrekt (kein
  FormScreenShell). Beides bereits in Ordnung.

**Aufwand:** S. Der Contract-Teil fällt aus 1.1 heraus, Sort und Pager sind
ein eigener kleiner Schnitt.

### 2.2 `/export-job-list` (S)

Bereits `entityList` (`user-data-rights/screens.ts:17-34`), Nav mit
`icon: "download"`, Standard-Empty-State
(`query-table.tsx:97`, `t("kumiko.list.no-entries")`).

- Erledigt durch **1.2** (`searchable` raus).
- Marc meldet zusätzlich "no entries nicht standard". Der Screen nutzt aber
  bereits den Standard-EmptyState. Vermutlich hat er den Fehlerzustand nach
  der geworfenen Suche gesehen, nicht den Empty-State. **Nach dem Fix
  gegenprüfen**, bevor hier weiter etwas geändert wird.

**Aufwand:** fällt aus 1.2 heraus, plus Verifikation.

### 2.3 `/tenant-settings-tenant` (S)

Auto-generierter `configEdit`, kein handgeschriebenes TSX. Der Fix sitzt
komplett im Generator.

- Breite: **1.3**
- Card-Description: **1.3** plus i18n-Key `tenant-settings.settings.description`
- Locale als Select: **1.4**
- "i18n fehlt teilweise": konkret ist unklar, welcher String roh erscheint.
  Kandidat ist der Section-Titel `tenant-settings.settings`, der als Key in
  keinem Bundle steht. **Beim Umsetzen mit einem Screenshot verifizieren**
  und alle rohen Keys nachtragen.

**Aufwand:** fällt aus 1.3/1.4 heraus, plus i18n-Nachzug.

### 2.4 `/delivery-log` (S bis M)

Heute: `custom` (`delivery/feature.ts:135-140`), 103 Zeilen TSX
(`delivery/web/delivery-log-screen.tsx`), `FormScreenShell` ohne `maxWidth`,
eigenes Empty-Markup (`<Text variant="small">`), keine Suche, Nav ohne Icon.
Query `delivery:query:log` (`handlers/log.query.ts:8-46`) kennt nur `limit`
und gibt `{rows}` ohne `nextCursor`/`total`.

**Zielform:** `projectionList`.

1. `log.query.ts` auf `definePagedQueryHandler` umstellen (aus 1.1), mit
   `cursor`, `limit`, `sort`. Rückgabe `{rows, nextCursor, total}`.
2. `r.screen({ id: "delivery-log", type: "projectionList", query: DeliveryQueries.log, columns: [...], defaultSort: {...}, access })`.
   Spalten aus dem TSX übernehmen: `type`, `channel`, `recipient`, `status`.
   Das Mapping von `notificationType`/`recipientAddress` auf die
   Anzeige-Namen wandert vom Client in den Query-Handler (der formt die
   Read-Projection, so wie es die Contract-Doku für Dashboard-Panels
   ausdrücklich festhält).
3. Status-Spalte mit `StatusBadge`-Renderer, analog `EuroCell` in credit-list:
   `{ field: "status", renderer: { react: { __component: "DeliveryStatusCell" } } }`.
   Diese eine kleine Zelle bleibt TSX, das ist der vorgesehene Weg.
4. `delivery-log-screen.tsx` und der Eintrag in `web/client-plugin.tsx`
   löschen. Die Zellen-Komponente bleibt registriert.
5. Nav-Icon setzen (`delivery/feature.ts:141-146`), Vorschlag `"send"`.
6. i18n: Spalten-Keys `delivery.log.col.*` liegen laut Analyse nicht in
   `src/delivery/i18n.ts`, sondern (vermutlich) in `web/i18n.ts`. Beim Umbau
   in das server-registrierte Bundle ziehen, sonst kennt der deklarative
   Renderer sie nicht.
7. Suche: nur wenn der Query-Handler einen `search`-Param bekommt, sonst
   `searchable` weglassen (siehe 1.2, sonst wiederholt sich der
   export-job-Fehler).

**Aufwand:** M, überwiegend Query-Umbau plus i18n-Umzug.

### 2.5 `/profile-picker` (M)

Marc: "hier stimmt nichts, alle Fehler aus allen anderen Punkten treffen hier
zu."

Wichtig: **das ist keine Liste.** Es ist ein Compliance-Regime-Picker
(`compliance-profiles/web/compliance-profile-screen.tsx`, 152 Zeilen): ein
Select über verfügbare Profile, ein Save-Button auf
`compliance-profiles:write:set-profile`, darunter ein Katalog aller Profile
mit Region und Aufsichtsbehörde.

**Zielform:** `actionForm` oder `configEdit`, nicht entityList.

- `configEdit` passt, wenn das Profil als Config-Key modelliert wird. Dann
  landet der Screen automatisch im Settings-Hub und erbt 1.3 und 1.4
  (Breite, Description, Select) geschenkt. Das ist der sauberste Weg, kostet
  aber eine Umstellung von `r.entity("tenant-compliance-profile")` auf einen
  Config-Key.
- `actionForm` ist der kleinere Eingriff: Select-Feld plus Submit auf den
  bestehenden Write-Handler, `layout: { width: "full" }`.
- Der Profil-Katalog darunter ist kein Formularfeld. Er wird eine
  `kind: "extension"`-Section (`types/src/screen.ts:576-580`) mit einer
  kleinen Katalog-Komponente. Das ist der vorgesehene Weg für so einen Block
  und ersetzt 152 Zeilen durch etwa 40.
- Nav-Icon fehlt (`compliance-profiles/feature.ts:82-87`), Vorschlag
  `"shield-check"`.

**Empfehlung:** `actionForm` plus Extension-Section. `configEdit` erst, wenn
das Compliance-Profil ohnehin als Config-Key modelliert werden soll, das ist
eine eigene Entscheidung.

**Aufwand:** M.

### 2.6 `/members` (M bis L, das eigentliche Stück Arbeit)

Heute: `custom` (`tenant/feature.ts:141-146`), 270 Zeilen TSX
(`tenant/web/members-screen.tsx`), drei Cards untereinander in einem
`FormScreenShell` (3xl, zentriert):

1. Card "Aktive Mitglieder" mit `DataTable` (email, roles)
2. Ein Invite-Form mitten auf der Seite
3. Card "Ausstehende Einladungen" mit `DataTable` plus Cancel-Action

Marc will: **eine** Liste, Header-Button öffnet einen Drawer für die neue
Einladung, Pendings als Filter in derselben Liste, volle Breite,
Standard-Listen-Chrome.

**Die technische Hürde, die den Aufwand bestimmt:** Members und Invitations
sind **zwei Entities** (`r.entity("tenant-membership")` und
`r.entity("tenant-invitation")`, `tenant/feature.ts:49-50`). `entityList`
bindet genau eine. "Pendings als Filter in einer Liste" geht also nur über
eine kombinierte Read-Projection.

**Zusatzhürde:** `ProjectionListScreenDefinition` hat **kein** `filter` und
keine Facetten. Der Renderer sagt das explizit
(`kumiko-screen.tsx:973-974`: "Entity-only additions (screen.filter, faceted
filters) layer on top of the shared buildListQueryPayload, projectionList has
neither"). Ein Filter-Dropdown auf einer projectionList ist heute nicht
möglich.

**Daraus folgen drei Teilstücke:**

**2.6a Kombinierte Query** (Server)

Neuer Handler `tenant:query:team:list` via `definePagedQueryHandler` (aus
1.1). Liest `tenant_memberships` und `tenant_invitations`, mappt beide auf
eine gemeinsame Row:

```ts
{ id, email, displayName, roles, status: "active" | "pending", createdAt, lastSeenAt, expiresAt? }
```

**Achtung, korrigierter Befund:** ein `joinedAt` gibt es nicht. Die
Membership hat nur die impliziten `createEntity`-Spalten `id`, `tenantId`,
`createdAt`, `updatedAt` plus `userId` und `roles`
(`tenant/schema/membership-table.ts:18-32`). `createdAt` ist damit das
Beitrittsdatum bei einer Membership und das Einladungsdatum bei einer
Invitation, was für eine gemeinsame Spalte genau richtig ist.

`lastSeenAt` kommt aus MAX über die Sessions des Users (Feld aus 1.5), also
über einen zweiten Select nach demselben Muster, mit dem der Handler heute
schon `email` und `displayName` nachlädt (`members.query.ts:35-50`). Bei
Invitations bleibt es leer, weil es dort noch keinen User gibt. Kein JOIN,
das Merge passiert wie gehabt in JS.

Params: `limit`, `offset`, `sort`, `search`, `status?`.

**Kein Cursor.** Ein Cursor über eine erst in JS zusammengeführte Liste aus
zwei Tabellen ist entweder falsch (er gilt nur für eine der beiden Quellen und
verschluckt Pendings) oder er liest ohnehin alles. Der Handler liest also
beide Tabellen vollständig, merged, sortiert und schneidet die Seite heraus.
`ponytail:` das trägt bis in die Größenordnung einiger tausend Mitglieder pro
Tenant. Wird ein Tenant größer, ist der Ausweg eine echte kombinierte
Read-Projection (eine Tabelle, ein `status`-Feld, dann wieder Cursor), nicht
ein Cursor über den Merge.
`members.query.ts` und `invitations.query.ts` bleiben vorerst bestehen (sie
haben andere Konsumenten), werden aber im selben Zug auf den Paged-Helper
gezogen (unabhängig von 1.1, das nur den einen tatsächlich betroffenen
Handler abdeckt).

**2.6b `filter` für projectionList** (Framework)

`ProjectionListScreenDefinition` bekommt `filter?: ScreenFilter` und
Facetten-Support, analog `EntityListScreenDefinition`
(`types/src/screen.ts:283-288`). Im Renderer heißt das: den heute
entity-exklusiven Zweig in `EntityListBody` (`kumiko-screen.tsx:952-1000`)
so weit hochziehen, dass `ProjectionListBody` ihn mitnutzt. Die
Facetten-Werte kommen bei einer Projection nicht aus `entity.fields`,
sondern müssen am Screen deklariert werden (der Boot-Validator kann sie
mangels Entity nicht ableiten).

Das ist eine eigenständige Framework-Erweiterung mit Nutzen weit über
/members hinaus. Sie sollte ein eigenes Issue sein.

*Alternative ohne 2.6b:* Zwei Screen-Registrierungen auf derselben Query mit
festem `status`-Param, verlinkt über `toolbarActions`. Billiger, aber es ist
nicht das, was Marc beschrieben hat (ein Filter in einer Liste).

**2.6c Drawer für "neue Einladung"** (Framework)

Marc will explizit einen Drawer, ausgelöst von einem Header-Button.

Heute nicht möglich. Die Screen-Typ-Union kennt keinen Drawer
(`types/src/screen.ts`: entityList, projectionList, projectionDetail,
dashboard, entityEdit, actionForm, custom, configEdit), und `ToolbarAction`
kann nur `navigate` oder `writeHandler`
(`types/src/screen.ts:239-262`). Das `Drawer`-Widget existiert in
`renderer-web/src/widgets/`, ist aber nur aus custom-TSX erreichbar.

Zwei Wege:

- **Zielbild:** `ToolbarAction` bekommt `kind: "drawer"` mit
  `screen: "<actionForm-id>"`. Der Renderer mountet den referenzierten
  `actionForm` im `Drawer`-Widget statt zu navigieren. Als `presentation`-Flag
  am actionForm wäre es ebenfalls denkbar, aber die Entscheidung
  "Vollseite oder Drawer" gehört zum Aufrufer, nicht zum Formular.
  Wiederverwendbar für jedes "+ Neu neben einer Liste", also für praktisch
  jede App im Workspace.
- **Zwischenschritt:** `toolbarActions: [{ kind: "navigate", screen: "invite-create" }]`
  auf einen normalen `actionForm`-Screen. Funktioniert heute ohne
  Framework-Änderung, ist aber eine Vollseite statt eines Drawers.

**Empfehlung:** Zwischenschritt im selben PR wie 2.6a, `kind: "drawer"` als
eigenes Framework-Issue direkt danach. So ist /members schnell benutzbar und
der Drawer kommt als Framework-Fähigkeit, nicht als Sonderfall in einem
Screen.

**2.6d Der Screen selbst**

```ts
r.screen({
  id: "members",
  type: "projectionList",
  query: TenantQueries.teamList,
  columns: [
    { field: "email", label: "tenant.members.col.email" },
    { field: "roles", label: "tenant.members.col.roles" },
    { field: "status", label: "tenant.members.col.status",
      renderer: { react: { __component: "MemberStatusCell" } } },
    { field: "createdAt", label: "tenant.members.col.created" },
    { field: "lastSeenAt", label: "tenant.members.col.lastActivity" },
  ],
  defaultSort: { field: "createdAt", dir: "desc" },
  searchable: true,          // nur wenn 2.6a einen search-Param hat
  filter: { ... },           // braucht 2.6b
  rowActions: [
    { kind: "writeHandler", id: "cancel-invitation",
      handler: "tenant:write:cancel-invitation", payload: { pick: ["id"] },
      confirm: "tenant.members.cancel.confirm", style: "danger",
      visible: { field: "status", eq: "pending" } },
  ],
  toolbarActions: [
    { kind: "navigate", id: "invite", label: "tenant.members.invite.title",
      screen: "invite-create", style: "primary" },
  ],
  access: { roles: access.admin },
});
```

`visible` auf der Row-Action (`types/src/screen.ts:226`) löst
"Cancel nur bei Pendings" ohne jede Sonderlogik.

**Spalten `created` und `last activity`:** beide fallen aus 2.6a heraus.
`last activity` heisst bewusst so und nicht `last login`, weil das Feld aus
1.5 bei Aktivität fortgeschrieben wird. Leer, solange ein Mitglied sich seit
Einführung des Feldes nicht angemeldet hat, und leer für Pendings.

**"edit user" ist bewusst nicht Teil dieses Umbaus (Entscheidung
2026-08-19).** `updateMemberRoles`
(`tenant/handlers/update-member-roles.write.ts`) steht auf
`access: { roles: ["system", "SystemAdmin"] }` (Zeile 33), und
`tenant/feature.ts:25` trägt dazu den Kommentar
`// no role-edit — updateMemberRoles stays SystemAdmin-only`. Das zu öffnen
wäre eine Rechteänderung, die Self-Demotion- und Last-Admin-Schutz im Handler
verlangt (beides fehlt heute, verifiziert). Kommt als eigenes Issue, wenn es
gebraucht wird, nicht als Nebenzweig einer Standardisierung.

**Aufwand:** 2.6a + 2.6d = M. Mit 2.6b und 2.6c = L. 1.5 ist Vorbedingung für
die Aktivitäts-Spalte.

---

## Phase 3: die restlichen 11 custom-Screens

**Nicht in Scope dieser Arbeit.** Marcs Auftrag sind die sechs Mount-Punkte.
Diese Liste macht die Trennlinie sichtbar und ist das Ergebnis, das Phase 0.1
belastbar macht.

| Feature | Screen | Zeilen TSX | Zielform (Einschätzung) |
|---|---|---|---|
| `user-data-rights` | privacy-center | 397 | dashboard + projectionList |
| `folders` | folder-manager | 561 | entityList + Drawer (braucht 2.6c) |
| `tags` | tag-manager | 390 | entityList |
| `template-resolver` | editor | 513 | custom bleibt (Code-Editor) |
| `personal-access-tokens` | pat-tokens | 296 | projectionList + actionForm |
| `audit` | audit-log | 250 | projectionList |
| `audit` | audit-log-detail | 131 | projectionDetail |
| `jobs` | job-runs | 290 | projectionList |
| `jobs` | job-run-detail | 180 | projectionDetail |
| `tier-engine` | tier-admin | 168 | entityList |
| `feature-toggles` | toggle-admin | 136 | entityList |
| `admin-shell` | platform-overview | 90 | dashboard |
| `admin-shell` | tenant-overview | 90 | dashboard |
| `auth-mfa` | mfa-* | diverse | custom bleibt (Auth-Flows) |

`template-resolver` und die Auth-Flow-Screens bekommen einen Allowlist-Tag
mit Begründung. Der Rest sind Umbau-Tickets.

Grobe Summe: rund 3.400 Zeilen TSX, von denen der überwiegende Teil
ersatzlos entfällt.

---

## Entschieden

Stand 2026-08-19, alle Punkte sind entschieden. Es gibt keine offenen Fragen
mehr, die die Umsetzung blockieren.

1. **`/members`** ist die Team-Liste des eigenen Tenants, keine
   tenant-übergreifende Admin-Liste. Zusätzliche Spalten `created` und
   `last activity`, letztere gespeist aus `lastSeenAt` (1.5).

2. **Rollen-Bearbeitung: nicht in diesem Umbau.** `updateMemberRoles` bleibt
   SystemAdmin-only. Eine Öffnung für Tenant-Admins ist eine Rechteänderung
   und bekommt bei Bedarf ein eigenes Issue, zusammen mit Self-Demotion- und
   Last-Admin-Schutz.

3. **`DEFAULT_LOCALES`: App-Parameter mit Default `["de", "en"]`**,
   symmetrisch zu `currencies` in `TenantSettingsKeyOptions`. Spanisch ist im
   Framework unvollständig, und eine angebotene, aber leere Sprache ist
   schlechter als eine fehlende. Apps mit mehr Bundles setzen den Parameter.

4. **`export-job` bekommt keine Suche.** `searchable` fliegt raus, Sortierung
   und Pager reichen für eine SystemAdmin-Liste von Export-Jobs. Ein
   Meili-Index für eine Handvoll Jobs pro Tenant wäre Aufwand ohne Nutzen.

5. **Drawer in zwei Schritten.** `/members` bekommt zuerst einen normalen
   `actionForm` als Vollseite über `toolbarActions: [{ kind: "navigate" }]`,
   damit der Screen ohne Framework-Änderung benutzbar ist.
   `ToolbarAction kind: "drawer"` folgt als eigenes Framework-Issue und
   ersetzt dann nur die eine Zeile.

---

## Reihenfolge und Schnitt in Issues

**Phase 0 läuft zuletzt, nicht zuerst.** Würde man die Guards sofort scharf
schalten, bräuchten alle 17 custom-Screens einen Allowlist-Tag, von denen
sechs in den Folge-PRs wieder verschwinden. Erst umbauen, dann zuschließen.

```
1.1         definePagedQueryHandler + Renderer-Guard (Einzelfall)  S   → erledigt
2.1         session-list: sort/cursor ins Input-Schema             S
1.2         searchable-Boot-Check + export-job-list fix           S   → schließt 2.2
1.3 + 1.4   configEdit width/description + Locale-Select          S   → schließt 2.3
1.5         lastSeenAt auf der Session + stündlicher Touch        S   ← blockiert 2.6d
2.4         delivery-log auf projectionList                       M
2.5         profile-picker auf actionForm                         M
2.6a+d      members: kombinierte Query + projectionList           M
2.6b        filter/Facetten für projectionList                    M   (eigenes Issue)
2.6c        ToolbarAction kind:"drawer"                           M   (eigenes Issue)
0.1 + 0.2   UI-Guards auf bundled-features, Bestandsaufnahme      S
0.3         Doku-Referenz umhängen                                S
```

Nicht in diesem Vorhaben: die Öffnung von `updateMemberRoles` für
Tenant-Admins und die 11 custom-Screens aus Phase 3.

Vier der sechs gemeldeten Screens sind nach den Framework-Fixes aus Phase 1
erledigt, ohne dass ein Screen angefasst wird. Das ist das Argument dafür,
Phase 1 nicht zu überspringen.

## Definition of Done

- `bun kumiko check` im Framework läuft die UI-Guards über
  `packages/bundled-features` und ist grün (Rest per begründetem
  Allowlist-Tag).
- Die sechs Screens sind lokal per Screenshot verifiziert, nicht nur per
  grüner Suite. Volle Breite, Standard-Suche, Standard-Empty-State,
  Nav-Icon, keine rohen i18n-Keys.
- `session-list` zeigt Zeilen.
- `/members` zeigt Aktive und Pendings in einer Liste, mit `created`,
  `last activity` und Einladungs-Button im Header.
- `lastSeenAt` wird höchstens einmal pro Session und Stunde geschrieben,
  belegt durch einen Test, nicht durch Augenschein.
- Die Suche auf `export-job-list` wirft nicht mehr.
- Renderer-Test für 1.1 (Bad-Shape-Query rendert die Fehler-Banner statt
  einer leeren Tabelle) und ein Boot-Validator-Test für 1.2 (ein Fall, der
  boot-failen muss).
- Ein Integration-Test pro umgebautem Screen über echtes HTTP plus
  `setupTestStack`, kein `createTestDispatcher`.
