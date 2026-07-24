# @cosmicdrift/kumiko-renderer

## 0.165.0

### Patch Changes

- Updated dependencies [cf56745]
  - @cosmicdrift/kumiko-framework@0.165.0
  - @cosmicdrift/kumiko-headless@0.165.0

## 0.164.0

### Patch Changes

- Updated dependencies [90b4221]
  - @cosmicdrift/kumiko-framework@0.164.0
  - @cosmicdrift/kumiko-headless@0.164.0

## 0.163.3

### Patch Changes

- Updated dependencies [5c43259]
  - @cosmicdrift/kumiko-framework@0.163.3
  - @cosmicdrift/kumiko-headless@0.163.3

## 0.163.2

### Patch Changes

- Updated dependencies [5dc5290]
  - @cosmicdrift/kumiko-framework@0.163.2
  - @cosmicdrift/kumiko-headless@0.163.2

## 0.163.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.163.1
- @cosmicdrift/kumiko-headless@0.163.1

## 0.163.0

### Patch Changes

- Updated dependencies [dc76328]
  - @cosmicdrift/kumiko-framework@0.163.0
  - @cosmicdrift/kumiko-headless@0.163.0

## 0.162.0

### Patch Changes

- Updated dependencies [08abac2]
  - @cosmicdrift/kumiko-framework@0.162.0
  - @cosmicdrift/kumiko-headless@0.162.0

## 0.161.0

### Patch Changes

- Updated dependencies [c7ac572]
  - @cosmicdrift/kumiko-framework@0.161.0
  - @cosmicdrift/kumiko-headless@0.161.0

## 0.160.0

### Minor Changes

- d3e815c: Add client `Dispatcher.stream` + `useStreamHandler` for POST /api/stream SSE (#1382).

### Patch Changes

- Updated dependencies [d3e815c]
  - @cosmicdrift/kumiko-framework@0.160.0
  - @cosmicdrift/kumiko-headless@0.160.0

## 0.159.1

### Patch Changes

- Updated dependencies [6d37eb5]
  - @cosmicdrift/kumiko-framework@0.159.1
  - @cosmicdrift/kumiko-headless@0.159.1

## 1.0.0

### Patch Changes

- Updated dependencies [9db805c]
- Updated dependencies [d0280c8]
- Updated dependencies [a997cc8]
- Updated dependencies [d97fcda]
- Updated dependencies [2fc542b]
- Updated dependencies [6254cc8]
  - @cosmicdrift/kumiko-framework@1.0.0
  - @cosmicdrift/kumiko-headless@1.0.0

## 0.158.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.158.2
- @cosmicdrift/kumiko-headless@0.158.2

## 0.158.1

### Patch Changes

- Updated dependencies [da816ee]
  - @cosmicdrift/kumiko-framework@0.158.1
  - @cosmicdrift/kumiko-headless@0.158.1

## 0.158.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.158.0
- @cosmicdrift/kumiko-headless@0.158.0

## 0.157.3

### Patch Changes

- @cosmicdrift/kumiko-framework@0.157.3
- @cosmicdrift/kumiko-headless@0.157.3

## 0.157.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.157.2
- @cosmicdrift/kumiko-headless@0.157.2

## 0.157.1

### Patch Changes

- c4b9a88: Fix `KumikoScreen` rendering role-gated screens for users without a matching role (#1203). `access.roles` was only enforced for nav/workspace visibility (`filterByAccess` in `workspace-shell.tsx`) — the actual screen-render path had no independent check, so any authenticated user reaching a role-gated screen via a direct URL, bookmark, or the app's `screenQn` fallback saw the screen's chrome regardless of role. Data stayed safe (query/write handlers are still server-side role-checked), this was a chrome leak, not a data leak.

  `KumikoScreen` now gates on `screen.access` using the same roles the shells already pass for nav filtering, threaded down via a new `UserRolesProvider`/`useUserRoles` (exported from `@cosmicdrift/kumiko-renderer`). `WorkspaceShell` and `DefaultAppShell` wrap their children with it using `user?.roles`. Consistent with `filterByAccess`'s existing default-deny: no provider mounted, or `roles` not passed, denies role-gated screens — apps with role-gated screens must wire `user` into their shell (the same prop they already pass for nav) or those screens render an "access denied" placeholder instead of their content.

  - @cosmicdrift/kumiko-framework@0.157.1
  - @cosmicdrift/kumiko-headless@0.157.1

## 0.157.0

### Patch Changes

- Updated dependencies [1371d8b]
  - @cosmicdrift/kumiko-framework@0.157.0
  - @cosmicdrift/kumiko-headless@0.157.0

## 0.156.3

### Patch Changes

- Updated dependencies [f768c8a]
  - @cosmicdrift/kumiko-framework@0.156.3
  - @cosmicdrift/kumiko-headless@0.156.3

## 0.156.2

### Patch Changes

- Updated dependencies [838cd4e]
  - @cosmicdrift/kumiko-framework@0.156.2
  - @cosmicdrift/kumiko-headless@0.156.2

## 0.156.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.156.1
- @cosmicdrift/kumiko-headless@0.156.1

## 0.156.0

### Patch Changes

- Updated dependencies [c7ca222]
- Updated dependencies [77ea09f]
  - @cosmicdrift/kumiko-framework@0.156.0
  - @cosmicdrift/kumiko-headless@0.156.0

## 0.155.1

### Patch Changes

- 69ac999: Migrate three display/build-tooling timestamp call-sites from native `Date` to `Temporal` (identical output format): `formatWhen` (operator-screen timestamps), `formatDateCell` (table-cell date/timestamp formatting, preserves the existing `dateStyle`/`timeStyle` priority order), and `build-prod-bundle`'s `builtAt` field. Surfaced by infra#286's `no-date-api` guard, which now actually scans these packages instead of silently skipping them.
- Updated dependencies [69ac999]
  - @cosmicdrift/kumiko-headless@0.155.1
  - @cosmicdrift/kumiko-framework@0.155.1

## 0.155.0

### Patch Changes

- Updated dependencies [137f31a]
  - @cosmicdrift/kumiko-framework@0.155.0
  - @cosmicdrift/kumiko-headless@0.155.0

## 0.154.2

### Patch Changes

- Updated dependencies [05c3e11]
  - @cosmicdrift/kumiko-framework@0.154.2
  - @cosmicdrift/kumiko-headless@0.154.2

## 0.154.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.154.1
- @cosmicdrift/kumiko-headless@0.154.1

## 0.154.0

### Patch Changes

- Updated dependencies [0d30bf7]
- Updated dependencies [e40a980]
  - @cosmicdrift/kumiko-framework@0.154.0
  - @cosmicdrift/kumiko-headless@0.154.0

## 0.153.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.153.0
- @cosmicdrift/kumiko-headless@0.153.0

## 0.152.0

### Patch Changes

- Updated dependencies [e32807e]
- Updated dependencies [3dd1f99]
  - @cosmicdrift/kumiko-framework@0.152.0
  - @cosmicdrift/kumiko-headless@0.152.0

## 0.151.1

### Patch Changes

- Updated dependencies [5c1dc93]
  - @cosmicdrift/kumiko-framework@0.151.1
  - @cosmicdrift/kumiko-headless@0.151.1

## 0.151.0

### Patch Changes

- Updated dependencies [ca4edbf]
  - @cosmicdrift/kumiko-framework@0.151.0
  - @cosmicdrift/kumiko-headless@0.151.0

## 0.150.0

### Patch Changes

- Updated dependencies [0e4cec9]
- Updated dependencies [aeb79fa]
  - @cosmicdrift/kumiko-framework@0.150.0
  - @cosmicdrift/kumiko-headless@0.150.0

## 0.149.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.149.2
- @cosmicdrift/kumiko-headless@0.149.2

## 0.149.1

### Patch Changes

- Updated dependencies [637b599]
  - @cosmicdrift/kumiko-framework@0.149.1
  - @cosmicdrift/kumiko-headless@0.149.1

## 0.149.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.149.0
- @cosmicdrift/kumiko-headless@0.149.0

## 0.148.0

### Patch Changes

- Updated dependencies [cb5612d]
  - @cosmicdrift/kumiko-framework@0.148.0
  - @cosmicdrift/kumiko-headless@0.148.0

## 0.147.3

### Patch Changes

- @cosmicdrift/kumiko-framework@0.147.3
- @cosmicdrift/kumiko-headless@0.147.3

## 0.147.2

### Patch Changes

- Updated dependencies [3f121df]
- Updated dependencies [dfb3c26]
- Updated dependencies [c007b76]
  - @cosmicdrift/kumiko-framework@0.147.2
  - @cosmicdrift/kumiko-headless@0.147.2

## 0.147.1

### Patch Changes

- 63cfcc9: entityList / entityEdit / reference lookups now kebabize feature + entity when building query/write QNs (matches server `qualifyEntityName`). Client-safe `toKebab` in `app/qn.ts` — do not import from `/engine` (browser bundle). Fixes camelCase entities (e.g. `driverModel`) returning `errors.notFound` in the UI.
  - @cosmicdrift/kumiko-framework@0.147.1
  - @cosmicdrift/kumiko-headless@0.147.1

## 0.147.0

### Minor Changes

- a46b306: AI-Text primitive: `AiTextField`/`AiTextArea` (renderer-web) — drop-in replacements for `TextField`/`TextareaField` with ghost-text completion (Tab to accept, Esc to discard), and correct/translate/rewrite toolbar actions with a before/after diff preview. Built on `useAiTextAction`/`useCompletion` (renderer) — request/response hooks with debounce, abort, and cap-exceeded/unavailable state. Both degrade gracefully to a plain text field when the server's `ai-text` feature (kumiko-enterprise) isn't mounted — no enterprise import in this public package.
- c93de1a: `Section` primitive: new optional `variant="destructive"` marks a section as a warning/danger area (border-only, e.g. account deletion, restrict processing) — closes the styling gap left after `privacy-center-screen.tsx` migrated off its hand-rolled `border-destructive/40` class onto the shared `Section` primitive.

### Patch Changes

- Updated dependencies [bdc5e27]
- Updated dependencies [c93de1a]
  - @cosmicdrift/kumiko-framework@0.147.0
  - @cosmicdrift/kumiko-headless@0.147.0

## 0.146.4

### Patch Changes

- Updated dependencies [d85f5ae]
  - @cosmicdrift/kumiko-headless@0.146.4
  - @cosmicdrift/kumiko-framework@0.146.4

## 0.146.3

### Patch Changes

- Updated dependencies [58a6145]
  - @cosmicdrift/kumiko-headless@0.146.3
  - @cosmicdrift/kumiko-framework@0.146.3

## 0.146.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.146.2
- @cosmicdrift/kumiko-headless@0.146.2

## 0.146.1

### Patch Changes

- Updated dependencies [706cea7]
  - @cosmicdrift/kumiko-framework@0.146.1
  - @cosmicdrift/kumiko-headless@0.146.1

## 0.146.0

### Patch Changes

- Updated dependencies [b00c3ed]
  - @cosmicdrift/kumiko-framework@0.146.0
  - @cosmicdrift/kumiko-headless@0.146.0

## 0.145.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.145.1
- @cosmicdrift/kumiko-headless@0.145.1

## 0.145.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.145.0
- @cosmicdrift/kumiko-headless@0.145.0

## 0.144.0

### Patch Changes

- Updated dependencies [c7d0ef8]
  - @cosmicdrift/kumiko-framework@0.144.0
  - @cosmicdrift/kumiko-headless@0.144.0

## 0.143.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.143.1
- @cosmicdrift/kumiko-headless@0.143.1

## 0.143.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.143.0
- @cosmicdrift/kumiko-headless@0.143.0

## 0.142.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.142.0
- @cosmicdrift/kumiko-headless@0.142.0

## 0.141.0

### Minor Changes

- 8de61e7: `Button`: `fullWidth?: boolean` → `width?: "full" | "auto"` (default `"auto"`). Bounded Value-Prop statt Boolean-Flag — `width="full"` streckt CTA-Buttons auf Container-Breite, andere Breiten bleiben Layout-Sache des Containers. Ersetzt das erst in 0.140 eingeführte `fullWidth` (noch kein externer Consumer).

### Patch Changes

- @cosmicdrift/kumiko-framework@0.141.0
- @cosmicdrift/kumiko-headless@0.141.0

## 0.140.0

### Minor Changes

- 742f15c: `Button` bekommt `ariaLabel?` (zugänglicher Name für icon-only-Buttons) und `fullWidth?` (streckt CTA-Buttons in Karten/Panels auf volle Breite). Schließt die letzten Button-Lücken aus kumiko-framework#935 — damit werden icon-only-Remove-Buttons und full-width Pricing-/CTA-Buttons ohne rohes `<button>` migrierbar.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.140.0
- @cosmicdrift/kumiko-headless@0.140.0

## 0.139.0

### Minor Changes

- 56ff9cb: Form-Kit / Primitives: `Button` bekommt eine `size`-Achse (`"sm" | "md" | "icon"`, default `"md"`) für kompakte Inline-/Icon-Buttons; neuer `Input`-`kind:"range"` (Slider, min/max/step) plus `RangeField`-Widget; `FileField`-Widget über den bestehenden `kind:"file"|"image"` (FileRef-basiert). Schließt die drei Core-Primitive-Lücken aus kumiko-framework#935.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.139.0
- @cosmicdrift/kumiko-headless@0.139.0

## 0.138.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.138.0
- @cosmicdrift/kumiko-headless@0.138.0

## 0.137.0

### Patch Changes

- Updated dependencies [fdd7c40]
  - @cosmicdrift/kumiko-framework@0.137.0
  - @cosmicdrift/kumiko-headless@0.137.0

## 0.136.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.136.1
- @cosmicdrift/kumiko-headless@0.136.1

## 0.136.0

### Patch Changes

- Updated dependencies [f5a7f51]
  - @cosmicdrift/kumiko-framework@0.136.0
  - @cosmicdrift/kumiko-headless@0.136.0

## 0.135.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.135.0
- @cosmicdrift/kumiko-headless@0.135.0

## 0.134.0

### Minor Changes

- 9eab762: Dashboard-Screen-Typ: vier neue Panel-Kinds — `stat-group` (betitelte Sektion aus mehreren Stat-Panels), `feed` (nicht-tabellarische Kurzliste), `progress-list` (Label/Wert + Fortschrittsbalken) und `custom` (eingehängte App-Komponente über dieselbe extensionSectionComponents-Registry wie entityEdit-Sections und List-Header-Slots, bleibt an ihrer Array-Position). Plus ein screen-weiter `filter` (Combobox-Picker), dessen Wert in jede Panel-Query gemerged wird — nutzt den bestehenden `useQuery`-payloadKey-Refetch, kein neuer Mechanismus. `ExtensionSectionProps` bekommt ein neues optionales `filterParams`-Feld für den `custom`-Mount-Ort.

### Patch Changes

- Updated dependencies [9eab762]
  - @cosmicdrift/kumiko-framework@0.134.0
  - @cosmicdrift/kumiko-headless@0.134.0

## 0.133.0

### Patch Changes

- Updated dependencies [9521906]
  - @cosmicdrift/kumiko-framework@0.133.0
  - @cosmicdrift/kumiko-headless@0.133.0

## 0.132.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.132.0
- @cosmicdrift/kumiko-headless@0.132.0

## 0.131.0

### Minor Changes

- 99008c9: App-Mounting 2.0 Säule B: neuer deklarativer Screen-Typ `dashboard` (stat/chart/list-Panels mit eigenen Queries; Boot-Validator + required-surface-keys; WebDashboardBody via DashboardBodyProvider). projectionList-Row-/Toolbar-Actions unterstützen jetzt `kind: "writeHandler"` (entityList-Dispatch-Pfad inkl. WriteFailedError).
- d814026: App-Mounting 2.0 Säule A: Mid-Level-Widget-Kit in renderer-web (StatCard, MiniStat, SectionCard, StatusBadge, ProgressBar, CollapsibleSection, DetailList, ModeSwitch, StatusBarChart, TimeseriesChart, EmptyState/LoadingState/ErrorState, QueryTable) + Status-Farb-Tokens (--color-status-\*). Neue Hooks useMutation + useDisclosure. Neues Core-Primitive Link (default/button/muted), Button-Variant "link", Text-Variant "muted"; auth-email-password nutzt sie (authButtonClass/authMutedLinkClass entfernt).

### Patch Changes

- Updated dependencies [99008c9]
  - @cosmicdrift/kumiko-framework@0.131.0
  - @cosmicdrift/kumiko-headless@0.131.0

## 0.130.2

### Patch Changes

- 98ed535: Content-Tree + Config-Nav Sysadmin-Shell polish:

  - text-content: Leaf-Knoten tragen jetzt ein `file`-Icon statt eines Dots; der Editor läuft auf der Page-Shell (`Form`-Primitive mit Card statt des entfernten `FormPanelShell`).
  - Sidebar-Nav bekommt ein Suchfeld, das den Baum live filtert (Treffer + ihre Ancestors bleiben, zugeklappte Ordner öffnen für die Suche).
  - Ordner-Knoten zeigen `folder-open` wenn ausgeklappt.
  - NAV_ICONS um `server`, `mail`, `lock`, `hash`, `download`, `folder-open` ergänzt — SMTP-/Config-Nav-Kinder (z.B. „Email-Versand") rendern damit ein Icon statt blank.
  - Verschachtelte Provider-Ordner (Content-Tree) rendern ihre Kinder in einem `<ul>` (valides HTML + Einrück-Stufe pro Tiefe) statt `<li>`-in-`<li>`.
  - Platform-Overview: `user:query:user:list` in der Allowlist (behebt den Overview-Crash).
  - @cosmicdrift/kumiko-framework@0.130.2
  - @cosmicdrift/kumiko-headless@0.130.2

## 0.130.1

### Patch Changes

- Export `translationsByLocaleFromKeys` and `TranslationsByKey` for key-first i18n bundle pivot.
  - @cosmicdrift/kumiko-framework@0.130.1
  - @cosmicdrift/kumiko-headless@0.130.1

## 0.130.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.130.0
- @cosmicdrift/kumiko-headless@0.130.0

## 0.129.0

### Patch Changes

- Updated dependencies [3247676]
  - @cosmicdrift/kumiko-framework@0.129.0
  - @cosmicdrift/kumiko-headless@0.129.0

## 0.128.0

### Patch Changes

- Updated dependencies [d340977]
  - @cosmicdrift/kumiko-headless@0.128.0
  - @cosmicdrift/kumiko-framework@0.128.0

## 0.127.0

### Patch Changes

- Updated dependencies [f5d37a1]
  - @cosmicdrift/kumiko-framework@0.127.0
  - @cosmicdrift/kumiko-headless@0.127.0

## 0.126.0

### Patch Changes

- Updated dependencies [0c482c3]
  - @cosmicdrift/kumiko-framework@0.126.0
  - @cosmicdrift/kumiko-headless@0.126.0

## 0.125.2

### Patch Changes

- a6f3f48: Fix `useTranslation()` returning a new `t` function reference on every render. `LocaleProvider`'s context value and the returned `t` are now memoized, keyed on resolver/fallbackBundles/fallbackLocale/locale identity.

  This caused a production incident: `admin-shell` overview screens use `t` in a `useEffect` dependency array, and the referentially-unstable `t` triggered an infinite render/effect loop (~600 query requests/second against the server).

  - @cosmicdrift/kumiko-framework@0.125.2
  - @cosmicdrift/kumiko-headless@0.125.2

## 0.125.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.125.1
- @cosmicdrift/kumiko-headless@0.125.1

## 0.125.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.125.0
- @cosmicdrift/kumiko-headless@0.125.0

## 0.124.0

### Minor Changes

- 50d7423: renderer: `ModalShell` shared overlay primitive, `LightboxProps` + `DefaultLightbox` for full-size image dialogs, and Apex landing click-to-enlarge via vanilla JS/CSS (no React dependency in static pages).

### Patch Changes

- @cosmicdrift/kumiko-framework@0.124.0
- @cosmicdrift/kumiko-headless@0.124.0

## 0.123.3

### Patch Changes

- @cosmicdrift/kumiko-framework@0.123.3
- @cosmicdrift/kumiko-headless@0.123.3

## 0.123.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.123.2
- @cosmicdrift/kumiko-headless@0.123.2

## 0.123.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.123.1
- @cosmicdrift/kumiko-headless@0.123.1

## 0.123.0

### Patch Changes

- Updated dependencies [b0e70a7]
  - @cosmicdrift/kumiko-headless@0.123.0
  - @cosmicdrift/kumiko-framework@0.123.0

## 0.122.5

### Patch Changes

- @cosmicdrift/kumiko-framework@0.122.5
- @cosmicdrift/kumiko-headless@0.122.5

## 0.122.4

### Patch Changes

- Updated dependencies [2dd0d9e]
  - @cosmicdrift/kumiko-framework@0.122.4
  - @cosmicdrift/kumiko-headless@0.122.4

## 0.122.3

### Patch Changes

- Updated dependencies [1693324]
  - @cosmicdrift/kumiko-framework@0.122.3
  - @cosmicdrift/kumiko-headless@0.122.3

## 0.122.2

### Patch Changes

- Updated dependencies [a9a6d80]
  - @cosmicdrift/kumiko-framework@0.122.2
  - @cosmicdrift/kumiko-headless@0.122.2

## 0.122.1

### Patch Changes

- Updated dependencies [8665f63]
  - @cosmicdrift/kumiko-framework@0.122.1
  - @cosmicdrift/kumiko-headless@0.122.1

## 0.122.0

### Patch Changes

- Updated dependencies [446f933]
- Updated dependencies [e069b64]
  - @cosmicdrift/kumiko-framework@0.122.0
  - @cosmicdrift/kumiko-headless@0.122.0

## 0.121.1

### Patch Changes

- Updated dependencies [0af1fe1]
  - @cosmicdrift/kumiko-framework@0.121.1
  - @cosmicdrift/kumiko-headless@0.121.1

## 0.121.0

### Patch Changes

- Updated dependencies [b679dc1]
  - @cosmicdrift/kumiko-framework@0.121.0
  - @cosmicdrift/kumiko-headless@0.121.0

## 0.120.0

### Patch Changes

- Updated dependencies [29fbdc5]
- Updated dependencies [c22b711]
  - @cosmicdrift/kumiko-framework@0.120.0
  - @cosmicdrift/kumiko-headless@0.120.0

## 0.119.0

### Patch Changes

- Updated dependencies [b01a4d2]
- Updated dependencies [53da660]
- Updated dependencies [6ffb71e]
- Updated dependencies [02670c9]
  - @cosmicdrift/kumiko-framework@0.119.0
  - @cosmicdrift/kumiko-headless@0.119.0

## 0.118.0

### Patch Changes

- Updated dependencies [c5ed4f0]
  - @cosmicdrift/kumiko-framework@0.118.0
  - @cosmicdrift/kumiko-headless@0.118.0

## 0.117.0

### Patch Changes

- Updated dependencies [e5bae38]
  - @cosmicdrift/kumiko-framework@0.117.0
  - @cosmicdrift/kumiko-headless@0.117.0

## 0.116.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.116.1
- @cosmicdrift/kumiko-headless@0.116.1

## 0.116.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.116.0
- @cosmicdrift/kumiko-headless@0.116.0

## 0.115.1

### Patch Changes

- Updated dependencies [7054c74]
  - @cosmicdrift/kumiko-framework@0.115.1
  - @cosmicdrift/kumiko-headless@0.115.1

## 0.115.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.115.0
- @cosmicdrift/kumiko-headless@0.115.0

## 0.114.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.114.0
- @cosmicdrift/kumiko-headless@0.114.0

## 0.113.1

### Patch Changes

- 25b7e6e: Fix: `projectionList` screens now render their `toolbarActions`.

  The `projectionList` screen-type declared `toolbarActions` in its schema, but `ProjectionListBody` never resolved or passed them to `RenderList` — so a declared toolbar button (e.g. a "New …" navigate action) silently didn't render. Now resolved analogous to `rowActions` (navigate-kind in v1) and passed through, matching `entityList` behaviour.

  - @cosmicdrift/kumiko-framework@0.113.1
  - @cosmicdrift/kumiko-headless@0.113.1

## 0.113.0

### Minor Changes

- ba5053b: New `projectionList` screen-type — like `entityList`, but bound to an explicit query instead of an entity.

  `entityList` derives its list-query from the screen's own feature (`<feature>:query:<entity>:list`), so a screen can't list a projection owned by another feature. `projectionList` takes a fully qualified `query` verbatim (e.g. `ledger:query:schedule:list`) — cross-feature by design, and works over any read-model/aggregation, not just entities. Columns carry explicit labels (no entity to derive from), there's no auto create-navigation, and row interaction is explicit via `rowActions`. Reuses the entityList table machinery (RenderList/computeListViewModel) via a synthetic-entity shim; `entityList` is untouched. v1 renders the query rows with navigate row-actions/row-click (no server sort/pagination — a projection query has no guaranteed paged contract).

### Patch Changes

- Updated dependencies [ba5053b]
  - @cosmicdrift/kumiko-framework@0.113.0
  - @cosmicdrift/kumiko-headless@0.113.0

## 0.112.1

### Patch Changes

- Updated dependencies [0b9eb9a]
  - @cosmicdrift/kumiko-framework@0.112.1
  - @cosmicdrift/kumiko-headless@0.112.1

## 0.112.0

### Patch Changes

- Updated dependencies [3714822]
  - @cosmicdrift/kumiko-framework@0.112.0
  - @cosmicdrift/kumiko-headless@0.112.0

## 0.111.0

### Patch Changes

- Updated dependencies [340acef]
  - @cosmicdrift/kumiko-framework@0.111.0
  - @cosmicdrift/kumiko-headless@0.111.0

## 0.110.0

### Patch Changes

- Updated dependencies [3fa4673]
  - @cosmicdrift/kumiko-framework@0.110.0
  - @cosmicdrift/kumiko-headless@0.110.0

## 0.109.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.109.0
- @cosmicdrift/kumiko-headless@0.109.0

## 0.108.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.108.0
- @cosmicdrift/kumiko-headless@0.108.0

## 0.107.0

### Patch Changes

- Updated dependencies [64ff082]
- Updated dependencies [3ff6025]
  - @cosmicdrift/kumiko-framework@0.107.0
  - @cosmicdrift/kumiko-headless@0.107.0

## 0.106.0

### Patch Changes

- Updated dependencies [7944923]
- Updated dependencies [d6fbd00]
  - @cosmicdrift/kumiko-framework@0.106.0
  - @cosmicdrift/kumiko-headless@0.106.0

## 0.105.2

### Patch Changes

- Updated dependencies [a305251]
  - @cosmicdrift/kumiko-framework@0.105.2
  - @cosmicdrift/kumiko-headless@0.105.2

## 0.105.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.105.1
- @cosmicdrift/kumiko-headless@0.105.1

## 0.105.0

### Patch Changes

- Updated dependencies [1918250]
  - @cosmicdrift/kumiko-framework@0.105.0
  - @cosmicdrift/kumiko-headless@0.105.0

## 0.104.0

### Patch Changes

- Updated dependencies [a3c973e]
  - @cosmicdrift/kumiko-framework@0.104.0
  - @cosmicdrift/kumiko-headless@0.104.0

## 0.103.0

### Patch Changes

- Updated dependencies [961d0bb]
  - @cosmicdrift/kumiko-framework@0.103.0
  - @cosmicdrift/kumiko-headless@0.103.0

## 0.102.2

### Patch Changes

- Updated dependencies [cfc5895]
  - @cosmicdrift/kumiko-headless@0.102.2
  - @cosmicdrift/kumiko-framework@0.102.2

## 0.102.1

### Patch Changes

- Updated dependencies [e0b88c7]
  - @cosmicdrift/kumiko-headless@0.102.1
  - @cosmicdrift/kumiko-framework@0.102.1

## 0.102.0

### Patch Changes

- Updated dependencies [4659e52]
- Updated dependencies [020d5e8]
  - @cosmicdrift/kumiko-headless@0.102.0
  - @cosmicdrift/kumiko-framework@0.102.0

## 0.101.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.101.0
- @cosmicdrift/kumiko-headless@0.101.0

## 0.100.0

### Patch Changes

- Updated dependencies [aaf890e]
- Updated dependencies [17b44b3]
  - @cosmicdrift/kumiko-framework@0.100.0
  - @cosmicdrift/kumiko-headless@0.100.0

## 0.99.0

### Patch Changes

- Updated dependencies [8146e5b]
  - @cosmicdrift/kumiko-framework@0.99.0
  - @cosmicdrift/kumiko-headless@0.99.0

## 0.98.0

### Minor Changes

- 4c39e11: tags: production-ready, GitLab-style labels

  - **Colored tags**: a tag's `color` now renders as a contrast-aware chip (`TagChip`, YIQ black/white text), plus a read-only `EntityTags` chip row for cards and detail views.
  - **Shared management UI**: new `TagManager` (catalog CRUD with per-tag usage counts) is mounted both as a standalone `tag-list` management screen and inside a `TagPicker` modal that returns the picked tags to the caller.
  - **Edit + delete**: new `tags:write:update-tag` (optimistic-locked rename / recolor / re-scope) and `tags:write:delete-tag` (cascades over the tag's assignments) handlers.
  - **Optional scope**: a tag carries an optional `scope` (empty = global, or an entity type) — GitLab group-vs-project label parity; the picker only offers global + scope-matching tags.
  - **Drop-in filtering**: `TagSection` (assign/manage on any entity edit) and a `TagFilter` header-slot control that narrows any `entityList` to the rows carrying the picked tags — no host-schema change.
  - **BREAKING**: `tags:write:rename-tag` is removed; use `tags:write:update-tag` (a superset that also updates color and scope).

  renderer: `entityList` faceted filters now accept the base `id` column (operator `in`), and list header-slot components receive the list's `screenId`. Together these let a header control drive the list's url-filter state — the enabling change for the tags `TagFilter` drop-in.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.98.0
- @cosmicdrift/kumiko-headless@0.98.0

## 0.97.1

### Patch Changes

- Updated dependencies [c5410a3]
  - @cosmicdrift/kumiko-framework@0.97.1
  - @cosmicdrift/kumiko-headless@0.97.1

## 0.97.0

### Patch Changes

- Updated dependencies [4e2bd72]
  - @cosmicdrift/kumiko-framework@0.97.0
  - @cosmicdrift/kumiko-headless@0.97.0

## 0.96.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.96.0
- @cosmicdrift/kumiko-headless@0.96.0

## 0.95.0

### Patch Changes

- Updated dependencies [387f259]
- Updated dependencies [da32b71]
  - @cosmicdrift/kumiko-framework@0.95.0
  - @cosmicdrift/kumiko-headless@0.95.0

## 0.94.0

### Patch Changes

- Updated dependencies [31a2abf]
  - @cosmicdrift/kumiko-framework@0.94.0
  - @cosmicdrift/kumiko-headless@0.94.0

## 0.93.0

### Patch Changes

- Updated dependencies [37d0ea4]
  - @cosmicdrift/kumiko-framework@0.93.0
  - @cosmicdrift/kumiko-headless@0.93.0

## 0.92.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.92.0
- @cosmicdrift/kumiko-headless@0.92.0

## 0.91.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.91.0
- @cosmicdrift/kumiko-headless@0.91.0

## 0.90.3

### Patch Changes

- @cosmicdrift/kumiko-framework@0.90.3
- @cosmicdrift/kumiko-headless@0.90.3

## 0.90.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.90.2
- @cosmicdrift/kumiko-headless@0.90.2

## 0.90.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.90.1
- @cosmicdrift/kumiko-headless@0.90.1

## 0.90.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.90.0
- @cosmicdrift/kumiko-headless@0.90.0

## 0.89.0

### Patch Changes

- 4722d4e: entityEdit: omit the Save button when there is nothing to submit. A read-only inspector detail (every field `readOnly`, no create/delete) previously rendered a permanently-disabled Save button, which reads as a broken control. The renderer now drops the Save button entirely when no field is editable and there is no extension section (which carries its own save).
- Updated dependencies [ca33c52]
- Updated dependencies [dbc2c2d]
  - @cosmicdrift/kumiko-framework@0.89.0
  - @cosmicdrift/kumiko-headless@0.89.0

## 0.88.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.88.0
- @cosmicdrift/kumiko-headless@0.88.0

## 0.87.3

### Patch Changes

- Updated dependencies [070c032]
  - @cosmicdrift/kumiko-framework@0.87.3
  - @cosmicdrift/kumiko-headless@0.87.3

## 0.87.2

### Patch Changes

- b04ca86: Fix tenant privilege escalation via membership roles. `hasAccess` checks session roles flat with no notion of origin, so a platform-global role (`SystemAdmin`/`system`) landing in a tenant membership merged into the session and unlocked the SystemAdmin-gated, cross-tenant handler surface — a Tenant-Admin could invite `SystemAdmin` and the invitee gained platform-wide, cross-tenant access.

  Reject reserved/global roles (`system`, `SystemAdmin`, `all`, `anonymous`) at every tenant-membership write chokepoint: `seedTenantMembership` (covers the three invite-accept branches plus seeding), `add-member`, `update-member-roles`, and early in `invite-create`. The bootstrap path was already correct (SystemAdmin lives in global `users.roles`, never in a membership); this makes the invite path consistent.

  Also centralize the `tenantIdOverride` SystemAdmin gate into a new `crossTenantOverrideDenied` helper (exported from `@cosmicdrift/kumiko-framework/engine`), replacing the inline check duplicated across managed-pages, compliance-profiles, text-content and template-resolver so a future override handler can't skip it.

- Updated dependencies [b04ca86]
  - @cosmicdrift/kumiko-framework@0.87.2
  - @cosmicdrift/kumiko-headless@0.87.2

## 0.87.1

### Patch Changes

- cb2abcd: Session bootstrap only mounts behind SessionAuthGate so public SPA gates (e.g. `/rechner`) no longer call `/api/auth/tenants`. Skip refresh when no `kumiko_csrf` cookie is present.
- Updated dependencies [cb2abcd]
  - @cosmicdrift/kumiko-framework@0.87.1
  - @cosmicdrift/kumiko-headless@0.87.1

## 0.87.0

### Patch Changes

- Updated dependencies [c0cbfb5]
  - @cosmicdrift/kumiko-framework@0.87.0
  - @cosmicdrift/kumiko-headless@0.87.0

## 0.86.0

### Patch Changes

- Updated dependencies [0a80617]
  - @cosmicdrift/kumiko-framework@0.86.0
  - @cosmicdrift/kumiko-headless@0.86.0

## 0.85.0

### Patch Changes

- Updated dependencies [2cdfe9d]
  - @cosmicdrift/kumiko-headless@0.85.0
  - @cosmicdrift/kumiko-framework@0.85.0

## 0.84.0

### Patch Changes

- Updated dependencies [189f0cb]
  - @cosmicdrift/kumiko-framework@0.84.0
  - @cosmicdrift/kumiko-headless@0.84.0

## 0.83.0

### Patch Changes

- c2b7154: Diagnosability + i18n completeness for error paths.

  - The HTTP layer now logs unexpected server faults (5xx) at the boundary with the failing handler `type` and the original `cause` stack. Previously a wrapped throw (`InternalError{cause}`) returned a 500 with **zero log lines** — undiagnosable in prod. Expected 4xx outcomes stay unlogged (no noise).
  - Added the generic `errors.*` default translations (`errors.internal`, `errors.notFound`, `errors.access.denied`, `errors.conflict`, `errors.versionConflict`, `errors.uniqueViolation`, `errors.unprocessable`, `errors.unconfigured`, `errors.feature.disabled`, `errors.rate_limited`) plus `errors.download.urlMissing` to the framework default bundle, so no consumer ever renders a raw i18n key as the user-facing message.

- Updated dependencies [c2b7154]
- Updated dependencies [e36a2b0]
  - @cosmicdrift/kumiko-framework@0.83.0
  - @cosmicdrift/kumiko-headless@0.83.0

## 0.82.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.82.0
- @cosmicdrift/kumiko-headless@0.82.0

## 0.81.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.81.1
- @cosmicdrift/kumiko-headless@0.81.1

## 0.81.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.81.0
- @cosmicdrift/kumiko-headless@0.81.0

## 0.80.0

### Minor Changes

- 407ed37: Add a single `Card` primitive (slot- + options-based) and route all card chrome through it.

  `usePrimitives().Card` takes `slots` (`header`/`title`/`subtitle`/`headerActions`/`footer`) and `options` (`padded`/`radius`/`footerBordered`). `DefaultForm` and `DefaultSection` now render through `DefaultCard`, so every consumer gets one consistent chrome (border, radius, shadow, footer row) without re-migrating. `AuthCard` and the `user-data-rights` / `user-profile` self-service screens use it; action buttons live in the card footer. testIds are preserved.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.80.0
- @cosmicdrift/kumiko-headless@0.80.0

## 0.79.3

### Patch Changes

- Updated dependencies [cd34ef3]
  - @cosmicdrift/kumiko-framework@0.79.3
  - @cosmicdrift/kumiko-headless@0.79.3

## 0.79.2

### Patch Changes

- Updated dependencies [335ffef]
  - @cosmicdrift/kumiko-framework@0.79.2
  - @cosmicdrift/kumiko-headless@0.79.2

## 0.79.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.79.1
- @cosmicdrift/kumiko-headless@0.79.1

## 0.79.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.79.0
- @cosmicdrift/kumiko-headless@0.79.0

## 0.78.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.78.0
- @cosmicdrift/kumiko-headless@0.78.0

## 0.77.1

### Patch Changes

- Updated dependencies [b91862b]
  - @cosmicdrift/kumiko-framework@0.77.1
  - @cosmicdrift/kumiko-headless@0.77.1

## 0.77.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.77.0
- @cosmicdrift/kumiko-headless@0.77.0

## 0.76.1

### Patch Changes

- Updated dependencies [491f034]
  - @cosmicdrift/kumiko-framework@0.76.1
  - @cosmicdrift/kumiko-headless@0.76.1

## 0.76.0

### Patch Changes

- Updated dependencies [5828e0c]
  - @cosmicdrift/kumiko-framework@0.76.0
  - @cosmicdrift/kumiko-headless@0.76.0

## 0.75.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.75.0
- @cosmicdrift/kumiko-headless@0.75.0

## 0.74.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.74.0
- @cosmicdrift/kumiko-headless@0.74.0

## 0.73.0

### Minor Changes

- 8aae416: Cross-tenant SystemAdmin admin screens for users + tenants, plus two admin-UI polish fixes

  The bundled `user` and `tenant` features now ship SystemAdmin-gated `entityList` + `entityEdit` screens (`user-list`/`user-edit`, `tenant-list`/`tenant-edit`). Because both features run with `systemScope()`, the lists return every user/tenant across all tenants — the platform-operator roster — with no custom queries. The screens are inert until an app navs them, so existing apps are unaffected; an app gets a full list/detail/edit surface (plus create for users) by adding a single nav entry pointing at the screen. This is the cross-feature gap the boot-validator forbids apps from filling themselves: the screens have to live in the feature that owns the entity.

  The `tenant` feature gained entity-convention handlers (`tenant:query:tenant:{list,detail}`, `tenant:write:tenant:update`) alongside its legacy `tenant:query:list` / `tenant:write:update` ones, so the screens resolve a live data path without renaming anything existing. There is no hard delete (tenants are disabled via `isEnabled`, users go through the GDPR status/forget flow), and the user `roles` field is intentionally not editable from the form (it is a raw-JSON privilege column). A generic `kumiko.actions.edit` default translation backs the list row-action.

  Admin-UI polish: the `DataTable` action column no longer draws a permanent left divider (the sticky background already separates it during horizontal scroll), and `SidebarBrand` only renders its `ChevronsUpDown` affordance when the new optional `collapsible` prop is set — without a wrapping dropdown the chevron suggested a menu that never opened.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.73.0
- @cosmicdrift/kumiko-headless@0.73.0

## 0.72.0

### Patch Changes

- Updated dependencies [a6d3b3b]
  - @cosmicdrift/kumiko-framework@0.72.0
  - @cosmicdrift/kumiko-headless@0.72.0

## 0.71.0

### Patch Changes

- Updated dependencies [0be304e]
- Updated dependencies [7b8d405]
  - @cosmicdrift/kumiko-framework@0.71.0
  - @cosmicdrift/kumiko-headless@0.71.0

## 0.70.0

### Patch Changes

- Updated dependencies [487734f]
  - @cosmicdrift/kumiko-framework@0.70.0
  - @cosmicdrift/kumiko-headless@0.70.0

## 0.69.0

### Minor Changes

- 18b5cc5: UI new-york alignment (framework batch):

  - `<Section>` / `<Form>` carry `subtitle` + an elevated `actions` footer-row; the
    hard header-divider is gone (title flows into the body, shadcn pattern).
  - `DefaultAppShell` gains a `headerActions` slot (right of the breadcrumb) for the
    theme toggle / global actions.
  - `NavTree` + `DefaultAppShell` gain `navBadges` — a per-leaf runtime badge slot
    keyed by bare nav-id; the app supplies value + color (e.g. a tier badge) without
    baking it into the static nav schema.
  - Bundled `ProfileScreen` adopts the one-card-per-section standard (no more card-in-
    card) with a two-column layout for the short account forms; bundled `TagSection`
    moves its create-tag input + button onto one inline row.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.69.0
- @cosmicdrift/kumiko-headless@0.69.0

## 0.68.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.68.0
- @cosmicdrift/kumiko-headless@0.68.0

## 0.67.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.67.1
- @cosmicdrift/kumiko-headless@0.67.1

## 0.67.0

### Patch Changes

- Updated dependencies [d732bde]
  - @cosmicdrift/kumiko-framework@0.67.0
  - @cosmicdrift/kumiko-headless@0.67.0

## 0.66.0

### Minor Changes

- 77ed9c1: Let the config-generated entity-edit form express the common shadcn form
  shapes (title + subtitle, flat single-section layout, domain-specific submit
  CTA). Driven by rebuilding real shadcn reference designs purely from the schema
  to find what the auto-UI couldn't yet do:

  - **Optional section title**: `EditFieldsSection.title` is now optional. A
    title-less section renders just its fields (no `h3`), so a form can be a flat
    "card title + fields directly" layout instead of being forced into a labelled
    sub-section. The whole-form card title/subtitle carries the context.
  - **entityEdit submit label**: `EntityEditScreenDefinition.submitLabel` (i18n key
    or raw string) overrides the generic "Save" — e.g. "Save Address", "Create
    item". Wired through `KumikoScreen` (create + update branches) into the
    existing `RenderEdit` `submitLabel` prop.
  - **Form subtitle**: `FormProps.subtitle` renders a muted line under the form
    title. `RenderEdit` resolves title + subtitle create/edit-aware via
    `screen:<id>.<create|edit>.title` / `.subtitle` (falling back to
    `screen:<id>.title`/`.subtitle`, then the screen id), so a create screen reads
    "Create item / Add a new item to your catalog" and the edit screen differs.

  No breaking changes — existing titled sections and the default save label are
  unaffected. A new `styleguide` "Examples" feature rebuilds the shadcn Shipping
  Address design from a schema as the first config stress-test.

- 7eacfcb: The config-generated edit form now renders `file` / `image` fields as a real
  upload widget — image fields show a round avatar preview + Upload/Change/Remove
  buttons, file fields show an attach control. The file storage backend (POST/GET
  `/api/files`, `FileStorageProvider`, `fileRef` entity) already existed; this
  wires it through to the auto-UI, discovered by rebuilding the shadcn Profile
  design purely from a schema.

  - **Renderer**: `InputProps` gains a `file | image` kind; `RenderField` maps
    `createImageField()`/`createFileField()` to it and threads `accept`, `maxSize`,
    `entityType`, `fieldName`.
  - **Headless**: `EditFieldViewModel` carries those file-field metadata and
    `computeEditViewModel` copies them from the field def.
  - **renderer-web**: a `FileUploadInput` widget POSTs the picked file (multipart,
    with the `X-CSRF-Token` double-submit header) to `/api/files`, stores the
    returned FileRef id as the field value, and previews images via
    `GET /api/files/:id`.
  - **dev-server**: `runDevApp` / `createKumikoServer` gain a `files` option
    (`{ storageProvider }`) threaded to `setupTestStack` (which mounts the upload
    routes + `ctx.files`); an explicitly-wired provider now satisfies the
    `FILE_STORAGE_PROVIDER` boot gate so demos don't need the env bridge.

  The `styleguide` "Examples" feature adds a Profile screen with
  `avatar: createImageField()`; an e2e test proves the upload round-trip
  (pick → POST → preview).

- 15b06c1: Add interactive faceted filters to the auto-generated entity list — the shadcn
  data-table pattern (outline dropdown buttons with multi-select checkboxes, like
  the "Columns" toggle). Each `filterable: true` **select** or **boolean** field
  becomes a facet dropdown in the list toolbar; selecting values filters the list
  server-side and a "Reset" clears all active facets.

  Wiring across the layers:

  - **Query schema** (`defineEntityListHandler`): a new `filters?: Filter[]`
    field next to the existing static `filter?` — additive, no contract break.
    `executor.list` applies the static filter and every dynamic filter with AND
    (the `op:"in"` array path already produced correct `IN (...)` SQL).
  - **Client schema** (`buildAppSchema`): the field-level `filterable` flag is now
    serialized so the renderer knows which fields can be faceted.
  - **URL state** (`useListUrlState`): facet selections live under
    `?<screenId>.f.<field>=v1,v2` keys, page-resetting on change, with
    `setFilter` / `clearFilters`.
  - **Renderer**: `KumikoScreen` derives the facets from the entity's filterable
    select/boolean fields (labels via the existing `field` / `:option:` i18n
    convention) and builds `payload.filters` (booleans coerced from the URL
    strings). New `DataTableFacet` type + `filterFacets` / `filterValues` /
    `onFilterChange` / `onFilterReset` props on `DataTableProps`.
  - **renderer-web**: `DefaultDataTable` renders each facet as a vendored shadcn
    `DropdownMenu` of `DropdownMenuCheckboxItem`s with an active-count badge — no
    new registry primitive.

  Range filters (number/date `lt`/`gt`) are intentionally out of scope; only
  equality facets (select/boolean) are rendered.

### Patch Changes

- Updated dependencies [77ed9c1]
- Updated dependencies [7eacfcb]
- Updated dependencies [15b06c1]
  - @cosmicdrift/kumiko-framework@0.66.0
  - @cosmicdrift/kumiko-headless@0.66.0

## 0.65.0

### Patch Changes

- Updated dependencies [6ac4ff6]
- Updated dependencies [773b368]
- Updated dependencies [1586c8c]
  - @cosmicdrift/kumiko-framework@0.65.0
  - @cosmicdrift/kumiko-headless@0.65.0

## 0.64.0

### Patch Changes

- Updated dependencies [dbd1606]
  - @cosmicdrift/kumiko-framework@0.64.0
  - @cosmicdrift/kumiko-headless@0.64.0

## 0.63.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.63.0
- @cosmicdrift/kumiko-headless@0.63.0

## 0.62.0

### Patch Changes

- Updated dependencies [ee56d33]
  - @cosmicdrift/kumiko-headless@0.62.0
  - @cosmicdrift/kumiko-framework@0.62.0

## 0.61.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.61.0
- @cosmicdrift/kumiko-headless@0.61.0

## 0.60.4

### Patch Changes

- Updated dependencies [7f55219]
  - @cosmicdrift/kumiko-framework@0.60.4
  - @cosmicdrift/kumiko-headless@0.60.4

## 0.60.3

### Patch Changes

- Updated dependencies [af1b957]
  - @cosmicdrift/kumiko-framework@0.60.3
  - @cosmicdrift/kumiko-headless@0.60.3

## 0.60.2

### Patch Changes

- Updated dependencies [68c5fee]
  - @cosmicdrift/kumiko-framework@0.60.2
  - @cosmicdrift/kumiko-headless@0.60.2

## 0.60.1

### Patch Changes

- Updated dependencies [bde2443]
  - @cosmicdrift/kumiko-framework@0.60.1
  - @cosmicdrift/kumiko-headless@0.60.1

## 0.60.0

### Patch Changes

- Updated dependencies [95a4a6c]
- Updated dependencies [16e1457]
- Updated dependencies [22c1ba2]
- Updated dependencies [34cb6e7]
- Updated dependencies [141d29b]
  - @cosmicdrift/kumiko-framework@0.60.0
  - @cosmicdrift/kumiko-headless@0.60.0

## 0.59.2

### Patch Changes

- Updated dependencies [c6018f4]
- Updated dependencies [d57b42f]
- Updated dependencies [fe4dd50]
- Updated dependencies [29aae4d]
- Updated dependencies [6c7262f]
- Updated dependencies [a6c5bf5]
- Updated dependencies [f7e9666]
  - @cosmicdrift/kumiko-framework@0.59.2
  - @cosmicdrift/kumiko-headless@0.59.2

## 0.59.1

### Patch Changes

- 731d87f: Fix silent custom-field data loss in `RenderEdit`. Two related extension-section
  bugs:

  - After a successful entity write, the boolean result of `persistExtensions()`
    was discarded and `onSubmit` fired unconditionally with the success result.
    Callers navigate away on success, unmounting the extension-error banner before
    the user could see that a custom-field section failed to persist. `onSubmit` is
    now suppressed only in the entity-success-but-extension-failure case (via the
    new `shouldNotifyCaller`); entity failures and validation blocks still notify.
  - The section mount resolved its entity-id as `entityId ?? vm.id` while
    `persistExtensions` used `entityId ?? null`. The divergent `vm.id` fallback
    could mount a section editable against an id the persist step then skipped.
    Both now go through `resolveExtensionEntityId` (`entityId ?? null`), so a
    section mounted for editing is always the one that gets written.

  Also adds a dev-warning when a list `header` slot names an extension-section
  component that is not registered, matching the diagnostic banner edit screens
  already show.

- Updated dependencies [99b8220]
- Updated dependencies [31d2d99]
- Updated dependencies [103c5f5]
- Updated dependencies [8a55f62]
  - @cosmicdrift/kumiko-framework@0.59.1
  - @cosmicdrift/kumiko-headless@0.59.1

## 0.59.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.59.0
- @cosmicdrift/kumiko-headless@0.59.0

## 0.58.0

### Patch Changes

- Updated dependencies [9733ddc]
- Updated dependencies [b02c52e]
- Updated dependencies [0202d38]
- Updated dependencies [a3dcb2c]
- Updated dependencies [f9897cd]
  - @cosmicdrift/kumiko-framework@0.58.0
  - @cosmicdrift/kumiko-headless@0.58.0

## 0.57.2

### Patch Changes

- Updated dependencies [99d4489]
  - @cosmicdrift/kumiko-framework@0.57.2
  - @cosmicdrift/kumiko-headless@0.57.2

## 0.57.1

### Patch Changes

- Updated dependencies [d07ef3f]
  - @cosmicdrift/kumiko-framework@0.57.1
  - @cosmicdrift/kumiko-headless@0.57.1

## 0.57.0

### Patch Changes

- 4c32f16: fix(config-mask): cascade-disclosure usability (#429, #430)

  #430: a config save now refetches values+cascade, so the Cascade-Disclosure
  reflects the saved value immediately instead of staying stale until reload
  (customSubmit previously only rebased the form state — onReset already refetched).

  #429: the disclosure trigger moves into the field label row (right-aligned via
  DefaultField's `flex justify-between`); the expanded detail renders between label
  and input (directly under its trigger). A field that only shows its inherited
  default is no longer expandable — no redundant single-row panel.

- Updated dependencies [2e78232]
  - @cosmicdrift/kumiko-framework@0.57.0
  - @cosmicdrift/kumiko-headless@0.57.0

## 0.56.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.56.1
- @cosmicdrift/kumiko-headless@0.56.1

## 0.56.0

### Patch Changes

- Updated dependencies [c9a0ef8]
  - @cosmicdrift/kumiko-framework@0.56.0
  - @cosmicdrift/kumiko-headless@0.56.0

## 0.55.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.55.1
- @cosmicdrift/kumiko-headless@0.55.1

## 0.55.0

### Patch Changes

- Updated dependencies [17fa9ee]
  - @cosmicdrift/kumiko-framework@0.55.0
  - @cosmicdrift/kumiko-headless@0.55.0

## 0.54.0

### Minor Changes

- 1135437: Date/Calendar-Inputs vereinheitlicht (#369): `date` und `timestamp` teilen jetzt
  eine gemeinsame, tippbare Eingabe mit Jahres-/Dekaden-Dropdown im Kalender. Datümer
  sind überall direkt tippbar (locale-aware Parse), nicht mehr nur per Klick. Neu pro
  Feld konfigurierbar: `min`/`max` (Picker-Range + Zod-Durchsetzung beim Write) und
  `locale` (Anzeige-/Eingabe-Format) auf `date`/`timestamp`/`locatedTimestamp`-Feldern.

### Patch Changes

- Updated dependencies [a565b61]
- Updated dependencies [e7a7809]
- Updated dependencies [b2e3a56]
- Updated dependencies [1135437]
  - @cosmicdrift/kumiko-framework@0.54.0
  - @cosmicdrift/kumiko-headless@0.54.0

## 0.53.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.53.0
- @cosmicdrift/kumiko-headless@0.53.0

## 0.52.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.52.0
- @cosmicdrift/kumiko-headless@0.52.0

## 0.51.0

### Patch Changes

- Updated dependencies [ac282fb]
- Updated dependencies [b40187f]
  - @cosmicdrift/kumiko-framework@0.51.0
  - @cosmicdrift/kumiko-headless@0.51.0

## 0.50.0

### Patch Changes

- Updated dependencies [f06e33a]
- Updated dependencies [d8330bc]
- Updated dependencies [8ca4a27]
- Updated dependencies [d8083ae]
- Updated dependencies [eabad73]
- Updated dependencies [6b16dd9]
  - @cosmicdrift/kumiko-framework@0.50.0
  - @cosmicdrift/kumiko-headless@0.50.0

## 0.49.0

### Patch Changes

- Updated dependencies [5d8b8ca]
  - @cosmicdrift/kumiko-framework@0.49.0
  - @cosmicdrift/kumiko-headless@0.49.0

## 0.48.1

### Patch Changes

- Updated dependencies [ec22610]
  - @cosmicdrift/kumiko-framework@0.48.1
  - @cosmicdrift/kumiko-headless@0.48.1

## 0.48.0

### Patch Changes

- Updated dependencies [2852197]
  - @cosmicdrift/kumiko-framework@0.48.0
  - @cosmicdrift/kumiko-headless@0.48.0

## 0.47.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.47.0
- @cosmicdrift/kumiko-headless@0.47.0

## 0.46.0

### Patch Changes

- Updated dependencies [7751b71]
  - @cosmicdrift/kumiko-framework@0.46.0
  - @cosmicdrift/kumiko-headless@0.46.0

## 0.45.1

### Patch Changes

- Updated dependencies [3053ef8]
  - @cosmicdrift/kumiko-framework@0.45.1
  - @cosmicdrift/kumiko-headless@0.45.1

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

- @cosmicdrift/kumiko-framework@0.45.0
- @cosmicdrift/kumiko-headless@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies [b082294]
  - @cosmicdrift/kumiko-framework@0.44.0
  - @cosmicdrift/kumiko-headless@0.44.0

## 0.43.0

### Minor Changes

- 5b04c40: entityList rendert jetzt `screen.slots.header`: eine PlatformComponent
  (`{ react: { __component: "X" } }`) wird über der Tabelle gemountet,
  aufgelöst über dieselbe `ExtensionSectionsProvider`-Registry wie
  entityEdit-Extension-Sections. Im Listen-Kontext bekommt die Component
  `entityName` + `entityId: null`; nicht registriert → kein Header (kein
  Crash). Ermöglicht App-seitige Listen-Header wie einen Cap-Counter, der
  seine Daten selbst lädt.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.43.0
- @cosmicdrift/kumiko-headless@0.43.0

## 0.42.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.42.0
- @cosmicdrift/kumiko-headless@0.42.0

## 0.41.1

### Patch Changes

- Updated dependencies [1e7a66e]
  - @cosmicdrift/kumiko-framework@0.41.1
  - @cosmicdrift/kumiko-headless@0.41.1

## 0.41.0

### Minor Changes

- 3f2d6ee: Event-Store-Doppelkodierungs-Fix, lokaler Event-Dispatcher in runProdApp, update-only entityEdit, actionForm-Extension-Kontext, konfigurierbare custom-fields-Rollen

  - **fix(event-store):** `insertSubsequentEventRow` (und die es-ops-Raw-Inserts
    - `upsertSnapshot`) banden vor-stringifiziertes JSON an `::jsonb` — Bun.SQL
      kodiert einen JS-String erneut, gespeichert wurde ein jsonb-**String-Skalar**
      statt einem Objekt. Betroffen waren alle Events mit version>1 seit dem
      bun-db-Cutover. payload/metadata/state binden jetzt als Objekte; SQL-seitige
      Konsumenten (`payload->>'x'`, GDPR-Pipeline, Ops-Tools) sehen wieder echte
      Objekte. Bestandsdaten brauchen einen einmaligen Repair
      (`SET payload = (payload #>> '{}')::jsonb WHERE jsonb_typeof(payload)='string'`).
  - **feat(runProdApp):** Lokaler Event-Dispatcher per Default an —
    Single-Container-Deployments hatten KEINEN Prozess, der
    `r.multiStreamProjection`-Projektionen anwendet (Read-Seiten blieben still
    leer). `createApiEntrypoint` bekommt `eventDispatcher: { runLocal: true }`
    (processLane "both"), runProdApp aktiviert das automatisch; Opt-out via
    `eventDispatcher: { disabled: true }` für Setups mit dezidiertem Worker.
  - **feat(entityEdit):** `allowCreate?: boolean` / `allowDelete?: boolean`
    (Default true) für Lifecycle-Entities ohne CRUD-create/-delete: unterdrückt
    den automatischen „+ Neu"-Button auf entityList-Screens bzw. den
    Löschen-Button im Update-Form; Aufruf ohne entityId rendert bei
    `allowCreate: false` einen Fehler statt eines Create-Forms.
  - **feat(actionForm):** Extension-Sections erhalten die initialen Form-Values
    (inkl. `?param=`-Prefill) als `initialValues` — Kontext-Sections wie eine
    Update-Timeline können den Row-Bezug daraus lesen.
  - **feat(custom-fields):** `createCustomFieldsFeature({ valueWriteRoles,
fieldDefinitionListRoles })` — Apps mit eigenem Rollen-Vokabular (z.B.
    "Admin"/"Editor") überschreiben damit die RBAC der von der
    CustomFieldsFormSection hart dispatchten Bundle-QNs (set/clear-custom-field,
    field-definition:list). Default unverändert TenantAdmin/TenantMember.

### Patch Changes

- Updated dependencies [3f2d6ee]
  - @cosmicdrift/kumiko-framework@0.41.0
  - @cosmicdrift/kumiko-headless@0.41.0

## 0.40.1

### Patch Changes

- Updated dependencies [667c79b]
  - @cosmicdrift/kumiko-framework@0.40.1
  - @cosmicdrift/kumiko-headless@0.40.1

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

- Updated dependencies [d10ef7e]
- Updated dependencies [64a51ac]
  - @cosmicdrift/kumiko-framework@0.40.0
  - @cosmicdrift/kumiko-headless@0.40.0

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
  - @cosmicdrift/kumiko-framework@0.39.0
  - @cosmicdrift/kumiko-headless@0.39.0

## 0.38.0

### Patch Changes

- 0f093f1: Review-findings behavior wave (15 findings, incl. 1 High):

  - **framework:** `buildAppSchema` dev-assertion actually fires now — the JSON-roundtrip comparison could never detect leaked functions (both sides drop them identically); replaced with a `findNonJsonSafePath` walker that reports the offending path and treats PlatformComponent slots as opaque (High). TenantDb `readWhere` now permits NARROWING within the enforced `[own, SYSTEM]` scope (callers can exclude SYSTEM reference rows at the DB instead of post-filtering after a limit; widening remains impossible — covered by new where-merge tests). Boot-validator survives a missing `section.component` with the intended boot error instead of crashing. msp-rebuild throws `InternalError` consistently.
  - **headless:** `applyFormatSpec` priority renders its `emptyLabel` ("—") for empty values again instead of collapsing to "" (regression vs. the old callback); `escapeHtmlAttr` escapes `'` (superset of `escapeHtml`, restores the apostrophe-escaping legal-pages had before the dedup).
  - **renderer:** `dispatcherErrorText` passes `error.i18nParams` to translate — placeholders no longer render raw.
  - **dev-server:** SPA fallback also answers HEAD (parity with prod).
  - **bundled-features:** invite-accept checks alreadyMember directly against the memberships projection (the filtered `tenant:query:memberships` made re-invites into disabled tenants hit the unique constraint); template-resolver list excludes SYSTEM rows at the DB (no post-filter starvation of the 500-row limit); custom-fields form: clearing a stored value dispatches `clear-custom-field` and dirty compares against initialValues (covered by new clear-path tests); Stripe env accepts restricted `rk_` keys; tenant-switcher uses `||` so empty names fall back; `inviteEmailMismatch` error factory.

- Updated dependencies [8becbed]
- Updated dependencies [0f093f1]
- Updated dependencies [ffcce8a]
- Updated dependencies [7a00d80]
  - @cosmicdrift/kumiko-framework@0.38.0
  - @cosmicdrift/kumiko-headless@0.38.0

## 0.37.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.37.0
- @cosmicdrift/kumiko-headless@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies [d84a515]
  - @cosmicdrift/kumiko-framework@0.36.0
  - @cosmicdrift/kumiko-headless@0.36.0

## 0.35.0

### Patch Changes

- Updated dependencies [6553405]
  - @cosmicdrift/kumiko-framework@0.35.0
  - @cosmicdrift/kumiko-headless@0.35.0

## 0.34.2

### Patch Changes

- ce4a16f: Set-Value-UI: gespeicherte customField-Werte beim Edit anzeigen (nicht write-only)

  Die `CustomFieldsFormSection` lud nur die Field-Definitionen, nie die
  gespeicherten Werte der Entity — die Inputs starteten beim Edit immer leer.
  Set-Value war damit „write-only": man konnte Werte setzen, sah den Bestand
  aber nie (Read-Back nach Reload war leer).

  Fix: `ExtensionSectionProps` bekommt `initialValues`; `EntityEditUpdateForm`
  reicht `record.customFields` (aus der detail-row) über `RenderEdit` an die
  Section durch. Die Section füllt die Inputs daraus, `pending` trackt nur
  Änderungen (Save bleibt bis zur ersten Eingabe disabled, nur geänderte
  Felder werden geschrieben). Folgt auf den create-mode-Fix (0.34.1).

  - @cosmicdrift/kumiko-framework@0.34.2
  - @cosmicdrift/kumiko-headless@0.34.2

## 0.34.1

### Patch Changes

- 689133c: Set-Value-UI: Extension-Section bekommt im Edit-Mode die echte entity-id

  `RenderEdit` mountete extension-sections (Custom-Fields-Set-Value-UI) mit
  `entityId={vm.id}` (= `values["id"]`). Der Update-Form lässt `id` aber
  bewusst aus den Form-values (id ist keine deklarierte Field), also war
  `vm.id` im Edit immer `undefined` → die Section blieb fälschlich im
  create-mode ("Save the entity first") obwohl die Entity längst existiert.
  Bug seit der Extension-Section-Einführung. Fix: `EntityEditUpdateForm`
  reicht die route-`entityId` explizit über die neue `RenderEdit`-prop durch;
  Create-/ActionForm-/ConfigEdit-Pfade fallen unverändert auf `vm.id` zurück.

  - @cosmicdrift/kumiko-framework@0.34.1
  - @cosmicdrift/kumiko-headless@0.34.1

## 0.34.0

### Minor Changes

- 9be544f: feat(screen-types): declarative FieldCondition and RowFieldExtractor replace function props

  `FieldCondition` is now a JSON-safe union (`boolean | { field, eq } | { field, ne }`) instead of `(data, ctx) => boolean`. `visible`, `readOnly`, and `required` on `EditFieldSpec` and row-action props use the new declarative form. `RowFieldExtractor` props (`entityId`, `params`, `payload`) are also declarative (`"fieldName"` / `{ pick }` / `{ map }`). All function-form props are removed — they were silently dropped by `JSON.stringify` in schema-injection.

### Patch Changes

- Updated dependencies [9be544f]
  - @cosmicdrift/kumiko-framework@0.34.0
  - @cosmicdrift/kumiko-headless@0.34.0

## 0.33.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.33.0
- @cosmicdrift/kumiko-headless@0.33.0

## 0.32.1

### Patch Changes

- b418259: navigate-Row-Actions: deklarativer entityId-Default für entityEdit-Ziele

  `action.entityId` ist eine Function und überlebt JSON-injizierte
  Schemas (`window.__KUMIKO_SCHEMA__`) nicht. Zielt die Action auf einen
  entityEdit-Screen, greift jetzt `row.id` als Default — der Edit öffnet
  auch in JSON-Schema-Apps im Update-Mode statt im Create-Mode.
  actionForm-/Custom-Ziele bekommen weiterhin KEINE entityId.

  - @cosmicdrift/kumiko-framework@0.32.1
  - @cosmicdrift/kumiko-headless@0.32.1

## 0.32.0

### Minor Changes

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

### Patch Changes

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

- Updated dependencies [05c4447]
- Updated dependencies [0009486]
  - @cosmicdrift/kumiko-framework@0.32.0
  - @cosmicdrift/kumiko-headless@0.32.0

## 0.31.1

### Patch Changes

- Updated dependencies [6f79d05]
  - @cosmicdrift/kumiko-framework@0.31.1
  - @cosmicdrift/kumiko-headless@0.31.1

## 0.31.0

### Patch Changes

- Updated dependencies [b74ddbe]
- Updated dependencies [5b1a594]
  - @cosmicdrift/kumiko-framework@0.31.0
  - @cosmicdrift/kumiko-headless@0.31.0

## 0.30.0

### Patch Changes

- Updated dependencies [00020b4]
  - @cosmicdrift/kumiko-framework@0.30.0
  - @cosmicdrift/kumiko-headless@0.30.0

## 0.29.0

### Patch Changes

- Updated dependencies [f9d41ae]
- Updated dependencies [290a05b]
- Updated dependencies [3186d8a]
  - @cosmicdrift/kumiko-framework@0.29.0
  - @cosmicdrift/kumiko-headless@0.29.0

## 0.28.0

### Patch Changes

- Updated dependencies [743db9b]
- Updated dependencies [e42fef9]
  - @cosmicdrift/kumiko-framework@0.28.0
  - @cosmicdrift/kumiko-headless@0.28.0

## 0.27.0

### Patch Changes

- Updated dependencies [ea365d1]
  - @cosmicdrift/kumiko-framework@0.27.0
  - @cosmicdrift/kumiko-headless@0.27.0

## 0.26.0

### Patch Changes

- 4911a41: fix(render-field): forward the app i18n locale (`useLocale`) to money/date inputs. Previously they fell back to `navigator.language` (browser language) — `money` only honoured an explicit `field.locale`, `date`/`timestamp` passed no locale at all. When the app language differed from the browser language this caused a decimal-separator mismatch (comma vs. period). `field.locale` still overrides the app locale.
  - @cosmicdrift/kumiko-framework@0.26.0
  - @cosmicdrift/kumiko-headless@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [924d48c]
  - @cosmicdrift/kumiko-framework@0.25.0
  - @cosmicdrift/kumiko-headless@0.25.0

## 0.24.1

### Patch Changes

- 52cd396: Fix a batch of "wrong-api" issues surfaced in PR review:

  - **`runProdApp` boot-path now reads the injected `envSource`, not the real
    `process.env`.** `requireEnv`/`readEnv`, the `PORT` read, and the
    `KUMIKO_SKIP_ES_OPS` guard all thread the validated env-source (default
    `process.env`), so a caller injecting env (tests / mirrored boot) fully
    controls configuration instead of silently picking up ambient values.
  - **`set-custom-field` embedded validation is now type-shape only.** Embedded
    sub-fields had their `required`/`maxLength`/`format`/`default` constraints
    stripped at the top level but not per sub-field, so a required sub-field
    still rejected missing/empty values — contrary to the documented
    "type-mismatches and ONLY type-mismatches" contract. Embedded values with a
    missing or empty required sub-field are now accepted (the constraint is
    enforced elsewhere, not at set-time), matching the top-level behavior.
  - **`useExtensionSectionComponent(name?)` accepts an optional name**, mirroring
    `useColumnRenderer`, so callers can invoke the hook unconditionally without
    passing a `""` stub.
  - **`kumiko init-deploy` scaffolds into `ctx.cwd`** (not `process.cwd()`) and
    derives the displayed paths via `node:path` `relative(ctx.cwd, …)`, so the
    write target and the printed paths share one root under injected working
    directories.
  - Generated dev-app comment uses the valid `bunx kumiko dev` invocation.

- Updated dependencies [35d5833]
- Updated dependencies [6079a87]
- Updated dependencies [52cd396]
- Updated dependencies [c5fe2ba]
  - @cosmicdrift/kumiko-framework@0.24.1
  - @cosmicdrift/kumiko-headless@0.24.1

## 0.24.0

### Patch Changes

- Updated dependencies [c5b7d99]
  - @cosmicdrift/kumiko-framework@0.24.0
  - @cosmicdrift/kumiko-headless@0.24.0

## 0.23.1

### Patch Changes

- Updated dependencies [88d492a]
  - @cosmicdrift/kumiko-framework@0.23.1
  - @cosmicdrift/kumiko-headless@0.23.1

## 0.23.0

### Patch Changes

- Updated dependencies [e27b7b7]
- Updated dependencies [8289134]
  - @cosmicdrift/kumiko-framework@0.23.0
  - @cosmicdrift/kumiko-headless@0.23.0

## 0.22.0

### Minor Changes

- dcc8d4c: `EditSectionSpec` ist jetzt eine Discriminated Union mit `kind?: "fields"` (default, backwards-compat) und `kind: "extension"` (mountet eine feature-bereitgestellte Component). `EditSectionViewModel` parallel als Union (`kind` required). Neue exports: `EditFieldsSection`, `EditExtensionSection`, `EditFieldsSectionViewModel`, `EditExtensionSectionViewModel`, plus Type-Guard `isExtensionEditSection(section)`. Boot-Validator validiert den component-Marker für extension-sections im entityEdit-Block. Bestehende screens (kind weggelassen) rendern unverändert.
- dcc8d4c: `ExtensionSectionsProvider` + `useExtensionSectionComponent(name)`-Hook für client-side Component-Auflösung im entityEdit-Screen via `__component`-Marker. Apps registrieren Components über das neue `ClientFeatureDefinition.extensionSectionComponents`-Feld (Pattern analog zu `columnRenderers`, Last-Wins-Semantik bei Multi-Feature-Kollision). `createKumikoApp` aggregiert + mountet den Provider automatisch. RenderEdit mountet die aufgelöste Component mit `{ entityName, entityId }`; fehlt die Registrierung → Banner mit dem gesuchten Component-Namen.

### Patch Changes

- Updated dependencies [dcc8d4c]
- Updated dependencies [4156981]
  - @cosmicdrift/kumiko-framework@0.22.0
  - @cosmicdrift/kumiko-headless@0.22.0

## 0.21.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.21.1
- @cosmicdrift/kumiko-headless@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [c1a044b]
  - @cosmicdrift/kumiko-framework@0.21.0
  - @cosmicdrift/kumiko-headless@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [6777250]
  - @cosmicdrift/kumiko-framework@0.20.0
  - @cosmicdrift/kumiko-headless@0.20.0

## 0.19.1

### Patch Changes

- a146fc4: Add shared boot-seed contract (`SeedIfExists`, `runEventStoreSeed`) and default skip-if-exists for `seedTextBlock` / `seedComplianceProfile`.
- Updated dependencies [a146fc4]
  - @cosmicdrift/kumiko-framework@0.19.1
  - @cosmicdrift/kumiko-headless@0.19.1

## 0.19.0

### Patch Changes

- Updated dependencies [2c84510]
  - @cosmicdrift/kumiko-framework@0.19.0
  - @cosmicdrift/kumiko-headless@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [ff49c38]
  - @cosmicdrift/kumiko-framework@0.18.0
  - @cosmicdrift/kumiko-headless@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [239e9dc]
  - @cosmicdrift/kumiko-framework@0.17.0
  - @cosmicdrift/kumiko-headless@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [1dcc743]
- Updated dependencies [9aeabb3]
  - @cosmicdrift/kumiko-framework@0.16.0
  - @cosmicdrift/kumiko-headless@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [5a7f7ac]
  - @cosmicdrift/kumiko-framework@0.15.0
  - @cosmicdrift/kumiko-headless@0.15.0

## 0.14.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.14.0
- @cosmicdrift/kumiko-headless@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [7f56b2f]
  - @cosmicdrift/kumiko-framework@0.13.0
  - @cosmicdrift/kumiko-headless@0.13.0

## 0.12.2

### Patch Changes

- Updated dependencies [597de52]
  - @cosmicdrift/kumiko-framework@0.12.2
  - @cosmicdrift/kumiko-headless@0.12.2

## 0.12.1

### Patch Changes

- Updated dependencies [f2ad7c4]
  - @cosmicdrift/kumiko-framework@0.12.1
  - @cosmicdrift/kumiko-headless@0.12.1

## 0.12.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.12.0
- @cosmicdrift/kumiko-headless@0.12.0

## 0.11.2

### Patch Changes

- Updated dependencies [92a84f0]
  - @cosmicdrift/kumiko-framework@0.11.2
  - @cosmicdrift/kumiko-headless@0.11.2

## 0.11.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.11.1
- @cosmicdrift/kumiko-headless@0.11.1

## 0.11.0

### Patch Changes

- Updated dependencies [30ea981]
- Updated dependencies [9347212]
  - @cosmicdrift/kumiko-framework@0.11.0
  - @cosmicdrift/kumiko-headless@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies [d06f029]
- Updated dependencies [753d392]
  - @cosmicdrift/kumiko-framework@0.10.0
  - @cosmicdrift/kumiko-headless@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [51e22f5]
  - @cosmicdrift/kumiko-framework@0.9.0
  - @cosmicdrift/kumiko-headless@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies [4b5f91e]
  - @cosmicdrift/kumiko-framework@0.8.1
  - @cosmicdrift/kumiko-headless@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies [f34af9a]
- Updated dependencies [dff4123]
  - @cosmicdrift/kumiko-framework@0.8.0
  - @cosmicdrift/kumiko-headless@0.8.0

## 0.7.0

### Minor Changes

- bcf43b6: es-ops: `SeedMembershipRow` exposes `streamTenantId` (stream-tenant aus `kumiko_events.v1`) neben dem payload-`tenantId`. Seed-Authors müssen den `kumiko_events`-JOIN nicht mehr selbst bauen — `m.streamTenantId` ist der korrekte Wert für `systemWriteAs`'s `tenantIdOverride` wenn das Aggregate von einem fremden Executor angelegt wurde (typisches `seedTenantMembership(by=systemAdmin)`-Pattern).

### Patch Changes

- Updated dependencies [bcf43b6]
  - @cosmicdrift/kumiko-framework@0.7.0
  - @cosmicdrift/kumiko-headless@0.7.0

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
  - @cosmicdrift/kumiko-framework@0.6.0
  - @cosmicdrift/kumiko-headless@0.6.0

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
  - @cosmicdrift/kumiko-framework@0.5.2
  - @cosmicdrift/kumiko-headless@0.5.2

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
  - @cosmicdrift/kumiko-framework@0.5.1
  - @cosmicdrift/kumiko-headless@0.5.1

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
  - @cosmicdrift/kumiko-framework@0.5.0
  - @cosmicdrift/kumiko-headless@0.5.0

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
  - @cosmicdrift/kumiko-framework@0.4.1
  - @cosmicdrift/kumiko-headless@0.4.1

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
  - @cosmicdrift/kumiko-framework@0.4.0
  - @cosmicdrift/kumiko-headless@0.4.0

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
  - @cosmicdrift/kumiko-framework@0.3.0
  - @cosmicdrift/kumiko-headless@0.3.0

## 0.2.3

### Patch Changes

- @cosmicdrift/kumiko-framework@0.2.3
- @cosmicdrift/kumiko-headless@0.2.3

## 0.2.2

### Patch Changes

- 7a7da3e: Re-publish 0.2.1 → 0.2.2 mit korrekt aufgelösten cross-package-Versionen.
  0.2.1 hatte `workspace:*` als Wert in den dependencies (npm publish ohne
  yarn-pack rewrite), Konsumenten bekamen "Workspace not found".

  publish-with-oidc.sh nutzt jetzt `yarn pack` (rewrited workspace:\*) +
  `npm publish <tarball>` (OIDC + provenance).

- Updated dependencies [7a7da3e]
  - @cosmicdrift/kumiko-framework@0.2.2
  - @cosmicdrift/kumiko-headless@0.2.2

## 0.2.1

### Patch Changes

- 48b7f6a: CI: switch publish to npm-CLI with OIDC Trusted Publishing + provenance.
  No source changes — verifies the new publish path produces a verified-
  provenance attestation on npmjs.com instead of token-based publish.
- Updated dependencies [48b7f6a]
  - @cosmicdrift/kumiko-framework@0.2.1
  - @cosmicdrift/kumiko-headless@0.2.1

## 0.2.0

### Minor Changes

- 6c70b6f: fix(tenant): seedTenant idempotent gegen Event-Store-Projection-Drift.

  Verhindert version_conflict beim App-Boot wenn Aggregat existiert aber
  Projection-Row fehlt (rebuild-drift, async-lag, manueller DB-Eingriff).

### Patch Changes

- Updated dependencies [6c70b6f]
  - @cosmicdrift/kumiko-framework@0.2.0
  - @cosmicdrift/kumiko-headless@0.2.0

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
  - @cosmicdrift/kumiko-framework@0.1.0
  - @cosmicdrift/kumiko-headless@0.1.0
