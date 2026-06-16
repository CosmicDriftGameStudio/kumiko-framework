# @cosmicdrift/kumiko-renderer-web

## 0.56.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.56.0
- @cosmicdrift/kumiko-renderer@0.56.0
- @cosmicdrift/kumiko-dispatcher-live@0.56.0

## 0.55.1

### Patch Changes

- acdc14c: fix(renderer-web): doppelter Kalender-Header im Date-/Timestamp-Picker

  react-day-picker v9 rendert im `captionLayout="dropdown"`-Modus je Monat/Jahr
  ein `<select>` UND ein begleitendes `aria-hidden`-`<span>` mit demselben Label;
  sichtbar wird nur eines, weil rdps eigene `style.css` das `<select>` transparent
  darüberlegt. Da `CalendarPopover` die rdp-Klassen mit eigenen Tokens überschreibt,
  greift diese Positionierung nicht → Monat/Jahr doppelt (Folgebug aus #369).

  Fix: rdps `Dropdown` per `components`-Prop durch ein einzelnes gestyltes `<select>`
  ersetzen — kein Begleit-Span mehr, CSS-unabhängig korrekt. Neuer Browser-e2e
  (`date-picker.spec.ts`) pinnt es (genau 2 Selects, kein aria-hidden-Label daneben,
  plus Tippen→ISO und Jahres-Sprung). Betrifft `date`- und `timestamp`-Picker
  gleichermaßen (geteilter `CalendarPopover`).

  - @cosmicdrift/kumiko-dispatcher-live@0.55.1
  - @cosmicdrift/kumiko-headless@0.55.1
  - @cosmicdrift/kumiko-renderer@0.55.1

## 0.55.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.55.0
- @cosmicdrift/kumiko-renderer@0.55.0
- @cosmicdrift/kumiko-dispatcher-live@0.55.0

## 0.54.0

### Minor Changes

- 1135437: Date/Calendar-Inputs vereinheitlicht (#369): `date` und `timestamp` teilen jetzt
  eine gemeinsame, tippbare Eingabe mit Jahres-/Dekaden-Dropdown im Kalender. Datümer
  sind überall direkt tippbar (locale-aware Parse), nicht mehr nur per Klick. Neu pro
  Feld konfigurierbar: `min`/`max` (Picker-Range + Zod-Durchsetzung beim Write) und
  `locale` (Anzeige-/Eingabe-Format) auf `date`/`timestamp`/`locatedTimestamp`-Feldern.

### Patch Changes

- Updated dependencies [1135437]
  - @cosmicdrift/kumiko-renderer@0.54.0
  - @cosmicdrift/kumiko-headless@0.54.0
  - @cosmicdrift/kumiko-dispatcher-live@0.54.0

## 0.53.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.53.0
- @cosmicdrift/kumiko-headless@0.53.0
- @cosmicdrift/kumiko-renderer@0.53.0

## 0.52.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.52.0
- @cosmicdrift/kumiko-headless@0.52.0
- @cosmicdrift/kumiko-renderer@0.52.0

## 0.51.0

### Minor Changes

- 9916c33: App-Shell: optional `fill` + Sidebar-Nav-Icons.

  - `AppLayout` und `DefaultAppShell` bekommen ein optionales `fill?: boolean`.
    `fill` → Wurzel `h-screen` (fixe Viewport-Höhe), Sidebar/Topbar bleiben
    stehen, der Main-Bereich scrollt INNEN (`min-h-0` + `overflow-auto`) statt
    der ganzen Seite. Default (`false`) bleibt der bisherige `min-h-screen`-Flow
    — bestehende Apps ändern sich nicht. Clippt nie (Content scrollt in `main`).
    Plus `className`/`mainClassName` als Erweiterungspunkte (cn-merge).
  - `NavTree` rendert jetzt Icons: ein Nav-Eintrag mit `icon: "<key>"` zeigt das
    passende lucide-Icon vor dem Label (vorher nur ein Punkt). Kuratierte
    Registry (`dashboard`, `list`, `calculator`, `wallet`, `sparkles`, …);
    unbekannte Keys fallen sauber auf den Punkt zurück (kein Boot-Fail).

### Patch Changes

- @cosmicdrift/kumiko-headless@0.51.0
- @cosmicdrift/kumiko-renderer@0.51.0
- @cosmicdrift/kumiko-dispatcher-live@0.51.0

## 0.50.0

### Patch Changes

- 0d92100: dev/prod-parity: validateBoot in dev-server + standalone-stable renderer-web @source + CSS-completeness guard (#359)

  Two prod-only breakages closed, both caused by the dev path validating/building
  differently than the prod path:

  - **Boot-validation parity**: `runDevApp` now runs the same `validateBoot` as
    `runProdApp`, before the fs-watcher and server start. Unqualified nav-/handler
    QNs, unresolvable navigate-targets and screen-access errors now fail fast in
    dev instead of only crashing the prod pod (CrashLoopBackOff).
  - **renderer-web stylesheet scans its own shell standalone**: `renderer-web/src/styles.css`
    scanned its shell classes via a monorepo-relative `@source` (`../../renderer-web/src`),
    which only resolves through the workspace symlink. A standalone consumer install
    found nothing → unstyled prod (15KB vs 48KB). It is now self-relative (`./`),
    which resolves in every install layout since the package ships `src`. Behaviour
    in the monorepo is identical (`./` ≡ the old path at the real location).
  - **Build-time CSS-completeness guard**: when `kumiko-build` falls back to the
    packaged renderer-web stylesheet, it now asserts the compiled CSS contains the
    shell sentinel class and fails loud (with a `src/styles.css` hint) instead of
    shipping an unstyled image.
  - @cosmicdrift/kumiko-headless@0.50.0
  - @cosmicdrift/kumiko-renderer@0.50.0
  - @cosmicdrift/kumiko-dispatcher-live@0.50.0

## 0.49.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.49.0
- @cosmicdrift/kumiko-renderer@0.49.0
- @cosmicdrift/kumiko-dispatcher-live@0.49.0

## 0.48.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.48.1
- @cosmicdrift/kumiko-renderer@0.48.1
- @cosmicdrift/kumiko-dispatcher-live@0.48.1

## 0.48.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.48.0
- @cosmicdrift/kumiko-renderer@0.48.0
- @cosmicdrift/kumiko-dispatcher-live@0.48.0

## 0.47.0

### Minor Changes

- f32f99d: Apex-Surface v1 — der evidente Weg für öffentlichen, schema-losen Apex-Content (Login/Register/Passwort-vergessen/Konto-löschen) in jeder Kumiko-App.

  **`@cosmicdrift/kumiko-renderer-web`: `createPublicSurface`** — das öffentliche Gegenstück zu `createKumikoApp`. Schema-LOSER Mount (`injectSchema: false`, kein `__KUMIKO_SCHEMA__`, kein Topologie-Leak), Match-once-Routing, optionaler `shell`-Wrapper. Stackt von übergebenen `clientFeatures` nur `providers` + `translations` — bewusst **nicht** deren `gates` (ein AuthGate würde die öffentliche Surface hinter Login sperren).

  **`@cosmicdrift/kumiko-bundled-features` (auth-email-password): `AuthShell`** — `AuthCard` rendert jetzt über einen optionalen `useAuthShell()`-Renderer. Default bleibt der Fullscreen-Wrapper (rückwärtskompatibel); `AuthShellProvider` lässt Apps die Auth-Card in ihrer Marketing-Chrome statt Fullscreen rendern.

  **`@cosmicdrift/kumiko-bundled-features` (user-data-rights): anonymer, email-verifizierter Deletion-Flow** — DSGVO Art. 17 greift gerade beim Lockout (User kann sich nicht mehr einloggen). Zwei neue anonyme Handler: `request-deletion-by-email` (enumeration-safe, Magic-Link) + `confirm-deletion-by-token` (idempotent, startet dieselbe Grace-Period wie der authentifizierte Pfad via geteiltem `startDeletionGracePeriod`). HMAC-Token trägt `userId` + Expiry selbst (kein DB-Table/Redis/Migration), Purpose `"deletion-request"`. Neue Options `deletionTokenSecret` / `deletionVerifyUrl` / `sendDeletionVerificationEmail` (Callback MUSS non-blocking/enqueue sein — synchroner Send öffnet ein Timing-Oracle für Account-Enumeration).

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.47.0
- @cosmicdrift/kumiko-headless@0.47.0
- @cosmicdrift/kumiko-renderer@0.47.0

## 0.46.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.46.0
- @cosmicdrift/kumiko-renderer@0.46.0
- @cosmicdrift/kumiko-dispatcher-live@0.46.0

## 0.45.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.45.1
- @cosmicdrift/kumiko-renderer@0.45.1
- @cosmicdrift/kumiko-dispatcher-live@0.45.1

## 0.45.0

### Minor Changes

- 2764993: Bug-Bash 3 Wave L — Renderer- + Bundled-Features-Verbesserungen:

  - **DataTable `rowActionMode="inline"`** (#8/#9): neues Prop, das Row-Actions
    immer als linksbündige Inline-Buttons rendert (auch bei >2 Actions, kein
    Kebab) — einheitliche, ausgerichtete Optik über alle Listen. Default bleibt
    `"adaptive"` (bisheriges Verhalten).
  - **Config-Default-Wording** (#11): Cascade-Disclosure nutzt denselben Begriff
    „Standard"/„Default" wie das Feld-Label-Badge (statt „Vorgabe"/„Preset") —
    ein durchgängiger Begriff. Der Key `kumiko.config.cascade.preset` entfällt.
  - **`slots.header`-Placement** (#12): der List-Header-Slot (z.B. Cap-Counter)
    rendert jetzt in der Listen-Toolbar statt als loser Text über dem Screen-Titel.
  - **Composed Extension-Save** (#1): neuer `useExtensionFormSubmit`-Mechanismus —
    Extension-Sections (z.B. Custom-Fields) schreiben beim Haupt-Form-Submit mit,
    statt einen eigenen Save-Button zu führen. Der Haupt-Save aktiviert sich auch
    bei reiner Section-Änderung.
  - **Profil-Seite** (#3): Sektionen als abgegrenzte Karten, Danger-Zone hervorgehoben.

### Patch Changes

- Updated dependencies [2764993]
  - @cosmicdrift/kumiko-renderer@0.45.0
  - @cosmicdrift/kumiko-dispatcher-live@0.45.0
  - @cosmicdrift/kumiko-headless@0.45.0

## 0.44.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.44.0
- @cosmicdrift/kumiko-renderer@0.44.0
- @cosmicdrift/kumiko-dispatcher-live@0.44.0

## 0.43.0

### Patch Changes

- Updated dependencies [5b04c40]
  - @cosmicdrift/kumiko-renderer@0.43.0
  - @cosmicdrift/kumiko-dispatcher-live@0.43.0
  - @cosmicdrift/kumiko-headless@0.43.0

## 0.42.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.42.0
- @cosmicdrift/kumiko-headless@0.42.0
- @cosmicdrift/kumiko-renderer@0.42.0

## 0.41.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.41.1
- @cosmicdrift/kumiko-renderer@0.41.1
- @cosmicdrift/kumiko-dispatcher-live@0.41.1

## 0.41.0

### Patch Changes

- Updated dependencies [3f2d6ee]
  - @cosmicdrift/kumiko-renderer@0.41.0
  - @cosmicdrift/kumiko-headless@0.41.0
  - @cosmicdrift/kumiko-dispatcher-live@0.41.0

## 0.40.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.40.1
- @cosmicdrift/kumiko-renderer@0.40.1
- @cosmicdrift/kumiko-dispatcher-live@0.40.1

## 0.40.0

### Minor Changes

- 64a51ac: Review-Findings Rest-Welle (PR #323, 35 Findings). Verhaltens-relevant:

  - **Boot strenger** (kann bisher durchlaufende Boots brechen): required
    Config-Keys mit computed bzw. non-empty default sind jetzt Boot-Fehler;
    Action-Field-Refs (pick/map/visible.field/entityId) werden gegen die
    Entity-Felder validiert; zwei Entities mit gleichem tableName werfen.
  - **readiness:** SystemAdmin-gated required-Keys zählen jetzt im Verdict
    jedes Callers (skipAccessFilter im Rollup) — `ready` kann von true auf
    false kippen, wo vorher Lücken unsichtbar waren; mail-foundation
    Provider-Key ist required.
  - **access.admin-Preset** enthält zusätzlich `TenantAdmin`.
  - **user-data-rights:** runForgetCleanup wählt savepoint-FIRST — nested
    BEGIN in Transaktionen (Prod-Incident-Klasse) behoben.
  - **dev-server:** `extraRoutes`-deps zwischen runProdApp und
    createKumikoServer geteilt (`ExtraRoutesSystemDeps`); createKumikoServer
    reicht jetzt den nackten ioredis-Client statt des TestRedis-Wrappers.
  - **renderer-web:** Theme-Restore concurrent-render-sicher (useState-Lazy);
    ConfigSourceBadge kollabiert Operator-Quellen auf Tenant-Screens.
  - **renderer/headless:** evalFieldCondition als Single-Source re-exportiert.

### Patch Changes

- Updated dependencies [64a51ac]
  - @cosmicdrift/kumiko-renderer@0.40.0
  - @cosmicdrift/kumiko-headless@0.40.0
  - @cosmicdrift/kumiko-dispatcher-live@0.40.0

## 0.39.0

### Minor Changes

- 34cb1f7: Bug-Bash-2 Wave F2: Renderer-Fixes + Auth-Vorarbeit

  - Settings-Screens: "Vorgabe"-Block (Source-Badge + Cascade-Disclosure)
    erschien doppelt pro Feld — RenderEdit reichte denselben Callback als
    labelAppendix UND fieldAppendix durch. Jetzt zwei getrennte Callbacks.
  - timestamp-Felder: neues TimestampInput konvertiert zwischen lokaler
    Wall-Clock (datetime-local) und UTC-Instant mit `Z` — Saves endeten
    vorher in 422 invalid_format. locatedTimestamps bleiben Wall-Clock
    (neues wallClock-Flag im EditFieldViewModel/FieldInputProps).
  - Validierungsfehler: errors.validation.\*-Keys (Zod-4-Codes +
    Framework-Codes) in den de/en-Default-Bundles, Field interpoliert
    issue.params ({minimum} etc.) — vorher rohe Keys in der UI.
  - AuthRoutesConfig.cookieDomain: Domain-Attribut für beide Auth-Cookies
    (Cross-Subdomain-Login), Logout löscht Domain- und host-only-Variante.
    Pass-through via RunProdApp/RunDevApp-Auth-Options.
  - HostDispatchFn bekommt `search` (Query-String) für verlustfreie
    Host-Redirects (additiv).

### Patch Changes

- Updated dependencies [34cb1f7]
  - @cosmicdrift/kumiko-renderer@0.39.0
  - @cosmicdrift/kumiko-headless@0.39.0
  - @cosmicdrift/kumiko-dispatcher-live@0.39.0

## 0.38.0

### Patch Changes

- ffcce8a: Review-findings quick-win sweep (29 findings across 24 PR reviews):

  - framework: `asEntityTableMeta` removed from the `bun-db` barrel (import via `db/query` shim instead — minor because it drops a public export); `toStoredEvent` now exported from the `event-store` barrel; `EventRow.tenantId` typed as `TenantId`; fallback-logger format unified to `[ns] msg` on both paths; search-payload collision warning deduped per entity:key and no longer mislabels contributor-vs-contributor collisions as Stammfield overwrites; `extractTableName` calls in projection-table-index carry an identifying context; `isFormatSpec` without cast; FieldFormatRegistry augmentation example uses the real `engine/types` subpath (verified compiling).
  - dev-server: shared `isKebabSegment` replaces three copies of `KEBAB_RE`; `dispatchSystemWrite` roles use the `ROLES` constant.
  - bundled-features: `isFileProviderPlugin` type guard exported from file-foundation and used instead of the blind cast (provider registration without `build()` now fails with a descriptive error); `enforceStockCap` JSDoc documents the TOCTOU caveat; assorted dead code and stale/misleading comments fixed.
  - headless: applyFormatSpec dev-warning in English.
  - docs: all `*.integration.ts` references corrected to `*.integration.test.ts`; use-all-bundled feature-manifest generation sorts configKeys/secrets deterministically (manifest regenerated).

- Updated dependencies [0f093f1]
- Updated dependencies [ffcce8a]
  - @cosmicdrift/kumiko-headless@0.38.0
  - @cosmicdrift/kumiko-renderer@0.38.0
  - @cosmicdrift/kumiko-dispatcher-live@0.38.0

## 0.37.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.37.0
- @cosmicdrift/kumiko-headless@0.37.0
- @cosmicdrift/kumiko-renderer@0.37.0

## 0.36.0

### Patch Changes

- d84a515: FormatSpec-Verbesserungen: isFormatSpec-TypeGuard, timestamp/date Locale-Optionen, applyFormatSpec nach headless verschoben, normalizeListColumn dev-warning für Funktions-Renderer, buildAppSchema dev-assertion für JSON-Safety
- 1901bdf: applyFormatSpec: dev-warning für unbekannte Format-Keys (console.warn in !production); JSON-round-trip-Tests für FormatSpec-Renderer und FieldCondition-RowActions
- Updated dependencies [d84a515]
  - @cosmicdrift/kumiko-headless@0.36.0
  - @cosmicdrift/kumiko-renderer@0.36.0
  - @cosmicdrift/kumiko-dispatcher-live@0.36.0

## 0.35.0

### Minor Changes

- 6553405: feat(screen-types): FieldFormatRegistry + FormatSpec ersetzen function-Renderer

  `FieldRenderer` akzeptiert keine Inline-Funktionen mehr — sie wurden von
  `JSON.stringify` in der `buildAppSchema → window.__KUMIKO_SCHEMA__`-Pipeline
  still gedroppt, was zu unsichtbaren Render-Fehlern führte.

  Neu: `FormatSpec` — deklarativer, JSON-sicherer Formatter-Typ:
  `{ format: "timestamp" }` | `{ format: "currency", symbol: "€" }` |
  `{ format: "boolean", trueLabel: "Ja", falseLabel: "Nein" }` |
  `{ format: "priority", prefix: "P" }` | `{ format: "date" }`

  Apps erweitern das Built-in-Set per module augmentation:

  ```ts
  declare module "@cosmicdrift/kumiko-framework" {
    interface FieldFormatRegistry {
      myFormat: { myOption?: string };
    }
  }
  ```

  `renderer-web` kennt alle Built-in-Keys; unbekannte App-spezifische Keys
  fallen auf `String(value)` zurück.

  Migration: Inline-Funktionen durch das passende `{ format: "..." }` ersetzen.

### Patch Changes

- @cosmicdrift/kumiko-headless@0.35.0
- @cosmicdrift/kumiko-renderer@0.35.0
- @cosmicdrift/kumiko-dispatcher-live@0.35.0

## 0.34.2

### Patch Changes

- Updated dependencies [ce4a16f]
  - @cosmicdrift/kumiko-renderer@0.34.2
  - @cosmicdrift/kumiko-dispatcher-live@0.34.2
  - @cosmicdrift/kumiko-headless@0.34.2

## 0.34.1

### Patch Changes

- Updated dependencies [689133c]
  - @cosmicdrift/kumiko-renderer@0.34.1
  - @cosmicdrift/kumiko-dispatcher-live@0.34.1
  - @cosmicdrift/kumiko-headless@0.34.1

## 0.34.0

### Patch Changes

- Updated dependencies [9be544f]
  - @cosmicdrift/kumiko-headless@0.34.0
  - @cosmicdrift/kumiko-renderer@0.34.0
  - @cosmicdrift/kumiko-dispatcher-live@0.34.0

## 0.33.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.33.0
- @cosmicdrift/kumiko-headless@0.33.0
- @cosmicdrift/kumiko-renderer@0.33.0

## 0.32.1

### Patch Changes

- Updated dependencies [b418259]
  - @cosmicdrift/kumiko-renderer@0.32.1
  - @cosmicdrift/kumiko-dispatcher-live@0.32.1
  - @cosmicdrift/kumiko-headless@0.32.1

## 0.32.0

### Minor Changes

- 5bb198b: ConfigCascadeView übersetzt + scope-gefiltert

  - Source-Badges und Cascade-Texte zeigten rohe i18n-Keys
    (`config.source.default` …) — die Keys existierten in keinem Bundle.
    Jetzt `kumiko.config.source.*` / `kumiko.config.cascade.*` mit de/en-
    Defaults in `kumikoDefaultTranslations`; `ConfigSourceBadge` nutzt
    dieselben Keys statt hartkodiertem Englisch.
  - Nicht-System-Screens zeigen nur noch die eigene Cascade-Ebene plus
    EINE neutrale „Vorgabe"-Zeile (effektiver Wert) — System/App-Override/
    Computed sind Operator-Interna und für Tenant-/User-Scope unsichtbar.
    `screenScope="system"` behält die Vollsicht.

- 05c4447: Workspace-Navigation + Row-Action-Fehler sichtbar machen

  - `useBrowserNavApi` honoriert jetzt den dokumentierten NavTarget-Contract:
    `workspaceId` weglassen = aktueller Workspace bleibt. Vorher erzeugte
    `navigate({ screenId })` im Workspace-Mode einen Pfad ohne Workspace-
    Prefix, `parsePath` las das Screen-Segment als Workspace-Id und
    `WorkspaceShell` revertete sofort auf den Default-Screen — Edit-/
    Toolbar-Navigate-Aktionen wirkten tot.
  - `RowActionNavigate` hat ein neues optionales `entityId(row)`:
    entityEdit-Targets bekommen die Id als Pfad-Segment (`route.entityId`),
    `?id=`-Search-Params öffneten den Edit-Screen im Create-Mode.
  - navigate-Row-Actions setzen Search-Params jetzt NACH `nav.navigate`
    (pushState trägt keine Query — vorher gesetzte Params klebten an der
    alten URL, actionForm-Prefill kam leer an).
  - Row-Action-Writes verwerfen Failure-Results nicht mehr:
    `WriteFailedError` (neu exportiert, inkl. `dispatcherErrorText`) wird
    geworfen und im Web-Renderer als destructive Toast gezeigt (inkl.
    docsUrl). Vorher schloss der Confirm-Dialog kommentarlos — "Klick tut
    nichts". Confirm-Dialoge schließen außerdem auch bei rejected
    onConfirm statt offen zu hängen.

- 0009486: Theme-Persistenz, cancelTarget für actionForms, Login-Legal-Links

  - Theme-Wahl wird in localStorage persistiert (`kumiko:theme`) und beim
    ersten Mount restored (`applyStoredThemeMode` + `THEME_STORAGE_KEY`
    exportiert) — vorher war der Dark/Light-Toggle nach jedem Reload weg.
    FOUC-Schutz: Inline-Script-Snippet siehe tokens.ts-Header.
  - `ActionFormScreenDefinition.cancelTarget?: string | false`: entkoppelt
    den Abbrechen-Button vom Submit-`redirect`; `false` entfernt ihn
    (Single-Action-Screens wie „Test-Mail senden"). Boot-Validator prüft
    String-Targets wie `redirect`.
  - `LoginScreen` bekommt `legalLinks` (Impressum/Datenschutz unterhalb
    der Card) — der Login ist oft die einzige öffentliche Seite einer
    Admin-Domain und braucht erreichbare Legal-Links (Impressumspflicht).

### Patch Changes

- Updated dependencies [5bb198b]
- Updated dependencies [05c4447]
- Updated dependencies [0009486]
  - @cosmicdrift/kumiko-renderer@0.32.0
  - @cosmicdrift/kumiko-headless@0.32.0
  - @cosmicdrift/kumiko-dispatcher-live@0.32.0

## 0.31.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.31.1
- @cosmicdrift/kumiko-renderer@0.31.1
- @cosmicdrift/kumiko-dispatcher-live@0.31.1

## 0.31.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.31.0
- @cosmicdrift/kumiko-renderer@0.31.0
- @cosmicdrift/kumiko-dispatcher-live@0.31.0

## 0.30.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.30.0
- @cosmicdrift/kumiko-renderer@0.30.0
- @cosmicdrift/kumiko-dispatcher-live@0.30.0

## 0.29.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.29.0
- @cosmicdrift/kumiko-renderer@0.29.0
- @cosmicdrift/kumiko-dispatcher-live@0.29.0

## 0.28.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.28.0
- @cosmicdrift/kumiko-renderer@0.28.0
- @cosmicdrift/kumiko-dispatcher-live@0.28.0

## 0.27.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.27.0
- @cosmicdrift/kumiko-renderer@0.27.0
- @cosmicdrift/kumiko-dispatcher-live@0.27.0

## 0.26.0

### Patch Changes

- de348c6: fix(pagination): `computeVisiblePages` keeps 5 page numbers visible at the list edges (sliding the window instead of clamping it) — e.g. `p=1/20` now shows `1 2 3 4 5 … 20` instead of `1 2 3 … 20`, matching the documented behaviour. Mid-list rendering is unchanged.
- 4e68aff: test(primitives): export pure helpers for unit testing — `computeVisiblePages`, `defaultCellRender`, `isComponentRendererRef` (index.tsx) and `parseIso`/`toIso` (date-input). No behaviour change; mirrors money-input which already exports its pure logic.
- Updated dependencies [4911a41]
  - @cosmicdrift/kumiko-renderer@0.26.0
  - @cosmicdrift/kumiko-dispatcher-live@0.26.0
  - @cosmicdrift/kumiko-headless@0.26.0

## 0.25.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.25.0
- @cosmicdrift/kumiko-renderer@0.25.0
- @cosmicdrift/kumiko-dispatcher-live@0.25.0

## 0.24.1

### Patch Changes

- Updated dependencies [52cd396]
  - @cosmicdrift/kumiko-renderer@0.24.1
  - @cosmicdrift/kumiko-headless@0.24.1
  - @cosmicdrift/kumiko-dispatcher-live@0.24.1

## 0.24.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.24.0
- @cosmicdrift/kumiko-renderer@0.24.0
- @cosmicdrift/kumiko-dispatcher-live@0.24.0

## 0.23.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.23.1
- @cosmicdrift/kumiko-renderer@0.23.1
- @cosmicdrift/kumiko-dispatcher-live@0.23.1

## 0.23.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.23.0
- @cosmicdrift/kumiko-renderer@0.23.0
- @cosmicdrift/kumiko-dispatcher-live@0.23.0

## 0.22.0

### Minor Changes

- dcc8d4c: `ExtensionSectionsProvider` + `useExtensionSectionComponent(name)`-Hook für client-side Component-Auflösung im entityEdit-Screen via `__component`-Marker. Apps registrieren Components über das neue `ClientFeatureDefinition.extensionSectionComponents`-Feld (Pattern analog zu `columnRenderers`, Last-Wins-Semantik bei Multi-Feature-Kollision). `createKumikoApp` aggregiert + mountet den Provider automatisch. RenderEdit mountet die aufgelöste Component mit `{ entityName, entityId }`; fehlt die Registrierung → Banner mit dem gesuchten Component-Namen.

### Patch Changes

- Updated dependencies [dcc8d4c]
- Updated dependencies [dcc8d4c]
  - @cosmicdrift/kumiko-headless@0.22.0
  - @cosmicdrift/kumiko-renderer@0.22.0
  - @cosmicdrift/kumiko-dispatcher-live@0.22.0

## 0.21.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.21.1
- @cosmicdrift/kumiko-headless@0.21.1
- @cosmicdrift/kumiko-renderer@0.21.1

## 0.21.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.21.0
- @cosmicdrift/kumiko-renderer@0.21.0
- @cosmicdrift/kumiko-dispatcher-live@0.21.0

## 0.20.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.20.0
- @cosmicdrift/kumiko-renderer@0.20.0
- @cosmicdrift/kumiko-dispatcher-live@0.20.0

## 0.19.1

### Patch Changes

- a146fc4: Add shared boot-seed contract (`SeedIfExists`, `runEventStoreSeed`) and default skip-if-exists for `seedTextBlock` / `seedComplianceProfile`.
- Updated dependencies [a146fc4]
  - @cosmicdrift/kumiko-dispatcher-live@0.19.1
  - @cosmicdrift/kumiko-headless@0.19.1
  - @cosmicdrift/kumiko-renderer@0.19.1

## 0.19.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.19.0
- @cosmicdrift/kumiko-renderer@0.19.0
- @cosmicdrift/kumiko-dispatcher-live@0.19.0

## 0.18.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.18.0
- @cosmicdrift/kumiko-renderer@0.18.0
- @cosmicdrift/kumiko-dispatcher-live@0.18.0

## 0.17.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.17.0
- @cosmicdrift/kumiko-renderer@0.17.0
- @cosmicdrift/kumiko-dispatcher-live@0.17.0

## 0.16.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.16.0
- @cosmicdrift/kumiko-renderer@0.16.0
- @cosmicdrift/kumiko-dispatcher-live@0.16.0

## 0.15.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.15.0
- @cosmicdrift/kumiko-renderer@0.15.0
- @cosmicdrift/kumiko-dispatcher-live@0.15.0

## 0.14.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.14.0
- @cosmicdrift/kumiko-headless@0.14.0
- @cosmicdrift/kumiko-renderer@0.14.0

## 0.13.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.13.0
- @cosmicdrift/kumiko-renderer@0.13.0
- @cosmicdrift/kumiko-dispatcher-live@0.13.0

## 0.12.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.12.2
- @cosmicdrift/kumiko-renderer@0.12.2
- @cosmicdrift/kumiko-dispatcher-live@0.12.2

## 0.12.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.12.1
- @cosmicdrift/kumiko-renderer@0.12.1
- @cosmicdrift/kumiko-dispatcher-live@0.12.1

## 0.12.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.12.0
- @cosmicdrift/kumiko-headless@0.12.0
- @cosmicdrift/kumiko-renderer@0.12.0

## 0.11.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.11.2
- @cosmicdrift/kumiko-renderer@0.11.2
- @cosmicdrift/kumiko-dispatcher-live@0.11.2

## 0.11.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.11.1
- @cosmicdrift/kumiko-headless@0.11.1
- @cosmicdrift/kumiko-renderer@0.11.1

## 0.11.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.11.0
- @cosmicdrift/kumiko-renderer@0.11.0
- @cosmicdrift/kumiko-dispatcher-live@0.11.0

## 0.10.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.10.0
- @cosmicdrift/kumiko-renderer@0.10.0
- @cosmicdrift/kumiko-dispatcher-live@0.10.0

## 0.9.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.9.0
- @cosmicdrift/kumiko-renderer@0.9.0
- @cosmicdrift/kumiko-dispatcher-live@0.9.0

## 0.8.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.8.1
- @cosmicdrift/kumiko-renderer@0.8.1
- @cosmicdrift/kumiko-dispatcher-live@0.8.1

## 0.8.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.8.0
- @cosmicdrift/kumiko-renderer@0.8.0
- @cosmicdrift/kumiko-dispatcher-live@0.8.0

## 0.7.0

### Minor Changes

- bcf43b6: es-ops: `SeedMembershipRow` exposes `streamTenantId` (stream-tenant aus `kumiko_events.v1`) neben dem payload-`tenantId`. Seed-Authors müssen den `kumiko_events`-JOIN nicht mehr selbst bauen — `m.streamTenantId` ist der korrekte Wert für `systemWriteAs`'s `tenantIdOverride` wenn das Aggregate von einem fremden Executor angelegt wurde (typisches `seedTenantMembership(by=systemAdmin)`-Pattern).

### Patch Changes

- Updated dependencies [bcf43b6]
  - @cosmicdrift/kumiko-dispatcher-live@0.7.0
  - @cosmicdrift/kumiko-headless@0.7.0
  - @cosmicdrift/kumiko-renderer@0.7.0

## 0.6.0

### Minor Changes

- 8489d18: feat(es-ops): Phase 1.5 — tenantIdOverride + dry-run-validator + E2E-Test + Doku

  Phase 1.5 schließt die Lücken aus Phase 1 die den ersten Driver-Use-Case
  (publicstatus admin-roles) blockten. Siehe Retro:
  `kumiko-platform/docs/plans/features/es-ops-phase1-retro.md` (PR #9).

  **A1 — tenantIdOverride:**
  `SeedMigrationContext.systemWriteAs(qn, payload, tenantIdOverride?)`.
  Default SYSTEM_TENANT_ID (unverändert für System-scope-Aggregates wie
  config-values). Mit override: `createSystemUser(tenantIdOverride)` als
  Executor, damit der Event-Store-Executor den Aggregate-Stream im
  richtigen Tenant findet. Fix für die `version_conflict`-Klasse-Bug
  (Memory `feedback_event_store_tenant_consistency.md`).

  **A2 — dry-run-validator:**
  Runner parsed seed-files vor `migration.run()` per regex
  `systemWriteAs\(["']([^"']+)["']`, sammelt handler-QNs, validiert
  gegen `registry.getWriteHandler(qn)`. Fail-fast mit klarer Message

  - Datei + QN statt zur Runtime "handler not found". Catched camelCase-
    typos (kebab-case-vs-camelCase Drift) + andere QN-Drift zur Boot-Zeit.
    runProdApp reicht den richtigen Registry rein (`registry` neu in
    RunPendingSeedMigrationsArgs).

  **A3 — E2E-Test:**
  `packages/bundled-features/src/__tests__/es-ops-e2e.integration.ts`
  mit `setupTestStack`-Pattern: tenant+config Features echt geladen,
  echtes Membership-Aggregate via TenantHandlers.addMember im Demo-Tenant,
  seed-migration ruft update-member-roles mit tenantIdOverride → write
  geht durch, Marker landed, Event in Store, Read-Model aktualisiert.
  Plus typo-Test: seed mit camelCase fail-t Dry-Run mit
  `/dry-run found.*unknown handler-QN/`. **TDD-First**: ohne A1+A2 wäre
  der test rot.

  **A4 — Doku:**
  `framework/src/es-ops/README.md` erweitert um „Wann brauche ich
  tenantIdOverride?" + „Deployment-Anforderungen" (Docker COPY, Idempotenz,
  Multi-Replica) + „Lokaler Smoke vor Push". Recipe-README + seed-files
  auf neue API aktualisiert.

  **A5 — Smoke-Skript-Template:**
  `samples/recipes/seed-migration/scripts/smoke.ts` als copy-paste-Template
  für App-Authors: Bun-runnable, offline (read-only, kein DB-Write),
  validiert Module-Load + QN-Resolution + System-User-Access. Recipe-
  README dokumentiert Pflicht-Pattern.

  **Bonus-Fix:**
  `tenant:write:create`-access auf `["system", "SystemAdmin"]` erweitert
  (symmetrisch zu update-member-roles). Aufgedeckt durch Recipe-Smoke +
  initial-tenants-Seed. Pinning-Test in `tenant.integration.ts` updated.

  **Test-State:** 45/45 grün (Pre-Push). Typecheck clean. Biome clean.
  as-cast-Audit clean. Guard-silent-skip clean. Recipe-Smoke clean.

  **Folge-Step (separater PR):** publicstatus driver-sample reaktivieren
  mit lokalem Pre-Push-Smoke gegen publicstatus' echtes Feature-Set.

### Patch Changes

- Updated dependencies [8489d18]
  - @cosmicdrift/kumiko-dispatcher-live@0.6.0
  - @cosmicdrift/kumiko-headless@0.6.0
  - @cosmicdrift/kumiko-renderer@0.6.0

## 0.5.2

### Patch Changes

- 4f0d781: fix(tenant): updateMemberRoles erlaubt "system"-Rolle (symmetrisch zu create)

  Drift innerhalb des tenant-Features: `tenant:write:create` akzeptierte
  `["system", "SystemAdmin"]`, `tenant:write:update-member-roles` aber
  nur `["SystemAdmin"]`. Konsequenz: ops-tooling und seed-migrations
  (`createSystemUser` mit `roles: ["system"]`) konnten den Handler nicht
  aufrufen — `access_denied`.

  Live entdeckt beim ersten Driver-Sample der es-ops Phase 1: publicstatus
  seed `2026-05-20-fix-admin-roles.ts` rief `update-member-roles` via
  `systemWriteAs` → access_denied → Pod CrashLoopBackOff.

  Plus access-rule-Pinning-Test in `tenant.integration.ts`-scenario-7.

- Updated dependencies [4f0d781]
  - @cosmicdrift/kumiko-dispatcher-live@0.5.2
  - @cosmicdrift/kumiko-headless@0.5.2
  - @cosmicdrift/kumiko-renderer@0.5.2

## 0.5.1

### Patch Changes

- 0e00015: fix(es-ops): path.resolve statt path.join für seedsDir → seed-files

  Bun's `await import()` braucht absolute Pfade. Wenn der App-Author
  `runProdApp({ seedsDir: "./seeds" })` setzt (relativ), würde
  `path.join("./seeds", "foo.ts")` einen relativen Pfad liefern → Bun's
  Import-Resolver such relativ zum `runner.ts`-Modul (nicht zum
  `process.cwd()`) → `Cannot find module 'seeds/...' from '<runner-path>'`.

  `path.resolve` löst gegen `process.cwd()` auf → absolute Pfade →
  Import funktioniert. Aufgedeckt beim ersten Live-Boot der publicstatus-
  Driver-Migration (Pod CrashLoopBackOff).

- Updated dependencies [0e00015]
  - @cosmicdrift/kumiko-dispatcher-live@0.5.1
  - @cosmicdrift/kumiko-headless@0.5.1
  - @cosmicdrift/kumiko-renderer@0.5.1

## 0.5.0

### Minor Changes

- 7ff69ab: feat(es-ops): Phase 1 — file-based seed-migrations

  Neues first-class Operations-Pattern fürs Framework. Liefert `seed-migrations`
  als drizzle-migrate-equivalent für Event-Sourcing-Aggregate-Updates die
  idempotent-Seeder nicht erfassen können (z.B. „Member hat schon eine
  Rolle, aber jetzt soll noch eine dazukommen").

  Public-API:

  - `runProdApp({ seedsDir })` — Auto-apply pending Migrations beim Boot
  - `SeedMigration`-Interface (default-Export einer `seeds/<id>.ts`-File)
  - `SeedMigrationContext` mit `systemWriteAs` (ruft existing write-handler
    als System-User) + Read-Helpers (`findUserByEmail`,
    `findMembershipsOfUser`, `findTenants`)
  - CLI: `bunx kumiko ops seed:new|status|apply`
  - Tracking-Table `kumiko_es_operations` mit `operation_type`-Discriminator
    (vorbereitet auf Phase 2+ Operations: projection-rebuild, event-replay,
    stream-migration, ...)
  - Env-Flags: `KUMIKO_SKIP_ES_OPS=1` (alle skippen für Recovery),
    `KUMIKO_SKIP_ES_OPS_<ID>=1` (einzelne kaputte skippen)

  Garantien: single-run via tracking, atomic via per-migration-Tx,
  chronological order via filename-prefix, fail-stop bei Failure (kein
  Partial-Apply), ES-konform via Handler-Dispatch.

  Sub-path-Export: `@cosmicdrift/kumiko-framework/es-ops`

  Plan-Doc: `kumiko-platform/docs/plans/features/es-ops.md`
  Recipe: `samples/recipes/seed-migration/`
  Driver-Use-Case: publicstatus admin-roles-drift (parallel-Branch
  `feat/es-ops-driver-admin-roles`).

  Phase 2+ skizziert + offen markiert — Implementation pro Use-Case.

### Patch Changes

- Updated dependencies [7ff69ab]
  - @cosmicdrift/kumiko-dispatcher-live@0.5.0
  - @cosmicdrift/kumiko-headless@0.5.0
  - @cosmicdrift/kumiko-renderer@0.5.0

## 0.4.1

### Patch Changes

- 010b410: feat(auth-email-password): "Bestätigungs-Mail erneut senden" im LoginScreen

  LoginScreen bietet bei reason=email_not_verified jetzt einen Resend-Link
  im Fehler-Banner — der existierende `requestEmailVerification`-Endpoint
  wird direkt aufgerufen, der Banner wechselt nach Erfolg zum Info-Variant
  ("Wir haben dir eine neue Bestätigungs-Mail geschickt.").

  UX-Details:

  - Bei 429 → inline-Hint "Bitte warte kurz und versuche es erneut."
  - Bei Netzwerk/sonstigen Fehlern → inline-Hint "Konnte nicht senden."
  - Anti-Typo-Gate: ändert der User die Email-Eingabe nach dem Login-Fail,
    verschwindet der Resend-Link — sonst würde Resend silent-success an die
    geänderte (potentiell typoed) Adresse gehen ohne User-Feedback.
  - Andere Failure-Codes (invalid_credentials etc.) zeigen weiterhin keinen
    Resend-Link.

  i18n: 4 neue Keys (DE+EN) im `auth.login.resend*`-Namespace, additive.
  Apps die ihre Translations override-en müssen nichts ändern.

  Additive UI-Feature — keine API-Breaks, keine Schema-Migration.

- Updated dependencies [010b410]
  - @cosmicdrift/kumiko-dispatcher-live@0.4.1
  - @cosmicdrift/kumiko-headless@0.4.1
  - @cosmicdrift/kumiko-renderer@0.4.1

## 0.4.0

### Minor Changes

- 825e7d2: Visual-Tree V.1.4 → V.1.6 — Feature-complete Editor + Folder-Hierarchy + Roving-tabindex.

  **V.1.4** — explicit `folder?: string` Schema-Field auf text-block-entity. Slug bleibt
  kebab-only validiert, Folder explizit gesetzt. Tree gruppiert via `groupBlocksByFolder`
  (ersetzt `groupBlocksBySlugPrefix`). `Subscribe<T>` Signature um optional `emitError`
  erweitert für explicit async-error-Pfade. ProviderBranch zeigt Error-Banner mit
  Retry-Button. Drift-Test pinnt seedTextBlock-vs-set.write Slug-Validation.

  **V.1.4b** — URL-State-Routing für Editor-Target via `nav.searchParams`. F5 + Back-Button
  stellen den Editor-State wieder her. Format: `?t=text-content:edit&a_slug=...&a_lang=...`.
  Plus `useDispatchTarget` hook ersetzt globalen `dispatchTarget` als empfohlenen Production-
  Pfad (legacy bleibt für Test-Hooks).

  **V.1.5** — Arrow-Key-Navigation (`<aside role="tree">`, ARIA-tree-Pattern) + SSE-driven
  Tree-Refresh. `ClientFeatureDefinition.treeEntities?: string[]` listet Entity-Namen pro
  Provider; live-events triggern provider-re-mount → Stale-Tree-state="stub"→"filled"
  flippt nach save automatisch.

  **V.1.5c+d** — Active-Node-Highlight (explicit blue + 2px border-l + scrollIntoView),
  VS-Code-Polish (compact spacing, focus-visible, folder-icon-color text-amber, indent-
  guides per ancestor-depth), Folder-Wrapper für legal-pages ("📁 Legal" + slug-first
  Verschachtelung) und text-content ("📁 Content").

  **V.1.6** — Multi-level Folder-Splitting (`folder="page/marketing"` → nested folders,
  walk-or-create-pattern, folder/leaf-collision-tolerant). Roving-tabindex (nur focused-
  treeitem hat tabIndex=0, Tab cyclt aus dem Tree raus).

  35/35 kumiko check PASS, 13/13 group-blocks + 22/22 text-content integration tests grün.
  Browser + Keyboard lokal validated.

  **Breaking**: `TreeContext` Type entfernt (V.1.2 SR2-Rip — war nie genutzt). Provider sind
  session-bound: `TreeChildrenSubscribe = () => Subscribe<T>` statt `(ctx) => Subscribe<T>`.

  **V.1.7-Followups**: useEffect-deps in VisualTree-focus-init (Performance), Cancellation-
  Token in TreeProvider's fetch (emit-after-unmount-warning), inline-rename, drag-drop,
  file-icons per slug-extension, parent-jump bei ArrowLeft auf collapsed-item.

### Patch Changes

- Updated dependencies [825e7d2]
  - @cosmicdrift/kumiko-dispatcher-live@0.4.0
  - @cosmicdrift/kumiko-headless@0.4.0
  - @cosmicdrift/kumiko-renderer@0.4.0

## 0.3.0

### Minor Changes

- 0.3.0 bringt zwei neue Subsysteme (Step-Engine Tier-3 + Visual-Tree) plus
  eine AST-Codemod-Pipeline als Vorarbeit für den L2-AI-Layer.

  ### Breaking Changes

  - `skipTransitionGuard` → `unsafeSkipTransitionGuard` (Rename in
    feature-ast + engine). Der `unsafe`-Prefix macht die Tragweite des
    Casts sichtbar und ist konsistent zur `unsafeProjectionUpsert`- und
    `r.rawTable`-Konvention. Migration: 1:1-Ersetzung, keine Verhaltens-Änderung.

  ### Features

  - **Step-Engine M.4 — Tier-3 Workflow-Engine.** Neue Step-Vocabulary
    `wait`, `waitForEvent`, `retry` ermöglicht persistierte Long-Running-Flows
    über Job-Boundaries hinweg. Q7 Snapshot-at-Start hängt jedem Step-Run
    einen SHA-256-Fingerprint des Aggregat-Zustands an, sodass Replays
    deterministisch gegen den ursprünglichen Eingangszustand laufen.
  - **Visual-Tree V.1.x — Tree-API + Editor-Panel.** Neue `VisualTree`-
    Component plus TreeProvider-Pattern; erste TreeProviders für
    `text-content` und `legal-pages` (CMS-light + Impressum/Privacy).
    Fundament für den späteren No-Code-Designer (~3000 LOC, 98 Tests).
  - **Codemod-Pipeline.** AST-basierte Patcher-Module für strukturelle
    Feature-Edits — wird vom kommenden L2-AI-Layer als Tool-Surface
    verwendet, ist aber eigenständig nutzbar für ts-morph-style Migrationen.
  - **user-data-rights Sample-Recipe.** DSGVO Art. 15/17/18/20 vollständig
    als Sample-Recipe (`samples/recipes/`) inklusive README — zeigt die
    Export- und Forget-Pipeline gegen den `compliance-profiles`-Default
    (`eu-dsgvo`).

  ### Fixes

  - `tier-engine`: auto-default-tier-Hook benutzt jetzt `ctx.db.raw` für
    Event-Store-Operationen (#37, vorher: stiller Bug, 22 Tage live).
  - `engine`: unsafe-projection-upsert nutzt `as never` statt `as any` —
    schmaler Cast-Surface, weniger Compiler-Knebel.
  - `visual-tree`: runtime-isolation marker für client-konsumierte Files,
    damit der Multi-Entry-Build den richtigen Bundle-Split bekommt.
  - `feature-ast`: vollständiger `unsafeSkipTransitionGuard`-Rename (war
    in zwei Modulen noch der alte Name).
  - `framework`: Error-Reasons + `noConsole`-Lint + No-Date-API-Guard
    wieder push-ready.

  ### Library-Updates

  hono 4.12, jose 6.2, stripe 22.1, meilisearch 0.58, marked 18,
  bun-types 1.3.13, lucide-react 1.14, bullmq 5.76, ioredis 5.10,
  i18next 26.0, react + radix-ui-primitives auf aktuelle Minors.

### Patch Changes

- Updated dependencies
  - @cosmicdrift/kumiko-dispatcher-live@0.3.0
  - @cosmicdrift/kumiko-headless@0.3.0
  - @cosmicdrift/kumiko-renderer@0.3.0

## 0.2.3

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.2.3
- @cosmicdrift/kumiko-headless@0.2.3
- @cosmicdrift/kumiko-renderer@0.2.3

## 0.2.2

### Patch Changes

- 7a7da3e: Re-publish 0.2.1 → 0.2.2 mit korrekt aufgelösten cross-package-Versionen.
  0.2.1 hatte `workspace:*` als Wert in den dependencies (npm publish ohne
  yarn-pack rewrite), Konsumenten bekamen "Workspace not found".

  publish-with-oidc.sh nutzt jetzt `yarn pack` (rewrited workspace:\*) +
  `npm publish <tarball>` (OIDC + provenance).

- Updated dependencies [7a7da3e]
  - @cosmicdrift/kumiko-headless@0.2.2
  - @cosmicdrift/kumiko-dispatcher-live@0.2.2
  - @cosmicdrift/kumiko-renderer@0.2.2

## 0.2.1

### Patch Changes

- 48b7f6a: CI: switch publish to npm-CLI with OIDC Trusted Publishing + provenance.
  No source changes — verifies the new publish path produces a verified-
  provenance attestation on npmjs.com instead of token-based publish.
- Updated dependencies [48b7f6a]
  - @cosmicdrift/kumiko-headless@0.2.1
  - @cosmicdrift/kumiko-dispatcher-live@0.2.1
  - @cosmicdrift/kumiko-renderer@0.2.1

## 0.2.0

### Minor Changes

- 6c70b6f: fix(tenant): seedTenant idempotent gegen Event-Store-Projection-Drift.

  Verhindert version_conflict beim App-Boot wenn Aggregat existiert aber
  Projection-Row fehlt (rebuild-drift, async-lag, manueller DB-Eingriff).

### Patch Changes

- Updated dependencies [6c70b6f]
  - @cosmicdrift/kumiko-dispatcher-live@0.2.0
  - @cosmicdrift/kumiko-headless@0.2.0
  - @cosmicdrift/kumiko-renderer@0.2.0

## 0.1.0

### Minor Changes

- 59ba6d7: Initial public release of Kumiko — AI-native backend builder.

  What ships in 0.1.0:

  - **Engine** (`@cosmicdrift/kumiko-framework`): `defineFeature`, `r.entity`, `r.writeHandler`, `r.queryHandler`, `r.projection`, `r.multiStreamProjection`, `r.hook`, `r.translations`, `r.crud`, `r.referenceData`, `r.screen`, `r.nav`, `r.authClaims`, full lifecycle pipeline with field-level access checks
  - **Pipeline** (`@cosmicdrift/kumiko-framework`): `createDispatcher`, JWT auth via jose, Zod schema validation, role-based access checks, command/write/query split
  - **DB** (`@cosmicdrift/kumiko-framework`): Drizzle helpers (`buildDrizzleTable`, `applyCursorQuery`), CRUD executor, Postgres dialect, optimistic locking, soft delete, multi-tenant scoping
  - **Event sourcing** (`@cosmicdrift/kumiko-framework`): aggregate streams, single + multi-stream projections, event upcasters, asOf queries, archive support, AsyncDaemon-pattern dispatcher
  - **Bundled features** (`@cosmicdrift/kumiko-bundled-features`): auth-email-password, sessions, tenants, users, jobs, secrets, file-provider-s3, mail-transport-smtp/inmemory, billing-foundation, cap-counter, channel-in-app, delivery, feature-toggles, legal-pages
  - **Renderer** (`@cosmicdrift/kumiko-renderer`, `@cosmicdrift/kumiko-renderer-web`): schema-driven CRUD UI for React + Expo Web, override paths, list debounce, theme tokens
  - **Headless** (`@cosmicdrift/kumiko-headless`): view-models for list/edit screens, locale-aware
  - **Dev server** (`@cosmicdrift/kumiko-dev-server`): `runDevApp`, `runProdApp`, `kumiko-build` for production bundles (client + server), Docker-ready
  - **Realtime** (`@cosmicdrift/kumiko-dispatcher-live`): SSE broadcast across tenants, Redis Pub/Sub backend
  - **CLI** (`bin/kumiko.ts`): interactive dev menu, test runners, check pipeline (Biome + TypeScript + 18 guards + Vitest)

  This is a pre-1.0 release — APIs may change between minor versions. Breaking changes will be documented per release.

### Patch Changes

- Updated dependencies [59ba6d7]
  - @cosmicdrift/kumiko-dispatcher-live@0.1.0
  - @cosmicdrift/kumiko-headless@0.1.0
  - @cosmicdrift/kumiko-renderer@0.1.0
