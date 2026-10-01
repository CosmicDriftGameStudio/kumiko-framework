# @cosmicdrift/kumiko-dev-server

## 0.331.0

### Patch Changes

- Updated dependencies [c398ed1]
- Updated dependencies [d22049b]
- Updated dependencies [16797a4]
- Updated dependencies [6b95958]
- Updated dependencies [e6b971c]
- Updated dependencies [50ddb3c]
- Updated dependencies [3ea4ffc]
- Updated dependencies [0dc0b1f]
- Updated dependencies [e4ea9f0]
- Updated dependencies [d22049b]
  - @cosmicdrift/kumiko-renderer-web@0.331.0
  - @cosmicdrift/kumiko-framework@0.331.0
  - @cosmicdrift/kumiko-headless@0.331.0
  - @cosmicdrift/kumiko-bundled-features@0.331.0
  - @cosmicdrift/kumiko-server-runtime@0.331.0

## 0.330.2

### Patch Changes

- Updated dependencies [32a6102]
  - @cosmicdrift/kumiko-framework@0.330.2
  - @cosmicdrift/kumiko-bundled-features@0.330.2
  - @cosmicdrift/kumiko-headless@0.330.2
  - @cosmicdrift/kumiko-renderer-web@0.330.2
  - @cosmicdrift/kumiko-server-runtime@0.330.2

## 0.330.1

### Patch Changes

- Updated dependencies [d064b0d]
- Updated dependencies [5bc2a13]
- Updated dependencies [63a63d6]
- Updated dependencies [39c2fbd]
- Updated dependencies [03ad4bc]
  - @cosmicdrift/kumiko-renderer-web@0.330.1
  - @cosmicdrift/kumiko-framework@0.330.1
  - @cosmicdrift/kumiko-bundled-features@0.330.1
  - @cosmicdrift/kumiko-server-runtime@0.330.1
  - @cosmicdrift/kumiko-headless@0.330.1

## 0.330.0

### Patch Changes

- 7a886f1: Published `.d.ts` resolve without extra setup; READMEs ship; renderer-web is a declared dependency

  The emitted declarations that mention `Temporal` or `Bun` now carry a preserved `/// <reference types>` for `temporal-polyfill/global` and `bun-types`, so a consumer without `bun-types` in its tsconfig no longer gets unresolved `Temporal`/`Bun` errors from our declarations. `kumiko-server-runtime` and `kumiko-dev-server` declare `@cosmicdrift/kumiko-renderer-web` as a dependency (they resolve its `styles.css`; it was already installed through bundled-features) and `bun-types` as a dependency. `bundled-features`, `server-runtime`, `dev-server`, `dispatcher-live`, `headless`, `renderer`, `renderer-web` and `cli` ship the README.md their `files` list already named. `bun run check:dist` now typechecks the packed install, checks README shipping, runtime-resolved package declarations and the `styles.css` resolve.

  <!-- kumiko-changes
  feature: server-runtime
  type: fix
  title: server-runtime and dev-server declare their renderer-web dependency and their .d.ts resolve Bun and Temporal types without consumer setup
  -->

- 48f36df: kumiko-server-runtime and kumiko-dev-server are published as compiled JavaScript plus .d.ts

  Both packages now ship `dist` (`.js` and `.d.ts`) instead of TypeScript source. Export keys are unchanged; only the targets behind them move to `dist`. `kumiko-dev-server` keeps its `bin/*.ts` entrypoints (they still need Bun) and ships them together with `templates`; they now import through the new `@cosmicdrift/kumiko-dev-server/cli` export instead of reaching into `src`. `kumiko-server-runtime` now declares `ioredis` and `kumiko-dev-server` declares `zod` as dependencies, which their code already imported. `ioredis` is imported as a named `{ Redis }` so the class resolves under Node's ESM loader.

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: kumiko-server-runtime and kumiko-dev-server are published as compiled JavaScript plus .d.ts
  -->

- Updated dependencies [7a886f1]
- Updated dependencies [dc5981b]
- Updated dependencies [89e32ce]
- Updated dependencies [7a886f1]
- Updated dependencies [89e32ce]
- Updated dependencies [89e32ce]
- Updated dependencies [7a886f1]
- Updated dependencies [f19fb5c]
- Updated dependencies [1e18129]
- Updated dependencies [1e18129]
- Updated dependencies [1e18129]
- Updated dependencies [48f36df]
- Updated dependencies [89e32ce]
- Updated dependencies [f0dabdf]
  - @cosmicdrift/kumiko-bundled-features@0.330.0
  - @cosmicdrift/kumiko-framework@0.330.0
  - @cosmicdrift/kumiko-renderer-web@0.330.0
  - @cosmicdrift/kumiko-server-runtime@0.330.0
  - @cosmicdrift/kumiko-headless@0.330.0

## 0.329.0

### Patch Changes

- Updated dependencies [80ccc38]
- Updated dependencies [9bbdb64]
  - @cosmicdrift/kumiko-bundled-features@0.329.0
  - @cosmicdrift/kumiko-framework@0.329.0
  - @cosmicdrift/kumiko-server-runtime@0.329.0
  - @cosmicdrift/kumiko-headless@0.329.0

## 0.328.1

### Patch Changes

- Updated dependencies [51a6a91]
- Updated dependencies [863e8e4]
- Updated dependencies [86451dd]
  - @cosmicdrift/kumiko-headless@0.328.1
  - @cosmicdrift/kumiko-framework@0.328.1
  - @cosmicdrift/kumiko-bundled-features@0.328.1
  - @cosmicdrift/kumiko-server-runtime@0.328.1

## 0.328.0

### Minor Changes

- c3fbe54: setupTestStack can wire job run-logger callbacks, and setupTestStackFromFeatures does so by default

  `TestStackOptions.jobs.runLogger` receives `{ registry, db }` and returns `onJobStart`/`onJobComplete`/`onJobFailed`. The stack awaits them before drainJobs() observes the outcome, so a log row is always written before drainJobs() resolves or rejects. `setupTestStackFromFeatures` (and with it `setupAppTestStack`) defaults to the same `jobRunLoggerCallbacks` prod uses whenever `jobs` is set and the jobs feature is mounted, so `tenantVisibleFailure` rows and `jobs:query:failures` work in tests without a hand-built harness. Such suites now write `job_runs` and tenant failure rows for every job run; a suite that counts those rows, or that wants the old behavior, passes its own `jobs.runLogger` (for example one returning `undefined`).

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: setupTestStack can wire job run-logger callbacks, and setupTestStackFromFeatures does so by default
  -->

- 822928f: UI design defaults: fixed-height screens, warm-neutral tokens, IBM Plex

  Declarative screens now follow the Kumiko design refresh. List, detail, form, action form and wizard screens fill the shell height by default (`fillHeight`, opt out with `fillHeight: false` on the screen to get page scrolling back). The renderer ships IBM Plex Sans and Mono instead of hard-wiring Inter (apps that expect Inter set `--font-sans`), uses warm-neutral light and dark tokens with 6px radius, and redesigns pager, row actions, select presentation, form and wizard footers and the detail layout. New optional schema fields (`createLabel`, `searchPlaceholder`, option tones, `description`, `itemNoun`, `valueType`, `summary`, `hideOnNarrow`) and widgets (`PageHeader`, `MetricBand`, `SideBySideTable`) are additive. See docs/reference/theming.md and docs/reference/screen-layout.md.

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Screens fill the shell height by default
  detail: |
    entityList, projectionList, projectionDetail, entityEdit, actionForm and wizard screens now fill the height of the shell content. The table or the form body scrolls inside, the toolbar stays on top and the pager or action bar stays pinned at the bottom (`scrollBody`, `stickyActions`). The shell header is 56px. Custom screens and direct DataTable or Form usage are unchanged.
  migration: |
    Set `fillHeight: false` on a screen to restore the old page scrolling (table grows with its rows, pager below the last row, form footer in the flow). Apps with e2e or screenshot tests that scroll the page to reach the pager or the form footer need to adjust them or opt out per screen.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Pager shows a status line, page size select and Page X of Y instead of page numbers
  detail: |
    The numbered page list is gone. The list footer shows "1-19 of 19 <entities>" (with the entity plural label when known), "Page X of Y", previous and next buttons and a page size select (25, 50, 100). Lists without a pager show a plain entry count. The chosen size is kept in the URL under `<screen>.size`.
  migration: |
    Remove code and tests that click numbered page buttons (`-page-N` test ids); use the next and previous buttons. The screen's declared `pageSize` stays the default, `<screen>.size` in the URL overrides it. The new keys `kumiko.pager.pageOf`, `kumiko.pager.status.noun`, `kumiko.pager.pageSize`, `kumiko.pager.pageSizeLabel`, `kumiko.list.count.*` exist in en, de and es; apps with their own locale need them too.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: rowActionMode adaptive has new semantics and mobile rows lose the kebab for plain navigation
  detail: |
    With `rowActionMode: "adaptive"` (the default), a table with `onRowClick` renders the first cell as a keyboard-operable link and puts all row actions into the kebab. Without `onRowClick` the primary row action is a link-button and the remaining actions go into the kebab (a single action gets no kebab). Below the md breakpoint a row that only navigates shows a chevron and no kebab.
  migration: |
    Code or tests that expect up to two inline row action buttons must open the kebab or use `rowActionMode: "inline"`, which is unchanged. To keep a visible action next to the row link, drop `onRowClick` and declare the action as the primary row action.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Form, wizard and detail screens use the board layout
  detail: |
    Screen forms have no card, sections are separated by lines, fields flow in rows with widths by type (text 240px, number 96px, money 160px, date and select 200px, textarea full row) and the page title lives in the shell header. Delete and Copy link move into the header kebab, the footer reads status, Cancel, Save, and the wizard footer has no Cancel. Wizard steps sit in a vertical rail from the lg breakpoint. The first detail header action is a button, further ones sit in the kebab. Detail screens have no header card and use the full width: metrics render as a dl band, tabs are underlined only when active, related lists are full-bleed with a count footer. Required-field asterisks are omitted when every field is required and "All fields are required." is shown instead.
  migration: |
    Adjust screenshots and DOM tests that pin the old card layout. `fillHeight: false` restores page scrolling only; the footer order, the moved actions and the new field layout apply in both modes. Empty list cells render a dash.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: PageHeader slot, MetricBand, wizard Save and close, drawer row actions with unsaved-input guard
  detail: |
    Core primitives `PageHeader` (status and actions portalled into the shell header when a shell provides the slot, otherwise the caller keeps its placement) and `MetricBand` (borderless dl of metrics) are new and optional. Wizards on an existing record show "Save and close". Row actions and related list row actions with `kind: "drawer"` open the action form in a flush drawer. Closing it with unsaved input (X, Escape, overlay, Cancel) asks for confirmation first; nothing is asked after a successful submit. Row action drawers are prefilled from the row through `params`. The action form `summary` renders a context box above the fields.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Related list no longer claims "showing the first N entries" for a complete list
  detail: |
    The hint "Zeigt die ersten 1 Einträge. Es gibt weitere, die hier nicht angezeigt werden." appeared for a single row even when nothing else existed. It now appears only when more rows exist than were loaded.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: breaking
  title: IBM Plex replaces Inter as the default typeface
  detail: |
    renderer-web ships IBM Plex Sans (400, 500, 600) and IBM Plex Mono (400, 500) as self-hosted woff2 files under the SIL Open Font License. `--font-sans` and `--font-mono` default to Plex. Inter is no longer wired in.
  migration: |
    Apps that expect Inter set `--font-sans` (and load the font themselves) in their styles.css or through the theme plugin. Nothing else is needed for apps happy with Plex. Custom server setups that do not use the dev server or the prod build of server-runtime must serve `/assets/kumiko/fonts/*.woff2` from the renderer-web `fonts` folder with the MIME type `font/woff2`, and `font-src 'self'` covers it.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: breaking
  title: Warm-neutral design tokens, 6px radius, content on the surface color
  detail: |
    Light and dark themes were rebuilt. Light: surface #FFFFFF, page #F3F2EE, sunken #F6F5F1, line #E2E0D9, strong line #CFCCC3, row line #ECEAE4, control border #908D85, text #1A1C1E, text 2 #474B50, text 3 #5F6368, disabled #8A8E93. New tokens: `--color-foreground-secondary`, `--color-foreground-disabled`, `--color-border-strong`, `--color-border-row`, `--color-status-*-surface` (ok, warn, bad, critical), `--color-status-neutral` and `--color-status-neutral-surface`, `--color-sidebar-muted`, `--color-sidebar-input`. `--radius` is 0.5rem so controls use 6px. The shell content, header and toolbars sit on the card surface, the sidebar (232px wide) takes the page color. Buttons: the secondary variant is a surface with a border, a ghost variant was added. Controls are 36px high (32px small), at least 44px below md.
  migration: |
    Apps that override tokens keep working, but check contrast pairs for the new roles and add overrides for the new tokens if the brand needs them. Apps with hard-coded colors that relied on the page color behind content, on grey secondary buttons or on the 10px radius must adjust. Screenshot tests need new baselines.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: breaking
  title: Field presentation follows option count, label length and type
  detail: |
    A select without an explicit `display` renders as a segmented control for up to 3 options with labels of at most 16 characters, as a vertical radio list for up to 3 longer options and as a dropdown for 4 or more. MoneyInput has no stepper, right-aligns its value and shows the currency as a suffix. Number inputs are left-aligned. Fields get a control width by type (number 96px, money 160px, date 200px, select at least 200px, text 240px), labels never wrap, radio lists and textareas take their own row.
  migration: |
    Set `display: "radio"` or `display: "dropdown"` on the select field to pin a presentation. Selects with 4 options no longer render as radio groups by default. Tests that spin a money value with the stepper buttons must type the value instead.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: breaking
  title: Drawer widget defaults to the flush variant, Link with target _blank sets rel
  detail: |
    The `Drawer` widget renders flush against the right edge with full height, no margin, no radius and a strong left border unless `variant="floating"` is passed. Every `<Drawer>` without `variant` changes its look. `Link` now forwards `rel` and `target`; with `target="_blank"` the default `rel` is `noopener noreferrer`.
  migration: |
    Pass `variant="floating"` to keep the detached panel look. Tests that assert a missing `rel` on `target="_blank"` links need updating.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: StatusBadge accent tone, ModeSwitch counts, radio cards, SideBySideTable, InfinityList selection
  detail: |
    `StatusBadge` gets an `accent` tone (primary tint with dot). `ModeSwitch` options take `count`, shown as a muted tabular counter. A select input takes `radioVariant: "card"` and each option a `description` for card-style radio choices. `SideBySideTable` renders a semantic table (th scope, ReactNode cells) for comparisons. `InfinityList` takes `selectedId` and `onSelectionChange({ index, total, prevId, nextId })`. `ProgressBar` takes `ariaLabel` and `size: "thin"`. `Button` has a `ghost` variant, DataTable rows take `DataTableRowAction.rowClick`, columns take `hideOnNarrow`. Tables and wizard steps use the new flush layout, tabs show counters.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Shell: user menu holds tenant, language and theme controls
  detail: |
    The sidebar user block sits in the sidebar footer and its menu contains the tenant, language and theme controls (`LanguageMenuItems` and `ThemeMenuItem` are exported). Sidebar items are 32px high on desktop, at least 44px below md.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Floating user block no longer overlaps the toolbar
  detail: |
    The "Admin" block hovered at the top left over the content below the header and covered the search field. The user block is part of the sidebar footer now.
  -->

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: Screen schema gains fillHeight, createLabel, searchPlaceholder, optionTones, statusTones, description, itemNoun, valueType, summary, hideOnNarrow
  detail: |
    `fillHeight` (default true) on entityList, projectionList, projectionDetail, entityEdit and actionForm. `createLabel` and `searchPlaceholder` (i18n keys) on lists. `optionTones` on select fields and `statusTones` on projectionDetail map values to ok, warn, bad or neutral (`SelectOptionTone`). `description` and `itemNoun` on relatedList sections. `valueType` on relatedList columns (numbers and money align right), `hideOnNarrow` on list columns. `summary: { title, subtitle }` on actionForm with `{name}` placeholders from the drawer prefill. New nav icon `chevron-left`.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: build-app-schema carries optionTones and collects the new screen i18n keys
  detail: |
    Select `optionTones` reach the client schema. `createLabel`, `searchPlaceholder`, `summary`, related list `description` and `itemNoun` are collected as i18n keys of the screen, so they are translated like other screen text.
  -->

  <!-- kumiko-changes
  feature: headless
  type: breaking
  title: Dates format with two-digit day and month
  detail: |
    `formatValue` for date values passes `day: "2-digit"` and `month: "2-digit"`, so German output is 01.10.2026 instead of 1.10.2026 in lists, details and related lists. List view models carry `hideOnNarrow` onto columns.
  migration: |
    Update tests and snapshots that expect single-digit day or month.
  -->

  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: New pager, list, form, wizard and drawer strings
  detail: |
    Adds the keys for the pager, list counts, sort label, form changed marker, unsaved counter, "All fields are required.", the on-this-page nav, wizard "Save and close" and "Next: {title}" and the drawer discard dialog.
  -->

  <!-- kumiko-changes
  feature: locale-es
  type: improvement
  title: New pager, list, form, wizard and drawer strings
  detail: |
    Adds the keys for the pager, list counts, sort label, form changed marker, unsaved counter, "All fields are required.", the on-this-page nav, wizard "Save and close" and "Next: {title}" and the drawer discard dialog.
  -->

  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: Production build copies the renderer-web fonts
  detail: |
    `buildProdBundle` copies the IBM Plex woff2 files to `dist/assets/kumiko/fonts/`, where the compiled CSS expects them. The new export `@cosmicdrift/kumiko-server-runtime/renderer-web-fonts` holds the URL prefix, the file name allowlist and the resolver, and the woff2 MIME type is known to the static file server.
  -->

  <!-- kumiko-changes
  feature: auth-email-password
  type: improvement
  title: User menu and tenant menu items fit the new shell
  detail: |
    The web user menu and tenant menu items are adapted to the sidebar footer user block, which now hosts the tenant, language and theme controls.
  -->

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: Dev server serves the renderer-web fonts
  detail: |
    GET `/assets/kumiko/fonts/<file>.woff2` streams the packaged IBM Plex files with `font/woff2` and a one day cache header. Names outside the allowlist answer 404.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: breaking
  title: Money field shows the currency symbol as a suffix inside the field, date field has its calendar button inside the input
  detail: |
    MoneyInput renders the value right-aligned with the currency symbol as a separate muted adornment (`<id>-currency`), placed before the number for locales that put it there. The input text no longer contains the symbol ("1.234,56", not "1.234,56 €"); parsing and the stored minor-unit value are unchanged. DateField and TimestampInput draw the calendar button as an icon inside the right edge of the input instead of a separate square button; the button keeps its aria-label and keyboard operation.
  migration: |
    Tests that read the money input value and expect the symbol must read the `<id>-currency` element or drop the symbol from the expected text. Selectors that find the calendar button by role and label keep working.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Mobile list cards keep the status badge top right, pager page size select uses the shared chevron
  detail: |
    On narrow viewports the status badge sits in the title row (top aligned) and the meta line runs across the full card width up to the chevron. The page size select in the pager hides the native arrow and shows the same chevron icon as the other selects.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Sidebar marks the list while an existing record is edited
  detail: |
    When the route carries an `entityId`, the nav entry of the screen's parent list is active instead of the edit screen's own nav entry (for example "Add vehicle"), the same rule the shell breadcrumb already applies.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: writeForm section Save button without icon, parity with entityEdit
  detail: |
    The Save button of a writeForm section no longer shows a check icon; it matches the entityEdit submit button. Tests that look for the icon inside the section Save button need updating.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Money input keeps the currency symbol beside the value and survives an invalid locale
  detail: |
    The currency symbol is a flex sibling of the input inside one bordered wrapper, so multi-character symbols (CHF, R$, kr) never overlap the digits; without a symbol there is no extra padding. An invalid locale tag renders the plain number without a symbol instead of throwing. Native controls (date input, scrollbars, select) follow the theme through `color-scheme`.
  -->

### Patch Changes

- Updated dependencies [424f49a]
- Updated dependencies [eae8d2b]
- Updated dependencies [9cc1787]
- Updated dependencies [2a4350b]
- Updated dependencies [c3fbe54]
- Updated dependencies [822928f]
  - @cosmicdrift/kumiko-framework@0.328.0
  - @cosmicdrift/kumiko-server-runtime@0.328.0
  - @cosmicdrift/kumiko-bundled-features@0.328.0
  - @cosmicdrift/kumiko-headless@0.328.0

## 0.327.0

### Minor Changes

- 7341d07: FloatingPanel widget and r.webSocketRoute

  renderer-web gains `FloatingPanel` (movable, resizable, non-modal panel with persisted geometry and a full-screen sheet on narrow viewports) and exports `useIsNarrowViewport`. Features can declare `r.webSocketRoute` under `/api/ws/` with session auth, an Origin check (allowlist, or same host without one), a per-route message cap, backpressure protection (4 MiB, the socket is closed beyond it) and a per-user connection cap (`maxConnectionsPerUser`, default 5, per server process; over it the upgrade gets 429). Handlers run one after another in arrival order per socket; on close `onClose` runs immediately (not queued behind a hung handler), queued messages never start, and `connection.signal` aborts. A 25 s heartbeat revalidates session, roles, tenant lifecycle and the token's own expiry (close 1008); a session store that keeps failing closes the socket with 1013 after three failed checks in a row. A server without upgrade wiring answers 501 `websocket_upgrade_not_wired` and logs the fix. `buildBunServeOptions` takes an optional `{ upgradeFetch, heartbeatIntervalMs? }` object as 4th argument and `runProdApp` handles expose `webSocketUpgradeFetch`; the dev server wires it. Upgrade rejections carry the same security headers as other responses. Additive, no migration.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: FloatingPanel widget and exported useIsNarrowViewport
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: r.webSocketRoute for authenticated WebSocket routes under /api/ws/
  -->

### Patch Changes

- Updated dependencies [7341d07]
- Updated dependencies [268c3bd]
- Updated dependencies [532a197]
- Updated dependencies [eef5a2f]
- Updated dependencies [da6e569]
  - @cosmicdrift/kumiko-framework@0.327.0
  - @cosmicdrift/kumiko-server-runtime@0.327.0
  - @cosmicdrift/kumiko-bundled-features@0.327.0
  - @cosmicdrift/kumiko-headless@0.327.0

## 0.326.1

### Patch Changes

- Updated dependencies [a5e987e]
  - @cosmicdrift/kumiko-bundled-features@0.326.1
  - @cosmicdrift/kumiko-server-runtime@0.326.1
  - @cosmicdrift/kumiko-framework@0.326.1
  - @cosmicdrift/kumiko-headless@0.326.1

## 0.326.0

### Patch Changes

- Updated dependencies [6af6be2]
  - @cosmicdrift/kumiko-framework@0.326.0
  - @cosmicdrift/kumiko-bundled-features@0.326.0
  - @cosmicdrift/kumiko-headless@0.326.0
  - @cosmicdrift/kumiko-server-runtime@0.326.0

## 0.325.2

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.325.2
- @cosmicdrift/kumiko-server-runtime@0.325.2
- @cosmicdrift/kumiko-framework@0.325.2
- @cosmicdrift/kumiko-headless@0.325.2

## 0.325.1

### Patch Changes

- Updated dependencies [f3482c4]
  - @cosmicdrift/kumiko-headless@0.325.1
  - @cosmicdrift/kumiko-bundled-features@0.325.1
  - @cosmicdrift/kumiko-server-runtime@0.325.1
  - @cosmicdrift/kumiko-framework@0.325.1

## 0.325.0

### Patch Changes

- Updated dependencies [100732a]
  - @cosmicdrift/kumiko-framework@0.325.0
  - @cosmicdrift/kumiko-bundled-features@0.325.0
  - @cosmicdrift/kumiko-headless@0.325.0
  - @cosmicdrift/kumiko-server-runtime@0.325.0

## 0.324.0

### Patch Changes

- Updated dependencies [efa4114]
- Updated dependencies [3c0095d]
  - @cosmicdrift/kumiko-framework@0.324.0
  - @cosmicdrift/kumiko-bundled-features@0.324.0
  - @cosmicdrift/kumiko-headless@0.324.0
  - @cosmicdrift/kumiko-server-runtime@0.324.0

## 0.323.0

### Minor Changes

- c01b9be: Deploy Dockerfile template: NPM_AUTH_TOKEN registry auth, manifest-first or full-tree install by detected layout, BUILD_VERSION/BUILD_TIME in the runtime stage, TZ=UTC; new `kumiko-init-deploy` bin with --force and a --check drift check.

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: Deploy Dockerfile template: NPM_AUTH_TOKEN registry auth, manifest-first or full-tree install by detected layout, BUILD_VERSION/BUILD_TIME in the runtime stage, TZ=UTC; new kumiko-init-deploy bin with --force and a --check drift check
  migration: |
    The scaffolded `deploy/Dockerfile` now declares `ARG NPM_AUTH_TOKEN`
    (global + re-declared in the build stage) instead of `ARG GITHUB_TOKEN`,
    and exports `ENV GITHUB_TOKEN=${NPM_AUTH_TOKEN}` in the build stage —
    bunfig.toml/.npmrc still read `$GITHUB_TOKEN`, only the build-arg name
    passed by CI changes. Apps that already generated `deploy/Dockerfile`
    from an older template keep working unchanged; re-run
    `kumiko-init-deploy --force` (or `kumiko init-deploy --force` from the
    monorepo) to pick up the new wiring, the runtime stage's
    `ARG BUILD_VERSION=dev`/`ARG BUILD_TIME=unknown` re-declaration (without
    it the runtime `ENV BUILD_VERSION`/`ENV BUILD_TIME` stayed empty despite
    a correct `--build-arg`), and `ENV TZ=UTC`.

    The install step now copies manifests first (`package.json`, `bun.lock`,
    and whichever of `bunfig.toml`/`.npmrc` exist) before `bun install`,
    unless the app's `package.json` has a `workspaces` field or a
    `file:`/`workspace:`/`link:` dependency spec, in which case it still
    does `COPY . .` first (bun needs the whole tree to resolve the
    lockfile).

    `scaffoldDeploy`/`ScaffoldDeployOptions`/`ScaffoldDeployResult` keep
    their existing shape and behavior. New: `renderDeployFiles` (pure,
    no writes) and `checkDeployDrift` (read-only, reports missing/differing
    files) are exported alongside `scaffoldDeploy`, which now calls
    `renderDeployFiles` internally. `ScaffoldDeployDetected` gained
    `installFromFullTree` and `registryConfigFiles`.

    New `kumiko-init-deploy` bin (and `runInitDeployCli` export) — same
    flags as `kumiko init-deploy` (`--app`, `--port`, `--github-org`,
    `--out`, `--force`), plus `--check` (drift check, exit 1 on any
    missing/differing file, does not write) and defaulting `--app` from
    `package.json`'s `name` (scope stripped) when omitted. `--check` and
    `--force` are mutually exclusive (exit 2). The monorepo's
    `kumiko init-deploy` command now delegates to `runInitDeployCli`
    instead of duplicating the CLI logic.
  -->

- 5c7e422: migrate-step.sh now reads `package.json#kumiko.deploy` (`dbUser`, `stackNetwork: "discover" | "directory"`); defaults are unchanged (dbUser = appName, stackNetwork = "discover"), and invalid values fail the render/check loudly instead of silently falling back.

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: migrate-step.sh reads package.json#kumiko.deploy (dbUser, stackNetwork "discover" | "directory"); defaults unchanged, invalid values fail the render and the drift check
  migration: |
    No action needed: without `kumiko.deploy` the scaffolded
    `deploy/migrate-step.sh` renders byte-identical to before. Apps whose
    database user is not the app name set
    `"kumiko": { "deploy": { "dbUser": "<user>" } }`; apps that want the
    exact `<dirname>_stack` network instead of the `docker network ls`
    heuristic set `"stackNetwork": "directory"`. Both `kumiko-init-deploy
    --force` and `--check` read the same config, so the drift check needs
    no extra flags. `ScaffoldDeployDetected` gained `dbUser` and
    `stackNetwork`.
  -->

- d7bba26: runDevApp wires auth-email-password's new invite-info query into invite.infoHandler

  Same wiring as runProdApp, for the dev server.

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: runDevApp wires auth-email-password's new invite-info query into invite.infoHandler
  migration: |
    No action needed: purely additive wiring, no option changes.
  -->

- 60e1a1f: Production builds discovered multi-entry client bundles by scanning `src/` for files matching `client-<suffix>.tsx` — any file matching that pattern became its own bundle, even a plain module only imported by another entry (#2305). `buildProdBundle` now takes the entry list explicitly, the same shape the dev server already uses: package.json `"kumiko": { "clientEntries": [{ "name", "sourceFile", "htmlPath"? }] }` for multi-entry apps, or `"kumiko": { "clientEntry": "./src/…" }` for a single non-conventional entry. Apps with a plain `src/client.tsx` need no declaration. An app that still has `src/client-<suffix>.tsx` files but no `kumiko.clientEntries` declaration now fails the build loudly with the exact snippet to add, instead of silently shipping without those bundles.

  <!-- kumiko-changes
  feature: server-runtime
  type: breaking
  title: buildProdBundle takes client entries explicitly via package.json "kumiko.clientEntries"/"kumiko.clientEntry" — no more filename inference
  detail: |
    `discoverClientEntries(cwd)`, which scanned `src/` for
    `client-<suffix>.tsx` files and treated every match as its own bundle
    entry, is replaced by `resolveClientEntries(cwd, declared)` plus
    `readClientEntriesConfig(cwd)`, a boundary parser for package.json
    `kumiko.clientEntry` / `kumiko.clientEntries`. `buildProdBundle(options)`
    now accepts the same `clientEntry`/`clientEntries` shape directly.

    `kumiko.clientEntries` entries are validated: `name` must match
    `^[a-z][a-z0-9-]*$` (it becomes the output filename), `sourceFile` (and
    `htmlPath`, if set) must resolve inside the app root, `sourceFile` must
    exist, and names/html-output-files/source-basenames must be unique
    across the list. `clientEntry` and `clientEntries` are mutually
    exclusive; an empty `clientEntries` array is rejected (omit the key
    instead). Apps with only `src/client.tsx` or `src/client.ts` need no
    declaration — that convention is unchanged.
  migration: |
    Apps with `src/client-<name>.tsx` entries: add the entry list to
    package.json, using the same objects already passed to
    `runDevApp`/`createKumikoServer`'s `clientEntries` (paths relative to the
    app root). Without this, the build now throws instead of silently
    building without those bundles.

      publicstatus:

        "kumiko": {
          "clientEntries": [
            { "name": "public", "sourceFile": "./src/client-public.tsx" },
            { "name": "admin", "sourceFile": "./src/client-admin.tsx", "htmlPath": "./public/admin.html" },
            { "name": "auth", "sourceFile": "./src/client-auth.tsx", "htmlPath": "./public/auth.html" }
          ]
        }

      show-pony:

        "kumiko": {
          "clientEntries": [
            { "name": "admin", "sourceFile": "./src/client-admin.tsx", "htmlPath": "./public/admin.html" },
            { "name": "public", "sourceFile": "./src/client-public.tsx", "htmlPath": "./public/index.html" }
          ]
        }

      offlot-app:

        "kumiko": {
          "clientEntries": [
            { "name": "app", "sourceFile": "./src/client-app.tsx", "htmlPath": "./public/app.html" }
          ]
        }

    Apps using a single entry that isn't `src/client.tsx`: add
    `"kumiko": { "clientEntry": "./src/…" }` instead.

    Apps with only `src/client.tsx` | `src/client.ts`: no action needed.

    `discoverClientEntries` (exported from
    `@cosmicdrift/kumiko-dev-server/build`) is removed; callers use
    `resolveClientEntries(cwd, readClientEntriesConfig(cwd))`.
  -->

  <!-- kumiko-changes
  feature: dev-server
  type: breaking
  title: kumiko-build reads client entries from package.json "kumiko.clientEntries"/"kumiko.clientEntry" instead of inferring them from filenames
  detail: |
    `kumiko-build` (and the `kumiko build` command) now call
    `readClientEntriesConfig(cwd)` and pass the result into
    `buildProdBundle`, instead of relying on `discoverClientEntries`'
    filename-based multi-entry discovery. `@cosmicdrift/kumiko-dev-server/build`
    re-exports `resolveClientEntries`, `readClientEntriesConfig`, and
    `ClientEntryDeclaration` in place of `discoverClientEntries`.
  migration: |
    See the `@cosmicdrift/kumiko-server-runtime` changelog entry above for
    the required package.json changes — the dev-server change is the CLI
    wiring for the same underlying behavior.
  -->

### Patch Changes

- Updated dependencies [d7bba26]
- Updated dependencies [d7bba26]
- Updated dependencies [60e1a1f]
- Updated dependencies [d7bba26]
- Updated dependencies [72727cd]
- Updated dependencies [d7bba26]
- Updated dependencies [1343b18]
  - @cosmicdrift/kumiko-bundled-features@0.323.0
  - @cosmicdrift/kumiko-server-runtime@0.323.0
  - @cosmicdrift/kumiko-framework@0.323.0
  - @cosmicdrift/kumiko-headless@0.323.0

## 0.322.0

### Patch Changes

- Updated dependencies [d0c631a]
- Updated dependencies [9e7bedc]
  - @cosmicdrift/kumiko-framework@0.322.0
  - @cosmicdrift/kumiko-bundled-features@0.322.0
  - @cosmicdrift/kumiko-headless@0.322.0
  - @cosmicdrift/kumiko-server-runtime@0.322.0

## 0.321.0

### Minor Changes

- fa27809: E2e logins started 429ing after the client-IP resolver landed (kumiko-framework#3323): every Playwright client is on `::1`, so the default `trustedProxyHops` (0, socket-only) collapsed every seeded user's login into one shared rate-limit bucket instead of one per user

  `defineAppE2eConfig`'s `webServer` now sets `KUMIKO_TRUSTED_PROXY_HOPS=1` (template-owned, added to `RESERVED_ENV_KEYS`), and `loginViaApi` sends a deterministic per-email `X-Forwarded-For` so each seeded user gets their own bucket, the same way a real client behind one trusted reverse-proxy hop would.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: parseTrustedProxyHopsEnv/TRUSTED_PROXY_HOPS_ENV factored out of runProdApp for runDevApp and consumer tooling to share
  detail: |
    `packages/framework/src/api/client-ip.ts` gained
    `parseTrustedProxyHopsEnv(raw, context)` and the
    `TRUSTED_PROXY_HOPS_ENV = "KUMIKO_TRUSTED_PROXY_HOPS"` constant (both
    exported via the `api` barrel), moved out of `runProdApp`'s inline
    parsing. Same validation and error message as before.
  migration: |
    No action needed; runProdApp's behavior and error message are unchanged.
  -->

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: runDevApp now also honors KUMIKO_TRUSTED_PROXY_HOPS as an env fallback, symmetric to runProdApp
  detail: |
    Precedence: `options.trustedProxyHops ?? effectiveAuth?.trustedProxyHops
    ?? parseTrustedProxyHopsEnv(envSource[TRUSTED_PROXY_HOPS_ENV], "runDevApp")`.
  migration: |
    No action needed for the default (unproxied) dev setup.
  -->

  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: runProdApp's KUMIKO_TRUSTED_PROXY_HOPS parsing now shares framework's parseTrustedProxyHopsEnv
  detail: |
    The inline digits-only + non-negative-integer validation moved out of
    `run-prod-app.ts` into `parseTrustedProxyHopsEnv`
    (`@cosmicdrift/kumiko-framework/api`); same validation and error message
    as before, no behavioral change.
  migration: |
    No action needed.
  -->

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: defineAppE2eConfig reserves KUMIKO_TRUSTED_PROXY_HOPS; loginViaApi sends a synthetic per-user X-Forwarded-For
  detail: |
    `defineAppE2eConfig`'s `webServer.env` now sets
    `KUMIKO_TRUSTED_PROXY_HOPS=1` and rejects that key in a consumer's own
    `env` (template-owned, added to `RESERVED_ENV_KEYS`). `loginViaApi` sends
    `x-forwarded-for: syntheticClientIpFor(credentials.email)`, a new
    exported helper deriving a deterministic private-range IP from
    `sha256(email)`, so each seeded user's login lands in its own
    rate-limit bucket instead of every ::1 client sharing one.
    `loginViaUi` is unchanged.
  migration: |
    Consumers using `defineAppE2eConfig` + `loginViaApi` (incl. the
    `seedTenant` fixture) need no changes — each seeded user now logs in
    from its own bucket. Browser logins (`loginViaUi`, raw `fetch` to
    `/api/auth/login` from a page) still share the `::1` bucket. A consumer
    with its own e2e login helper (bypassing `loginViaApi`) should send
    `x-forwarded-for: syntheticClientIpFor(email)` (exported from
    `@cosmicdrift/kumiko-testing`) themselves, and must not set
    `KUMIKO_TRUSTED_PROXY_HOPS` in `defineAppE2eConfig`'s `env` — it's now
    reserved.
  -->

### Patch Changes

- 959b3fb: `billing-plans-panel` now surfaces a `past_due` subscription with its own warning banner, instead of looking the same as an active one. `switch-plan` now rejects switching a subscription that already has a scheduled cancellation (`cancelAt` set) with a `409 cancellationScheduled` conflict — the tenant must reactivate first; the billing-plans query and panel reflect this by marking every switch target `unavailable` and pointing at reactivation. A new `retrieveSubscription` provider-plugin method (implemented for Stripe) plus a `sync-subscription` write-handler and `sync-subscriptions` job backfill drift — like a `cancel_at` set on the provider's own dashboard — that never arrived as a webhook, appending it as a real `subscription.updated` event. `isBillingEnabled` no longer throws for an unregistered provider name, returning `false` instead. `kumiko-testing integration` now accepts positional test-file args, `kumiko-upgrade`/`kumiko-schema` gained a `--help`, and `pre-push.sh` now refuses to push a repo with a stale `.kumiko/upgrade-state.json`.

  <!-- kumiko-changes
  feature: billing-foundation
  type: breaking
  title: switch-plan rejects a subscription with a scheduled cancellation
  detail: |
    `billing-foundation:write:switch-plan` now throws a `409 ConflictError`
    (`billing-foundation.errors.cancellationScheduled`) when the tenant's
    subscription already has `cancelAt` set — switching plans mid-cancellation
    previously silently proceeded and could leave the new plan itself
    scheduled to cancel. `billing-foundation:query:billing-plans` now resolves every
    non-current plan's `action` to `unavailable` (instead of `switch`) while a
    cancellation is scheduled, and the billing-plans panel shows a
    `switchRequiresReactivation` message alongside the existing
    `cancelScheduled` banner.
  migration: |
    A tenant that switches plans while their subscription is scheduled to
    cancel now gets a 409 instead of a successful switch. Callers driving
    `switch-plan` directly (not through the bundled panel) must reactivate the
    subscription first (`create-portal-session` / the provider's own
    reactivation flow) before retrying the switch.
  -->

  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: past_due banner on the billing-plans panel; sync-subscription backfill for provider-side drift
  detail: |
    `billing-plans-panel` renders a `past_due`-status warning banner
    (`billing-foundation.plans.pastDue`) alongside the existing
    payment-pending/cancel-scheduled ones. `SubscriptionProviderPlugin` gained
    an optional `retrieveSubscription(ctx, providerSubscriptionId)` method
    returning a `ProviderSubscriptionSnapshot`; the new
    `billing-foundation:write:sync-subscription` handler (`agent.expose:
    false`, `SYSTEM_ROLE`/`SystemAdmin`-only — the `sync-subscriptions` job's
    own systemUser only carries `SYSTEM_ROLE`) compares the live snapshot
    against `read_subscriptions` and appends a `subscription.updated` (or
    `subscription.canceled`, when the snapshot's own status is terminal)
    event with a deterministic `sync:<sha256>` providerEventId when it has
    drifted, a no-op otherwise. The `sync-subscriptions` job (manual-trigger +
    runOnBoot, perTenant) dispatches it and is registered unconditionally.
    `isBillingEnabled(ctx, providerName)` returns `false` instead of throwing
    when `providerName` isn't registered.
  migration: |
    No action needed — every part is additive. Apps on `subscription-stripe`
    automatically get `retrieveSubscription` wired; a custom provider plugin
    without one makes `sync-subscription` report
    `{ synced: false, reason: "provider_cannot_retrieve" }` instead of syncing.
    On the next deploy, `sync-subscriptions`' `runOnBoot` fires once per Redis
    dataset (not once per replica) with one provider API call per tenant that
    has a live subscription. If that run is interrupted (deploy killed
    mid-fan-out, Redis restart), it is not re-run automatically on the next
    boot — trigger it manually via `billing-foundation:job:sync-subscriptions`
    (`jobs:write:trigger`) to catch up.
  -->

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: kumiko-testing integration accepts positional test-file args
  detail: |
    `kumiko-testing integration` now runs only the given files/globs when
    positional args are passed, instead of always discovering every
    `*.integration.test.ts` file.
  migration: No action needed — omitting positional args keeps the previous full-discovery behavior.
  -->

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: kumiko-upgrade gained --help/-h
  detail: Prints usage and exits 0 without running the upgrade report.
  migration: No action needed.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: kumiko-schema gained --help/-h/help
  detail: Prints usage listing the available subcommands and exits 0.
  migration: No action needed.
  -->

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: pre-push.sh refuses to push a stale .kumiko/upgrade-state.json
  detail: |
    When `.kumiko/upgrade-state.json` exists at the repo root, `pre-push.sh`
    now runs the upgrade-state guard before its main check and refuses the
    push if the guard fails, resolving `guard-upgrade-state.ts` next to the
    hook's real (symlink-resolved) script location.
  migration: |
    A repo that has adopted `.kumiko/upgrade-state.json` and is currently
    stale now has its push blocked until the upgrade state is reconciled. A
    repo without that marker file is unaffected.
  -->

- Updated dependencies [959b3fb]
- Updated dependencies [c8c629f]
- Updated dependencies [fa27809]
- Updated dependencies [fa27809]
- Updated dependencies [8246f13]
- Updated dependencies [fa27809]
- Updated dependencies [b74db24]
- Updated dependencies [5616ad9]
- Updated dependencies [fa27809]
  - @cosmicdrift/kumiko-bundled-features@0.321.0
  - @cosmicdrift/kumiko-framework@0.321.0
  - @cosmicdrift/kumiko-server-runtime@0.321.0
  - @cosmicdrift/kumiko-headless@0.321.0

## 0.320.0

### Minor Changes

- 0ab9874: auth routes return a server-computed landingPath from auth.postAuthLanding

  `AuthRoutesConfig.postAuthLanding` lets an app resolve, in one server-side place, where a user lands after auth instead of every frontend screen re-deriving it from roles/tenantId. The resolver runs for login, mfa-verify, mfa-preauth-confirm, signup-confirm, and all three invite-accept branches, and its result is validated (root-relative only, no protocol-relative/backslash/control-character paths, no cross-origin resolution) before it is ever added to the response as `landingPath`. An invalid path or a throwing resolver just omits the field — auth never fails because of it.

  `run-prod-app`'s and `run-dev-app`'s auth options now accept `postAuthLanding` and thread it through to the framework config unchanged.

  `SignupCompleteScreen` and `InviteAcceptScreen` now prefer the server's `landingPath` over their `loggedInHref` prop, which becomes a deprecated per-app fallback for apps that haven't configured a resolver yet.

  Closes #3320.

  <!-- kumiko-changes
  feature: auth-email-password
  type: improvement
  title: auth routes return a server-computed landingPath from auth.postAuthLanding
  -->

- c61cc7a: Centralized, trustedProxyHops-aware client-IP resolver for every IP-based rate limit (kumiko-framework#3323)

  `rate-limit/middleware.ts`'s L1/L2 rate limits, `auth-routes.ts`'s auth rate limits and `requestIdMiddleware`'s `requestContext.ip` each derived the caller's IP their own way, all trusting the first `X-Forwarded-For` entry unconditionally — a header any client can set, so any of them was bypassable by an attacker who simply forged a first entry, and an app with no reverse proxy in front of it had no defense at all. Worse, `requestIdMiddleware` left `ip` `undefined` when no XFF header was present, which made `dispatch-shared.ts`'s `enforceRateLimit` treat the whole bucket as skippable — an L3 handler with `rateLimit: { per: "ip" }` silently never throttled a client that omitted the header.

  All three now share one `createClientIpResolver` (`@cosmicdrift/kumiko-framework/api`). A new top-level `trustedProxyHops` option on `buildServer`, `runProdApp` and `runDevApp` (default `0`) replaces the old first-entry heuristic: `0` trusts no proxy header at all (only the real socket address, sourced once from Bun's `server.requestIP()`, counts), `n >= 1` reads the n-th `X-Forwarded-For` entry from the right (falling back to `X-Real-IP`, then the socket address, for a chain shorter than `n`). A bucket is never skipped anymore — with no usable value the resolver falls back to a fixed `"unknown"` string, which shares one bucket across affected clients rather than letting them bypass the limit entirely. The deprecated `auth.trustedProxyHops` still works as a fallback when the new top-level option isn't set.

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Centralized client-IP resolver replaces the old first-XFF-entry heuristic
  detail: |
    New `trustedProxyHops` option on `ServerOptions` (default 0 — trusts no
    proxy header, only the socket address counts). Precedence:
    `options.trustedProxyHops ?? options.auth?.trustedProxyHops ?? 0`.
    `requestContext.ip` is now always set for an HTTP request (falls back to
    "unknown" instead of being left undefined), so `rateLimit: { per: "ip" }`
    handlers reached via `r.httpRoute`/`extraRoutes` systemQuery are never
    silently unthrottled. `rate-limit/middleware.ts`'s `globalIpRateLimit`/
    `authEndpointRateLimit` and `auth-routes.ts`'s `createAuthRoutes` gained a
    `trustedProxyHops`/`clientIpResolver` option and now share the server's
    one resolver instance instead of each building their own.
  migration: |
    Apps deployed behind a reverse-proxy/ingress that appends to
    X-Forwarded-For must set `trustedProxyHops` (buildServer/runProdApp/
    runDevApp top-level option) to the number of trusted hops — usually `1`
    for a single ingress. Without it, every client collapses into one shared
    rate-limit bucket (safe default, but likely too strict for real traffic).
    Apps not behind a proxy need no change; `trustedProxyHops` defaults to 0.

    Integration tests that call an `ip`/`ip+handler`-rate-limited handler
    repeatedly through `stack.http.raw`/`stack.app.request` (no real socket)
    now share one "unknown" bucket instead of skipping the bucket entirely —
    a previously-passing test suite can start seeing 429s. Fix by flushing
    the rate-limit namespace between test cases (`stack.redis.flushNamespace()`
    in `beforeEach`), or by setting `setupTestStack({ trustedProxyHops: 1 })`
    and sending a distinct `X-Forwarded-For` per test case. Also check any
    test that nulls `context.redis` via `extraContext` to exercise a
    handler's own redis-down guard: `setupTestStack` now keeps the L3
    rate-limit resolver alive from its own always-real Redis in that case
    (an explicit `context.rateLimit` still wins), so a handler-declared
    `rateLimit` is enforced instead of throwing `InternalError` for a missing
    resolver.
  -->

  <!-- kumiko-changes
  feature: server-runtime
  type: breaking
  title: runProdApp threads the Bun socket address and a trustedProxyHops option through to the client-IP resolver
  detail: |
    `buildBunServeOptions` now extracts the client socket address once via
    `server.requestIP(req)` at the outermost Bun.serve fetch callback (a
    cloned/rebuilt Request loses that ability) and threads it through
    `tryHonoFirst`/`withSecurityHeaders`/`buildStaticFallback` as Hono's
    `env`. `RunProdAppOptions` gained a top-level `trustedProxyHops` (falls
    back to the deprecated `auth.trustedProxyHops`, then
    `KUMIKO_TRUSTED_PROXY_HOPS`), forwarded into `buildServer` and the
    static-fallback's own client-IP resolver.
  migration: |
    Same as the framework entry — set `trustedProxyHops` on `runProdApp` when
    deployed behind a reverse-proxy/ingress.
  -->

  <!-- kumiko-changes
  feature: dev-server
  type: breaking
  title: createKumikoServer/runDevApp gained a trustedProxyHops option
  detail: |
    `CreateKumikoServerOptions`/`RunDevAppOptions` gained a top-level
    `trustedProxyHops`, forwarded into `setupTestStack`'s `buildServer` call.
    Dev normally runs unproxied, so this is usually left unset (default 0).
  migration: |
    No action needed for the default (unproxied) dev setup. Set
    `trustedProxyHops` only if you run the dev server behind a reverse proxy.
  -->

- fe36eeb: AppSchema now leaves the server only via an authenticated GET /api/schema

  <!-- kumiko-changes
  feature: server-runtime
  type: breaking
  title: Static fallback no longer injects __KUMIKO_SCHEMA__ into HTML
  migration: |
    `HostDispatchResult.injectSchema` is deprecated and ignored — HTML never
    carries the schema anymore, in prod or dev. `createKumikoApp` now fetches
    the schema itself from the authenticated `GET /api/schema` after its
    clientFeature gates (e.g. an auth gate) let rendering through, so a
    signed-in admin app keeps working without changes. Anything that read
    `window.__KUMIKO_SCHEMA__` directly (custom clients, e2e fixtures) must
    switch to fetching `/api/schema` instead. An anonymously reachable page
    that used to render schema-based screens needs `createPublicSurface`,
    which never carries a schema. The `@cosmicdrift/kumiko-server-runtime/inject-schema`
    subpath export is removed.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: New GET /api/schema route
  detail: |
    Behind the existing `/api/*` auth guard. A signed-in, non-anonymous user
    gets the built `AppSchema` as JSON with `Cache-Control: private, no-cache`
    and a strong `ETag`; a matching `If-None-Match` gets a bodyless 304 (still
    behind the same auth check, so an anonymous request with a stolen/guessed
    ETag still 401s instead of getting a 304). Anonymous or missing auth gets
    the same 401 `unauthenticated` response shape as every other non-public
    route.
  -->

  <!-- kumiko-changes
  feature: dev-server
  type: breaking
  title: Dev-server HTML no longer injects __KUMIKO_SCHEMA__ either
  migration: |
    Same semantics as the prod change: `DevHostDispatchResult.injectSchema`
    is deprecated and ignored. The dev-server's auto-mint mode still sets
    the `kumiko_auth`/`kumiko_csrf` cookies on the HTML response, so a
    client-side fetch to `/api/schema` is authenticated immediately without
    a real login round-trip.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: createKumikoApp loads the schema after the auth gate, with loading/error states
  detail: |
    When neither `options.schema` nor `window.__KUMIKO_SCHEMA__` is set,
    `createKumikoApp` now fetches the schema from `GET /api/schema` itself,
    only after its clientFeature gates let rendering through (so an
    unauthenticated visitor never triggers the request). While the fetch is
    in flight a minimal loading placeholder renders; a 401/403 shows a clear
    "sign in required" message with no auto-retry; any other failure shows a
    retry button. Losing schema access mid-session (a gate withdrawing
    children, e.g. on logout) resets the fetched schema so the next mount
    re-fetches instead of reusing a previous session's — important once
    schemas become role-dependent. An explicit `options.schema` never resets
    this way.
  -->

### Patch Changes

- e7cd1cb: setupTestStackFromFeatures' config preset now also derives \_configAccessorFactory

  buildHandlerContext derives ctx.config from \_configAccessorFactory, not configResolver directly, so a write handler under presets: ["config"] saw ctx.config as undefined even with a configResolver present. mergeExtraContext now also runs addConfigAccessorFactory (the same helper runProdApp/runDevApp use), keeping a base-supplied configResolver winning over the preset default. Closes #3313.

  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: setupTestStackFromFeatures' config preset now also derives _configAccessorFactory
  -->

- c61cc7a: Upload requests are now size-checked before the body is buffered

  `POST /api/files` previously ran `parseBody()` on the full multipart request before any size check, so the body was parsed in full before the configured `maxUploadSize` ever ruled it out. It now rejects requests over the configured limit (checked upfront via `Content-Length`, and while streaming for chunked bodies) with a 413 before parsing. `runProdApp` and the dev server now also derive `Bun.serve`'s request-body cap from that same `maxUploadSize`/field `maxSize` configuration instead of Bun's own 128 MiB default; `buildBunServeOptions` keeps a lower fixed fallback for direct callers, overridable via `runProdApp`'s new `maxRequestBodySize` option.

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Upload requests are now size-checked before the body is buffered
  -->

- Updated dependencies [c61cc7a]
- Updated dependencies [0ab9874]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [519261d]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [3a99ac1]
- Updated dependencies [fe36eeb]
- Updated dependencies [02cc7b3]
- Updated dependencies [c498565]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [9c6173d]
- Updated dependencies [9907bc6]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
  - @cosmicdrift/kumiko-bundled-features@0.320.0
  - @cosmicdrift/kumiko-framework@0.320.0
  - @cosmicdrift/kumiko-server-runtime@0.320.0
  - @cosmicdrift/kumiko-headless@0.320.0

## 0.319.0

### Patch Changes

- Updated dependencies [53c5206]
- Updated dependencies [53c5206]
- Updated dependencies [53c5206]
- Updated dependencies [53c5206]
- Updated dependencies [53c5206]
- Updated dependencies [53c5206]
  - @cosmicdrift/kumiko-bundled-features@0.319.0
  - @cosmicdrift/kumiko-server-runtime@0.319.0
  - @cosmicdrift/kumiko-framework@0.319.0
  - @cosmicdrift/kumiko-headless@0.319.0

## 0.318.0

### Patch Changes

- Updated dependencies [4c5152f]
- Updated dependencies [4c5152f]
- Updated dependencies [4c5152f]
- Updated dependencies [5d3b3e8]
- Updated dependencies [5d3b3e8]
- Updated dependencies [4fac08d]
- Updated dependencies [4c5152f]
- Updated dependencies [4c5152f]
- Updated dependencies [4c5152f]
- Updated dependencies [4c5152f]
  - @cosmicdrift/kumiko-bundled-features@0.318.0
  - @cosmicdrift/kumiko-framework@0.318.0
  - @cosmicdrift/kumiko-server-runtime@0.318.0
  - @cosmicdrift/kumiko-headless@0.318.0

## 0.317.0

### Patch Changes

- Updated dependencies [94ce380]
- Updated dependencies [fd40653]
- Updated dependencies [b13c820]
- Updated dependencies [94ce380]
  - @cosmicdrift/kumiko-bundled-features@0.317.0
  - @cosmicdrift/kumiko-framework@0.317.0
  - @cosmicdrift/kumiko-server-runtime@0.317.0
  - @cosmicdrift/kumiko-headless@0.317.0

## 0.316.0

### Patch Changes

- Updated dependencies [aa32979]
  - @cosmicdrift/kumiko-framework@0.316.0
  - @cosmicdrift/kumiko-bundled-features@0.316.0
  - @cosmicdrift/kumiko-headless@0.316.0
  - @cosmicdrift/kumiko-server-runtime@0.316.0

## 0.315.0

### Patch Changes

- Updated dependencies [55b8505]
- Updated dependencies [4cc60bf]
- Updated dependencies [9635e86]
- Updated dependencies [0f2643d]
  - @cosmicdrift/kumiko-bundled-features@0.315.0
  - @cosmicdrift/kumiko-framework@0.315.0
  - @cosmicdrift/kumiko-server-runtime@0.315.0
  - @cosmicdrift/kumiko-headless@0.315.0

## 0.314.0

### Patch Changes

- Updated dependencies [483666f]
- Updated dependencies [22d89ec]
- Updated dependencies [483666f]
- Updated dependencies [c3df63c]
- Updated dependencies [3434a94]
- Updated dependencies [3434a94]
  - @cosmicdrift/kumiko-framework@0.314.0
  - @cosmicdrift/kumiko-bundled-features@0.314.0
  - @cosmicdrift/kumiko-headless@0.314.0
  - @cosmicdrift/kumiko-server-runtime@0.314.0

## 0.313.0

### Patch Changes

- Updated dependencies [773c52f]
- Updated dependencies [a14fd1f]
- Updated dependencies [4aa0c98]
- Updated dependencies [42c5298]
- Updated dependencies [16c81b9]
- Updated dependencies [f0c1ef1]
- Updated dependencies [93d7b77]
- Updated dependencies [4dea3ec]
- Updated dependencies [09a9148]
- Updated dependencies [b99240c]
- Updated dependencies [e7dc624]
  - @cosmicdrift/kumiko-bundled-features@0.313.0
  - @cosmicdrift/kumiko-framework@0.313.0
  - @cosmicdrift/kumiko-server-runtime@0.313.0
  - @cosmicdrift/kumiko-headless@0.313.0

## 0.312.0

### Patch Changes

- Updated dependencies [f662b79]
- Updated dependencies [b2d00cf]
- Updated dependencies [1799c20]
- Updated dependencies [f662b79]
- Updated dependencies [f662b79]
- Updated dependencies [f662b79]
  - @cosmicdrift/kumiko-bundled-features@0.312.0
  - @cosmicdrift/kumiko-framework@0.312.0
  - @cosmicdrift/kumiko-server-runtime@0.312.0
  - @cosmicdrift/kumiko-headless@0.312.0

## 0.311.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.311.0
- @cosmicdrift/kumiko-bundled-features@0.311.0
- @cosmicdrift/kumiko-server-runtime@0.311.0
- @cosmicdrift/kumiko-headless@0.311.0

## 0.310.0

### Patch Changes

- Updated dependencies [a2c9e30]
- Updated dependencies [4f36c3f]
  - @cosmicdrift/kumiko-bundled-features@0.310.0
  - @cosmicdrift/kumiko-framework@0.310.0
  - @cosmicdrift/kumiko-server-runtime@0.310.0
  - @cosmicdrift/kumiko-headless@0.310.0

## 0.309.0

### Patch Changes

- a81c5d0: Boot admin seed no longer duplicates the admin when the email blind-index lookup misses (fw#3101)

  <!-- kumiko-changes
  feature: auth-email-password
  type: fix
  title: Boot admin seed no longer duplicates the admin when the email blind-index lookup misses (fw#3101)
  detail: |
    runProdApp and runDevApp used to call the unguarded `seedAdmin`, whose idempotency check is a plain email fetchOne that the query layer rewrites into `(email = $plaintext OR email_bidx = $hmac)` once a blind-index key is configured. Under KMS encryption `email` holds per-row ciphertext, so only the bidx arm can ever match — and it misses whenever a row's `email_bidx` is NULL (written before the key existed, or after a subject-key erase), silently inserting a second admin account for the same email. Both boot paths now call `seedAdminGuarded`, which under KMS decrypt-scans the active users for the email and reuses the oldest matching row instead of duplicating it. `seedAdminGuarded` also now aborts with a named error if a PII KMS is configured but no blind-index key is — that combination makes the lookup blind by construction — and reconciles `emailVerified: true` onto the existing row it resolves through the decrypt-scan branch, matching the existing-row reconcile `seedUser` already does on its own idempotency hit.
  -->

- Updated dependencies [75925be]
- Updated dependencies [cb0adcf]
- Updated dependencies [11b6f67]
- Updated dependencies [ac9bdae]
- Updated dependencies [a81c5d0]
- Updated dependencies [8f109b5]
- Updated dependencies [711de11]
  - @cosmicdrift/kumiko-framework@0.309.0
  - @cosmicdrift/kumiko-bundled-features@0.309.0
  - @cosmicdrift/kumiko-server-runtime@0.309.0
  - @cosmicdrift/kumiko-headless@0.309.0

## 0.308.0

### Patch Changes

- 1b64375: `createKumikoServer` can now build its client bundle prod-shaped (splitting, no sourcemap, `NODE_ENV=production`) behind the opt-in `KUMIKO_DEV_PROD_BUNDLES` env var — `bun dev` is unaffected. `defineAppE2eConfig` sets it for the Playwright web server, so E2E now exercises the bundle shape that actually ships instead of a single dev bundle with React's development build, every lazy chunk inlined and a regenerated sourcemap per boot (publicstatus admin: 2.2 MB + 9.2 MB map → 0.87 MB entry; E2E suite −15 % on a 1.5 CPU runner).

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: Dev server can build prod-shaped client bundles, E2E uses them
  -->

- 685ecc9: `import { z } from "zod"` pulled the whole zod namespace — including all 63 locales and the json-schema module — into every client bundle that imported it (359 KB in a publicstatus admin bundle). All framework packages now use `import * as z from "zod"`, which Bun.build can tree-shake (a probe bundle went from 264 KB to 67 KB). A new Biome rule (`noRestrictedImports` on `packages/*/src/**`) keeps `{ z }` from coming back.

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: zod namespace import lets client bundles tree-shake unused locales
  -->

- Updated dependencies [49e07f5]
- Updated dependencies [ad701ed]
- Updated dependencies [6e5ed00]
- Updated dependencies [6e5ed00]
- Updated dependencies [6e5ed00]
- Updated dependencies [3ae4b82]
- Updated dependencies [9816d20]
- Updated dependencies [6b8b0ed]
- Updated dependencies [6e5ed00]
- Updated dependencies [685ecc9]
  - @cosmicdrift/kumiko-framework@0.308.0
  - @cosmicdrift/kumiko-headless@0.308.0
  - @cosmicdrift/kumiko-bundled-features@0.308.0
  - @cosmicdrift/kumiko-server-runtime@0.308.0

## 0.307.0

### Patch Changes

- a3f00b0: Dev-server boots now use a per-boot BullMQ queue-name prefix (stable per persistent dev DB, random per ephemeral boot) instead of the shared prod default, so parallel dev/e2e servers on the same Redis no longer steal each other's jobs.

  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: Dev-server job queues no longer collide across parallel boots
  -->

- Updated dependencies [cc23d3d]
- Updated dependencies [0ce171d]
- Updated dependencies [a3f00b0]
- Updated dependencies [c5c5ddb]
- Updated dependencies [e682776]
- Updated dependencies [cc23d3d]
- Updated dependencies [4179f26]
- Updated dependencies [aae3f5d]
  - @cosmicdrift/kumiko-bundled-features@0.307.0
  - @cosmicdrift/kumiko-server-runtime@0.307.0
  - @cosmicdrift/kumiko-framework@0.307.0
  - @cosmicdrift/kumiko-headless@0.307.0

## 0.306.0

### Patch Changes

- Updated dependencies [b43fe63]
- Updated dependencies [8b4d672]
- Updated dependencies [fdf9377]
- Updated dependencies [499b9c2]
- Updated dependencies [4f96ced]
- Updated dependencies [2e332a3]
- Updated dependencies [5785f57]
- Updated dependencies [cb31fad]
- Updated dependencies [b43fe63]
- Updated dependencies [cbbbb19]
- Updated dependencies [946f7e7]
- Updated dependencies [c6013bd]
- Updated dependencies [b43fe63]
- Updated dependencies [659c575]
- Updated dependencies [946f7e7]
  - @cosmicdrift/kumiko-bundled-features@0.306.0
  - @cosmicdrift/kumiko-framework@0.306.0
  - @cosmicdrift/kumiko-server-runtime@0.306.0
  - @cosmicdrift/kumiko-headless@0.306.0

## 0.305.0

### Minor Changes

- c41c201: E2E webserver builds Tailwind CSS once instead of running a `--watch` process

  `defineAppE2eConfig` sets `KUMIKO_DEV_STYLESHEET_WATCH=0`, so the dev-server it boots builds CSS once and stops instead of keeping a Tailwind `--watch` process alive. Tailwind v4's watcher subscribes to the whole app cwd recursively with no gitignore filter, so every Playwright artifact write under `test-results/` previously counted as a rebuild trigger.

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: createKumikoServer/runDevApp gain stylesheetWatch (env KUMIKO_DEV_STYLESHEET_WATCH=0) to build Tailwind CSS once without a --watch process
  -->

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: defineAppE2eConfig starts the E2E web server without a Tailwind --watch process, so Playwright artifact writes no longer trigger hundreds of CSS rebuilds
  -->

### Patch Changes

- Updated dependencies [90c5398]
- Updated dependencies [9de2cde]
- Updated dependencies [05b87d7]
- Updated dependencies [0ee6000]
- Updated dependencies [0567906]
- Updated dependencies [d98d172]
- Updated dependencies [d42d76a]
  - @cosmicdrift/kumiko-framework@0.305.0
  - @cosmicdrift/kumiko-bundled-features@0.305.0
  - @cosmicdrift/kumiko-headless@0.305.0
  - @cosmicdrift/kumiko-server-runtime@0.305.0

## 0.304.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.304.0
- @cosmicdrift/kumiko-bundled-features@0.304.0
- @cosmicdrift/kumiko-server-runtime@0.304.0
- @cosmicdrift/kumiko-headless@0.304.0

## 0.303.0

### Patch Changes

- Updated dependencies [3d28528]
  - @cosmicdrift/kumiko-framework@0.303.0
  - @cosmicdrift/kumiko-bundled-features@0.303.0
  - @cosmicdrift/kumiko-headless@0.303.0
  - @cosmicdrift/kumiko-server-runtime@0.303.0

## 0.302.0

### Patch Changes

- Updated dependencies [deede20]
  - @cosmicdrift/kumiko-framework@0.302.0
  - @cosmicdrift/kumiko-bundled-features@0.302.0
  - @cosmicdrift/kumiko-headless@0.302.0
  - @cosmicdrift/kumiko-server-runtime@0.302.0

## 0.301.0

### Patch Changes

- 5028a6c: Scaffolded bunfig.toml and bunfig.ci.toml no longer contain the inert [test] concurrency key

  bun has no [test] concurrency key and ignores it silently; the scaffold wrote concurrency = 8, which made kumiko-testing bunfig refuse the merge on a freshly scaffolded app. Existing apps can delete the line from their bunfig files; nothing changes at runtime.

  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: Scaffolded bunfig.toml and bunfig.ci.toml no longer contain the inert [test] concurrency key
  -->

- Updated dependencies [cf629d8]
- Updated dependencies [bae6958]
  - @cosmicdrift/kumiko-bundled-features@0.301.0
  - @cosmicdrift/kumiko-framework@0.301.0
  - @cosmicdrift/kumiko-server-runtime@0.301.0
  - @cosmicdrift/kumiko-headless@0.301.0

## 0.300.0

### Patch Changes

- Updated dependencies [2414932]
- Updated dependencies [2414932]
  - @cosmicdrift/kumiko-bundled-features@0.300.0
  - @cosmicdrift/kumiko-framework@0.300.0
  - @cosmicdrift/kumiko-server-runtime@0.300.0
  - @cosmicdrift/kumiko-headless@0.300.0

## 0.299.0

### Patch Changes

- aa09d45: Fix scaffold boot, guard multi-repo roots, --write-baseline CLI and bunfig overwrite (#3120)

  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: Scaffolded docker-compose.yml uses the correct Postgres 18 data path; default app mounts auth-foundation so it boots
  migration: |
    No action needed for existing apps; only newly scaffolded apps are affected.
  -->

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: AstGuard.run receives the caller's repo roots (guard-test-timeouts, guard-pii-annotations, guard-section-fields-raw, guard-text-field-stance, guard-i18n-locale-mount, guard-i18n-locale-terminology, check-complexity, guard-direct-fetch, guard-no-direct-fs, guard-write-handler-qns) so multi-repo aggregate runs stop throwing "cannot classify path" or dropping sibling-repo findings; --write-baseline now requires --guard=<name>
  migration: |
    No action needed for AstGuard.run's new optional `roots` parameter. `kumiko-guards guards --write-baseline` no longer writes every ratchet guard's baseline in one call; pass `--guard=<name>` to freeze one guard deliberately, or run it once per guard.
  -->

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: kumiko-testing bunfig merges app-owned sections (e.g. install.scopes) back in and only aborts, naming the key, when a managed [install]/[test] section has a key the template doesn't emit; e2e seed routes gain an isE2eSeedingEnabled() export so a custom server entry can skip mounting them in prod
  migration: |
    If `kumiko-testing bunfig` exits 1 naming a section.key (e.g. test.concurrency), remove or rename that key, or move it out of [install]/[test], then rerun. If your server entry mounts createE2eSeedRoutes() directly instead of using e2e/server.ts, guard the mount with isE2eSeedingEnabled() so prod never registers the seed routes.
  -->

  - @cosmicdrift/kumiko-framework@0.299.0
  - @cosmicdrift/kumiko-bundled-features@0.299.0
  - @cosmicdrift/kumiko-server-runtime@0.299.0
  - @cosmicdrift/kumiko-headless@0.299.0

## 0.298.0

### Minor Changes

- 6735981: createKumikoServer/runDevApp take ExtraRouteDefinition[]; dev hostDispatch gets systemQuery

  <!-- kumiko-changes
  feature: dev-server
  type: breaking
  title: createKumikoServer/runDevApp take ExtraRouteDefinition[]; dev hostDispatch gets systemQuery
  migration: |
    extraRoutes on createKumikoServer/runDevApp changes from (app, deps) => void to readonly ExtraRouteDefinition[] - see the framework core changelog entry for the route-kind/dep breakdown. wire?: (deps: SystemWireDeps) => void | Promise<void> replaces non-route setup previously done inside the old extraRoutes callback. The dev hostDispatch callback now receives a second argument { systemQuery }; a dispatch implementation reading the dev db directly switches to systemQuery.
  -->

### Patch Changes

- Updated dependencies [6735981]
- Updated dependencies [4ae8163]
- Updated dependencies [6735981]
- Updated dependencies [6735981]
- Updated dependencies [6735981]
  - @cosmicdrift/kumiko-bundled-features@0.298.0
  - @cosmicdrift/kumiko-framework@0.298.0
  - @cosmicdrift/kumiko-server-runtime@0.298.0
  - @cosmicdrift/kumiko-headless@0.298.0

## 0.297.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.297.0
- @cosmicdrift/kumiko-framework@0.297.0
- @cosmicdrift/kumiko-server-runtime@0.297.0
- @cosmicdrift/kumiko-headless@0.297.0

## 0.296.0

### Patch Changes

- Updated dependencies [bfa7536]
- Updated dependencies [cb6e8a4]
- Updated dependencies [bfa7536]
- Updated dependencies [42b0562]
- Updated dependencies [f042685]
- Updated dependencies [d8cdd8a]
- Updated dependencies [3c34575]
  - @cosmicdrift/kumiko-bundled-features@0.296.0
  - @cosmicdrift/kumiko-framework@0.296.0
  - @cosmicdrift/kumiko-headless@0.296.0
  - @cosmicdrift/kumiko-server-runtime@0.296.0

## 0.295.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.295.0
- @cosmicdrift/kumiko-bundled-features@0.295.0
- @cosmicdrift/kumiko-server-runtime@0.295.0
- @cosmicdrift/kumiko-headless@0.295.0

## 0.294.1

### Patch Changes

- Updated dependencies [7f6fbc6]
  - @cosmicdrift/kumiko-framework@0.294.1
  - @cosmicdrift/kumiko-bundled-features@0.294.1
  - @cosmicdrift/kumiko-headless@0.294.1
  - @cosmicdrift/kumiko-server-runtime@0.294.1

## 0.294.0

### Patch Changes

- Updated dependencies [ea10c90]
  - @cosmicdrift/kumiko-framework@0.294.0
  - @cosmicdrift/kumiko-bundled-features@0.294.0
  - @cosmicdrift/kumiko-server-runtime@0.294.0
  - @cosmicdrift/kumiko-headless@0.294.0

## 0.293.0

### Patch Changes

- Updated dependencies [7fb8a62]
  - @cosmicdrift/kumiko-framework@0.293.0
  - @cosmicdrift/kumiko-bundled-features@0.293.0
  - @cosmicdrift/kumiko-headless@0.293.0
  - @cosmicdrift/kumiko-server-runtime@0.293.0

## 0.292.0

### Patch Changes

- fbe8ffa: `FILE_STORAGE_PROVIDER` now selects the file provider, not just the boot gate

  `file-foundation`'s `provider` config key declares `env: "FILE_STORAGE_PROVIDER"`, so the generic ENV→app-override bridge (`buildEnvConfigOverrides`) fills it at boot. An app that mounts `composeFileStack({ providers: [...] })` and sets `FILE_STORAGE_PROVIDER=s3-env` gets that provider without replacing `createConfigResolver` — the workaround three apps had copied, each of which also had to re-wire the envelope cipher for `encrypted: true` keys or lose decryption silently.

  The cascade is unchanged: the ENV value sits on the app-override rung, so a tenant row written via `config:write:set` still overrides it.

  `FILE_STORAGE_PROVIDER` carries a second meaning — `validateBoot` requires its presence once file/image fields are in use, and `runDevApp` sets it to `"configured"` when `options.files` already wires a provider. That placeholder names no plugin, so `createFileProviderForTenant` treats it like an unset key and raises its usual "no provider selected" error instead of looking up a provider called `configured`. Both strings are now the exported constants `FILE_STORAGE_PROVIDER_ENV` and `FILE_STORAGE_PROVIDER_BOOT_SENTINEL`.

  Not breaking, but check your value before upgrading: an app on the framework's default resolver whose `FILE_STORAGE_PROVIDER` is neither a registered provider name nor the sentinel now fails with `provider "<value>" not registered` where it previously failed with `no provider selected` — an error either way, but a different one. Apps that pass their own `configResolver` never reach the bridge and are unaffected. A second consequence: `config:query:readiness` resolves the same key, so for a tenant without a row the ENV-selected provider's required keys now count as required where nothing counted before.

  <!-- kumiko-changes
  feature: file-foundation
  type: improvement
  title: FILE_STORAGE_PROVIDER selects the file provider, not just the boot gate
  detail: The `provider` config key declares `env: "FILE_STORAGE_PROVIDER"`, so the ENV→app-override bridge selects the provider at boot without an app-side `createConfigResolver` rebuild. Tenant rows still override the ENV value (cascade unchanged). The boot-gate placeholder `"configured"` that `runDevApp` writes names no plugin, so `createFileProviderForTenant` treats it as unset and raises "no provider selected"; both strings are exported as `FILE_STORAGE_PROVIDER_ENV` / `FILE_STORAGE_PROVIDER_BOOT_SENTINEL`.
  migration: Apps on the framework's default config resolver: make sure `FILE_STORAGE_PROVIDER` holds a registered provider name (`inmemory`, `s3`, `s3-env`) — it is now the provider selection, not only a presence check. Apps that pass their own `configResolver` are unaffected and can drop their hand-rolled `file-foundation:config:provider` app-override.
  -->

- Updated dependencies [787c572]
- Updated dependencies [fbe8ffa]
- Updated dependencies [7b5ac24]
- Updated dependencies [6d53c10]
  - @cosmicdrift/kumiko-bundled-features@0.292.0
  - @cosmicdrift/kumiko-framework@0.292.0
  - @cosmicdrift/kumiko-server-runtime@0.292.0
  - @cosmicdrift/kumiko-headless@0.292.0

## 0.291.0

### Minor Changes

- 32a1ce3: runProdApp, runDevApp and runWorkerApp forward validateBootOptions to validateBoot (fw#3080)

  All three run-app entrypoints called `validateBoot(features)` without options, so only `createApp` could pass a `navAllowlist` or `warnOnUniqueAccessRoles` through. An app could declare the option, test it against `validateBoot` directly and see green — while the process it actually boots never received it. The three option types now carry an optional `validateBootOptions`, passed straight through in the same shape `createApp` already uses. `ValidateBootOptions` is exported from `@cosmicdrift/kumiko-framework/engine` so consumers can type the value. Omitting it leaves boot behaviour unchanged.

  <!-- kumiko-changes
  feature: server-runtime
  type: fix
  title: runProdApp, runDevApp and runWorkerApp forward validateBootOptions to validateBoot (fw#3080)
  -->

### Patch Changes

- c061ac9: renderWriteHandlerTypes emits the WriteHandlerQn union in stable order

  `renderWriteHandlerTypes` now sorts `handlerQns` before rendering, like its sibling renderers in the same file. The dev-server passes registration order (`collectWriteHandlerQns`) while the CLI/build path passes manifest order, so the same feature set produced a differently ordered `WriteHandlerQn` union in `.kumiko/define.ts` and `.kumiko/types.generated.d.ts` depending on which one ran last. Consumer apps that commit those generated files no longer get order-only diffs after a local `bun dev`.

  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: renderWriteHandlerTypes emits the WriteHandlerQn union in stable order
  -->

- Updated dependencies [1ae48cb]
- Updated dependencies [0fa2da2]
- Updated dependencies [ef54b65]
- Updated dependencies [d47adef]
- Updated dependencies [ca8d3e3]
- Updated dependencies [53e20f4]
- Updated dependencies [67a4227]
- Updated dependencies [0621367]
- Updated dependencies [0fd6bb5]
- Updated dependencies [9331ec5]
- Updated dependencies [229298b]
- Updated dependencies [32a1ce3]
  - @cosmicdrift/kumiko-bundled-features@0.291.0
  - @cosmicdrift/kumiko-framework@0.291.0
  - @cosmicdrift/kumiko-server-runtime@0.291.0
  - @cosmicdrift/kumiko-headless@0.291.0

## 0.290.0

### Patch Changes

- Updated dependencies [878d8b2]
- Updated dependencies [9da6b5f]
- Updated dependencies [fe23245]
  - @cosmicdrift/kumiko-framework@0.290.0
  - @cosmicdrift/kumiko-bundled-features@0.290.0
  - @cosmicdrift/kumiko-headless@0.290.0
  - @cosmicdrift/kumiko-server-runtime@0.290.0

## 0.289.0

### Minor Changes

- a200a5c: runDevApp gains resolvePageHead for dev/e2e parity with runProdApp

  RunDevAppOptions/CreateKumikoServerOptions gain resolvePageHead, same PageHeadResolver signature as RunProdAppOptions. Applied to every templated HTML response (default single-entry shell and a host-dispatched "html" entry) via the shared @cosmicdrift/kumiko-headless/apex resolveAndInjectPageHead — same 300ms timeout, same error/null/timeout-falls-back-to-unchanged-200-shell semantics as prod (kumiko-framework#3026). The dev-only static-html hostDispatch kind (raw file passthrough, no bundle/schema injection either) is unaffected. No behavior change for apps that don't set resolvePageHead.

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: runDevApp gains resolvePageHead for dev/e2e parity with runProdApp
  -->

### Patch Changes

- Updated dependencies [dea8ea0]
- Updated dependencies [78f9c42]
- Updated dependencies [efac5bb]
- Updated dependencies [20853fa]
- Updated dependencies [1e5a8e0]
- Updated dependencies [f01015e]
- Updated dependencies [a84d3cb]
- Updated dependencies [dea8ea0]
- Updated dependencies [2e868a7]
- Updated dependencies [253ade3]
- Updated dependencies [a200a5c]
- Updated dependencies [a200a5c]
- Updated dependencies [f01015e]
  - @cosmicdrift/kumiko-bundled-features@0.289.0
  - @cosmicdrift/kumiko-framework@0.289.0
  - @cosmicdrift/kumiko-headless@0.289.0
  - @cosmicdrift/kumiko-server-runtime@0.289.0

## 0.288.0

### Patch Changes

- Updated dependencies [70cac5a]
  - @cosmicdrift/kumiko-bundled-features@0.288.0
  - @cosmicdrift/kumiko-server-runtime@0.288.0
  - @cosmicdrift/kumiko-framework@0.288.0

## 0.287.0

### Patch Changes

- Updated dependencies [7a60311]
- Updated dependencies [3489874]
- Updated dependencies [76f2631]
- Updated dependencies [89ba55f]
- Updated dependencies [89ba55f]
- Updated dependencies [3ce01df]
  - @cosmicdrift/kumiko-bundled-features@0.287.0
  - @cosmicdrift/kumiko-framework@0.287.0
  - @cosmicdrift/kumiko-server-runtime@0.287.0

## 0.286.0

### Patch Changes

- Updated dependencies [fb24ada]
- Updated dependencies [1f7ab5d]
  - @cosmicdrift/kumiko-bundled-features@0.286.0
  - @cosmicdrift/kumiko-server-runtime@0.286.0
  - @cosmicdrift/kumiko-framework@0.286.0

## 0.285.2

### Patch Changes

- Updated dependencies [9c28242]
  - @cosmicdrift/kumiko-framework@0.285.2
  - @cosmicdrift/kumiko-bundled-features@0.285.2
  - @cosmicdrift/kumiko-server-runtime@0.285.2

## 0.285.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.285.1
- @cosmicdrift/kumiko-bundled-features@0.285.1
- @cosmicdrift/kumiko-server-runtime@0.285.1

## 0.285.0

### Patch Changes

- Updated dependencies [8ee38b3]
  - @cosmicdrift/kumiko-framework@0.285.0
  - @cosmicdrift/kumiko-bundled-features@0.285.0
  - @cosmicdrift/kumiko-server-runtime@0.285.0

## 0.284.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.284.0
- @cosmicdrift/kumiko-bundled-features@0.284.0
- @cosmicdrift/kumiko-server-runtime@0.284.0

## 0.283.0

### Patch Changes

- Updated dependencies [45f7641]
  - @cosmicdrift/kumiko-framework@0.283.0
  - @cosmicdrift/kumiko-bundled-features@0.283.0
  - @cosmicdrift/kumiko-server-runtime@0.283.0

## 0.282.0

### Patch Changes

- Updated dependencies [a56b257]
  - @cosmicdrift/kumiko-bundled-features@0.282.0
  - @cosmicdrift/kumiko-server-runtime@0.282.0
  - @cosmicdrift/kumiko-framework@0.282.0

## 0.281.0

### Patch Changes

- Updated dependencies [8de23a7]
- Updated dependencies [7ae9256]
- Updated dependencies [7bf2e5e]
- Updated dependencies [f1dc700]
  - @cosmicdrift/kumiko-framework@0.281.0
  - @cosmicdrift/kumiko-bundled-features@0.281.0
  - @cosmicdrift/kumiko-server-runtime@0.281.0

## 0.280.0

### Patch Changes

- Updated dependencies [fae19a6]
  - @cosmicdrift/kumiko-framework@0.280.0
  - @cosmicdrift/kumiko-bundled-features@0.280.0
  - @cosmicdrift/kumiko-server-runtime@0.280.0

## 0.279.0

### Patch Changes

- Updated dependencies [e55f357]
  - @cosmicdrift/kumiko-framework@0.279.0
  - @cosmicdrift/kumiko-bundled-features@0.279.0
  - @cosmicdrift/kumiko-server-runtime@0.279.0

## 0.278.0

### Patch Changes

- Updated dependencies [17dcac1]
- Updated dependencies [17dcac1]
- Updated dependencies [3e1eb25]
- Updated dependencies [17dcac1]
- Updated dependencies [17dcac1]
  - @cosmicdrift/kumiko-bundled-features@0.278.0
  - @cosmicdrift/kumiko-framework@0.278.0
  - @cosmicdrift/kumiko-server-runtime@0.278.0

## 0.277.0

### Patch Changes

- Updated dependencies [411e80b]
  - @cosmicdrift/kumiko-framework@0.277.0
  - @cosmicdrift/kumiko-bundled-features@0.277.0
  - @cosmicdrift/kumiko-server-runtime@0.277.0

## 0.276.0

### Patch Changes

- Updated dependencies [e2312ee]
  - @cosmicdrift/kumiko-framework@0.276.0
  - @cosmicdrift/kumiko-bundled-features@0.276.0
  - @cosmicdrift/kumiko-server-runtime@0.276.0

## 0.275.0

### Patch Changes

- Updated dependencies [2cb61dd]
- Updated dependencies [9d9a462]
  - @cosmicdrift/kumiko-framework@0.275.0
  - @cosmicdrift/kumiko-bundled-features@0.275.0
  - @cosmicdrift/kumiko-server-runtime@0.275.0

## 0.274.0

### Patch Changes

- Updated dependencies [47070b6]
- Updated dependencies [282072a]
  - @cosmicdrift/kumiko-framework@0.274.0
  - @cosmicdrift/kumiko-bundled-features@0.274.0
  - @cosmicdrift/kumiko-server-runtime@0.274.0

## 0.273.0

### Patch Changes

- Updated dependencies [e9d3944]
- Updated dependencies [01c9133]
  - @cosmicdrift/kumiko-framework@0.273.0
  - @cosmicdrift/kumiko-bundled-features@0.273.0
  - @cosmicdrift/kumiko-server-runtime@0.273.0

## 0.272.0

### Patch Changes

- Updated dependencies [147fb82]
- Updated dependencies [6c55fa2]
- Updated dependencies [94812d3]
- Updated dependencies [7bf4309]
  - @cosmicdrift/kumiko-framework@0.272.0
  - @cosmicdrift/kumiko-bundled-features@0.272.0
  - @cosmicdrift/kumiko-server-runtime@0.272.0

## 0.271.0

### Patch Changes

- Updated dependencies [94b9d44]
- Updated dependencies [c704c75]
- Updated dependencies [60ed7ed]
- Updated dependencies [c704c75]
- Updated dependencies [5f8be0d]
  - @cosmicdrift/kumiko-framework@0.271.0
  - @cosmicdrift/kumiko-bundled-features@0.271.0
  - @cosmicdrift/kumiko-server-runtime@0.271.0

## 0.270.0

### Minor Changes

- dba0a60: `openToAll: true` is removed from `OpenToAllAccessRule` — every `openToAll` grant now requires `{ reason: string }`. `isOpenToAllGranted` denies a bare `true` reaching it from an untyped source (pattern JSON, Designer) the same way it already denied a malformed object. The boot validator rejects an untyped `openToAll: true` access declaration with an error pointing at `{ reason }`. The pattern-library Designer access field is now a required text input on `access.openToAll.reason` instead of a boolean toggle. `build-config-feature-schema.ts` synthesizes `{ openToAll: { reason: "..." } }` (instead of `{ openToAll: true }`) for a config key whose roles include `"all"`. `boot-validator/nav.ts` and `renderer-web/app/create-app.tsx` switched from `"openToAll" in access` to `isOpenToAllGranted(access)`. The feature-AST extractor now also extracts `escapeHatch: { reason }` on write/query handlers and on `r.hook` options.

  New codemod `scripts/codemod/migrate-open-to-all.ts` rewrites `openToAll: true` to `openToAll: { reason }` in test files and reports every non-test site for a manual reason.

### Patch Changes

- Updated dependencies [dba0a60]
  - @cosmicdrift/kumiko-framework@0.270.0
  - @cosmicdrift/kumiko-bundled-features@0.270.0
  - @cosmicdrift/kumiko-server-runtime@0.270.0

## 0.269.2

### Patch Changes

- Updated dependencies [3d58c23]
  - @cosmicdrift/kumiko-framework@0.269.2
  - @cosmicdrift/kumiko-bundled-features@0.269.2
  - @cosmicdrift/kumiko-server-runtime@0.269.2

## 0.269.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.269.1
- @cosmicdrift/kumiko-server-runtime@0.269.1
- @cosmicdrift/kumiko-framework@0.269.1

## 0.269.0

### Patch Changes

- Updated dependencies [ec9aaca]
- Updated dependencies [8412e09]
  - @cosmicdrift/kumiko-framework@0.269.0
  - @cosmicdrift/kumiko-bundled-features@0.269.0
  - @cosmicdrift/kumiko-server-runtime@0.269.0

## 0.268.0

### Patch Changes

- Updated dependencies [b16457a]
  - @cosmicdrift/kumiko-framework@0.268.0
  - @cosmicdrift/kumiko-bundled-features@0.268.0
  - @cosmicdrift/kumiko-server-runtime@0.268.0

## 0.267.0

### Patch Changes

- Updated dependencies [e87ab51]
  - @cosmicdrift/kumiko-framework@0.267.0
  - @cosmicdrift/kumiko-bundled-features@0.267.0
  - @cosmicdrift/kumiko-server-runtime@0.267.0

## 0.266.0

### Patch Changes

- Updated dependencies [4d36b68]
  - @cosmicdrift/kumiko-framework@0.266.0
  - @cosmicdrift/kumiko-bundled-features@0.266.0
  - @cosmicdrift/kumiko-server-runtime@0.266.0

## 0.265.0

### Patch Changes

- Updated dependencies [371a263]
  - @cosmicdrift/kumiko-framework@0.265.0
  - @cosmicdrift/kumiko-bundled-features@0.265.0
  - @cosmicdrift/kumiko-server-runtime@0.265.0

## 0.264.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.264.1
- @cosmicdrift/kumiko-server-runtime@0.264.1
- @cosmicdrift/kumiko-framework@0.264.1

## 0.264.0

### Patch Changes

- Updated dependencies [d0184f7]
  - @cosmicdrift/kumiko-framework@0.264.0
  - @cosmicdrift/kumiko-bundled-features@0.264.0
  - @cosmicdrift/kumiko-server-runtime@0.264.0

## 0.263.0

### Patch Changes

- Updated dependencies [cd255ca]
- Updated dependencies [f6732fa]
  - @cosmicdrift/kumiko-framework@0.263.0
  - @cosmicdrift/kumiko-bundled-features@0.263.0
  - @cosmicdrift/kumiko-server-runtime@0.263.0

## 0.262.0

### Patch Changes

- Updated dependencies [6fbede9]
  - @cosmicdrift/kumiko-framework@0.262.0
  - @cosmicdrift/kumiko-bundled-features@0.262.0
  - @cosmicdrift/kumiko-server-runtime@0.262.0

## 0.261.0

### Patch Changes

- Updated dependencies [5139a3f]
  - @cosmicdrift/kumiko-framework@0.261.0
  - @cosmicdrift/kumiko-bundled-features@0.261.0
  - @cosmicdrift/kumiko-server-runtime@0.261.0

## 0.260.0

### Patch Changes

- Updated dependencies [71b9c4b]
  - @cosmicdrift/kumiko-bundled-features@0.260.0
  - @cosmicdrift/kumiko-framework@0.260.0
  - @cosmicdrift/kumiko-server-runtime@0.260.0

## 0.259.0

### Patch Changes

- Updated dependencies [20dc41a]
  - @cosmicdrift/kumiko-framework@0.259.0
  - @cosmicdrift/kumiko-bundled-features@0.259.0
  - @cosmicdrift/kumiko-server-runtime@0.259.0

## 0.258.1

### Patch Changes

- 3c6c428: Declare the personal stance on the remaining non-test createTextField call sites (kumiko-framework#2810).
- Updated dependencies [b555e6c]
- Updated dependencies [3c6c428]
  - @cosmicdrift/kumiko-bundled-features@0.258.1
  - @cosmicdrift/kumiko-framework@0.258.1
  - @cosmicdrift/kumiko-server-runtime@0.258.1

## 0.258.0

### Patch Changes

- Updated dependencies [f2e57b4]
- Updated dependencies [c1b53a3]
- Updated dependencies [27166cb]
  - @cosmicdrift/kumiko-framework@0.258.0
  - @cosmicdrift/kumiko-bundled-features@0.258.0
  - @cosmicdrift/kumiko-server-runtime@0.258.0

## 0.257.0

### Patch Changes

- Updated dependencies [04794a7]
  - @cosmicdrift/kumiko-bundled-features@0.257.0
  - @cosmicdrift/kumiko-server-runtime@0.257.0
  - @cosmicdrift/kumiko-framework@0.257.0

## 0.256.0

### Patch Changes

- Updated dependencies [586d707]
  - @cosmicdrift/kumiko-framework@0.256.0
  - @cosmicdrift/kumiko-bundled-features@0.256.0
  - @cosmicdrift/kumiko-server-runtime@0.256.0

## 0.255.2

### Patch Changes

- Updated dependencies [2ec3f41]
  - @cosmicdrift/kumiko-bundled-features@0.255.2
  - @cosmicdrift/kumiko-server-runtime@0.255.2
  - @cosmicdrift/kumiko-framework@0.255.2

## 0.255.1

### Patch Changes

- Updated dependencies [5b04527]
  - @cosmicdrift/kumiko-framework@0.255.1
  - @cosmicdrift/kumiko-bundled-features@0.255.1
  - @cosmicdrift/kumiko-server-runtime@0.255.1

## 0.255.0

### Patch Changes

- Updated dependencies [88530a2]
- Updated dependencies [0374846]
- Updated dependencies [1212eeb]
- Updated dependencies [7003472]
  - @cosmicdrift/kumiko-framework@0.255.0
  - @cosmicdrift/kumiko-bundled-features@0.255.0
  - @cosmicdrift/kumiko-server-runtime@0.255.0

## 0.254.0

### Patch Changes

- Updated dependencies [9b74bc9]
- Updated dependencies [a8f109b]
  - @cosmicdrift/kumiko-framework@0.254.0
  - @cosmicdrift/kumiko-bundled-features@0.254.0
  - @cosmicdrift/kumiko-server-runtime@0.254.0

## 0.253.0

### Patch Changes

- Updated dependencies [e626ea3]
  - @cosmicdrift/kumiko-bundled-features@0.253.0
  - @cosmicdrift/kumiko-server-runtime@0.253.0
  - @cosmicdrift/kumiko-framework@0.253.0

## 0.252.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.252.1
- @cosmicdrift/kumiko-server-runtime@0.252.1
- @cosmicdrift/kumiko-framework@0.252.1

## 0.252.0

### Patch Changes

- Updated dependencies [f0a494a]
  - @cosmicdrift/kumiko-bundled-features@0.252.0
  - @cosmicdrift/kumiko-server-runtime@0.252.0
  - @cosmicdrift/kumiko-framework@0.252.0

## 0.251.0

### Patch Changes

- Updated dependencies [55691fd]
- Updated dependencies [28ad1f3]
  - @cosmicdrift/kumiko-framework@0.251.0
  - @cosmicdrift/kumiko-bundled-features@0.251.0
  - @cosmicdrift/kumiko-server-runtime@0.251.0

## 0.250.0

### Patch Changes

- Updated dependencies [86e18dd]
- Updated dependencies [a4a25ee]
- Updated dependencies [e349f03]
- Updated dependencies [0be08d9]
- Updated dependencies [a8955dd]
- Updated dependencies [d9f9337]
- Updated dependencies [efe22b1]
- Updated dependencies [5c1c606]
  - @cosmicdrift/kumiko-framework@0.250.0
  - @cosmicdrift/kumiko-bundled-features@0.250.0
  - @cosmicdrift/kumiko-server-runtime@0.250.0

## 0.249.0

### Patch Changes

- 14fb8a2: Fix `runCodegen` (and thus `kumiko-build`) deleting an already-generated `WriteHandlerQn` union / `TypedDispatcher` block from `.kumiko/` when no `feature-manifest.json` is present; the block is now preserved as-is with a warning instead of being silently dropped.
- Updated dependencies [812795d]
- Updated dependencies [f268c17]
  - @cosmicdrift/kumiko-framework@0.249.0
  - @cosmicdrift/kumiko-bundled-features@0.249.0
  - @cosmicdrift/kumiko-server-runtime@0.249.0

## 0.248.0

### Patch Changes

- Updated dependencies [109ff0d]
  - @cosmicdrift/kumiko-framework@0.248.0
  - @cosmicdrift/kumiko-bundled-features@0.248.0
  - @cosmicdrift/kumiko-server-runtime@0.248.0

## 0.247.0

### Patch Changes

- Updated dependencies [25cbdd2]
- Updated dependencies [f9f5608]
  - @cosmicdrift/kumiko-framework@0.247.0
  - @cosmicdrift/kumiko-bundled-features@0.247.0
  - @cosmicdrift/kumiko-server-runtime@0.247.0

## 0.246.0

### Patch Changes

- Updated dependencies [b4d5b20]
- Updated dependencies [f2c9178]
- Updated dependencies [137191d]
  - @cosmicdrift/kumiko-framework@0.246.0
  - @cosmicdrift/kumiko-bundled-features@0.246.0
  - @cosmicdrift/kumiko-server-runtime@0.246.0

## 0.245.0

### Patch Changes

- Updated dependencies [3359dae]
- Updated dependencies [d669ad6]
  - @cosmicdrift/kumiko-framework@0.245.0
  - @cosmicdrift/kumiko-bundled-features@0.245.0
  - @cosmicdrift/kumiko-server-runtime@0.245.0

## 0.244.0

### Patch Changes

- Updated dependencies [2cb949e]
- Updated dependencies [9179815]
- Updated dependencies [dc4e6a2]
  - @cosmicdrift/kumiko-framework@0.244.0
  - @cosmicdrift/kumiko-bundled-features@0.244.0
  - @cosmicdrift/kumiko-server-runtime@0.244.0

## 0.243.4

### Patch Changes

- 8c7b961: Fix `createKumikoServer` 404ing on static assets under `public/` (e.g. `/marketing/hero.png`). The dev-server's SPA catch-all only handled dot-less paths, so any dotted request that wasn't the client bundle fell straight through to the API stack and 404ed — this worked in prod (`buildStaticFallback`'s disk lookup) but not dev.

  Dotted GET/HEAD requests outside `/api/` and `/sse` now try the Hono app first (an `r.httpRoute` can still own a dotted path), then fall back to a file under `<cwd>/public/`, then the router-miss 404 — mirroring the SPA branch's Hono-first order. The path is decoded and resolved against `publicDir` with a containment check (blocks both literal `..` and the `%2e%2e%2f` encoded-slash vector, which `new URL()` doesn't normalize on its own), plus a `realpath`-based check after the read so a symlink inside `public/` can't point outside it.

  - @cosmicdrift/kumiko-bundled-features@0.243.4
  - @cosmicdrift/kumiko-server-runtime@0.243.4
  - @cosmicdrift/kumiko-framework@0.243.4

## 0.243.3

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.243.3
- @cosmicdrift/kumiko-server-runtime@0.243.3
- @cosmicdrift/kumiko-framework@0.243.3

## 0.243.2

### Patch Changes

- Updated dependencies [3667747]
  - @cosmicdrift/kumiko-bundled-features@0.243.2
  - @cosmicdrift/kumiko-server-runtime@0.243.2
  - @cosmicdrift/kumiko-framework@0.243.2

## 0.243.1

### Patch Changes

- Updated dependencies [006119f]
  - @cosmicdrift/kumiko-bundled-features@0.243.1
  - @cosmicdrift/kumiko-server-runtime@0.243.1
  - @cosmicdrift/kumiko-framework@0.243.1

## 0.243.0

### Patch Changes

- Updated dependencies [349d763]
  - @cosmicdrift/kumiko-framework@0.243.0
  - @cosmicdrift/kumiko-bundled-features@0.243.0
  - @cosmicdrift/kumiko-server-runtime@0.243.0

## 0.242.0

### Patch Changes

- Updated dependencies [efd5891]
  - @cosmicdrift/kumiko-framework@0.242.0
  - @cosmicdrift/kumiko-bundled-features@0.242.0
  - @cosmicdrift/kumiko-server-runtime@0.242.0

## 0.241.0

### Patch Changes

- Updated dependencies [33059e9]
- Updated dependencies [43b41b5]
- Updated dependencies [8289b69]
- Updated dependencies [408729d]
- Updated dependencies [b68e9e7]
- Updated dependencies [8d6abd4]
  - @cosmicdrift/kumiko-bundled-features@0.241.0
  - @cosmicdrift/kumiko-framework@0.241.0
  - @cosmicdrift/kumiko-server-runtime@0.241.0

## 0.240.0

### Patch Changes

- Updated dependencies [db53bbc]
- Updated dependencies [ca82938]
- Updated dependencies [0823b37]
  - @cosmicdrift/kumiko-framework@0.240.0
  - @cosmicdrift/kumiko-bundled-features@0.240.0
  - @cosmicdrift/kumiko-server-runtime@0.240.0

## 0.239.0

### Patch Changes

- Updated dependencies [2fbab3d]
  - @cosmicdrift/kumiko-framework@0.239.0
  - @cosmicdrift/kumiko-bundled-features@0.239.0
  - @cosmicdrift/kumiko-server-runtime@0.239.0

## 0.238.0

### Patch Changes

- Updated dependencies [8206493]
  - @cosmicdrift/kumiko-framework@0.238.0
  - @cosmicdrift/kumiko-bundled-features@0.238.0
  - @cosmicdrift/kumiko-server-runtime@0.238.0

## 0.237.2

### Patch Changes

- Updated dependencies [562b11f]
  - @cosmicdrift/kumiko-bundled-features@0.237.2
  - @cosmicdrift/kumiko-server-runtime@0.237.2
  - @cosmicdrift/kumiko-framework@0.237.2

## 0.237.1

### Patch Changes

- Updated dependencies [da3aed4]
  - @cosmicdrift/kumiko-framework@0.237.1
  - @cosmicdrift/kumiko-bundled-features@0.237.1
  - @cosmicdrift/kumiko-server-runtime@0.237.1

## 0.237.0

### Patch Changes

- Updated dependencies [0f399c2]
- Updated dependencies [1dca3bc]
- Updated dependencies [9b2eae0]
  - @cosmicdrift/kumiko-framework@0.237.0
  - @cosmicdrift/kumiko-bundled-features@0.237.0
  - @cosmicdrift/kumiko-server-runtime@0.237.0

## 0.236.1

### Patch Changes

- Updated dependencies [825acb8]
  - @cosmicdrift/kumiko-framework@0.236.1
  - @cosmicdrift/kumiko-server-runtime@0.236.1
  - @cosmicdrift/kumiko-bundled-features@0.236.1

## 0.236.0

### Patch Changes

- Updated dependencies [ccad32d]
- Updated dependencies [69529cd]
- Updated dependencies [1c330c2]
- Updated dependencies [e668a62]
  - @cosmicdrift/kumiko-framework@0.236.0
  - @cosmicdrift/kumiko-bundled-features@0.236.0
  - @cosmicdrift/kumiko-server-runtime@0.236.0

## 0.235.4

### Patch Changes

- Updated dependencies [c5a5dd4]
- Updated dependencies [41ef079]
  - @cosmicdrift/kumiko-framework@0.235.4
  - @cosmicdrift/kumiko-bundled-features@0.235.4
  - @cosmicdrift/kumiko-server-runtime@0.235.4

## 0.235.3

### Patch Changes

- Updated dependencies [fa9a541]
  - @cosmicdrift/kumiko-framework@0.235.3
  - @cosmicdrift/kumiko-bundled-features@0.235.3
  - @cosmicdrift/kumiko-server-runtime@0.235.3

## 0.235.2

### Patch Changes

- Updated dependencies [1ce74b3]
  - @cosmicdrift/kumiko-framework@0.235.2
  - @cosmicdrift/kumiko-bundled-features@0.235.2
  - @cosmicdrift/kumiko-server-runtime@0.235.2

## 0.235.1

### Patch Changes

- Updated dependencies [4c83a80]
- Updated dependencies [c3f1b2a]
  - @cosmicdrift/kumiko-framework@0.235.1
  - @cosmicdrift/kumiko-bundled-features@0.235.1
  - @cosmicdrift/kumiko-server-runtime@0.235.1

## 0.235.0

### Patch Changes

- Updated dependencies [9dc8d1c]
- Updated dependencies [38d7ffc]
- Updated dependencies [5882fb3]
  - @cosmicdrift/kumiko-framework@0.235.0
  - @cosmicdrift/kumiko-bundled-features@0.235.0
  - @cosmicdrift/kumiko-server-runtime@0.235.0

## 0.234.0

### Patch Changes

- Updated dependencies [40a8143]
  - @cosmicdrift/kumiko-framework@0.234.0
  - @cosmicdrift/kumiko-bundled-features@0.234.0
  - @cosmicdrift/kumiko-server-runtime@0.234.0

## 0.233.0

### Patch Changes

- Updated dependencies [4b83147]
- Updated dependencies [dd6cf49]
  - @cosmicdrift/kumiko-bundled-features@0.233.0
  - @cosmicdrift/kumiko-server-runtime@0.233.0
  - @cosmicdrift/kumiko-framework@0.233.0

## 0.232.0

### Patch Changes

- 5dd1cc1: Fix `startDevJobRunners` (dev-server boot) never calling `attachDispatcher()` on its per-lane job runners, so `ctx.write`/`ctx.queryAs` inside any dev-run job threw "dispatcher attached — call attachDispatcher() first" on their first call. Production entrypoints were unaffected — they already wire this automatically.
- Updated dependencies [5dd1cc1]
- Updated dependencies [aeac06f]
- Updated dependencies [05bdf93]
- Updated dependencies [03a8df0]
  - @cosmicdrift/kumiko-server-runtime@0.232.0
  - @cosmicdrift/kumiko-framework@0.232.0
  - @cosmicdrift/kumiko-bundled-features@0.232.0

## 0.231.0

### Patch Changes

- Updated dependencies [404d143]
- Updated dependencies [5d4c21e]
- Updated dependencies [4f4bc49]
  - @cosmicdrift/kumiko-framework@0.231.0
  - @cosmicdrift/kumiko-bundled-features@0.231.0
  - @cosmicdrift/kumiko-server-runtime@0.231.0

## 0.230.0

### Patch Changes

- Updated dependencies [b56b01e]
  - @cosmicdrift/kumiko-bundled-features@0.230.0
  - @cosmicdrift/kumiko-server-runtime@0.230.0
  - @cosmicdrift/kumiko-framework@0.230.0

## 0.229.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.229.1
- @cosmicdrift/kumiko-server-runtime@0.229.1
- @cosmicdrift/kumiko-framework@0.229.1

## 0.229.0

### Patch Changes

- Updated dependencies [ebadd51]
  - @cosmicdrift/kumiko-framework@0.229.0
  - @cosmicdrift/kumiko-bundled-features@0.229.0
  - @cosmicdrift/kumiko-server-runtime@0.229.0

## 0.228.0

### Patch Changes

- Updated dependencies [8685ef8]
  - @cosmicdrift/kumiko-bundled-features@0.228.0
  - @cosmicdrift/kumiko-server-runtime@0.228.0
  - @cosmicdrift/kumiko-framework@0.228.0

## 0.227.0

### Patch Changes

- Updated dependencies [8c718c0]
- Updated dependencies [5f157b6]
  - @cosmicdrift/kumiko-bundled-features@0.227.0
  - @cosmicdrift/kumiko-framework@0.227.0
  - @cosmicdrift/kumiko-server-runtime@0.227.0

## 0.226.0

### Patch Changes

- Updated dependencies [211ff70]
- Updated dependencies [db616cb]
- Updated dependencies [2e8cf67]
- Updated dependencies [bcac6f3]
- Updated dependencies [c4ed490]
  - @cosmicdrift/kumiko-framework@0.226.0
  - @cosmicdrift/kumiko-bundled-features@0.226.0
  - @cosmicdrift/kumiko-server-runtime@0.226.0

## 0.225.0

### Patch Changes

- Updated dependencies [aa1a1a7]
- Updated dependencies [aa1a1a7]
- Updated dependencies [5185710]
- Updated dependencies [d63b2e8]
  - @cosmicdrift/kumiko-framework@0.225.0
  - @cosmicdrift/kumiko-bundled-features@0.225.0
  - @cosmicdrift/kumiko-server-runtime@0.225.0

## 0.224.2

### Patch Changes

- Updated dependencies [415ff22]
  - @cosmicdrift/kumiko-framework@0.224.2
  - @cosmicdrift/kumiko-bundled-features@0.224.2
  - @cosmicdrift/kumiko-server-runtime@0.224.2

## 0.224.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.224.1
- @cosmicdrift/kumiko-server-runtime@0.224.1
- @cosmicdrift/kumiko-framework@0.224.1

## 0.224.0

### Patch Changes

- Updated dependencies [a65fe24]
  - @cosmicdrift/kumiko-bundled-features@0.224.0
  - @cosmicdrift/kumiko-server-runtime@0.224.0
  - @cosmicdrift/kumiko-framework@0.224.0

## 0.223.0

### Patch Changes

- Updated dependencies [c4d07f5]
  - @cosmicdrift/kumiko-framework@0.223.0
  - @cosmicdrift/kumiko-bundled-features@0.223.0
  - @cosmicdrift/kumiko-server-runtime@0.223.0

## 0.222.0

### Patch Changes

- Updated dependencies [6a13c64]
- Updated dependencies [8edfaa0]
- Updated dependencies [b00604c]
- Updated dependencies [d3ec5e0]
- Updated dependencies [afceecd]
  - @cosmicdrift/kumiko-framework@0.222.0
  - @cosmicdrift/kumiko-bundled-features@0.222.0
  - @cosmicdrift/kumiko-server-runtime@0.222.0

## 0.221.0

### Patch Changes

- 1656ff9: Scaffold templates pin bun-types ^1.4.0 and Dockerfile BUN_VERSION=1.4.0 so generated apps pick up the Bun 1.4 toolchain on the next publish.
- 1656ff9: Security review batch: prototype-safe role ranks, prod KMS fail-closed scaffolding, payload-tenant occupancy latch, invite-accept reserved-role writeFailure, and related contract docs.
- fab31bf: Fix tryHonoFirst masking a matched route's own deliberate 404 (e.g. default-deny reads) as the SPA shell with status 200. buildServer's `app.notFound()` now marks genuine router-misses with an internal-only header that tryHonoFirst — and every passthrough that bypasses it — uses to tell the two cases apart; the marker never reaches a client.

  Closes #2435

- Updated dependencies [1656ff9]
- Updated dependencies [fab31bf]
  - @cosmicdrift/kumiko-framework@0.221.0
  - @cosmicdrift/kumiko-bundled-features@0.221.0
  - @cosmicdrift/kumiko-server-runtime@0.221.0

## 0.220.1

### Patch Changes

- Updated dependencies [45abad1]
  - @cosmicdrift/kumiko-bundled-features@0.220.1
  - @cosmicdrift/kumiko-server-runtime@0.220.1
  - @cosmicdrift/kumiko-framework@0.220.1

## 0.220.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.220.0
- @cosmicdrift/kumiko-framework@0.220.0
- @cosmicdrift/kumiko-server-runtime@0.220.0

## 0.219.0

### Patch Changes

- Updated dependencies [7e1a189]
  - @cosmicdrift/kumiko-bundled-features@0.219.0
  - @cosmicdrift/kumiko-server-runtime@0.219.0
  - @cosmicdrift/kumiko-framework@0.219.0

## 0.218.0

### Patch Changes

- Updated dependencies [bfae2fb]
  - @cosmicdrift/kumiko-framework@0.218.0
  - @cosmicdrift/kumiko-bundled-features@0.218.0
  - @cosmicdrift/kumiko-server-runtime@0.218.0

## 0.217.0

### Patch Changes

- Updated dependencies [02aadf9]
  - @cosmicdrift/kumiko-framework@0.217.0
  - @cosmicdrift/kumiko-bundled-features@0.217.0
  - @cosmicdrift/kumiko-server-runtime@0.217.0

## 0.216.0

### Patch Changes

- Updated dependencies [89654bc]
  - @cosmicdrift/kumiko-framework@0.216.0
  - @cosmicdrift/kumiko-bundled-features@0.216.0
  - @cosmicdrift/kumiko-server-runtime@0.216.0

## 0.215.7

### Patch Changes

- Updated dependencies [93220e2]
  - @cosmicdrift/kumiko-bundled-features@0.215.7
  - @cosmicdrift/kumiko-server-runtime@0.215.7
  - @cosmicdrift/kumiko-framework@0.215.7

## 0.215.6

### Patch Changes

- Updated dependencies [5126f8a]
  - @cosmicdrift/kumiko-bundled-features@0.215.6
  - @cosmicdrift/kumiko-server-runtime@0.215.6
  - @cosmicdrift/kumiko-framework@0.215.6

## 0.215.5

### Patch Changes

- Updated dependencies [16454c2]
  - @cosmicdrift/kumiko-framework@0.215.5
  - @cosmicdrift/kumiko-bundled-features@0.215.5
  - @cosmicdrift/kumiko-server-runtime@0.215.5

## 0.215.4

### Patch Changes

- Updated dependencies [e2a55b2]
  - @cosmicdrift/kumiko-framework@0.215.4
  - @cosmicdrift/kumiko-bundled-features@0.215.4
  - @cosmicdrift/kumiko-server-runtime@0.215.4

## 0.215.3

### Patch Changes

- Updated dependencies [be16c6b]
- Updated dependencies [2a74871]
- Updated dependencies [469ec58]
  - @cosmicdrift/kumiko-bundled-features@0.215.3
  - @cosmicdrift/kumiko-framework@0.215.3
  - @cosmicdrift/kumiko-server-runtime@0.215.3

## 0.215.2

### Patch Changes

- Updated dependencies [b6afed4]
  - @cosmicdrift/kumiko-bundled-features@0.215.2
  - @cosmicdrift/kumiko-server-runtime@0.215.2
  - @cosmicdrift/kumiko-framework@0.215.2

## 0.215.1

### Patch Changes

- Updated dependencies [48a8ced]
  - @cosmicdrift/kumiko-bundled-features@0.215.1
  - @cosmicdrift/kumiko-server-runtime@0.215.1
  - @cosmicdrift/kumiko-framework@0.215.1

## 0.215.0

### Minor Changes

- 7a7f6a9: Added a dedicated `@cosmicdrift/kumiko-dev-server/env-schema` subpath export for `frameworkCoreEnvSchema`, so app repos' `bin/env.ts` (which every app's prod boot path reads) no longer has to pull in the full `runDevApp`/`scaffoldApp`/tooling barrel just for the schema.

  Also marked `compose-stacks.ts` with a `// @runtime runtime` directive: despite living in this `"dev"`-marked package, every preset it exports composes `@cosmicdrift/kumiko-bundled-features` factories and is consumed by `run-config.ts`'s `runProdApp` boot path in 5 app repos today — the directive is the runtime-isolation guard's highest-priority classification layer and lets this one file opt out of the package-wide `"dev"` marker without reclassifying the whole package (which would also mislabel genuinely dev-only exports like `runDevApp`/`scaffoldApp`). No behavior change; this only affects the infra runtime-isolation guard's classification of the file.

### Patch Changes

- 54fa88c: `bun create kumiko-app --yes` now wires the generated `bin/main.ts`'s `runProdApp` call through `resolveKmsWiring` (existing framework helper), so the default `--yes` feature set no longer hits `BOOT ABORTED` on the first `bun run boot` / `bun run start`. Without a configured subject-keys KMS this falls back to plaintext PII with a loud boot warning — never silently — and the generated `.env.example`/README now document the `PLATFORM_KEK` / `SUBJECT_KEYS_DATABASE_URL` / `KUMIKO_BLIND_INDEX_KEY` trio needed for a real deploy.
- Updated dependencies [5cf7f9d]
- Updated dependencies [2bcf3c9]
  - @cosmicdrift/kumiko-framework@0.215.0
  - @cosmicdrift/kumiko-bundled-features@0.215.0
  - @cosmicdrift/kumiko-server-runtime@0.215.0

## 0.214.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.214.0
- @cosmicdrift/kumiko-framework@0.214.0
- @cosmicdrift/kumiko-server-runtime@0.214.0

## 0.213.0

### Patch Changes

- Updated dependencies [8e3a500]
- Updated dependencies [7ffd0f6]
- Updated dependencies [774ca7d]
- Updated dependencies [fd90843]
  - @cosmicdrift/kumiko-server-runtime@0.213.0
  - @cosmicdrift/kumiko-framework@0.213.0
  - @cosmicdrift/kumiko-bundled-features@0.213.0

## 0.212.0

### Patch Changes

- Updated dependencies [30bd330]
- Updated dependencies [120e585]
- Updated dependencies [da78a06]
- Updated dependencies [5372dce]
- Updated dependencies [35b0005]
- Updated dependencies [d006e42]
- Updated dependencies [28fc80a]
  - @cosmicdrift/kumiko-bundled-features@0.212.0
  - @cosmicdrift/kumiko-framework@0.212.0
  - @cosmicdrift/kumiko-server-runtime@0.212.0

## 0.211.0

### Patch Changes

- Updated dependencies [f38784b]
  - @cosmicdrift/kumiko-framework@0.211.0
  - @cosmicdrift/kumiko-bundled-features@0.211.0
  - @cosmicdrift/kumiko-server-runtime@0.211.0

## 0.210.0

### Patch Changes

- Updated dependencies [f2e6862]
- Updated dependencies [8b4467d]
- Updated dependencies [1ba89fb]
- Updated dependencies [d85987c]
- Updated dependencies [db14e69]
  - @cosmicdrift/kumiko-framework@0.210.0
  - @cosmicdrift/kumiko-bundled-features@0.210.0
  - @cosmicdrift/kumiko-server-runtime@0.210.0

## 0.209.1

### Patch Changes

- Updated dependencies [f387a20]
- Updated dependencies [2c05054]
  - @cosmicdrift/kumiko-framework@0.209.1
  - @cosmicdrift/kumiko-bundled-features@0.209.1
  - @cosmicdrift/kumiko-server-runtime@0.209.1

## 0.209.0

### Patch Changes

- Updated dependencies [f707d1b]
- Updated dependencies [49662ef]
- Updated dependencies [12df48b]
- Updated dependencies [f86cf43]
- Updated dependencies [b9fdc41]
- Updated dependencies [92a5361]
  - @cosmicdrift/kumiko-framework@0.209.0
  - @cosmicdrift/kumiko-bundled-features@0.209.0
  - @cosmicdrift/kumiko-server-runtime@0.209.0

## 0.208.3

### Patch Changes

- Updated dependencies [e595330]
- Updated dependencies [8087d17]
  - @cosmicdrift/kumiko-framework@0.208.3
  - @cosmicdrift/kumiko-bundled-features@0.208.3
  - @cosmicdrift/kumiko-server-runtime@0.208.3

## 0.208.2

### Patch Changes

- Updated dependencies [e364c7e]
  - @cosmicdrift/kumiko-bundled-features@0.208.2
  - @cosmicdrift/kumiko-server-runtime@0.208.2
  - @cosmicdrift/kumiko-framework@0.208.2

## 0.208.1

### Patch Changes

- Updated dependencies [f538bc0]
  - @cosmicdrift/kumiko-framework@0.208.1
  - @cosmicdrift/kumiko-bundled-features@0.208.1
  - @cosmicdrift/kumiko-server-runtime@0.208.1

## 0.208.0

### Patch Changes

- Updated dependencies [025c5b9]
  - @cosmicdrift/kumiko-framework@0.208.0
  - @cosmicdrift/kumiko-bundled-features@0.208.0
  - @cosmicdrift/kumiko-server-runtime@0.208.0

## 0.207.0

### Minor Changes

- dec6fd7: Spanish (`es`) is now a first-class locale across the framework's own UI. Every translation table ships a third locale: the renderer defaults (save/cancel/delete, empty states, pagination, validation messages), the complete email-password login and MFA flows, and every bundled feature's screens, nav entries and field labels. Previously a Spanish-speaking user resolved to `es` through `navigator.language` and then fell through to the hardcoded `en` fallback, so the entire product read English no matter what the language switcher offered.

  The per-file `LocalizedString` type now requires `es` alongside `de` and `en`, so a table cannot ship half-translated: the compiler rejects a missing locale rather than letting the bundle builder emit `undefined`. `LanguageSwitcher` no longer hardcodes the German string "Sprache" as its `aria-label` and `title`; it resolves `kumiko.nav.language` instead, so screen readers announce the control in the active language. The `kumiko new app` scaffold emits all three locales, so newly generated apps start out multilingual.

  Apps are not forced to follow. The boot validator's completeness gate still requires only `de` and `en`, so an app that translates its own features into those two keeps booting unchanged, and any locale an app registers through `r.translations` continues to merge in without needing an entry in a framework list.

### Patch Changes

- Updated dependencies [dec6fd7]
  - @cosmicdrift/kumiko-bundled-features@0.207.0
  - @cosmicdrift/kumiko-server-runtime@0.207.0
  - @cosmicdrift/kumiko-framework@0.207.0

## 0.206.0

### Patch Changes

- Updated dependencies [8c1c3d9]
- Updated dependencies [20d127c]
- Updated dependencies [d60cb15]
  - @cosmicdrift/kumiko-bundled-features@0.206.0
  - @cosmicdrift/kumiko-framework@0.206.0
  - @cosmicdrift/kumiko-server-runtime@0.206.0

## 0.205.0

### Patch Changes

- Updated dependencies [546c45c]
- Updated dependencies [6e7f20b]
  - @cosmicdrift/kumiko-bundled-features@0.205.0
  - @cosmicdrift/kumiko-framework@0.205.0
  - @cosmicdrift/kumiko-server-runtime@0.205.0

## 0.204.1

### Patch Changes

- Updated dependencies [4c6d8c2]
  - @cosmicdrift/kumiko-bundled-features@0.204.1
  - @cosmicdrift/kumiko-server-runtime@0.204.1
  - @cosmicdrift/kumiko-framework@0.204.1

## 0.204.0

### Patch Changes

- Updated dependencies [0d53fbd]
  - @cosmicdrift/kumiko-framework@0.204.0
  - @cosmicdrift/kumiko-bundled-features@0.204.0
  - @cosmicdrift/kumiko-server-runtime@0.204.0

## 0.203.0

### Patch Changes

- Updated dependencies [403912f]
- Updated dependencies [29e46a9]
- Updated dependencies [437d3fb]
- Updated dependencies [75a8fd7]
  - @cosmicdrift/kumiko-bundled-features@0.203.0
  - @cosmicdrift/kumiko-framework@0.203.0
  - @cosmicdrift/kumiko-server-runtime@0.203.0

## 0.202.0

### Patch Changes

- e91d4cb: `personal-access-tokens:write:create` now requires `currentPassword` (verified against the caller's password hash) before minting a token, and rejects when the caller has MFA enrolled and `mfaCode` is missing or wrong — a session cookie alone is no longer enough to stand up a durable API credential. `expiresInDays` now defaults to 90 days instead of never-expiring when omitted (the existing 3650-day cap is unchanged, so a genuinely long-lived token is still possible if requested explicitly). Changing a user's password, or enabling/disabling MFA, now revokes all of that user's live PAT tokens — mirrors the existing session auto-revoke-on-password-change behavior. `run-prod-app`/`run-dev-app` wire the new MFA↔PAT revoke callback automatically when both `auth-mfa` and `personal-access-tokens` are mounted; no app-level change needed for that part. Apps that already mint PATs (their own client code, scripts, or tests) need to add `currentPassword` to the request payload — this is a breaking change to the `create` request shape despite the minor bump (bundled-features doesn't follow strict semver across its handler schemas yet).

  `auth-email-password`'s `invite-create` handler gained an opt-in `canAssignRole?: (inviterRoles, targetRole) => boolean` option on `InviteCreateOptions` — when set, an invite whose target role fails the check is rejected before the invitation is created or the mail is sent. Framework-reserved roles (SystemAdmin, etc.) were already blocked; this closes the gap for app-defined role hierarchies (e.g. only some Admins may grant a "DPO" role) that the framework has no way to know about on its own. Omitting the option keeps the previous behavior unchanged — any non-reserved role remains assignable by any Admin.

- Updated dependencies [b1e2e56]
- Updated dependencies [e984211]
- Updated dependencies [9d350a6]
- Updated dependencies [e91d4cb]
- Updated dependencies [d41d75c]
- Updated dependencies [40f9cfd]
  - @cosmicdrift/kumiko-framework@0.202.0
  - @cosmicdrift/kumiko-bundled-features@0.202.0
  - @cosmicdrift/kumiko-server-runtime@0.202.0

## 0.201.0

### Patch Changes

- Updated dependencies [0904138]
- Updated dependencies [aa3f669]
- Updated dependencies [5c53db1]
- Updated dependencies [7d75f1b]
  - @cosmicdrift/kumiko-framework@0.201.0
  - @cosmicdrift/kumiko-bundled-features@0.201.0
  - @cosmicdrift/kumiko-server-runtime@0.201.0

## 0.200.1

### Patch Changes

- Updated dependencies [50d0f7e]
  - @cosmicdrift/kumiko-bundled-features@0.200.1
  - @cosmicdrift/kumiko-server-runtime@0.200.1
  - @cosmicdrift/kumiko-framework@0.200.1

## 0.200.0

### Patch Changes

- Updated dependencies [96d500b]
  - @cosmicdrift/kumiko-bundled-features@0.200.0
  - @cosmicdrift/kumiko-server-runtime@0.200.0
  - @cosmicdrift/kumiko-framework@0.200.0

## 0.199.2

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.199.2
- @cosmicdrift/kumiko-server-runtime@0.199.2
- @cosmicdrift/kumiko-framework@0.199.2

## 0.199.1

### Patch Changes

- Updated dependencies [8e7b495]
  - @cosmicdrift/kumiko-framework@0.199.1
  - @cosmicdrift/kumiko-bundled-features@0.199.1
  - @cosmicdrift/kumiko-server-runtime@0.199.1

## 0.199.0

### Patch Changes

- df2db70: The client `AppSchema` now carries `FeatureSchema.searchAdapterMissing`, set from the same `context.searchAdapter` presence check that already powers #2051's boot warning. `kumiko-screen.tsx`'s `entityList` search box is gated on it: when the server has no `SearchAdapter` wired, the box no longer renders at all, instead of rendering and then 422'ing on the first query (`search_adapter_not_wired`, #2032). Scoped to `entityList` screens only, matching #2051's own boot-check scope — `projectionList` screens are unaffected. Non-breaking: the flag defaults to "not missing" wherever a schema doesn't flow through `buildAppSchema()` (hand-authored fixtures, legacy `toAppSchema()`), preserving today's render behavior.
- Updated dependencies [7dd7d05]
- Updated dependencies [df2db70]
- Updated dependencies [107f9bb]
- Updated dependencies [8485e63]
- Updated dependencies [059f2cb]
- Updated dependencies [021c5df]
- Updated dependencies [3389b20]
- Updated dependencies [41eb28c]
- Updated dependencies [7135b86]
- Updated dependencies [5816935]
- Updated dependencies [fb8cbb7]
  - @cosmicdrift/kumiko-framework@0.199.0
  - @cosmicdrift/kumiko-server-runtime@0.199.0
  - @cosmicdrift/kumiko-bundled-features@0.199.0

## 0.198.0

### Patch Changes

- 80d03ba: `runDevApp` checked for a mounted sessions provider with a raw pre-registry scan (`features.some(f => f.extensionUsages...)`) instead of `registry.getExtensionUsages(EXT_SESSION_STORE)` like `runProdApp` — two different ways of asking the same question. Unified onto the registry-based check, and gave dev the same boot gate prod already had (`assertSessionBootInvariants`, now `mode: "prod" | "dev"`): prod still aborts boot when auth is mounted without a sessionStore provider, dev now warns instead of staying silent. New `@cosmicdrift/kumiko-server-runtime/session-boot-gate` export.

  Note: the two extensionUsages predicates read the same underlying array, so this did not reproduce a proven false negative — it removes a divergent mechanism and adds the missing dev-time signal. If a real app's sessions feature is mounted and its session-list is still empty, the new warn will not fire (no sessionStore is "missing" there) and that needs separate investigation.

- Updated dependencies [3be0d60]
- Updated dependencies [9b2c94a]
- Updated dependencies [b925dea]
- Updated dependencies [89ebe92]
- Updated dependencies [e3504b5]
- Updated dependencies [72eae1d]
- Updated dependencies [80d03ba]
  - @cosmicdrift/kumiko-bundled-features@0.198.0
  - @cosmicdrift/kumiko-framework@0.198.0
  - @cosmicdrift/kumiko-server-runtime@0.198.0

## 0.197.1

### Patch Changes

- Updated dependencies [a8e33c8]
- Updated dependencies [66c1283]
  - @cosmicdrift/kumiko-framework@0.197.1
  - @cosmicdrift/kumiko-bundled-features@0.197.1
  - @cosmicdrift/kumiko-server-runtime@0.197.1

## 0.197.0

### Patch Changes

- Updated dependencies [3446b2b]
  - @cosmicdrift/kumiko-bundled-features@0.197.0
  - @cosmicdrift/kumiko-server-runtime@0.197.0
  - @cosmicdrift/kumiko-framework@0.197.0

## 0.196.1

### Patch Changes

- Updated dependencies [110e770]
  - @cosmicdrift/kumiko-bundled-features@0.196.1
  - @cosmicdrift/kumiko-server-runtime@0.196.1
  - @cosmicdrift/kumiko-framework@0.196.1

## 0.196.0

### Patch Changes

- af7686d: Scaffolded `src/seed.ts` now carries a `// skip:` comment above its idempotency check, so freshly generated apps pass `kumiko-guard-silent-skip` in CI out of the box.
- Updated dependencies [6f4ce3e]
  - @cosmicdrift/kumiko-bundled-features@0.196.0
  - @cosmicdrift/kumiko-server-runtime@0.196.0
  - @cosmicdrift/kumiko-framework@0.196.0

## 0.195.0

### Patch Changes

- Updated dependencies [49538eb]
- Updated dependencies [49538eb]
- Updated dependencies [49538eb]
  - @cosmicdrift/kumiko-bundled-features@0.195.0
  - @cosmicdrift/kumiko-framework@0.195.0
  - @cosmicdrift/kumiko-server-runtime@0.195.0

## 0.194.0

### Patch Changes

- Updated dependencies [2b1b089]
- Updated dependencies [52b0ba6]
- Updated dependencies [7938610]
- Updated dependencies [52b0ba6]
- Updated dependencies [074ccd4]
- Updated dependencies [2b1b089]
  - @cosmicdrift/kumiko-bundled-features@0.194.0
  - @cosmicdrift/kumiko-framework@0.194.0
  - @cosmicdrift/kumiko-server-runtime@0.194.0

## 0.193.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.193.1
- @cosmicdrift/kumiko-server-runtime@0.193.1
- @cosmicdrift/kumiko-framework@0.193.1

## 0.193.0

### Patch Changes

- Updated dependencies [eb4da66]
- Updated dependencies [181003b]
- Updated dependencies [9100e19]
  - @cosmicdrift/kumiko-bundled-features@0.193.0
  - @cosmicdrift/kumiko-framework@0.193.0
  - @cosmicdrift/kumiko-server-runtime@0.193.0

## 0.192.0

### Patch Changes

- 58505c6: New `derivatives-sharp` feature: server-only image renderer that registers at the `derivativeRenderer` extension point for `image/*`. Resize (cover/inside/contain), format conversion with quality (webp/avif/jpeg), whole-image blur and `blurRegions` for burning blur into plates or faces. EXIF orientation is applied, all other EXIF (including GPS) is dropped. `blurRegions` is part of `VariantSpec`, so corrected regions hash to a fresh variant URL instead of serving a stale cache hit.
- Updated dependencies [58505c6]
  - @cosmicdrift/kumiko-bundled-features@0.192.0
  - @cosmicdrift/kumiko-server-runtime@0.192.0
  - @cosmicdrift/kumiko-framework@0.192.0

## 0.191.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.191.0
- @cosmicdrift/kumiko-server-runtime@0.191.0
- @cosmicdrift/kumiko-framework@0.191.0

## 0.190.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.190.0
- @cosmicdrift/kumiko-server-runtime@0.190.0
- @cosmicdrift/kumiko-framework@0.190.0

## 0.189.0

### Patch Changes

- cac0d04: `Form`'s new `stickyActions` prop pins the actions footer to the viewport bottom on narrow screens (`<640px`) instead of normal document flow, so a virtual keyboard shrinking the viewport can no longer push it out of reach. `RenderEdit` sets it automatically for wizard-mode screens. The default HTML shell's viewport meta also gains `interactive-widget=resizes-content`, so a real mobile keyboard shrinks the layout viewport (which the fixed footer anchors to) instead of only the visual viewport.
- Updated dependencies [64c5f92]
- Updated dependencies [321b375]
- Updated dependencies [5137ce5]
- Updated dependencies [833c4f7]
- Updated dependencies [88edff1]
- Updated dependencies [cac0d04]
  - @cosmicdrift/kumiko-framework@0.189.0
  - @cosmicdrift/kumiko-bundled-features@0.189.0
  - @cosmicdrift/kumiko-server-runtime@0.189.0

## 0.188.0

### Patch Changes

- Updated dependencies [f12b1b8]
- Updated dependencies [6ea31c7]
- Updated dependencies [9f2e2e5]
- Updated dependencies [e55c957]
- Updated dependencies [a9b8343]
- Updated dependencies [5ca5131]
  - @cosmicdrift/kumiko-bundled-features@0.188.0
  - @cosmicdrift/kumiko-framework@0.188.0
  - @cosmicdrift/kumiko-server-runtime@0.188.0

## 0.187.0

### Patch Changes

- Updated dependencies [1246ec0]
  - @cosmicdrift/kumiko-framework@0.187.0
  - @cosmicdrift/kumiko-bundled-features@0.187.0
  - @cosmicdrift/kumiko-server-runtime@0.187.0

## 0.186.3

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.186.3
- @cosmicdrift/kumiko-server-runtime@0.186.3
- @cosmicdrift/kumiko-framework@0.186.3

## 0.186.2

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.186.2
- @cosmicdrift/kumiko-server-runtime@0.186.2
- @cosmicdrift/kumiko-framework@0.186.2

## 0.186.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.186.1
- @cosmicdrift/kumiko-server-runtime@0.186.1
- @cosmicdrift/kumiko-framework@0.186.1

## 0.186.0

### Patch Changes

- Updated dependencies [9aeb008]
  - @cosmicdrift/kumiko-framework@0.186.0
  - @cosmicdrift/kumiko-bundled-features@0.186.0
  - @cosmicdrift/kumiko-server-runtime@0.186.0

## 0.185.0

### Patch Changes

- Updated dependencies [0a059a0]
- Updated dependencies [43e0291]
- Updated dependencies [3d1a0dd]
- Updated dependencies [c57e2be]
- Updated dependencies [18c7fc1]
  - @cosmicdrift/kumiko-framework@0.185.0
  - @cosmicdrift/kumiko-bundled-features@0.185.0
  - @cosmicdrift/kumiko-server-runtime@0.185.0

## 0.184.0

### Patch Changes

- Updated dependencies [9171858]
  - @cosmicdrift/kumiko-bundled-features@0.184.0
  - @cosmicdrift/kumiko-server-runtime@0.184.0
  - @cosmicdrift/kumiko-framework@0.184.0

## 0.183.2

### Patch Changes

- Updated dependencies [92c7948]
  - @cosmicdrift/kumiko-framework@0.183.2
  - @cosmicdrift/kumiko-bundled-features@0.183.2
  - @cosmicdrift/kumiko-server-runtime@0.183.2

## 0.183.1

### Patch Changes

- Updated dependencies [a6a3c42]
  - @cosmicdrift/kumiko-bundled-features@0.183.1
  - @cosmicdrift/kumiko-server-runtime@0.183.1
  - @cosmicdrift/kumiko-framework@0.183.1

## 0.183.0

### Patch Changes

- 4fecbb5: Dev-Server liefert das Default-HTML jetzt mit `<script type="module">`.

  Als classic script werden die Top-Level-Deklarationen des Bundles zu
  window-Properties. Eine Dependency mit `export function history()`
  (prosemirror-history, kommt mit tiptap) ersetzt damit `window.history` —
  danach wirft jedes `pushState`, und die Navigation ist tot, ohne dass die App
  irgendetwas falsch gemacht hätte. Der Prod-Build emittiert die Modul-Form
  seit jeher; nur der Dev-Server hing hinterher.

- Updated dependencies [08c5c8c]
- Updated dependencies [14853d9]
- Updated dependencies [b54a9e0]
- Updated dependencies [28c03cd]
  - @cosmicdrift/kumiko-bundled-features@0.183.0
  - @cosmicdrift/kumiko-framework@0.183.0
  - @cosmicdrift/kumiko-server-runtime@0.183.0

## 0.182.1

### Patch Changes

- Updated dependencies [958df88]
  - @cosmicdrift/kumiko-framework@0.182.1
  - @cosmicdrift/kumiko-bundled-features@0.182.1
  - @cosmicdrift/kumiko-server-runtime@0.182.1

## 0.182.0

### Patch Changes

- Updated dependencies [8a3b0a9]
- Updated dependencies [9c62bc8]
- Updated dependencies [9344050]
- Updated dependencies [0a50d9c]
- Updated dependencies [d722db8]
  - @cosmicdrift/kumiko-framework@0.182.0
  - @cosmicdrift/kumiko-bundled-features@0.182.0
  - @cosmicdrift/kumiko-server-runtime@0.182.0

## 0.181.0

### Patch Changes

- Updated dependencies [fda4dc6]
- Updated dependencies [758cc7c]
  - @cosmicdrift/kumiko-framework@0.181.0
  - @cosmicdrift/kumiko-bundled-features@0.181.0
  - @cosmicdrift/kumiko-server-runtime@0.181.0

## 0.180.0

### Patch Changes

- Updated dependencies [85102ca]
  - @cosmicdrift/kumiko-framework@0.180.0
  - @cosmicdrift/kumiko-bundled-features@0.180.0
  - @cosmicdrift/kumiko-server-runtime@0.180.0

## 0.179.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.179.0
- @cosmicdrift/kumiko-server-runtime@0.179.0
- @cosmicdrift/kumiko-framework@0.179.0

## 0.178.1

### Patch Changes

- Updated dependencies [9400ec1]
  - @cosmicdrift/kumiko-framework@0.178.1
  - @cosmicdrift/kumiko-bundled-features@0.178.1
  - @cosmicdrift/kumiko-server-runtime@0.178.1

## 0.178.0

### Patch Changes

- Updated dependencies [52753b6]
  - @cosmicdrift/kumiko-framework@0.178.0
  - @cosmicdrift/kumiko-bundled-features@0.178.0
  - @cosmicdrift/kumiko-server-runtime@0.178.0

## 0.177.0

### Patch Changes

- Updated dependencies [f49afdc]
  - @cosmicdrift/kumiko-framework@0.177.0
  - @cosmicdrift/kumiko-bundled-features@0.177.0
  - @cosmicdrift/kumiko-server-runtime@0.177.0

## 0.176.2

### Patch Changes

- Updated dependencies [3b5983a]
- Updated dependencies [63b6acf]
  - @cosmicdrift/kumiko-bundled-features@0.176.2
  - @cosmicdrift/kumiko-framework@0.176.2
  - @cosmicdrift/kumiko-server-runtime@0.176.2

## 0.176.1

### Patch Changes

- Updated dependencies [c7c4260]
  - @cosmicdrift/kumiko-bundled-features@0.176.1
  - @cosmicdrift/kumiko-server-runtime@0.176.1
  - @cosmicdrift/kumiko-framework@0.176.1

## 0.176.0

### Patch Changes

- Updated dependencies [90ceb78]
  - @cosmicdrift/kumiko-framework@0.176.0
  - @cosmicdrift/kumiko-bundled-features@0.176.0
  - @cosmicdrift/kumiko-server-runtime@0.176.0

## 0.175.0

### Minor Changes

- bc1377e: **BREAKING: `text-content` merged into `template-resolver`.**

  The `text-content` feature is gone. Its text blocks now live in
  `template-resolver` as `kind: "text-block"` rows of `read_template_resources`,
  which gains a nullable `title` and `folder` column. `ai-prompt` joins the kind
  set. `RENDER_KINDS` is unchanged (renderer plugins keep their exact domain);
  the full entity domain is the new `TEMPLATE_KINDS`.

  Migration for consuming apps:

  | before                                                    | after                                                                                                    |
  | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
  | `createTextContentFeature()`                              | `createTemplateResolverFeature()`                                                                        |
  | `@cosmicdrift/kumiko-bundled-features/text-content`       | `.../template-resolver`                                                                                  |
  | `.../text-content/seeding` → `seedTextBlock`              | `.../template-resolver/seeding` → `seedTextBlock`                                                        |
  | `.../text-content/web` → `textContentClient()`            | `.../template-resolver/web` → `textBlocksClient()`                                                       |
  | `extraContext: { textContent: createTextContentApi(db) }` | `extraContext: { templateResolver: createTemplateResolverApi(db) }` (auto-wired by runProdApp/runDevApp) |
  | `textContent.getBlock({ tenantId, slug, lang })`          | `templateResolver.findExact({ tenantId, slug, kind: "text-block", locale })`                             |
  | `text-content:write:set` `{ slug, lang, title, body }`    | `template-resolver:write:set` `{ slug, locale, title, content }`                                         |
  | `text-content:query:by-slug` `{ slug, lang }`             | `template-resolver:query:by-slug` `{ slug, locale }`                                                     |
  | `text-content:query:by-tenant`                            | `template-resolver:query:by-tenant`                                                                      |
  | `TestStackPreset "text-content"`                          | `TestStackPreset "template-resolver"`                                                                    |

  `composePagesStack()` no longer mounts the content foundation — it now returns
  `legal-pages` only, because `template-resolver` ships in `composeRendererStack()`
  and `createRegistry` rejects duplicate features. Apps composing pages without
  the renderer stack add `createTemplateResolverFeature()` themselves.

  DB migration per app: add `title` + `folder` to `read_template_resources`, copy
  `read_text_blocks` rows over as `kind = 'text-block'` (`lang` → `locale`,
  `body` → `content`, `scope` = `'system'` for `SYSTEM_TENANT_ID` else
  `'tenant'`, `status` = `'active'`), then drop `read_text_blocks`.

### Patch Changes

- Updated dependencies [bc1377e]
  - @cosmicdrift/kumiko-bundled-features@0.175.0
  - @cosmicdrift/kumiko-server-runtime@0.175.0
  - @cosmicdrift/kumiko-framework@0.175.0

## 0.174.1

### Patch Changes

- 50b7d0c: PR-review fix batch (deferred careful-tier findings):

  - `document-ingest-foundation`'s `fileRef.created` MSP now appends a `documentIngest.skipped` event (with a `reason`) instead of silently dropping oversized/unsupported-mime uploads — the previous behavior gave neither the user nor ops any way to tell "not supported" from "ingest broken".
  - `pii-retention` boot-validator: the `blockDelete`-without-`anonymize` warning now also fires for entities whose only subject binding is a `{ subjectRef: true }` FK (no annotated content) — it previously missed those entirely.
  - `warnOnUniqueAccessRoles` now scans config-key and entity/field access rules too (not just handlers), and is opt-in via `validateBoot(features, { warnOnUniqueAccessRoles: true })` / `createApp({ validateBootOptions })` instead of always-on — a role scoped to exactly one endpoint on purpose is the normal shape of fine-grained access, not always a typo.
  - `seedUser`/`seedUserWithPassword`/`seedAdmin` now reconcile `emailVerified: true` onto an already-seeded row (via a real `.updated` event) instead of only applying it on first insert — a persistent dev DB re-seeded with the flag previously stayed stuck unverified.
  - Dev-server scaffold (`bin/dev.ts`) now seeds the admin with `emailVerified: true` so a fresh `bun dev` doesn't immediately hit the `422 email_not_verified` login gate; the prod scaffold (`bin/main.ts`) is unchanged on purpose.
  - `EntityEditCreateBody`/`ActionFormBody` (renderer): a URL search-param no longer sets a value for a field the screen's layout doesn't render — it previously could inject an invisible, unvalidated value into a create-form submission.
  - `ReferenceCreateDialog`: a create-handler success with no `id` in the payload (custom create variant) now still closes the dialog and refetches the reference list, with a visible banner explaining the record couldn't be auto-selected — it previously returned silently, leaving the dialog open with no feedback.
  - Two `config`/`auth-mfa` KEK-rotation jobs' duplicated envelope-classification logic is now one shared `classifyStoredEnvelope` (`bundled-features/shared`).
  - `jobs` feature's "is this job manually triggerable" check is now one shared predicate instead of two independently-maintained copies (`catalog.query.ts`, `trigger.write.ts`).
  - `login-gates`/`document-ingest-foundation`/dev-server integration tests hardened against several fake-test / flaky-timing gaps found in review (exact payload assertions instead of `ok === false`, deterministic abort-timing instead of a race against a heartbeat timer, a single read-loop instead of a per-iteration `Promise.race` that could drop an SSE chunk).

- Updated dependencies [de0da71]
- Updated dependencies [f5da76a]
- Updated dependencies [50b7d0c]
  - @cosmicdrift/kumiko-framework@0.174.1
  - @cosmicdrift/kumiko-bundled-features@0.174.1
  - @cosmicdrift/kumiko-server-runtime@0.174.1

## 0.174.0

### Patch Changes

- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
  - @cosmicdrift/kumiko-framework@0.174.0
  - @cosmicdrift/kumiko-bundled-features@0.174.0
  - @cosmicdrift/kumiko-server-runtime@0.174.0

## 0.173.1

### Patch Changes

- Updated dependencies [f23aa36]
- Updated dependencies [f23aa36]
  - @cosmicdrift/kumiko-framework@0.173.1
  - @cosmicdrift/kumiko-bundled-features@0.173.1
  - @cosmicdrift/kumiko-server-runtime@0.173.1

## 0.173.0

### Patch Changes

- Updated dependencies [20dfb78]
- Updated dependencies [ffce47c]
  - @cosmicdrift/kumiko-framework@0.173.0
  - @cosmicdrift/kumiko-bundled-features@0.173.0
  - @cosmicdrift/kumiko-server-runtime@0.173.0

## 0.172.0

### Patch Changes

- Updated dependencies [1fcdfc5]
  - @cosmicdrift/kumiko-framework@0.172.0
  - @cosmicdrift/kumiko-bundled-features@0.172.0
  - @cosmicdrift/kumiko-server-runtime@0.172.0

## 0.171.2

### Patch Changes

- Updated dependencies [c717af3]
  - @cosmicdrift/kumiko-bundled-features@0.171.2
  - @cosmicdrift/kumiko-framework@0.171.2
  - @cosmicdrift/kumiko-server-runtime@0.171.2

## 0.171.1

### Patch Changes

- Updated dependencies [07b9c04]
- Updated dependencies [f8261c1]
- Updated dependencies [74a0fb3]
  - @cosmicdrift/kumiko-framework@0.171.1
  - @cosmicdrift/kumiko-bundled-features@0.171.1
  - @cosmicdrift/kumiko-server-runtime@0.171.1

## 0.171.0

### Patch Changes

- Updated dependencies [d125a49]
- Updated dependencies [32123ff]
- Updated dependencies [716acd6]
- Updated dependencies [9cc21ed]
- Updated dependencies [c284d61]
  - @cosmicdrift/kumiko-framework@0.171.0
  - @cosmicdrift/kumiko-bundled-features@0.171.0
  - @cosmicdrift/kumiko-server-runtime@0.171.0

## 0.170.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.170.0
- @cosmicdrift/kumiko-server-runtime@0.170.0
- @cosmicdrift/kumiko-framework@0.170.0

## 0.169.0

### Patch Changes

- Updated dependencies [63157c0]
- Updated dependencies [74e97f3]
- Updated dependencies [644274a]
  - @cosmicdrift/kumiko-bundled-features@0.169.0
  - @cosmicdrift/kumiko-framework@0.169.0
  - @cosmicdrift/kumiko-server-runtime@0.169.0

## 0.168.0

### Patch Changes

- fecbfe3: `extraRoutes` is now registered before `onAfterSetup` (seeds) instead of after. A seed that dispatches through `stack.http` builds Hono's matcher, and every route added afterwards threw `Can not add a route since the matcher is already built` — so an app could have seeds or its own routes, but not both.
- Updated dependencies [4c7d3c9]
- Updated dependencies [d149bab]
- Updated dependencies [136bc02]
  - @cosmicdrift/kumiko-framework@0.168.0
  - @cosmicdrift/kumiko-bundled-features@0.168.0
  - @cosmicdrift/kumiko-server-runtime@0.168.0

## 0.167.1

### Patch Changes

- 49eb6df: `RunProdAppAuthOptions`/`RunDevAppAuthOptions` now accept `accountLockout` (`maxFailedAttempts`, `lockoutDurationMinutes`), wired through the shared `composeFeatures`/`buildComposeAuthOptions` plumbing that already carries `accountUnlock`. Before this, both wrappers exposed `accountUnlock` — the self-service escape hatch for the lockout's failure counter — with no way to ever set the lockout it's meant to escape, so an app using either wrapper's convenience options couldn't turn on brute-force protection at all (kumiko-framework#1627).
- Updated dependencies [49eb6df]
- Updated dependencies [cf5302a]
- Updated dependencies [e75d079]
- Updated dependencies [cf5302a]
  - @cosmicdrift/kumiko-server-runtime@0.167.1
  - @cosmicdrift/kumiko-bundled-features@0.167.1
  - @cosmicdrift/kumiko-framework@0.167.1

## 0.167.0

### Patch Changes

- Updated dependencies [57c1da2]
- Updated dependencies [ce30a2c]
- Updated dependencies [6ed2e5d]
  - @cosmicdrift/kumiko-framework@0.167.0
  - @cosmicdrift/kumiko-bundled-features@0.167.0
  - @cosmicdrift/kumiko-server-runtime@0.167.0

## 0.166.0

### Patch Changes

- Updated dependencies [8b20a77]
- Updated dependencies [760b2eb]
- Updated dependencies [6679e45]
  - @cosmicdrift/kumiko-framework@0.166.0
  - @cosmicdrift/kumiko-bundled-features@0.166.0
  - @cosmicdrift/kumiko-server-runtime@0.166.0

## 0.165.4

### Patch Changes

- Updated dependencies [9bc5823]
  - @cosmicdrift/kumiko-bundled-features@0.165.4
  - @cosmicdrift/kumiko-server-runtime@0.165.4
  - @cosmicdrift/kumiko-framework@0.165.4

## 0.165.3

### Patch Changes

- Updated dependencies [e4a0b9b]
  - @cosmicdrift/kumiko-framework@0.165.3
  - @cosmicdrift/kumiko-bundled-features@0.165.3
  - @cosmicdrift/kumiko-server-runtime@0.165.3

## 0.165.2

### Patch Changes

- Updated dependencies [ed36555]
  - @cosmicdrift/kumiko-framework@0.165.2
  - @cosmicdrift/kumiko-bundled-features@0.165.2
  - @cosmicdrift/kumiko-server-runtime@0.165.2

## 0.165.1

### Patch Changes

- Updated dependencies [4193ec6]
- Updated dependencies [e92295d]
  - @cosmicdrift/kumiko-framework@0.165.1
  - @cosmicdrift/kumiko-bundled-features@0.165.1
  - @cosmicdrift/kumiko-server-runtime@0.165.1

## 2.0.0

### Patch Changes

- Updated dependencies [ea3b162]
- Updated dependencies [9b6e4ca]
- Updated dependencies [c58f20f]
- Updated dependencies [eb856c6]
  - @cosmicdrift/kumiko-bundled-features@2.0.0
  - @cosmicdrift/kumiko-framework@2.0.0
  - @cosmicdrift/kumiko-server-runtime@2.0.0

## 1.0.0

### Patch Changes

- Updated dependencies [53f83f5]
  - @cosmicdrift/kumiko-framework@1.0.0
  - @cosmicdrift/kumiko-bundled-features@1.0.0
  - @cosmicdrift/kumiko-server-runtime@1.0.0

## 0.165.0

### Minor Changes

- cf56745: Removes dead public API with zero verified consumers across all Kumiko repos:

  - `@cosmicdrift/kumiko-framework`: `getUnscopedAggregateStreamTenant` (event-store), `createEncryptionProvider`/`EncryptionProvider` (legacy single-key db encryption, superseded by `createEnvelopeCipher`), and the unused `tx` parameter on `executeStream`/`dispatcher.stream()`.
  - `@cosmicdrift/kumiko-types`: `ConfigResolver.getAllWithSource` and the corresponding resolver implementation.
  - `@cosmicdrift/kumiko-dispatcher-live`: `SseFrame`, `iterateSseChunks`, `parseSseFrames` re-exports (internal consumers already import from `./sse-stream` directly).
  - `@cosmicdrift/kumiko-dev-server`: `IdentityStackOptions.providers` (never wired by any app — provider features are appended positionally instead; `GdprStackOptions.providers` is unaffected, it has real callers/tests).

  Adds `toInstant` to `@cosmicdrift/kumiko-headless`'s public barrel (previously an unexported helper duplicated by `@cosmicdrift/kumiko-renderer`'s `formatWhen`).

### Patch Changes

- Updated dependencies [cf56745]
  - @cosmicdrift/kumiko-framework@0.165.0
  - @cosmicdrift/kumiko-bundled-features@0.165.0
  - @cosmicdrift/kumiko-server-runtime@0.165.0

## 0.164.0

### Patch Changes

- Updated dependencies [90b4221]
  - @cosmicdrift/kumiko-framework@0.164.0
  - @cosmicdrift/kumiko-bundled-features@0.164.0
  - @cosmicdrift/kumiko-server-runtime@0.164.0

## 0.163.3

### Patch Changes

- Updated dependencies [5c43259]
  - @cosmicdrift/kumiko-framework@0.163.3
  - @cosmicdrift/kumiko-bundled-features@0.163.3
  - @cosmicdrift/kumiko-server-runtime@0.163.3

## 0.163.2

### Patch Changes

- Updated dependencies [5dc5290]
  - @cosmicdrift/kumiko-framework@0.163.2
  - @cosmicdrift/kumiko-bundled-features@0.163.2
  - @cosmicdrift/kumiko-server-runtime@0.163.2

## 0.163.1

### Patch Changes

- Updated dependencies [75174f6]
  - @cosmicdrift/kumiko-server-runtime@0.163.1
  - @cosmicdrift/kumiko-framework@0.163.1
  - @cosmicdrift/kumiko-bundled-features@0.163.1

## 0.163.0

### Patch Changes

- Updated dependencies [0ee7b33]
- Updated dependencies [dc76328]
- Updated dependencies [867e236]
- Updated dependencies [c8b05f0]
  - @cosmicdrift/kumiko-bundled-features@0.163.0
  - @cosmicdrift/kumiko-framework@0.163.0
  - @cosmicdrift/kumiko-server-runtime@0.163.0

## 0.162.0

### Patch Changes

- Updated dependencies [08abac2]
- Updated dependencies [5066725]
- Updated dependencies [6d2063c]
  - @cosmicdrift/kumiko-framework@0.162.0
  - @cosmicdrift/kumiko-bundled-features@0.162.0
  - @cosmicdrift/kumiko-server-runtime@0.162.0

## 0.161.0

### Minor Changes

- c7ac572: Auth-foundation migration (#1372–#1375): tenantResolver/tenantExistence EPs, sessionStore wiring without auth.sessions, slim AnonymousAccessConfig, recipe auth-foundation-providers.

### Patch Changes

- 5eb3aa4: `composeIdentityStack` and `composeGdprStack` now mount `authFoundationFeature` alongside `sessions` — the registry hard-requires it (`sessions.requires("auth-foundation")`), so any consumer mounting sessions via either helper without it now fails at boot. `composeIdentityStack` also gained an optional `providers` array for the tokenVerifier provider(s) auth-foundation itself requires at least one of (e.g. `createPersonalAccessTokensFeature({ scopes })`) — scopes stay app-owned, not a framework default.

  Apps that already mount `authFoundationFeature` explicitly alongside these helpers (money-horse, publicstatus) will get a duplicate-feature boot error on the next bump — drop the explicit mount, the helper now owns it.

- Updated dependencies [c7ac572]
  - @cosmicdrift/kumiko-bundled-features@0.161.0
  - @cosmicdrift/kumiko-framework@0.161.0
  - @cosmicdrift/kumiko-server-runtime@0.161.0

## 0.160.0

### Patch Changes

- Updated dependencies [d3e815c]
  - @cosmicdrift/kumiko-framework@0.160.0
  - @cosmicdrift/kumiko-bundled-features@0.160.0
  - @cosmicdrift/kumiko-server-runtime@0.160.0

## 0.159.1

### Patch Changes

- Updated dependencies [6d37eb5]
  - @cosmicdrift/kumiko-framework@0.159.1
  - @cosmicdrift/kumiko-bundled-features@0.159.1
  - @cosmicdrift/kumiko-server-runtime@0.159.1

## 1.0.0

### Patch Changes

- Updated dependencies [9db805c]
- Updated dependencies [d0280c8]
- Updated dependencies [a997cc8]
- Updated dependencies [114faef]
- Updated dependencies [d97fcda]
- Updated dependencies [aa52aa1]
- Updated dependencies [2fc542b]
- Updated dependencies [6254cc8]
  - @cosmicdrift/kumiko-framework@1.0.0
  - @cosmicdrift/kumiko-server-runtime@1.0.0
  - @cosmicdrift/kumiko-bundled-features@1.0.0

## 0.158.2

### Patch Changes

- Updated dependencies [c6487d0]
  - @cosmicdrift/kumiko-server-runtime@0.158.2
  - @cosmicdrift/kumiko-framework@0.158.2
  - @cosmicdrift/kumiko-bundled-features@0.158.2

## 0.158.1

### Patch Changes

- Updated dependencies [da816ee]
  - @cosmicdrift/kumiko-framework@0.158.1
  - @cosmicdrift/kumiko-server-runtime@0.158.1
  - @cosmicdrift/kumiko-bundled-features@0.158.1

## 0.158.0

### Patch Changes

- Updated dependencies [7d230f2]
  - @cosmicdrift/kumiko-server-runtime@0.158.0
  - @cosmicdrift/kumiko-framework@0.158.0
  - @cosmicdrift/kumiko-bundled-features@0.158.0

## 0.157.3

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.157.3
- @cosmicdrift/kumiko-server-runtime@0.157.3
- @cosmicdrift/kumiko-framework@0.157.3

## 0.157.2

### Patch Changes

- Updated dependencies [08c40d6]
  - @cosmicdrift/kumiko-bundled-features@0.157.2
  - @cosmicdrift/kumiko-server-runtime@0.157.2
  - @cosmicdrift/kumiko-framework@0.157.2

## 0.157.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.157.1
- @cosmicdrift/kumiko-server-runtime@0.157.1
- @cosmicdrift/kumiko-framework@0.157.1

## 0.157.0

### Patch Changes

- Updated dependencies [1371d8b]
  - @cosmicdrift/kumiko-framework@0.157.0
  - @cosmicdrift/kumiko-bundled-features@0.157.0
  - @cosmicdrift/kumiko-server-runtime@0.157.0

## 0.156.3

### Patch Changes

- Updated dependencies [f768c8a]
  - @cosmicdrift/kumiko-framework@0.156.3
  - @cosmicdrift/kumiko-bundled-features@0.156.3
  - @cosmicdrift/kumiko-server-runtime@0.156.3

## 0.156.2

### Patch Changes

- f0a76da: `buildServerBundle` (used by `kumiko-build`) moves `meilisearch` from
  `BUILD_ONLY_EXTERNALS` to `RUNTIME_EXTERNALS`. Apps importing
  `createMeilisearchAdapter` from `@cosmicdrift/kumiko-framework/search/meilisearch`
  reference the package at runtime, not just transitively during the build —
  without this, the generated `dist-server/package.json` omits `meilisearch`
  and the production container crashes on boot with
  `Cannot find package 'meilisearch'` (found via a money-horse prod incident).
- Updated dependencies [838cd4e]
  - @cosmicdrift/kumiko-framework@0.156.2
  - @cosmicdrift/kumiko-bundled-features@0.156.2
  - @cosmicdrift/kumiko-server-runtime@0.156.2

## 0.156.1

### Patch Changes

- 9ec4841: Scaffolded demo `tasks` feature ships i18n keys, client translations, and list edit rowAction so `bun dev` boots on current validators.
  - @cosmicdrift/kumiko-framework@0.156.1
  - @cosmicdrift/kumiko-bundled-features@0.156.1
  - @cosmicdrift/kumiko-server-runtime@0.156.1

## 0.156.0

### Patch Changes

- Updated dependencies [c7ca222]
- Updated dependencies [77ea09f]
  - @cosmicdrift/kumiko-framework@0.156.0
  - @cosmicdrift/kumiko-bundled-features@0.156.0
  - @cosmicdrift/kumiko-server-runtime@0.156.0

## 0.155.1

### Patch Changes

- 36e30da: infra#285/#286 triage: rename `ScanWarning.reason` to `.message` (a `console.warn` display string, not a wire error code) — `guard-error-reasons` now actually scans this package instead of silently skipping it.
- Updated dependencies [69ac999]
  - @cosmicdrift/kumiko-server-runtime@0.155.1
  - @cosmicdrift/kumiko-bundled-features@0.155.1
  - @cosmicdrift/kumiko-framework@0.155.1

## 0.155.0

### Patch Changes

- Updated dependencies [137f31a]
  - @cosmicdrift/kumiko-framework@0.155.0
  - @cosmicdrift/kumiko-bundled-features@0.155.0
  - @cosmicdrift/kumiko-server-runtime@0.155.0

## 0.154.2

### Patch Changes

- Updated dependencies [05c3e11]
  - @cosmicdrift/kumiko-framework@0.154.2
  - @cosmicdrift/kumiko-bundled-features@0.154.2
  - @cosmicdrift/kumiko-server-runtime@0.154.2

## 0.154.1

### Patch Changes

- Updated dependencies [618be61]
  - @cosmicdrift/kumiko-bundled-features@0.154.1
  - @cosmicdrift/kumiko-server-runtime@0.154.1
  - @cosmicdrift/kumiko-framework@0.154.1

## 0.154.0

### Patch Changes

- Updated dependencies [0d30bf7]
- Updated dependencies [e40a980]
  - @cosmicdrift/kumiko-framework@0.154.0
  - @cosmicdrift/kumiko-bundled-features@0.154.0
  - @cosmicdrift/kumiko-server-runtime@0.154.0

## 0.153.0

### Patch Changes

- caed246: Extract `@cosmicdrift/kumiko-server-runtime` as a new package carrying `runProdApp` and its
  production-boot dependencies (compose-features, boot seeding/crypto/job-logger,
  extra-routes-deps, pii-boot-gate, static-file serving, prod bundle build, session-wiring).

  `@cosmicdrift/kumiko-dev-server` now depends on `kumiko-server-runtime` for these shared
  pieces instead of bundling them directly, and no longer exports `runProdApp` or
  `compose-features` from its own subpaths — apps must import those from
  `@cosmicdrift/kumiko-server-runtime` (see the package's README/exports). This is a breaking
  change for anyone importing `runProdApp`/`composeFeatures` from `@cosmicdrift/kumiko-dev-server`
  directly; `runDevApp` and the rest of `kumiko-dev-server`'s public API are unaffected.

  The net effect: a production app that only needs `runProdApp` no longer pulls `ts-morph` and
  the scaffolding/codegen toolchain into its `node_modules`.

- Updated dependencies [caed246]
  - @cosmicdrift/kumiko-server-runtime@0.153.0
  - @cosmicdrift/kumiko-framework@0.153.0
  - @cosmicdrift/kumiko-bundled-features@0.153.0

## 0.152.0

### Patch Changes

- Updated dependencies [e32807e]
- Updated dependencies [3dd1f99]
  - @cosmicdrift/kumiko-framework@0.152.0
  - @cosmicdrift/kumiko-bundled-features@0.152.0

## 0.151.1

### Patch Changes

- Updated dependencies [5c1dc93]
  - @cosmicdrift/kumiko-framework@0.151.1
  - @cosmicdrift/kumiko-bundled-features@0.151.1

## 0.151.0

### Patch Changes

- Updated dependencies [ca4edbf]
- Updated dependencies [624dcc5]
- Updated dependencies [97ca76d]
  - @cosmicdrift/kumiko-framework@0.151.0
  - @cosmicdrift/kumiko-bundled-features@0.151.0

## 0.150.0

### Minor Changes

- 0e4cec9: Fix-Batch aus dem PR-Review-Prozess (Quellen: #1035, #1036, #1037, #1041, #1042,
  #1043, #1049, #1050, #1052, #1053, #1056, #1064, #1034).

  - `@cosmicdrift/kumiko-framework/engine` exportiert neu `isEncryptedAtRest(def)` —
    ein Config-Key gilt als verschlüsselt wenn `encrypted: true` ODER
    `backing: "secrets"` gesetzt ist. Ersetzt drei bisher unabhängig abweichende
    Ableitungen (feature-manifest.ts, cascade/values.query.ts) und schließt eine
    Boot-Validator-Lücke: `computed`/`allowPerRequest` auf einem
    `backing: "secrets"`-Key failt jetzt am Boot statt zur Laufzeit durchzurutschen.
  - `RunProdAppOptions` bekommt `observabilityOptions` (Passthrough zur
    Auto-Instrumentation) — vorher nur über den Low-Level-Entrypoint erreichbar.
  - `@cosmicdrift/kumiko-bundled-features/auth-mfa`: `currentTotpCode` (Test-Hook,
    nie ein Runtime-Helper) zieht aus dem Haupt-Barrel in einen neuen
    `./auth-mfa/testing`-Subpath — Import-Pfad ändert sich für Tests, die den
    Live-Code direkt aus einem Secret ableiten wollen.
  - MFA-Enrollment-UI: `mfa-enable-screen.tsx` importiert `qrcode/lib/browser`
    statt `qrcode` (vermeidet Node-only Deps wie yargs/pngjs im Client-Bundle;
    Bundle-Impact lokal nicht verifiziert), fängt Fehler jetzt in try/catch statt
    den Busy-State hängen zu lassen. `mfa-verify-screen.tsx` bekommt ein
    optionales `onCancel`, damit dead-end-Fehler (challenge_expired,
    too_many_attempts) einen Weg zurück zum Login haben.
  - Diverse Low-Sev-Fixes: base32-Decode toleriert `=`-Padding und validiert
    Restbits, Rate-Limit-Fix im public-share-token-Recipe (ip+handler statt
    user+handler bei openToAll), i18n-Lücken (mfa_not_supported-Key,
    styleguide-Sample-Übersetzungen), tote Kommentar-Blöcke gekürzt,
    password-hashing-Imports innerhalb bundled-features auf die tatsächliche
    `shared/`-Quelle umgestellt (Barrel-Re-Export in `auth-email-password`
    bewusst NICHT entfernt — bleibt als öffentlicher Re-Export bestehen, da eine
    Entfernung ein Breaking Change für published Consumers wäre und ein eigenes
    Deprecation-Fenster braucht).

### Patch Changes

- Updated dependencies [216870d]
- Updated dependencies [0e4cec9]
- Updated dependencies [aeb79fa]
  - @cosmicdrift/kumiko-bundled-features@0.150.0
  - @cosmicdrift/kumiko-framework@0.150.0

## 0.149.2

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.149.2
- @cosmicdrift/kumiko-framework@0.149.2

## 0.149.1

### Patch Changes

- Updated dependencies [637b599]
  - @cosmicdrift/kumiko-bundled-features@0.149.1
  - @cosmicdrift/kumiko-framework@0.149.1

## 0.149.0

### Patch Changes

- Updated dependencies [ab7e41e]
- Updated dependencies [9a463ec]
  - @cosmicdrift/kumiko-bundled-features@0.149.0
  - @cosmicdrift/kumiko-framework@0.149.0

## 0.148.0

### Patch Changes

- Updated dependencies [c7600c7]
- Updated dependencies [cb5612d]
  - @cosmicdrift/kumiko-bundled-features@0.148.0
  - @cosmicdrift/kumiko-framework@0.148.0

## 0.147.3

### Patch Changes

- Updated dependencies [0f0f675]
  - @cosmicdrift/kumiko-bundled-features@0.147.3
  - @cosmicdrift/kumiko-framework@0.147.3

## 0.147.2

### Patch Changes

- Updated dependencies [3f121df]
- Updated dependencies [dfb3c26]
- Updated dependencies [c007b76]
  - @cosmicdrift/kumiko-framework@0.147.2
  - @cosmicdrift/kumiko-bundled-features@0.147.2

## 0.147.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.147.1
- @cosmicdrift/kumiko-framework@0.147.1

## 0.147.0

### Minor Changes

- bdc5e27: Add `./observability` subpath export to `@cosmicdrift/kumiko-framework` (the public barrel existed but wasn't wired into the exports map) and additive `observability`/`metrics` pass-through options to `runProdApp` (`@cosmicdrift/kumiko-dev-server`). Apps that don't set these keep the existing Noop-provider/no-`/metrics` behavior unchanged.

  Prep work for publicstatus#91 (Job-Queue-Lane-Alert needs a real Prometheus meter — publicstatus currently exposes no `/metrics` endpoint at all).

### Patch Changes

- Updated dependencies [bdc5e27]
- Updated dependencies [c93de1a]
  - @cosmicdrift/kumiko-framework@0.147.0
  - @cosmicdrift/kumiko-bundled-features@0.147.0

## 0.146.4

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.146.4
- @cosmicdrift/kumiko-framework@0.146.4

## 0.146.3

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.146.3
- @cosmicdrift/kumiko-framework@0.146.3

## 0.146.2

### Patch Changes

- Updated dependencies [cc25fd7]
  - @cosmicdrift/kumiko-bundled-features@0.146.2
  - @cosmicdrift/kumiko-framework@0.146.2

## 0.146.1

### Patch Changes

- Updated dependencies [706cea7]
  - @cosmicdrift/kumiko-framework@0.146.1
  - @cosmicdrift/kumiko-bundled-features@0.146.1

## 0.146.0

### Patch Changes

- Updated dependencies [e605b4f]
- Updated dependencies [b00c3ed]
- Updated dependencies [3bb719a]
  - @cosmicdrift/kumiko-bundled-features@0.146.0
  - @cosmicdrift/kumiko-framework@0.146.0

## 0.145.1

### Patch Changes

- 8367193: Scaffolded apps now typecheck cleanly out of the box.

  - Add `@types/react` + `@types/react-dom` to the generated app's devDependencies (fixes ~900 TS7xxx errors from untyped React/JSX).
  - Generated `src/client.tsx` wraps `DefaultAppShell` in a local `AppShell` that supplies the required `brand` prop, so `createKumikoApp({ shell })` typechecks against the renderer signature (fixes the TS2322 "Property 'brand' is missing" errors).
  - Post-create next-steps banner is now English.
  - @cosmicdrift/kumiko-framework@0.145.1
  - @cosmicdrift/kumiko-bundled-features@0.145.1

## 0.145.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.145.0
- @cosmicdrift/kumiko-framework@0.145.0

## 0.144.0

### Patch Changes

- Updated dependencies [c7d0ef8]
  - @cosmicdrift/kumiko-framework@0.144.0
  - @cosmicdrift/kumiko-bundled-features@0.144.0

## 0.143.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.143.1
- @cosmicdrift/kumiko-framework@0.143.1

## 0.143.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.143.0
- @cosmicdrift/kumiko-framework@0.143.0

## 0.142.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.142.0
- @cosmicdrift/kumiko-framework@0.142.0

## 0.141.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.141.0
- @cosmicdrift/kumiko-framework@0.141.0

## 0.140.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.140.0
- @cosmicdrift/kumiko-framework@0.140.0

## 0.139.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.139.0
- @cosmicdrift/kumiko-framework@0.139.0

## 0.138.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.138.0
- @cosmicdrift/kumiko-framework@0.138.0

## 0.137.0

### Patch Changes

- Updated dependencies [fdd7c40]
  - @cosmicdrift/kumiko-framework@0.137.0
  - @cosmicdrift/kumiko-bundled-features@0.137.0

## 0.136.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.136.1
- @cosmicdrift/kumiko-framework@0.136.1

## 0.136.0

### Patch Changes

- Updated dependencies [f5a7f51]
  - @cosmicdrift/kumiko-framework@0.136.0
  - @cosmicdrift/kumiko-bundled-features@0.136.0

## 0.135.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.135.0
- @cosmicdrift/kumiko-framework@0.135.0

## 0.134.0

### Patch Changes

- Updated dependencies [9eab762]
  - @cosmicdrift/kumiko-framework@0.134.0
  - @cosmicdrift/kumiko-bundled-features@0.134.0

## 0.133.0

### Patch Changes

- Updated dependencies [9521906]
  - @cosmicdrift/kumiko-framework@0.133.0
  - @cosmicdrift/kumiko-bundled-features@0.133.0

## 0.132.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.132.0
- @cosmicdrift/kumiko-framework@0.132.0

## 0.131.0

### Minor Changes

- ce77f02: `kumiko add feature` scaffoldet die volle App-Feature-Konvention (constants.ts, i18n.ts mit Boot-Pflichtkeys, schema/, web/-Client-Stub, validateBoot-Test) statt nur feature.ts+index.ts. Referenz-Doku: docs/reference/app-feature-structure.md.

### Patch Changes

- Updated dependencies [99008c9]
- Updated dependencies [d814026]
  - @cosmicdrift/kumiko-framework@0.131.0
  - @cosmicdrift/kumiko-bundled-features@0.131.0

## 0.130.2

### Patch Changes

- Updated dependencies [98ed535]
  - @cosmicdrift/kumiko-bundled-features@0.130.2
  - @cosmicdrift/kumiko-framework@0.130.2

## 0.130.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.130.1
- @cosmicdrift/kumiko-framework@0.130.1

## 0.130.0

### Minor Changes

- bb715dd: Add composable SaaS stack presets (`composeStacks`) and `setupTestStackFromFeatures` test helper.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.130.0
- @cosmicdrift/kumiko-bundled-features@0.130.0

## 0.129.0

### Patch Changes

- Updated dependencies [3247676]
  - @cosmicdrift/kumiko-framework@0.129.0
  - @cosmicdrift/kumiko-bundled-features@0.129.0

## 0.128.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.128.0
- @cosmicdrift/kumiko-framework@0.128.0

## 0.127.0

### Patch Changes

- f5d37a1: Harden admin operator UI: stricter boot i18n/entityList validation, job run logger wiring, audit/job filters, shell breadcrumbs, and bundled entityList/i18n standards.
- Updated dependencies [f5d37a1]
  - @cosmicdrift/kumiko-framework@0.127.0
  - @cosmicdrift/kumiko-bundled-features@0.127.0

## 0.126.0

### Patch Changes

- Updated dependencies [0c482c3]
  - @cosmicdrift/kumiko-framework@0.126.0
  - @cosmicdrift/kumiko-bundled-features@0.126.0

## 0.125.2

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.125.2
- @cosmicdrift/kumiko-framework@0.125.2

## 0.125.1

### Patch Changes

- 8b21e66: dev-server: `define.ts`-Codegen für `TypedDispatcher`/`WriteHandlerQn` reexportierte den Typ nur (`export type { X } from "..."`), ohne ihn lokal zu binden — mit `verbatimModuleSyntax: true` (Standard-tsconfig aller Apps) brach das den eigenen `TypedDispatcher`-Typ mit "Cannot find name 'WriteHandlerQn'". Jetzt `import type` + separater `export type`-Reexport.
  - @cosmicdrift/kumiko-framework@0.125.1
  - @cosmicdrift/kumiko-bundled-features@0.125.1

## 0.125.0

### Patch Changes

- Updated dependencies [8d1353b]
  - @cosmicdrift/kumiko-bundled-features@0.125.0
  - @cosmicdrift/kumiko-framework@0.125.0

## 0.124.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.124.0
- @cosmicdrift/kumiko-framework@0.124.0

## 0.123.3

### Patch Changes

- Updated dependencies [57ebd1d]
  - @cosmicdrift/kumiko-bundled-features@0.123.3
  - @cosmicdrift/kumiko-framework@0.123.3

## 0.123.2

### Patch Changes

- Updated dependencies [581a3b6]
  - @cosmicdrift/kumiko-bundled-features@0.123.2
  - @cosmicdrift/kumiko-framework@0.123.2

## 0.123.1

### Patch Changes

- Updated dependencies [cf63778]
  - @cosmicdrift/kumiko-bundled-features@0.123.1
  - @cosmicdrift/kumiko-framework@0.123.1

## 0.123.0

### Patch Changes

- b0e70a7: headless: new `html` tagged template + `raw()`/`RawHtml` — auto-escapes every interpolation, `raw()` marks prerendered markup, nested `html` fragments compose without double-escaping. Structural companion to the new HTML-escape guard (infra#201).

  Hardening from the guard's first run: apex JSON-LD `<script>` block serializes `<` as `<` (no `</script>` breakout), dev-server `injectSchema` does the same for `window.__KUMIKO_SCHEMA__`; apex/page-render prerendered fragments renamed to the `*Html` convention.

- Updated dependencies [b0e70a7]
  - @cosmicdrift/kumiko-bundled-features@0.123.0
  - @cosmicdrift/kumiko-framework@0.123.0

## 0.122.5

### Patch Changes

- Updated dependencies [837e3b3]
  - @cosmicdrift/kumiko-bundled-features@0.122.5
  - @cosmicdrift/kumiko-framework@0.122.5

## 0.122.4

### Patch Changes

- Updated dependencies [2dd0d9e]
  - @cosmicdrift/kumiko-framework@0.122.4
  - @cosmicdrift/kumiko-bundled-features@0.122.4

## 0.122.3

### Patch Changes

- Updated dependencies [1693324]
  - @cosmicdrift/kumiko-framework@0.122.3
  - @cosmicdrift/kumiko-bundled-features@0.122.3

## 0.122.2

### Patch Changes

- Updated dependencies [a9a6d80]
  - @cosmicdrift/kumiko-framework@0.122.2
  - @cosmicdrift/kumiko-bundled-features@0.122.2

## 0.122.1

### Patch Changes

- Updated dependencies [8665f63]
  - @cosmicdrift/kumiko-framework@0.122.1
  - @cosmicdrift/kumiko-bundled-features@0.122.1

## 0.122.0

### Patch Changes

- Updated dependencies [e069b64]
- Updated dependencies [446f933]
- Updated dependencies [e069b64]
  - @cosmicdrift/kumiko-bundled-features@0.122.0
  - @cosmicdrift/kumiko-framework@0.122.0

## 0.121.1

### Patch Changes

- Updated dependencies [0af1fe1]
  - @cosmicdrift/kumiko-framework@0.121.1
  - @cosmicdrift/kumiko-bundled-features@0.121.1

## 0.121.0

### Patch Changes

- Updated dependencies [b679dc1]
  - @cosmicdrift/kumiko-framework@0.121.0
  - @cosmicdrift/kumiko-bundled-features@0.121.0

## 0.120.0

### Patch Changes

- Updated dependencies [29fbdc5]
- Updated dependencies [c22b711]
- Updated dependencies [433c060]
  - @cosmicdrift/kumiko-framework@0.120.0
  - @cosmicdrift/kumiko-bundled-features@0.120.0

## 0.119.0

### Minor Changes

- b01a4d2: Blind index for PII equality lookups + hard PII boot gate (#818, PRs #819/#821/#822/#823 + this one).

  **BREAKING for apps that mount PII-annotated features (user, tenant, sessions, …) without a KMS:** `runProdApp` now ABORTS boot instead of warning. Either wire `kms: createPgKmsAdapter({ databaseUrl, platformKek })` (plus `blindIndexKey`, env `KUMIKO_BLIND_INDEX_KEY`) or acknowledge explicitly with `allowPlaintextPii: "<reason>"` until your KMS is provisioned. Apps with their own `r.unmanagedTable` stores carrying subject annotations must encrypt on write (`encryptForDirectWrite`) and declare `piiEncryptedOnWrite: true`, or boot fails.

  New: `lookupable: true` on pii text fields maintains an HMAC blind-index column so equality lookups (login by email, dedup checks, invites, password reset) keep working on encrypted columns — query compilers rewrite `eq` filters to `(col = $1 OR col_bidx = $2)`, rollout-neutral for plaintext legacy rows. `user.email` and `tenant-invitation.email` are lookupable; `api-token.name` is `userOwned`; `config.userId`/`notification-preference.userId` are declared `allowPlaintext` (pseudonymous FKs). All bundled read paths that hand stored PII to mails, responses, comparisons or lookups decrypt via the new `decryptStoredPii` helper (13 fixed call sites — with a KMS active, all three invite-accept branches and password-reset mails were previously broken). GDPR exports decrypt every `kumiko-pii:` value centrally. Runtime tripwires: a PII ciphertext in a JSON API response is a loud 500 in dev/test and redacted+logged in prod; outgoing mail to a ciphertext recipient is always refused. Executor write-response echoes (`event.payload`) now carry plaintext (the persisted event log is unchanged). `runDevApp` accepts `kms` + `blindIndexKey` to exercise the full crypto path locally.

- 6ffb71e: Crypto-shredding phase C — event-store PII envelope engine (#724): fields annotated `pii` / `userOwned` / `tenantOwned` are encrypted with the erase subject's DEK at the same executor hook points as `encrypted: true`. Storage format `kumiko-pii:v1:<subjectKey>:<base64(iv|tag|ct)>` names the subject inline; event payload AND projection row carry ciphertext (live == rebuild by construction), legacy plaintext passes through on read. Subject keys are created on first write; reads after `eraseKey` render the `[[erased]]` sentinel; writes to an erased subject fail. `runProdApp({ kms })` wires the engine — without an adapter it stays off (plaintext, pre-phase-C behavior) and boot warns; the hard gate ships with the prod-grade PgKmsAdapter (phase E). Also: `forget()` now re-encrypts `previous` like `delete()` (plaintext of encrypted/pii fields no longer lands in the forgotten event), `userOwned.ownerField` accepts text fields (ES userId-by-convention), and `user-session.ip/userAgent` + `tenant-invitation.invitedBy` annotations now name the referenced user as their subject.

### Patch Changes

- Updated dependencies [b01a4d2]
- Updated dependencies [53da660]
- Updated dependencies [6ffb71e]
- Updated dependencies [02670c9]
  - @cosmicdrift/kumiko-framework@0.119.0
  - @cosmicdrift/kumiko-bundled-features@0.119.0

## 0.118.0

### Patch Changes

- Updated dependencies [c5ed4f0]
  - @cosmicdrift/kumiko-framework@0.118.0
  - @cosmicdrift/kumiko-bundled-features@0.118.0

## 0.117.0

### Minor Changes

- e5bae38: Crypto-shredding phase A — kms-adapter foundation (#724): new `@cosmicdrift/kumiko-framework/crypto` module with the `KmsAdapter` contract (user/tenant `SubjectId`, `local-key` vs `remote-crypto` capability modes for the later Vault transit adapter, `KeyErased`/`KeyNotFound`/`KeyAlreadyExists` errors) plus `InMemoryKmsAdapter` and a reusable adapter contract test suite. Erased subjects keep a tombstone — `createKey` after `eraseKey` throws, so forget cannot be undone by re-keying. `runProdApp({ kms })` exposes the adapter as `ctx.kms` and health-gates boot (an app configured for crypto-shredding refuses to start against an unreachable key store). No behavior change for apps that don't pass the option.

### Patch Changes

- Updated dependencies [e5bae38]
- Updated dependencies [03809b9]
  - @cosmicdrift/kumiko-framework@0.117.0
  - @cosmicdrift/kumiko-bundled-features@0.117.0

## 0.116.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.116.1
- @cosmicdrift/kumiko-framework@0.116.1

## 0.116.0

### Patch Changes

- Updated dependencies [d9bb774]
- Updated dependencies [ef58e34]
  - @cosmicdrift/kumiko-bundled-features@0.116.0
  - @cosmicdrift/kumiko-framework@0.116.0

## 0.115.1

### Patch Changes

- Updated dependencies [7054c74]
  - @cosmicdrift/kumiko-framework@0.115.1
  - @cosmicdrift/kumiko-bundled-features@0.115.1

## 0.115.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.115.0
- @cosmicdrift/kumiko-framework@0.115.0

## 0.114.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.114.0
- @cosmicdrift/kumiko-framework@0.114.0

## 0.113.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.113.1
- @cosmicdrift/kumiko-framework@0.113.1

## 0.113.0

### Patch Changes

- Updated dependencies [ba5053b]
  - @cosmicdrift/kumiko-framework@0.113.0
  - @cosmicdrift/kumiko-bundled-features@0.113.0

## 0.112.1

### Patch Changes

- Updated dependencies [0b9eb9a]
  - @cosmicdrift/kumiko-framework@0.112.1
  - @cosmicdrift/kumiko-bundled-features@0.112.1

## 0.112.0

### Patch Changes

- Updated dependencies [3714822]
  - @cosmicdrift/kumiko-framework@0.112.0
  - @cosmicdrift/kumiko-bundled-features@0.112.0

## 0.111.0

### Minor Changes

- 340acef: Unified encryption: encrypted config keys and encrypted entity fields now use
  the same versioned envelope mechanism as `ctx.secrets` (DEK per value, KEK from
  `KUMIKO_SECRETS_MASTER_KEY_V<n>`), making key rotation possible everywhere.

  - New `createEnvelopeCipher` (framework/secrets): JSON `StoredEnvelope` in TEXT
    columns, format detection, decrypt-only legacy fallback, shared DEK cache.
    `MasterKeyProvider.wrapDek/unwrapDek` gained an optional `KeyScope` param
    (BYOK hook; env provider ignores it).
  - Config: `ConfigResolverOptions.encryption` → `cipher` (EnvelopeCipher);
    reading an encrypted key without a cipher now THROWS instead of silently
    returning the ciphertext as the value. New manual `config:reencrypt` job
    migrates legacy `CONFIG_ENCRYPTION_KEY` rows and rotates old kekVersions.
  - Entity fields: `ENCRYPTION_KEY` singleton replaced by boot-injected cipher
    (`configureEntityFieldEncryption`); executor encrypt/decrypt paths are async;
    boot validation now probes keyring availability (malformed keys fail at
    boot). GDPR export decrypts encrypted fields (or emits an explicit
    `[encrypted:unavailable]` marker) instead of leaking ciphertext.
  - run{Prod,Dev}App auto-wire the cipher + `masterKeyProvider` from the
    environment; `CONFIG_ENCRYPTION_KEY` / `ENCRYPTION_KEY` remain supported as
    decrypt-only fallbacks until the reencrypt job has run.
  - `createEncryptionProvider` is deprecated (legacy decrypt-only). Tests:
    `createTestEnvelopeCipher` / `createTestMasterKeyProvider` in
    framework/testing.

  Migration: provision `KUMIKO_SECRETS_MASTER_KEY_V1`, deploy, run
  `config:reencrypt`, verify `failed: 0`, then drop the legacy env keys.

### Patch Changes

- Updated dependencies [340acef]
  - @cosmicdrift/kumiko-framework@0.111.0
  - @cosmicdrift/kumiko-bundled-features@0.111.0

## 0.110.0

### Patch Changes

- Updated dependencies [3fa4673]
  - @cosmicdrift/kumiko-framework@0.110.0
  - @cosmicdrift/kumiko-bundled-features@0.110.0

## 0.109.0

### Patch Changes

- Updated dependencies [b127293]
  - @cosmicdrift/kumiko-bundled-features@0.109.0
  - @cosmicdrift/kumiko-framework@0.109.0

## 0.108.0

### Patch Changes

- Updated dependencies [d1b91b1]
  - @cosmicdrift/kumiko-bundled-features@0.108.0
  - @cosmicdrift/kumiko-framework@0.108.0

## 0.107.0

### Patch Changes

- Updated dependencies [64ff082]
- Updated dependencies [3ff6025]
  - @cosmicdrift/kumiko-framework@0.107.0
  - @cosmicdrift/kumiko-bundled-features@0.107.0

## 0.106.0

### Minor Changes

- d6fbd00: Personal Access Tokens: long-lived, revocable bearer credentials for headless HTTP-API access.

  - New `personal-access-tokens` bundled-feature: `read_api_tokens` direct-write store, SHA-256 token hashing, show-once mint, `create`/`revoke`/`mine`/`available-scopes` handlers, and a mountable `PatTokensScreen` web UI (`personalAccessTokensClient()`).
  - Framework auth seam: bearer tokens prefixed `kpat_` resolve via a new `patResolver` (before jwt.verify) into a `SessionUser`; roles are resolved live per request (not snapshotted). Config-driven scopes (app declares named QN-glob bundles) are enforced fail-closed at the API boundary. Optional per-token rate limiting.
  - `runProdApp`/`runDevApp` auto-wire the resolver + rate limiter when the feature is mounted. All new `AuthRoutesConfig`/`SessionUser` fields are optional — no change for apps that don't mount it.

### Patch Changes

- Updated dependencies [7944923]
- Updated dependencies [d6fbd00]
  - @cosmicdrift/kumiko-framework@0.106.0
  - @cosmicdrift/kumiko-bundled-features@0.106.0

## 0.105.2

### Patch Changes

- Updated dependencies [a305251]
- Updated dependencies [a305251]
  - @cosmicdrift/kumiko-bundled-features@0.105.2
  - @cosmicdrift/kumiko-framework@0.105.2

## 0.105.1

### Patch Changes

- Updated dependencies [4f6e001]
  - @cosmicdrift/kumiko-bundled-features@0.105.1
  - @cosmicdrift/kumiko-framework@0.105.1

## 0.105.0

### Patch Changes

- Updated dependencies [1918250]
  - @cosmicdrift/kumiko-framework@0.105.0
  - @cosmicdrift/kumiko-bundled-features@0.105.0

## 0.104.0

### Minor Changes

- a3c973e: auth-email-password: migrate the tenant-invite flow off its app callback onto the `delivery` system, completing the #562 migration (all four magic-link flows now mail via `ctx.notify`).

  `invite-create` now dispatches the invite mail itself via `ctx.notify` (delivery), like reset/verify/signup — and no longer returns the token in its result, so a tenant admin can't see or accept with the invitee's token. `delivery` is now a hard boot requirement when invite is mounted.

  Breaking:

  - `InviteConfig` (framework auth-routes) drops `sendInviteEmail` / `appAcceptUrl` — only the three accept handlers remain.
  - `InviteOptions` / dev-server `InviteSetup` carry `appUrl` (+ optional `appName` / `locale`) instead of the callback.
  - `InviteCreateData` no longer includes `token`.
  - `renderInviteEmail` returns structured `AuthMailContent` (was `RenderedEmail`); `RenderInviteEmailArgs` switches `inviteUrl` → `url`.
  - `createAuthMailerConfig` / `AuthMailerConfig` / `CreateAuthMailerConfigArgs` are removed (invite was the last callback consumer); `RenderedEmail` is removed. `AuthPaths` / `DEFAULT_AUTH_PATHS` / `makeAuthPaths` keep their public names (moved to a dedicated module).

  Mount `delivery()` + a mail channel + a transport instead of wiring `sendInviteEmail`.

### Patch Changes

- Updated dependencies [a3c973e]
  - @cosmicdrift/kumiko-framework@0.104.0
  - @cosmicdrift/kumiko-bundled-features@0.104.0

## 0.103.0

### Minor Changes

- 961d0bb: auth-email-password: migrate the magic-link mail flows (password-reset, email-verification, signup) off app-supplied `send*Email` callbacks onto the `delivery` system (#562).

  `ctx.notify` is now wired in production: `runProdApp` / `runDevApp` build a `DeliveryService` and bind it as the dispatcher's per-user `_notifyFactory` when the `delivery` feature is mounted (previously only tests wired it, so every production notification was silently dropped). The three flows' request handlers now render structured content and dispatch via `ctx.notify({ route: { email }, priority: "critical" })`; `delivery` becomes a hard boot-time requirement when any of them is mounted.

  Breaking for app authors who wired these flows by hand:

  - `PasswordResetConfig` / `EmailVerificationConfig` / `SignupConfig` (framework auth-routes) no longer take `sendResetEmail` / `appResetUrl` / `sendVerificationEmail` / `appVerifyUrl` / `sendActivationEmail` / `appActivationUrl` — they shrink to `{ requestHandler, confirmHandler }`.
  - `PasswordResetOptions` / `EmailVerificationOptions` / `SignupOptions` (and the dev-server `*Setup` wrappers) now carry `appUrl` (+ optional `appName` / `locale`) instead of the callback; `signup` now requires `appUrl`.
  - `createAuthMailerConfig` / `AuthMailerConfig` shrink to invite only.
  - `renderActivationEmail` now returns structured `AuthMailContent` (was `RenderedEmail`); `RenderActivationEmailArgs` is removed (use `RenderTokenContentArgs`).

  Mount `delivery()` + a mail channel + a transport instead of writing the reset/verify/signup mail callbacks. Tenant invite is unchanged (still callback-based).

### Patch Changes

- Updated dependencies [961d0bb]
  - @cosmicdrift/kumiko-framework@0.103.0
  - @cosmicdrift/kumiko-bundled-features@0.103.0

## 0.102.2

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.102.2
- @cosmicdrift/kumiko-framework@0.102.2

## 0.102.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.102.1
- @cosmicdrift/kumiko-framework@0.102.1

## 0.102.0

### Patch Changes

- 0b90d0a: Auto-wired `secrets` no longer crashes boot when no KEK is available

  `buildBootExtraContext` now only auto-wires `ctx.secrets` when the `secrets` feature is mounted AND a key is actually available — either a `masterKey` override or a `KUMIKO_SECRETS_MASTER_KEY_V<n>` env var. Without one it skips the wiring instead of eagerly constructing an env master-key provider that throws. This unblocks dev servers that supply their own DEV key via explicit `extraContext.secrets` (the env KEK isn't set in dev); their explicit wiring wins. Production with a configured KEK is unchanged, and a genuinely missing prod KEK is still caught by `secretsEnvSchema` at boot.

- Updated dependencies [020d5e8]
  - @cosmicdrift/kumiko-framework@0.102.0
  - @cosmicdrift/kumiko-bundled-features@0.102.0

## 0.101.0

### Minor Changes

- a32f591: App-shell hoist (boot-wiring + presets): less per-app bootstrap duplication

  `runProdApp` now provides framework defaults that apps override only for the exception:

  - Auto-wires `textContent` (always) and `secrets` (when the `secrets` feature is mounted) into the AppContext — apps drop their hand-rolled extraContext factory. New optional `masterKey?` override for KMS backends instead of the env KEK provider.
  - New `auth.mail` block builds all four auth-mail flows (password-reset, email-verification, signup, invite) from an env-derived SMTP transport + standard templates, replacing the per-app SMTP block + `createAuthMailerConfig` wrapper + `AUTH_PATHS` plucking. Null-transport guard preserved (no `SMTP_HOST` → flows stay unwired); explicit per-flow setups still win.

  New helpers:

  - `createSmtpTransportFromEnv(env, { fallbackFrom })` (channel-email).
  - `seedLegalContentFromJson(db, blocks)` (text-content) — centralises the legal-block seed loop with the load-bearing `ifExists: "update"`.
  - `dsgvoSelfServiceFeatures(opts?)` (new `presets` entry) — the five-feature DSGVO + account-self-service chain in dependency order.
  - `DEFAULT_AUTH_PATHS` + `makeAuthPaths()`; `createAuthMailerConfig`'s `paths` argument is now optional (defaults to `DEFAULT_AUTH_PATHS`).
  - `SECRETS_FEATURE_NAME` constant.

  Additive and backward-compatible — existing apps that pass explicit wiring keep working unchanged.

- ab82597: runDevApp parity with runProdApp's app-shell hoist

  `runDevApp` now supports the same `auth.mail` convenience block and auto-wires `textContent` (always) + `secrets` (feature-gated) into the dev AppContext, plus a `masterKey?` override — so an app's `bin/server.ts` drops the same SMTP block, auth-mailer wrapper, and provider wiring as its `bin/main.ts`. `resolveAuthMail` is now generic over the prod/dev auth-option types, and the shared `AuthMailOptions` type is exported. Additive and backward-compatible.

### Patch Changes

- a9f5b75: `runProdApp` now wires sessions **secure-by-default**: mounting `createSessionsFeature()`
  turns on server-side session revocation + `sessionStrictMode` automatically, instead of
  _also_ requiring an explicit `auth.sessions`. Apps that mounted the sessions feature but
  never set `auth.sessions` — so their logout / password-reset never actually revoked any
  JWT — are now correct without a code change. `auth.sessions` still overrides the config,
  and the new `auth.sessions: false` is the explicit opt-out (back to stateless JWTs).
- Updated dependencies [a32f591]
  - @cosmicdrift/kumiko-bundled-features@0.101.0
  - @cosmicdrift/kumiko-framework@0.101.0

## 0.100.0

### Patch Changes

- Updated dependencies [aaf890e]
- Updated dependencies [17b44b3]
  - @cosmicdrift/kumiko-framework@0.100.0
  - @cosmicdrift/kumiko-bundled-features@0.100.0

## 0.99.0

### Patch Changes

- Updated dependencies [8146e5b]
  - @cosmicdrift/kumiko-framework@0.99.0
  - @cosmicdrift/kumiko-bundled-features@0.99.0

## 0.98.0

### Patch Changes

- Updated dependencies [4c39e11]
  - @cosmicdrift/kumiko-bundled-features@0.98.0
  - @cosmicdrift/kumiko-framework@0.98.0

## 0.97.1

### Patch Changes

- Updated dependencies [c5410a3]
  - @cosmicdrift/kumiko-framework@0.97.1
  - @cosmicdrift/kumiko-bundled-features@0.97.1

## 0.97.0

### Patch Changes

- Updated dependencies [4e2bd72]
  - @cosmicdrift/kumiko-framework@0.97.0
  - @cosmicdrift/kumiko-bundled-features@0.97.0

## 0.96.0

### Patch Changes

- Updated dependencies [38ed5f4]
  - @cosmicdrift/kumiko-bundled-features@0.96.0
  - @cosmicdrift/kumiko-framework@0.96.0

## 0.95.0

### Patch Changes

- Updated dependencies [23527e4]
- Updated dependencies [a236ed7]
- Updated dependencies [387f259]
- Updated dependencies [da32b71]
  - @cosmicdrift/kumiko-bundled-features@0.95.0
  - @cosmicdrift/kumiko-framework@0.95.0

## 0.94.0

### Patch Changes

- Updated dependencies [31a2abf]
  - @cosmicdrift/kumiko-framework@0.94.0
  - @cosmicdrift/kumiko-bundled-features@0.94.0

## 0.93.0

### Patch Changes

- Updated dependencies [37d0ea4]
  - @cosmicdrift/kumiko-framework@0.93.0
  - @cosmicdrift/kumiko-bundled-features@0.93.0

## 0.92.0

### Patch Changes

- Updated dependencies [6514695]
  - @cosmicdrift/kumiko-bundled-features@0.92.0
  - @cosmicdrift/kumiko-framework@0.92.0

## 0.91.0

### Patch Changes

- Updated dependencies [30d03de]
  - @cosmicdrift/kumiko-bundled-features@0.91.0
  - @cosmicdrift/kumiko-framework@0.91.0

## 0.90.3

### Patch Changes

- 9a90672: scaffold: generated `docker-compose.yml` now uses `postgres:18` (the project standard) instead of `postgres:17`.
  - @cosmicdrift/kumiko-framework@0.90.3
  - @cosmicdrift/kumiko-bundled-features@0.90.3

## 0.90.2

### Patch Changes

- Updated dependencies [5f623a9]
  - @cosmicdrift/kumiko-bundled-features@0.90.2
  - @cosmicdrift/kumiko-framework@0.90.2

## 0.90.1

### Patch Changes

- 04ec020: scaffold: ship a `docker-compose.yml` (Postgres 17 + Redis 7) with `kumiko new app`. The generated README already told users to run `docker compose up -d`, but no compose file was emitted — so the documented first-run path dead-ended. Ports and credentials match the `.env.example` `*_URL` defaults.
  - @cosmicdrift/kumiko-framework@0.90.1
  - @cosmicdrift/kumiko-bundled-features@0.90.1

## 0.90.0

### Patch Changes

- Updated dependencies [1712768]
  - @cosmicdrift/kumiko-bundled-features@0.90.0
  - @cosmicdrift/kumiko-framework@0.90.0

## 0.89.0

### Patch Changes

- ca33c52: HTTP-cache hardening + load reduction for the public-page caches (follow-up to the cache helpers in #630).

  - **`cachedResponse`: `If-None-Match` now decides alone.** Per RFC 7232 §3.3 a present `If-None-Match` makes `If-Modified-Since` irrelevant. Previously a mismatching ETag fell through to the `If-Modified-Since` branch and could still return a stale `304`. Benign in the current call sites (static ETags are mtime+size based, revision routes carry no `last-modified`), but now correct: ETag present → ETag alone.
  - **Multi-tenant `index.html` is served with `Vary: Host`.** `runProdApp`'s `hostDispatch` path picks the HTML file per Host and serves it `public`. Without `Vary: Host` a shared cache could key only on the URL; only the `max-age=0, must-revalidate` + per-Host ETag kept it from leaking one tenant's schema-injected shell to another. `Vary: Host` makes the isolation explicit instead of incidental, matching `managed-pages`.
  - **`legal-pages` / `managed-pages` cache for 60s.** Both served `public, max-age=0, must-revalidate`, so every request hit the origin to revalidate — and each `304` re-ran the content (and branding) query just to recompute the revision ETag. They now use `public, max-age=60, must-revalidate`: CDN/browser serve fresh for 60s without an origin round-trip, edits go live within 60s.

- Updated dependencies [be41f4d]
- Updated dependencies [8ae9ca3]
- Updated dependencies [ca33c52]
- Updated dependencies [dbc2c2d]
  - @cosmicdrift/kumiko-bundled-features@0.89.0
  - @cosmicdrift/kumiko-framework@0.89.0

## 0.88.0

### Patch Changes

- Updated dependencies [3ccc55e]
  - @cosmicdrift/kumiko-bundled-features@0.88.0
  - @cosmicdrift/kumiko-framework@0.88.0

## 0.87.3

### Patch Changes

- Updated dependencies [070c032]
  - @cosmicdrift/kumiko-framework@0.87.3
  - @cosmicdrift/kumiko-bundled-features@0.87.3

## 0.87.2

### Patch Changes

- b04ca86: Fix tenant privilege escalation via membership roles. `hasAccess` checks session roles flat with no notion of origin, so a platform-global role (`SystemAdmin`/`system`) landing in a tenant membership merged into the session and unlocked the SystemAdmin-gated, cross-tenant handler surface — a Tenant-Admin could invite `SystemAdmin` and the invitee gained platform-wide, cross-tenant access.

  Reject reserved/global roles (`system`, `SystemAdmin`, `all`, `anonymous`) at every tenant-membership write chokepoint: `seedTenantMembership` (covers the three invite-accept branches plus seeding), `add-member`, `update-member-roles`, and early in `invite-create`. The bootstrap path was already correct (SystemAdmin lives in global `users.roles`, never in a membership); this makes the invite path consistent.

  Also centralize the `tenantIdOverride` SystemAdmin gate into a new `crossTenantOverrideDenied` helper (exported from `@cosmicdrift/kumiko-framework/engine`), replacing the inline check duplicated across managed-pages, compliance-profiles, text-content and template-resolver so a future override handler can't skip it.

- Updated dependencies [b04ca86]
  - @cosmicdrift/kumiko-framework@0.87.2
  - @cosmicdrift/kumiko-bundled-features@0.87.2

## 0.87.1

### Patch Changes

- cb2abcd: Session bootstrap only mounts behind SessionAuthGate so public SPA gates (e.g. `/rechner`) no longer call `/api/auth/tenants`. Skip refresh when no `kumiko_csrf` cookie is present.
- Updated dependencies [cb2abcd]
  - @cosmicdrift/kumiko-bundled-features@0.87.1
  - @cosmicdrift/kumiko-framework@0.87.1

## 0.87.0

### Minor Changes

- c0cbfb5: Add HTTP cache helpers (`cachedResponse`, ETag computation, `CachePolicy`) to `@cosmicdrift/kumiko-framework/api` and wire them into prod static-fallback plus `legal-pages` / `managed-pages` public HTML routes.

### Patch Changes

- Updated dependencies [c0cbfb5]
  - @cosmicdrift/kumiko-framework@0.87.0
  - @cosmicdrift/kumiko-bundled-features@0.87.0

## 0.86.0

### Patch Changes

- e9feadd: fix(build): pino als RUNTIME_EXTERNAL — landet seit 0.83.0 (5xx-Logging) im Bundle und muss im Runtime-Container installiert sein
- Updated dependencies [0a80617]
  - @cosmicdrift/kumiko-framework@0.86.0
  - @cosmicdrift/kumiko-bundled-features@0.86.0

## 0.85.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.85.0
- @cosmicdrift/kumiko-framework@0.85.0

## 0.84.0

### Patch Changes

- Updated dependencies [189f0cb]
  - @cosmicdrift/kumiko-framework@0.84.0
  - @cosmicdrift/kumiko-bundled-features@0.84.0

## 0.83.0

### Patch Changes

- Updated dependencies [c2b7154]
- Updated dependencies [e36a2b0]
  - @cosmicdrift/kumiko-framework@0.83.0
  - @cosmicdrift/kumiko-bundled-features@0.83.0

## 0.82.0

### Patch Changes

- Updated dependencies [505f67c]
  - @cosmicdrift/kumiko-bundled-features@0.82.0
  - @cosmicdrift/kumiko-framework@0.82.0

## 0.81.1

### Patch Changes

- 9a798c5: Fix: any API handler reading `ctx.config` threw `errors.internal` in prod (first hit: the GDPR data-export download via `createFileProviderForTenant`). `runProdApp`/`runDevApp` wired `configResolver` into the AppContext but never `_configAccessorFactory`, so the dispatcher left `ctx.config` undefined. Boot now mints the factory from the **effective** resolver (an app-supplied configResolver override wins), restoring `ctx.config` for all handlers with dev/prod parity.
  - @cosmicdrift/kumiko-framework@0.81.1
  - @cosmicdrift/kumiko-bundled-features@0.81.1

## 0.81.0

### Patch Changes

- Updated dependencies [cf4d208]
  - @cosmicdrift/kumiko-bundled-features@0.81.0
  - @cosmicdrift/kumiko-framework@0.81.0

## 0.80.0

### Minor Changes

- 7e7e078: `scaffoldApp` now produces a bootable app out of the box. Three bugs the
  fresh-scaffold smoke uncovered after `bun create kumiko-app demo --yes &&
cd demo && bun install && bun dev`:

  - **`/client.js` 404 → blank SPA**: the default HTML referenced
    `/client.js` but `bin/dev.ts` never set `clientEntry`, so the dev-server
    had no bundle to serve. Scaffold now writes `src/client.tsx` (with
    `createKumikoApp({ shell: DefaultAppShell, clientFeatures:
[emailPasswordClient()] })`) and wires `clientEntry: "./src/client.tsx"`
    into `bin/dev.ts`. `@cosmicdrift/kumiko-renderer-web` is added as a
    scaffolded dependency.
  - **`Missing required env var: TEST_DATABASE_URL`**: `runDevApp →
setupTestStack` required `TEST_DATABASE_URL` but the template only
    listed `DATABASE_URL` (which `runProdApp` needs). `.env.example` now
    carries both with their respective comments.
  - **`[composeFeatures] "user/tenant/config/auth-email-password" already
auto-mounted` spam on every boot**: PR #599 stopped the
    `createRegistry` crash; this PR stops the warns at the source.
    `renderRunConfig` filters those four `composeFeatures`-auto-mounted
    feature names out of the generated `APP_FEATURES` even if the
    create-kumiko-app picker handed them in.

  Drive-by: new `e2e/hero-demos/` Playwright suite — scaffolds a fresh app
  via `runCreate()` (HEAD code), `bun install`s the published deps, boots
  it, and replays a shared `DemoDef` against the live app (the same object
  `scripts/record-demo.ts` consumes for the hero GIF). Steps marked
  `recordingOnly: true` (typing a new feature into `src/features/`) ship in
  the recording but the E2E runner skips them. A green E2E guarantees a
  hang-free recording session.

### Patch Changes

- Updated dependencies [407ed37]
  - @cosmicdrift/kumiko-bundled-features@0.80.0
  - @cosmicdrift/kumiko-framework@0.80.0

## 0.79.3

### Patch Changes

- Updated dependencies [cd34ef3]
  - @cosmicdrift/kumiko-bundled-features@0.79.3
  - @cosmicdrift/kumiko-framework@0.79.3

## 0.79.2

### Patch Changes

- Updated dependencies [914e84b]
- Updated dependencies [335ffef]
  - @cosmicdrift/kumiko-bundled-features@0.79.2
  - @cosmicdrift/kumiko-framework@0.79.2

## 0.79.1

### Patch Changes

- 4feba2b: `composeFeatures({ includeBundled: true })` now de-duplicates app-features
  whose name collides with one of the auto-mounted bundled foundation
  features (`config`, `user`, `tenant`, `auth-email-password`).

  Hit while recording the Phase 3 hero demo: the create-kumiko-app picker
  hands back `createAuthEmailPasswordFeature()` (it's `recommended: true`),
  runDevApp adds its own bundled copy via `includeBundled: true`, and
  createRegistry then crashes with `Duplicate feature: "auth-email-password"`
  — every freshly-scaffolded app was DOA on `bun dev`.

  The bundled instance wins (it carries the `authOptions` wiring for
  passwordReset / emailVerification / signup / invite); the app-side copy
  is dropped with a `console.warn` so the user can remove the line from
  `run-config.ts` to silence it.

  - @cosmicdrift/kumiko-framework@0.79.1
  - @cosmicdrift/kumiko-bundled-features@0.79.1

## 0.79.0

### Patch Changes

- Updated dependencies [969f006]
  - @cosmicdrift/kumiko-bundled-features@0.79.0
  - @cosmicdrift/kumiko-framework@0.79.0

## 0.78.0

### Minor Changes

- 7d27b06: `runProdApp` now boots `createAllInOneEntrypoint` by default (single-instance), running BOTH job lanes (api + worker) and the event-dispatcher inline. Previously it used `createApiEntrypoint` + `runLocalJobs`, which only consumed the **api** lane — so worker-lane crons (e.g. the GDPR data-export `run-export-jobs`, default `runIn:"worker"`) were silently never scheduled and stayed pending forever in single-container deploys.

  New `runSingleInstance` option (default `true`); set `false` only with a dedicated worker deployment (then this process is api-only and the worker must run the worker lane + MSPs). The old `jobs.runLocalJobs` runProdApp option is removed (it was internal-only); `eventDispatcher.disabled` is honoured as `runSingleInstance:false` for back-compat.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.78.0
- @cosmicdrift/kumiko-bundled-features@0.78.0

## 0.77.1

### Patch Changes

- Updated dependencies [b91862b]
  - @cosmicdrift/kumiko-framework@0.77.1
  - @cosmicdrift/kumiko-bundled-features@0.77.1

## 0.77.0

### Minor Changes

- 452656c: UX-polish for `bun create kumiko-app` based on the first end-to-end smoke
  against `https://kumiko.rocks/install.sh`:

  - **Next-steps points at `bun dev`** (not the CI-only `bun run boot` smoke).
    Also reminds the user that PG + Redis need to be up (`docker compose up -d`)
    and adds a one-line description so the recommended command is obvious.
  - **Setup-impact preview**: a single `→ Scaffolding N features into ./<name>/`
    line lands before the actual file writes, so the user can correlate the
    picked feature count with what they selected.
  - **README lists the mounted features dynamically** (`## Mounted features`
    with the picker output) instead of the hardcoded `secrets + sessions`
    foundation paragraph. Makes the generated README usable as a starting point
    doc rather than something the user immediately rewrites.

  Deferred to a follow-up: `configurableOptions` sub-prompts (Plan-Doc D9
  sketch). Only `auth-email-password` declares them today, and it's
  auto-mounted via `includeBundled` rather than picker-mounted — wiring
  sub-prompts requires deciding whether to surface auto-mounted features
  in the picker or to annotate more picker-mounted features first.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.77.0
- @cosmicdrift/kumiko-bundled-features@0.77.0

## 0.76.1

### Patch Changes

- Updated dependencies [491f034]
  - @cosmicdrift/kumiko-framework@0.76.1
  - @cosmicdrift/kumiko-bundled-features@0.76.1

## 0.76.0

### Minor Changes

- e7c164d: Scaffold a `dev`-ready app workspace.

  `scaffoldApp` now writes a `bin/dev.ts` entry alongside `bin/main.ts` and adds
  `scripts.dev = "bun --watch bin/dev.ts"` to `package.json`. The dev entry
  calls `runDevApp` with `welcomeBanner: true` and seeds an admin user via
  `auth.admin` — the first `bun dev` lands on a clickable URL with the login
  visible in the terminal.

  `.env.example` carries a `KUMIKO_DEV_DB_NAME=<app>_dev` default so each reboot
  reuses the same Postgres database and survives admin login + persisted data.
  Without it `createKumikoServer` would create a fresh `kumiko_test_<random>`
  DB on every restart and wipe state.

  The existing `boot`-script (`KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts`) and
  `bin/main.ts` with `runProdApp` stay intact for CI boot-smoke and production
  deploy.

  The new `scaffold-dev-cycle.integration.test.ts` pins the Phase-2 Risk #1
  contract: `pushEntityProjectionTables` is idempotent across persistent-DB
  reboots and adding a new `r.entity` between boots creates only the new table
  (no duplicate-CREATE crash, no missing table). That's the path `bun --watch`
  triggers when a Dev-User edits `src/features/notes.ts` — without it the
  scaffolded onboarding would lie.

### Patch Changes

- Updated dependencies [5828e0c]
  - @cosmicdrift/kumiko-framework@0.76.0
  - @cosmicdrift/kumiko-bundled-features@0.76.0

## 0.75.0

### Patch Changes

- Updated dependencies [3cdad53]
  - @cosmicdrift/kumiko-bundled-features@0.75.0
  - @cosmicdrift/kumiko-framework@0.75.0

## 0.74.0

### Minor Changes

- 6775bf9: `bun create kumiko-app <name>` — interactive feature picker

  `scaffoldApp()` (in `@cosmicdrift/kumiko-dev-server`) gains an optional
  `features` parameter that drives the imports + `APP_FEATURES` array of the
  generated `src/run-config.ts`. Without it the historical secrets+sessions
  foundation still lands — fully backwards-compatible.

  The new `create-kumiko-app` package (unscoped, so `bun create kumiko-app`
  resolves to it) wraps `scaffoldApp` with:

  - a vendored copy of `samples/apps/use-all-bundled/feature-manifest.json`
    so the picker works without network access (drift-tested in CI)
  - an Inquirer multi-select grouped by `uiHints.category`, default-checked
    on `uiHints.recommended`, listing the 9 picker-MVP bundled features
    (auth-email-password, tenant, user, sessions, delivery, files,
    user-profile, mail-transport-inmemory, billing-foundation)
  - transitive `requires` resolution (`auth-email-password` auto-pulls
    `user` + `tenant`)
  - `--yes` for the non-interactive recommended stack and
    `--print-manifest` for CI snapshots

  Phase 1b of the create-kumiko-app plan. Remaining bundled features +
  configurableOptions sub-prompts + configKey routing land in Phase 1c.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.74.0
- @cosmicdrift/kumiko-bundled-features@0.74.0

## 0.73.0

### Minor Changes

- 4a39cec: `runDevApp({ welcomeBanner: true })` — first-run banner after boot

  Adds an opt-in `welcomeBanner` option to `runDevApp`. When set, the
  dev-server prints a small box-art banner with the listen URL, the
  seeded admin login (when `auth.admin` is configured), a hint where to
  edit features for hot-reload, and a docs link.

  Default is off so existing apps keep their current quiet boot. The
  scaffold template (`create-kumiko-app`) flips it on so the first
  `bun dev` ends on something the user can click.

  Pass an object (`welcomeBanner: { featuresDir, docsUrl }`) to override
  the hint text. The `renderWelcomeBanner` helper is exported for callers
  that want to render the same banner outside `runDevApp`.

  Phase 1c (sub) of the create-kumiko-app plan.

### Patch Changes

- Updated dependencies [8aae416]
  - @cosmicdrift/kumiko-bundled-features@0.73.0
  - @cosmicdrift/kumiko-framework@0.73.0

## 0.72.0

### Patch Changes

- Updated dependencies [a6d3b3b]
- Updated dependencies [40c229f]
  - @cosmicdrift/kumiko-framework@0.72.0
  - @cosmicdrift/kumiko-bundled-features@0.72.0

## 0.71.0

### Patch Changes

- Updated dependencies [0be304e]
- Updated dependencies [7b8d405]
  - @cosmicdrift/kumiko-framework@0.71.0
  - @cosmicdrift/kumiko-bundled-features@0.71.0

## 0.70.0

### Patch Changes

- Updated dependencies [487734f]
  - @cosmicdrift/kumiko-framework@0.70.0
  - @cosmicdrift/kumiko-bundled-features@0.70.0

## 0.69.0

### Patch Changes

- Updated dependencies [18b5cc5]
  - @cosmicdrift/kumiko-bundled-features@0.69.0
  - @cosmicdrift/kumiko-framework@0.69.0

## 0.68.0

### Patch Changes

- Updated dependencies [d9a62f9]
  - @cosmicdrift/kumiko-bundled-features@0.68.0
  - @cosmicdrift/kumiko-framework@0.68.0

## 0.67.1

### Patch Changes

- Updated dependencies [f5a8a83]
  - @cosmicdrift/kumiko-bundled-features@0.67.1
  - @cosmicdrift/kumiko-framework@0.67.1

## 0.67.0

### Minor Changes

- d732bde: tier-engine: derive the trial from `tenant.inserted_at` and enforce it as a live gate

  Real auth-signups create the tenant via `seedTenant` (event-store executor), which
  bypasses the dispatcher `postSave` hook — so the auto-default `tier-assignment` row was
  never written and the cached trial-clock never warmed. A freshly signed-up tenant got
  neither a tier-assignment nor the 30-day trial on the server side.

  The trial is now derived from `tenant.inserted_at` (which always exists for every tenant)
  and checked live at the dispatcher feature-gate via a new optional `trialGate` on
  `EffectiveFeaturesResolver`, consulted only on the already-disabled cold path. The sync
  boot-cached resolver hot path is unchanged; `checkFeatureEnabled`/`ensureFeatureEnabled`
  become async (both call sites were already async). Removes the cached `trialClock` and the
  resolver trial-union. New exported type: `TrialGate`.

### Patch Changes

- Updated dependencies [d732bde]
  - @cosmicdrift/kumiko-bundled-features@0.67.0
  - @cosmicdrift/kumiko-framework@0.67.0

## 0.66.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [77ed9c1]
- Updated dependencies [15b06c1]
- Updated dependencies [32aa721]
  - @cosmicdrift/kumiko-framework@0.66.0
  - @cosmicdrift/kumiko-bundled-features@0.66.0

## 0.65.0

### Minor Changes

- dcdfe3f: dev-server: `runSchemaApply` / `runStandaloneSchemaCli` als Export unter `@cosmicdrift/kumiko-dev-server/schema-apply`. Apps delegieren ihr `bin/kumiko.ts` (`kumiko schema apply`) auf ~5 Zeilen statt ~100 Zeilen identisches Boilerplate (DATABASE_URL-Check, Migrations, Projection-Rebuild) pro App zu duplizieren. Der Greenfield-Infra-Bootstrap (event-store + pipeline-state-Tabellen, idempotent vor den App-Migrations) ist eingefaltet, sodass leere DBs (CNPG) und Bestands-DBs über denselben Code laufen — keine per-App-Divergenz mehr.

### Patch Changes

- Updated dependencies [09ff47e]
- Updated dependencies [6ac4ff6]
- Updated dependencies [773b368]
- Updated dependencies [6a200dd]
- Updated dependencies [1586c8c]
- Updated dependencies [0550ca4]
- Updated dependencies [8678242]
- Updated dependencies [8de0b3b]
  - @cosmicdrift/kumiko-bundled-features@0.65.0
  - @cosmicdrift/kumiko-framework@0.65.0

## 0.64.0

### Patch Changes

- Updated dependencies [dbd1606]
  - @cosmicdrift/kumiko-framework@0.64.0
  - @cosmicdrift/kumiko-bundled-features@0.64.0

## 0.63.0

### Patch Changes

- Updated dependencies [9e33766]
  - @cosmicdrift/kumiko-bundled-features@0.63.0
  - @cosmicdrift/kumiko-framework@0.63.0

## 0.62.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.62.0
- @cosmicdrift/kumiko-framework@0.62.0

## 0.61.0

### Patch Changes

- Updated dependencies [6b624d5]
  - @cosmicdrift/kumiko-bundled-features@0.61.0
  - @cosmicdrift/kumiko-framework@0.61.0

## 0.60.4

### Patch Changes

- Updated dependencies [7f55219]
  - @cosmicdrift/kumiko-framework@0.60.4
  - @cosmicdrift/kumiko-bundled-features@0.60.4

## 0.60.3

### Patch Changes

- Updated dependencies [af1b957]
  - @cosmicdrift/kumiko-framework@0.60.3
  - @cosmicdrift/kumiko-bundled-features@0.60.3

## 0.60.2

### Patch Changes

- Updated dependencies [68c5fee]
  - @cosmicdrift/kumiko-framework@0.60.2
  - @cosmicdrift/kumiko-bundled-features@0.60.2

## 0.60.1

### Patch Changes

- Updated dependencies [bde2443]
  - @cosmicdrift/kumiko-framework@0.60.1
  - @cosmicdrift/kumiko-bundled-features@0.60.1

## 0.60.0

### Patch Changes

- Updated dependencies [95a4a6c]
- Updated dependencies [9ae7ab8]
- Updated dependencies [16e1457]
- Updated dependencies [22c1ba2]
- Updated dependencies [34cb6e7]
- Updated dependencies [141d29b]
- Updated dependencies [fec57ca]
  - @cosmicdrift/kumiko-framework@0.60.0
  - @cosmicdrift/kumiko-bundled-features@0.60.0

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
  - @cosmicdrift/kumiko-bundled-features@0.59.2

## 0.59.1

### Patch Changes

- Updated dependencies [e8dacba]
- Updated dependencies [99b8220]
- Updated dependencies [31d2d99]
- Updated dependencies [103c5f5]
- Updated dependencies [8a55f62]
  - @cosmicdrift/kumiko-bundled-features@0.59.1
  - @cosmicdrift/kumiko-framework@0.59.1

## 0.59.0

### Patch Changes

- Updated dependencies [6ea62ca]
  - @cosmicdrift/kumiko-bundled-features@0.59.0
  - @cosmicdrift/kumiko-framework@0.59.0

## 0.58.0

### Patch Changes

- Updated dependencies [9733ddc]
- Updated dependencies [9733ddc]
- Updated dependencies [b02c52e]
- Updated dependencies [0202d38]
- Updated dependencies [a3dcb2c]
- Updated dependencies [625a4e2]
- Updated dependencies [f9897cd]
  - @cosmicdrift/kumiko-bundled-features@0.58.0
  - @cosmicdrift/kumiko-framework@0.58.0

## 0.57.2

### Patch Changes

- Updated dependencies [ea2d54d]
- Updated dependencies [99d4489]
  - @cosmicdrift/kumiko-bundled-features@0.57.2
  - @cosmicdrift/kumiko-framework@0.57.2

## 0.57.1

### Patch Changes

- Updated dependencies [d07ef3f]
  - @cosmicdrift/kumiko-framework@0.57.1
  - @cosmicdrift/kumiko-bundled-features@0.57.1

## 0.57.0

### Patch Changes

- Updated dependencies [2e78232]
  - @cosmicdrift/kumiko-framework@0.57.0
  - @cosmicdrift/kumiko-bundled-features@0.57.0

## 0.56.1

### Patch Changes

- Updated dependencies [a72f3a1]
  - @cosmicdrift/kumiko-bundled-features@0.56.1
  - @cosmicdrift/kumiko-framework@0.56.1

## 0.56.0

### Patch Changes

- Updated dependencies [c9a0ef8]
  - @cosmicdrift/kumiko-framework@0.56.0
  - @cosmicdrift/kumiko-bundled-features@0.56.0

## 0.55.1

### Patch Changes

- Updated dependencies [8ccc145]
  - @cosmicdrift/kumiko-bundled-features@0.55.1
  - @cosmicdrift/kumiko-framework@0.55.1

## 0.55.0

### Patch Changes

- Updated dependencies [17fa9ee]
  - @cosmicdrift/kumiko-framework@0.55.0
  - @cosmicdrift/kumiko-bundled-features@0.55.0

## 0.54.0

### Patch Changes

- Updated dependencies [a565b61]
- Updated dependencies [e7a7809]
- Updated dependencies [b2e3a56]
- Updated dependencies [1135437]
  - @cosmicdrift/kumiko-framework@0.54.0
  - @cosmicdrift/kumiko-bundled-features@0.54.0

## 0.53.0

### Minor Changes

- effc862: run-prod-app / run-dev-app: forward `allowedOrigins` + `unsafeSkipOriginCheck` to buildServer

  `RunProdAppAuthOptions` / `RunDevAppAuthOptions` exposed `cookieDomain` but not
  `allowedOrigins` (or `unsafeSkipOriginCheck`), while the buildServer Origin guard
  (#340) **fails closed** when `cookieDomain` is set without an allowlist. An app
  that widened its session cookie across subdomains therefore could not satisfy the
  guard through `runProdApp`/`runDevApp` — it could only CrashLoop on boot.

  Both fields are now part of the auth options and forwarded into the buildServer
  auth config alongside `cookieDomain`. Proven by a boot test: `cookieDomain` alone
  fails closed through `runProdApp`; `cookieDomain` + `allowedOrigins` clears the
  guard (the allowlist reaches buildServer).

### Patch Changes

- @cosmicdrift/kumiko-framework@0.53.0
- @cosmicdrift/kumiko-bundled-features@0.53.0

## 0.52.0

### Patch Changes

- Updated dependencies [c014f18]
  - @cosmicdrift/kumiko-bundled-features@0.52.0
  - @cosmicdrift/kumiko-framework@0.52.0

## 0.51.0

### Patch Changes

- Updated dependencies [ac282fb]
- Updated dependencies [f51c8a8]
- Updated dependencies [f51c8a8]
- Updated dependencies [b40187f]
  - @cosmicdrift/kumiko-framework@0.51.0
  - @cosmicdrift/kumiko-bundled-features@0.51.0

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

- Updated dependencies [f06e33a]
- Updated dependencies [d8330bc]
- Updated dependencies [8ca4a27]
- Updated dependencies [d8083ae]
- Updated dependencies [eabad73]
- Updated dependencies [6b16dd9]
- Updated dependencies [c5610ea]
  - @cosmicdrift/kumiko-framework@0.50.0
  - @cosmicdrift/kumiko-bundled-features@0.50.0

## 0.49.0

### Patch Changes

- Updated dependencies [5d8b8ca]
- Updated dependencies [5ffbc19]
  - @cosmicdrift/kumiko-framework@0.49.0
  - @cosmicdrift/kumiko-bundled-features@0.49.0

## 0.48.1

### Patch Changes

- Updated dependencies [ec22610]
- Updated dependencies [b8207de]
  - @cosmicdrift/kumiko-framework@0.48.1
  - @cosmicdrift/kumiko-bundled-features@0.48.1

## 0.48.0

### Patch Changes

- Updated dependencies [2852197]
  - @cosmicdrift/kumiko-framework@0.48.0
  - @cosmicdrift/kumiko-bundled-features@0.48.0

## 0.47.0

### Patch Changes

- Updated dependencies [f32f99d]
  - @cosmicdrift/kumiko-bundled-features@0.47.0
  - @cosmicdrift/kumiko-framework@0.47.0

## 0.46.0

### Patch Changes

- Updated dependencies [7751b71]
  - @cosmicdrift/kumiko-framework@0.46.0
  - @cosmicdrift/kumiko-bundled-features@0.46.0

## 0.45.1

### Patch Changes

- Updated dependencies [3053ef8]
  - @cosmicdrift/kumiko-framework@0.45.1
  - @cosmicdrift/kumiko-bundled-features@0.45.1

## 0.45.0

### Patch Changes

- Updated dependencies [2764993]
  - @cosmicdrift/kumiko-bundled-features@0.45.0
  - @cosmicdrift/kumiko-framework@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies [b082294]
  - @cosmicdrift/kumiko-framework@0.44.0
  - @cosmicdrift/kumiko-bundled-features@0.44.0

## 0.43.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.43.0
- @cosmicdrift/kumiko-framework@0.43.0

## 0.42.0

### Patch Changes

- Updated dependencies [81ac289]
  - @cosmicdrift/kumiko-bundled-features@0.42.0
  - @cosmicdrift/kumiko-framework@0.42.0

## 0.41.1

### Patch Changes

- Updated dependencies [1e7a66e]
  - @cosmicdrift/kumiko-framework@0.41.1
  - @cosmicdrift/kumiko-bundled-features@0.41.1

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
  - @cosmicdrift/kumiko-bundled-features@0.41.0

## 0.40.1

### Patch Changes

- Updated dependencies [667c79b]
  - @cosmicdrift/kumiko-framework@0.40.1
  - @cosmicdrift/kumiko-bundled-features@0.40.1

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
  - @cosmicdrift/kumiko-bundled-features@0.40.0

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
- Updated dependencies [12e1137]
  - @cosmicdrift/kumiko-framework@0.39.0
  - @cosmicdrift/kumiko-bundled-features@0.39.0

## 0.38.0

### Patch Changes

- 0f093f1: Review-findings behavior wave (15 findings, incl. 1 High):

  - **framework:** `buildAppSchema` dev-assertion actually fires now — the JSON-roundtrip comparison could never detect leaked functions (both sides drop them identically); replaced with a `findNonJsonSafePath` walker that reports the offending path and treats PlatformComponent slots as opaque (High). TenantDb `readWhere` now permits NARROWING within the enforced `[own, SYSTEM]` scope (callers can exclude SYSTEM reference rows at the DB instead of post-filtering after a limit; widening remains impossible — covered by new where-merge tests). Boot-validator survives a missing `section.component` with the intended boot error instead of crashing. msp-rebuild throws `InternalError` consistently.
  - **headless:** `applyFormatSpec` priority renders its `emptyLabel` ("—") for empty values again instead of collapsing to "" (regression vs. the old callback); `escapeHtmlAttr` escapes `'` (superset of `escapeHtml`, restores the apostrophe-escaping legal-pages had before the dedup).
  - **renderer:** `dispatcherErrorText` passes `error.i18nParams` to translate — placeholders no longer render raw.
  - **dev-server:** SPA fallback also answers HEAD (parity with prod).
  - **bundled-features:** invite-accept checks alreadyMember directly against the memberships projection (the filtered `tenant:query:memberships` made re-invites into disabled tenants hit the unique constraint); template-resolver list excludes SYSTEM rows at the DB (no post-filter starvation of the 500-row limit); custom-fields form: clearing a stored value dispatches `clear-custom-field` and dirty compares against initialValues (covered by new clear-path tests); Stripe env accepts restricted `rk_` keys; tenant-switcher uses `||` so empty names fall back; `inviteEmailMismatch` error factory.

- ffcce8a: Review-findings quick-win sweep (29 findings across 24 PR reviews):

  - framework: `asEntityTableMeta` removed from the `bun-db` barrel (import via `db/query` shim instead — minor because it drops a public export); `toStoredEvent` now exported from the `event-store` barrel; `EventRow.tenantId` typed as `TenantId`; fallback-logger format unified to `[ns] msg` on both paths; search-payload collision warning deduped per entity:key and no longer mislabels contributor-vs-contributor collisions as Stammfield overwrites; `extractTableName` calls in projection-table-index carry an identifying context; `isFormatSpec` without cast; FieldFormatRegistry augmentation example uses the real `engine/types` subpath (verified compiling).
  - dev-server: shared `isKebabSegment` replaces three copies of `KEBAB_RE`; `dispatchSystemWrite` roles use the `ROLES` constant.
  - bundled-features: `isFileProviderPlugin` type guard exported from file-foundation and used instead of the blind cast (provider registration without `build()` now fails with a descriptive error); `enforceStockCap` JSDoc documents the TOCTOU caveat; assorted dead code and stale/misleading comments fixed.
  - headless: applyFormatSpec dev-warning in English.
  - docs: all `*.integration.ts` references corrected to `*.integration.test.ts`; use-all-bundled feature-manifest generation sorts configKeys/secrets deterministically (manifest regenerated).

- Updated dependencies [8becbed]
- Updated dependencies [0f093f1]
- Updated dependencies [ffcce8a]
- Updated dependencies [7a00d80]
  - @cosmicdrift/kumiko-framework@0.38.0
  - @cosmicdrift/kumiko-bundled-features@0.38.0

## 0.37.0

### Patch Changes

- Updated dependencies
  - @cosmicdrift/kumiko-bundled-features@0.37.0
  - @cosmicdrift/kumiko-framework@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies [d84a515]
  - @cosmicdrift/kumiko-framework@0.36.0
  - @cosmicdrift/kumiko-bundled-features@0.36.0

## 0.35.0

### Patch Changes

- Updated dependencies [6553405]
  - @cosmicdrift/kumiko-framework@0.35.0
  - @cosmicdrift/kumiko-bundled-features@0.35.0

## 0.34.2

### Patch Changes

- Updated dependencies [ce4a16f]
  - @cosmicdrift/kumiko-bundled-features@0.34.2
  - @cosmicdrift/kumiko-framework@0.34.2

## 0.34.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.34.1
- @cosmicdrift/kumiko-framework@0.34.1

## 0.34.0

### Patch Changes

- Updated dependencies [9be544f]
  - @cosmicdrift/kumiko-framework@0.34.0
  - @cosmicdrift/kumiko-bundled-features@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [0bb1b92]
  - @cosmicdrift/kumiko-bundled-features@0.33.0
  - @cosmicdrift/kumiko-framework@0.33.0

## 0.32.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.32.1
- @cosmicdrift/kumiko-framework@0.32.1

## 0.32.0

### Patch Changes

- Updated dependencies [05c4447]
- Updated dependencies [0009486]
  - @cosmicdrift/kumiko-framework@0.32.0
  - @cosmicdrift/kumiko-bundled-features@0.32.0

## 0.31.1

### Patch Changes

- Updated dependencies [6f79d05]
  - @cosmicdrift/kumiko-framework@0.31.1
  - @cosmicdrift/kumiko-bundled-features@0.31.1

## 0.31.0

### Patch Changes

- Updated dependencies [b74ddbe]
- Updated dependencies [5b1a594]
  - @cosmicdrift/kumiko-framework@0.31.0
  - @cosmicdrift/kumiko-bundled-features@0.31.0

## 0.30.0

### Patch Changes

- Updated dependencies [00020b4]
  - @cosmicdrift/kumiko-framework@0.30.0
  - @cosmicdrift/kumiko-bundled-features@0.30.0

## 0.29.0

### Patch Changes

- 581b5e9: run-prod-app: static-fallback served index.html nur noch für GET/HEAD — non-GET ohne Hono-Match liefert den Hono-404 durch (vorher 200 index.html, wodurch z.B. falsch konfigurierte Webhook-Endpoints als delivered galten).
- Updated dependencies [f9d41ae]
- Updated dependencies [290a05b]
- Updated dependencies [4398d02]
- Updated dependencies [3186d8a]
  - @cosmicdrift/kumiko-framework@0.29.0
  - @cosmicdrift/kumiko-bundled-features@0.29.0

## 0.28.0

### Minor Changes

- 743db9b: extraRoutes-deps liefern jetzt `registry` + `dispatchSystemWrite` (runProdApp + createKumikoServer/runDevApp) — das Wiring, das `createSubscriptionWebhookHandler` für Provider-Webhook-Routen braucht. Dazu: `KumikoServer`/`ApiEntrypoint`/`TestStack` exponieren den Command-Dispatcher, `createSystemUser` nimmt optionale `extraRoles` (kein Access-Bypass für die system-Rolle — Ziel-Handler gaten auf explizite Rollen wie SystemAdmin).

### Patch Changes

- Updated dependencies [743db9b]
- Updated dependencies [e42fef9]
  - @cosmicdrift/kumiko-framework@0.28.0
  - @cosmicdrift/kumiko-bundled-features@0.28.0

## 0.27.0

### Patch Changes

- Updated dependencies [ea365d1]
  - @cosmicdrift/kumiko-bundled-features@0.27.0
  - @cosmicdrift/kumiko-framework@0.27.0

## 0.26.0

### Patch Changes

- Updated dependencies [ed1ce4b]
- Updated dependencies [b539942]
  - @cosmicdrift/kumiko-bundled-features@0.26.0
  - @cosmicdrift/kumiko-framework@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [924d48c]
  - @cosmicdrift/kumiko-framework@0.25.0
  - @cosmicdrift/kumiko-bundled-features@0.25.0

## 0.24.1

### Patch Changes

- 35d5833: Stop swallowing errors at six review-flagged sites (fail-closed / make visible
  instead of silently dropping).

  - **framework — dispatcher postQuery (single-object result):** a hook that
    returned 0 rows used to fall back to the unhooked original (`rows[0] ?? result`),
    and ≥2 rows silently dropped the extras. A single-object response can only
    carry one row, so this now throws instead of hiding the contract violation.
  - **bundled-features — custom-fields write access-gate:** when a field
    definition row exists but its `serialized_field` is corrupt, the per-field
    `fieldAccess.write` check fell open (`{ ok: true }`) and let the write through
    unvalidated. It now fails closed with `field_definition_corrupt` (secure-by-default).
  - **bundled-features — compliance-profiles override parser:** a corrupt stored
    override is still ignored, but the warning now preserves the parser's failure
    reason instead of flattening it to a generic message.
  - **dev-server — scaffold-deploy:** a malformed `package.json` no longer
    silently skips private-GitHub-package detection; it warns so the
    mis-detection (and a later `yarn install` YN0041) is traceable.

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
- Updated dependencies [b497f4d]
- Updated dependencies [52cd396]
- Updated dependencies [c5fe2ba]
  - @cosmicdrift/kumiko-framework@0.24.1
  - @cosmicdrift/kumiko-bundled-features@0.24.1

## 0.24.0

### Patch Changes

- Updated dependencies [c5b7d99]
  - @cosmicdrift/kumiko-framework@0.24.0
  - @cosmicdrift/kumiko-bundled-features@0.24.0

## 0.23.1

### Patch Changes

- Updated dependencies [88d492a]
  - @cosmicdrift/kumiko-framework@0.23.1
  - @cosmicdrift/kumiko-bundled-features@0.23.1

## 0.23.0

### Patch Changes

- e27b7b7: Fix deploy-template drift after the drizzle→`kumiko schema` cutover. Three stale references in the scaffolded `Dockerfile` + `migrate-step.sh` broke every fresh deploy and would have re-broken existing deploys on the next re-scaffold:

  - `Dockerfile.template` copied `/app/dist-server/drizzle.config.ts`, which the single-bundle server build (0.20.0) no longer emits — Docker `COPY` of a missing source fails hard.
  - `Dockerfile.template` copied `/app/drizzle`, but apps on the new schema pipeline (0.21.0) ship `kumiko/migrations/` instead. The COPY broke for apps without a legacy `drizzle/` directory, and even when it succeeded the SQL the runtime needs (`${INIT_CWD}/kumiko/migrations/*.sql`) was missing. Replaced with `COPY /app/kumiko/migrations ./kumiko/migrations`.
  - `Dockerfile.template` set `ENV KUMIKO_MIGRATION_HOOKS=/app/migration-hooks.js`, pointing at a bundle output that 0.20.0 also dropped. The new `schema apply` path doesn't read this env — removed.
  - `migrate-step.sh.template` invoked `bun /app/kumiko.js migrate apply`, but the CLI registers no `migrate` command — only `schema apply`. The pre-deploy migrate step crashed with `Unknown command: migrate`. Fixed to `bun /app/kumiko.js schema apply`.

  Header comments + `KUMIKO_REPO_ROOT`/`INIT_CWD` annotations rewritten to describe the schema-CLI path instead of drizzle-kit. Two new regression tests in `scaffold-deploy.test.ts` lock the migrate command + pin the kumiko/migrations COPY so this drift can't silently return.

  This corrects the "no deploy change" claim in the 0.20.0 changelog entry: 0.20.0 was a deploy-template change, the templates just hadn't been updated.

- Updated dependencies [e27b7b7]
- Updated dependencies [8289134]
  - @cosmicdrift/kumiko-framework@0.23.0
  - @cosmicdrift/kumiko-bundled-features@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies [dcc8d4c]
- Updated dependencies [edebd91]
- Updated dependencies [dcc8d4c]
- Updated dependencies [4156981]
- Updated dependencies [62bf38b]
  - @cosmicdrift/kumiko-bundled-features@0.22.0
  - @cosmicdrift/kumiko-framework@0.22.0

## 0.21.1

### Patch Changes

- Updated dependencies [0809f08]
  - @cosmicdrift/kumiko-bundled-features@0.21.1
  - @cosmicdrift/kumiko-framework@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [c1a044b]
  - @cosmicdrift/kumiko-framework@0.21.0
  - @cosmicdrift/kumiko-bundled-features@0.21.0

## 0.20.0

### Minor Changes

- 6777250: Server build: bundle all server entries in a single `Bun.build` with code splitting so the framework is emitted once as a shared chunk instead of inlined per entry. `dist-server/` shrinks ~66% (publicstatus ~41 MB → ~14 MB), boot/migrate stay separate entries, no deploy change. Drops the dead drizzle `migration-hooks.js` + `drizzle.config.ts` bundling and the `drizzle-kit`/`drizzle-orm` runtime externals — the migrate path uses `runMigrationsFromDir`.

  Schema migrations: `kumiko schema generate` now writes a `NNNN_<name>.rebuild.json` marker next to each migration listing the changed/new tables, so the apply step can rebuild the affected projections. New helpers `writeRebuildMarker` / `readRebuildMarker` / `rebuildTablesFromDiff` are exported from the `db` entrypoint.

### Patch Changes

- Updated dependencies [6777250]
  - @cosmicdrift/kumiko-framework@0.20.0
  - @cosmicdrift/kumiko-bundled-features@0.20.0

## 0.19.1

### Patch Changes

- a146fc4: Add shared boot-seed contract (`SeedIfExists`, `runEventStoreSeed`) and default skip-if-exists for `seedTextBlock` / `seedComplianceProfile`.
- Updated dependencies [a146fc4]
  - @cosmicdrift/kumiko-framework@0.19.1
  - @cosmicdrift/kumiko-bundled-features@0.19.1

## 0.19.0

### Minor Changes

- 2c84510: migrations: ship an app-facing `kumiko-schema` CLI bin.

  Apps could not run the drizzle-free migration commands: the `kumiko schema`
  subcommands live in the dev CLI, whose registry eager-loads ts-morph-heavy dev
  commands and isn't shipped to apps. This extracts the generate/apply/baseline/
  status core into `@cosmicdrift/kumiko-framework/schema-cli` (`runSchemaCli`) and
  ships a self-contained `kumiko-schema` bin from `@cosmicdrift/kumiko-dev-server`:

      bunx kumiko-schema generate <name>
      bunx kumiko-schema apply
      bunx kumiko-schema baseline   # adopt an existing DB (tables already exist)
      bunx kumiko-schema status

  The dev `kumiko schema` command now delegates to the same core — one
  implementation, no drift.

### Patch Changes

- Updated dependencies [2c84510]
  - @cosmicdrift/kumiko-framework@0.19.0
  - @cosmicdrift/kumiko-bundled-features@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [ff49c38]
  - @cosmicdrift/kumiko-framework@0.18.0
  - @cosmicdrift/kumiko-bundled-features@0.18.0

## 0.17.0

### Minor Changes

- 239e9dc: migrations: drizzle-free boot-gate + repair the `kumiko schema` CLI.

  Phase 1 of the migration-system consolidation (docs/plans/migration-system-consolidation.md):

  - new `assertKumikoSchemaCurrent` / `detectKumikoDrift` boot-gate validates
    `_kumiko_migrations` (applied + checksum) + `kumiko/migrations/.snapshot.json`
    (tables exist), instead of the drizzle journal. `runProdApp` now uses it;
    `options.migrations.dir` default is `./kumiko/migrations`.
  - export the migrate-runner / migrate-generator API from `@cosmicdrift/kumiko-framework/db`
    (`runMigrationsFromDir`, `loadMigrationsFromDir`, `fetchAppliedMigrations`,
    `generateMigration`, `loadSnapshotJson`, …) — the `kumiko schema` CLI imported
    these from the barrel where they were never exported (the command was broken).
  - `kumiko schema status` no longer imports `drizzle-orm`; new `kumiko schema baseline`
    marks checked-in migrations as applied without running their SQL (DB-adoption /
    legacy cutover).

  The legacy drizzle gate (`schema-drift.ts`, `kumiko migrate`) is untouched here and
  removed in Phase 3.

### Patch Changes

- Updated dependencies [239e9dc]
  - @cosmicdrift/kumiko-framework@0.17.0
  - @cosmicdrift/kumiko-bundled-features@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [1dcc743]
- Updated dependencies [9aeabb3]
  - @cosmicdrift/kumiko-framework@0.16.0
  - @cosmicdrift/kumiko-bundled-features@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [79d5891]
- Updated dependencies [5a7f7ac]
  - @cosmicdrift/kumiko-bundled-features@0.15.0
  - @cosmicdrift/kumiko-framework@0.15.0

## 0.14.0

### Minor Changes

- b8e1d48: scaffoldApp baut `src/run-config.ts` + `bin/main.ts` jetzt via ts-morph
  (AST) statt template-strings. Selbes Tool wie scaffoldAppFeature →
  ein konsistenter Mechanismus für generate + later modify. Plus:
  ts-morph als explicit dependency aufgenommen (war bisher nur via
  hoisted root-dep verfügbar; broken bei publish).

### Patch Changes

- ce23d48: `walkthrough.integration.ts` — DX-3.1 walkthrough-snapshot-test. Pins
  scaffoldApp + scaffoldAppFeature output gegen die Behauptungen in
  docs.kumiko.rocks/en/walkthrough/. Catches doc-drift ohne actual
  `bunx … && yarn install && bun run boot` CI-run.

  5 Tests: file-list, auto-mount-diff, run-config text-content,
  composeFeatures(includeBundled:true) = 7 features, bin/main auth.admin
  stub.

  - @cosmicdrift/kumiko-framework@0.14.0
  - @cosmicdrift/kumiko-bundled-features@0.14.0

## 0.13.0

### Minor Changes

- 7bd5c88: `KUMIKO_DRY_RUN_ENV=boot` mode for runProdApp — runs env-validation +
  composeFeatures + validateBoot + createRegistry without DB/Redis
  connect, exits with status 0 on success. Used by the
  `samples/apps/use-all-bundled` smoke-app (Sprint 9.8 Phase C / Empfehlung
  1 / canonical bug-catcher) and downstream by enterprise's
  `use-all-features` mirror. Render-modes (human|json|pulumi|k8s|1)
  behavior unchanged.
- 575752f: `scaffoldAppFeature` + `kumiko add feature <name>` — DX-2 aus DX-Roadmap.
  Scaffolded ein neues Feature in `src/features/<name>/` einer bereits via
  `kumiko new app` scaffolded App + **auto-mountet** es in `src/run-config.ts`
  via ts-morph (import + `APP_FEATURES`-array-entry, idempotent).

  User-Promise "defineFeature → nichts woanders eintragen" erfüllt für die
  run-config-Seite. FEATURE_IMPORT_REGISTRY in drizzle/generate.ts ist
  DX-4's Refactor — bei DX-1+DX-2-App noch nicht vorhanden.

  Usage (in einer DX-1-gescaffoldeten App):

  ```sh
  bunx kumiko add feature product-catalog
  # → src/features/product-catalog/{feature.ts,index.ts}
  # → src/run-config.ts auto-edited: import + APP_FEATURES-entry
  ```

- 3d5e9ef: `kumiko-schema-check` CLI — Empfehlung 3 aus Sprint-9.8-Retro
  (`luminous-watching-moler.md`). Diff't APP_FEATURES (runtime, aus
  `src/run-config.ts`) gegen FEATURE_IMPORT_REGISTRY (statisch, aus
  `drizzle/generate.ts`). Fängt Studio's 9.8-Drama: registry 18 features
  hinter APP_FEATURES → migrations fehlten für mounted features.

  Usage (im app-workspace):

  ```sh
  bunx kumiko-schema-check
  # or with custom paths:
  bunx kumiko-schema-check --run-config src/run-config.ts --generate drizzle/generate.ts
  ```

  Plus: 5 bundled-features hatten camelCase feature-names statt kebab-case
  (Memory `feedback_kebab_aggregates`) — aufgedeckt durch den schema-check
  gegen use-all-bundled. Fix: `channelEmail` → `channel-email`,
  `channelInApp` → `channel-in-app`, `channelPush` → `channel-push`,
  `rateLimiting` → `rate-limiting`, `rendererSimple` → `renderer-simple`.

  Plus `CHANNEL_IN_APP_FEATURE` und `RATE_LIMITING_FEATURE` Konstanten
  angepasst (waren intern auf camelCase, jetzt kebab-case).

- 46b84d0: `scaffoldApp` + `kumiko new app <name>` — DX-1.0 aus DX-Roadmap. Generiert
  ein lauffähiges App-Skelett (package.json, tsconfig, run-config mit
  secrets+sessions, bin/main.ts mit auth-admin-stub + deterministische
  tenant-UUID, .env.example, README) in `<cwd>/<name>/`.

  Boot-Pfad: `KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts` läuft ohne DB/Redis.

  Held-back für spätere DX-Phasen: drizzle-setup (DX-1.1, blocked-by DX-4
  auto-registry), Dockerfile (existing `kumiko init-deploy`), first feature
  scaffold (existing `kumiko create` bzw. DX-2 `kumiko add feature`).

  Usage:

  ```sh
  bunx kumiko new app my-shop
  cd my-shop && yarn install
  cp .env.example .env  # JWT_SECRET + KUMIKO_SECRETS_MASTER_KEY_V1 setzen
  bun run boot          # → boot validation OK
  ```

### Patch Changes

- 2bd60c1: `buildServerBundle` BUILD_ONLY_EXTERNALS erweitert um drizzle-kit's
  dialect-resolver dynamic-imports: `@planetscale/database`, `@libsql/client`,
  `better-sqlite3`, `@neondatabase/serverless`, `@vercel/postgres`, `mysql2`.

  Aufgedeckt durch C1 Empfehlung 4 (bundle-smoke). Bisher schlug
  `bun build` an dynamic-imports im drizzle-kit auch wenn der App nur
  postgres nutzt. Externalisieren = build durchläuft + tree-shake wirft
  die ungenutzten driver-modules eh raus.

- 8bfb284: Dockerfile.template setzt `YARN_ENABLE_SCRIPTS=false` im Build-Stage. Fixt msgpackr-extract native-build-Failures (ARM, CI) und generell jeden transitiven Native-Dep — der Build-Stage bundlet nur JS via `bun build`, Runtime-Native-Deps werden separat im Runtime-Stage via `bun install --production` installiert. Apps die bisher per-package-Workarounds via `dependenciesMeta.<pkg>.built=false` in der App-package.json brauchten (studio, enterprise) können diese Entries nach Upgrade auf diese dev-server-Version entfernen.
- cc0ddc0: `Dockerfile.template` emits an inline `start.sh` for createBunServer command-override target.

  `infra/pulumi/bun-server.ts`'s `createBunServer` overrides the container command with `exec ./start.sh` after injecting DATABASE_URL from the init-container. Apps deployed via createBunServer crashed with `./start.sh: not found` until each one added a per-app `start.sh` in repo root (= studio's PR #22).

  Now the Dockerfile-template emits the file inline (`RUN printf … > ./start.sh && chmod +x`). Apps no longer need to ship one — the runtime stage generates it. Apps that don't go through createBunServer's command-override still boot via the bottom CMD; start.sh is dead-code in that case.

- Updated dependencies [7f56b2f]
- Updated dependencies [68b8118]
- Updated dependencies [9121928]
- Updated dependencies [72518fa]
- Updated dependencies [0a00e7b]
- Updated dependencies [aca1443]
- Updated dependencies [c6cb96c]
- Updated dependencies [3d5e9ef]
  - @cosmicdrift/kumiko-framework@0.13.0
  - @cosmicdrift/kumiko-bundled-features@0.13.0

## 0.12.2

### Patch Changes

- Updated dependencies [597de52]
  - @cosmicdrift/kumiko-framework@0.12.2
  - @cosmicdrift/kumiko-bundled-features@0.12.2

## 0.12.1

### Patch Changes

- Updated dependencies [f2ad7c4]
  - @cosmicdrift/kumiko-framework@0.12.1
  - @cosmicdrift/kumiko-bundled-features@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies [0c1ebe5]
  - @cosmicdrift/kumiko-bundled-features@0.12.0
  - @cosmicdrift/kumiko-framework@0.12.0

## 0.11.2

### Patch Changes

- Updated dependencies [92a84f0]
  - @cosmicdrift/kumiko-framework@0.11.2
  - @cosmicdrift/kumiko-bundled-features@0.11.2

## 0.11.1

### Patch Changes

- Updated dependencies [e6f702f]
  - @cosmicdrift/kumiko-bundled-features@0.11.1
  - @cosmicdrift/kumiko-framework@0.11.1

## 0.11.0

### Patch Changes

- Updated dependencies [30ea981]
- Updated dependencies [9347212]
  - @cosmicdrift/kumiko-framework@0.11.0
  - @cosmicdrift/kumiko-bundled-features@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies [d06f029]
- Updated dependencies [753d392]
  - @cosmicdrift/kumiko-framework@0.10.0
  - @cosmicdrift/kumiko-bundled-features@0.10.0

## 0.9.0

### Minor Changes

- 51e22f5: Add deploy-template scaffolding (Sprint 9.6).

  **New API:**

  - `scaffoldDeploy({ appName, port?, githubOrg?, destination?, force? })` exported from `@cosmicdrift/kumiko-dev-server`. Generates `deploy/Dockerfile`, `deploy/Dockerfile.dockerignore`, and `deploy/migrate-step.sh` from canonical templates shipped with the package. Substitutes `{{appName}}`, `{{port}}`, `{{githubOrg}}` placeholders.
  - New CLI command: `kumiko init-deploy --app <name> [--port <n>] [--github-org <org>] [--out <dir>] [--force]`.

  The templates are extracted from publicstatus's production-tested `deploy/Dockerfile` (node-alpine build stage → bun-alpine runtime, drizzle migrations baked in, healthcheck wired). Refuses to overwrite existing files unless `--force` is passed so a tuned per-app Dockerfile isn't clobbered.

  **Templates are a starting point, not a contract.** Apps should review and adjust:

  - **Image tag** is hardcoded `:latest` in `migrate-step.sh.template`. Swap to `:${BUILD_SHA}` for atomic deploys.
  - **DB defaults** in `migrate-step.sh.template` assume `db user = db name = appName`, host `db`, port `5432`. Adjust to your stack.
  - **`COPY /app/seeds`** assumes the app uses ES-Operations seed migrations. Comment out if your app has no `seeds/` directory (otherwise `docker build` fails).
  - **`docker build`-smoke-test:** the templates run untested against a non-publicstatus app-tree. Verify locally before pushing to CI.

  **Deferred to Sprint 9.7+:** `.github/workflows/build-image.yml.suggested`, `pulumi/secrets-bootstrap.sh`, `pulumi/extraEnv.snippet.ts`.

  **Plan-Doc drift (for 9.9 update):** Plan-Doc-Tabelle nennt `start.sh` (in-container migrate-then-run); diese Implementation liefert `migrate-step.sh` (host-side deploy-pipeline). Beide Konzepte sind gültig — Plan-Doc-Update sollte das klarstellen.

- 37fe758: `scaffoldDeploy()` inspects the app source-tree and emits Dockerfile blocks conditionally (Sprint 9.6 follow-up).

  **Why this exists:** Sprint 9.6's first Dockerfile.template hardcoded `COPY --from=build /app/seeds ./seeds` with a "comment out if you don't use it" note in the changeset. Apps without a `seeds/` directory (e.g. studio.kumiko.rocks) crashed in Docker-build with `failed to compute cache key: "/app/seeds": not found`. Root-cause was a framework issue (template too rigid), not a per-app symptom — the framework should detect what the app actually has.

  **Detection:**

  - `hasSeeds` — `exists(sourceDir/seeds)`. Drives the ES-Ops `COPY ./seeds` block in the runtime stage.
  - `hasPrivateGhPackages` — scan `package.json` `dependencies` + `devDependencies` for any `@cosmicdriftgamestudio/*` entry. Drives the `ARG GITHUB_TOKEN` blocks (multi-stage with explicit re-declaration inside the build-stage) and the `ENV GITHUB_TOKEN=${GITHUB_TOKEN}` re-export before `yarn install --immutable`.

  **Template syntax:** mustache-style block conditionals `{{#flag}}…{{/flag}}` (multi-line via `[\s\S]`, surrounding line stripped on falsy). Plain `{{key}}` placeholder substitution is unchanged.

  **New API:**

  - `ScaffoldDeployOptions.sourceDir?: string` — defaults to `destination`. Lets the caller scaffold into one dir while detecting optional surfaces in another (rare).
  - `ScaffoldDeployResult.detected: { hasSeeds, hasPrivateGhPackages }` — surfaced so the CLI can report what was emitted.

  **6 new tests:** seeds detection (with + without), GH-Packages detection (private + public-only + malformed package.json).

  Sprint 9.6's "starting point not contract" disclaimer in the original changeset is now obsolete for these two surfaces — apps no longer need to manually comment out lines.

### Patch Changes

- Updated dependencies [51e22f5]
  - @cosmicdrift/kumiko-framework@0.9.0
  - @cosmicdrift/kumiko-bundled-features@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies [4b5f91e]
  - @cosmicdrift/kumiko-framework@0.8.1
  - @cosmicdrift/kumiko-bundled-features@0.8.1

## 0.8.0

### Minor Changes

- f34af9a: Add framework-core env-schema (Sprint 9.2, Migration Phase 1).

  **New API:**

  - `frameworkCoreEnvSchema` exported from `@cosmicdrift/kumiko-dev-server` — Zod-object covering the vars read by framework-core: `PORT` (default `"3000"`), `DATABASE_URL`, `REDIS_URL`, `KUMIKO_INSTANCE_ID`, `KUMIKO_SKIP_ES_OPS`. `DATABASE_URL` + `REDIS_URL` carry `.meta({ kumiko: { pulumi: { secret: true } } })` so `KUMIKO_DRY_RUN_ENV=pulumi` emits `--secret` flags. Plus `FrameworkCoreEnv` type via `z.infer`. `NODE_ENV` is excluded: build-prod-bundle inlines it as a literal at build-time (esbuild define), so runtime env-validation can't observe it.
  - `composeEnvSchema({ core, features, extend, optionalFeatures })` accepts a new `core?` option. Keys from `core` are tagged with source `"framework-core"` in the resulting sources map and in `KumikoBootError.format()` output. Conflict detection runs across core/features/extend — a feature or `extend` block that re-declares a core var throws `KumikoBootError` at compose-time.

  **Why:** Phase 1 of the Sprint 9 env-schema migration (`kumiko-studio/docs/plans/sprint-9-env-schemas.md`). Apps wire `composeEnvSchema({ core: frameworkCoreEnvSchema, features, extend })` into `runProdApp` to get aggregated boot-validation for the vars that framework-core reads. `KUMIKO_DRY_RUN_ENV=pulumi|k8s` then enumerates them with source attribution per row — operators see "(framework-core)" next to `DATABASE_URL` rather than guessing whether the framework or the app is the consumer.

  **Backward-compat:** Purely additive. `runProdApp`'s existing `requireEnv("DATABASE_URL")` / `process.env["KUMIKO_INSTANCE_ID"]` reads remain unchanged. Apps that don't pass `envSchema` behave exactly as before.

  **Feature-specific vars (Phase 2):** `JWT_SECRET` (auth-email-password), `KUMIKO_SECRETS_MASTER_KEY_*` (secrets), `SMTP_*` (channel-email-smtp), `STRIPE_*` / `MOLLIE_*` (subscription-\*) stay scoped to their owning feature's `r.envSchema()` and are NOT in `frameworkCoreEnvSchema`.

- dff4123: Add Zod-based env-schema declarations and boot-time validation (Sprint 9.1).

  **New API:**

  - `r.envSchema(z.object({...}))` — declare per-feature env-vars at registration time.
  - `@cosmicdrift/kumiko-framework/env`: `composeEnvSchema({features, extend, optionalFeatures})` merges feature schemas into one app-wide schema, returning `{schema, sources}`. `parseEnv(schema, env, {sources, pulumiPrefix})` validates `process.env` and throws `KumikoBootError` listing ALL problems at once (aggregated, not first-fail).
  - `@cosmicdrift/kumiko-framework/env/dry-run`: `renderDryRun(composed, mode, opts)` for `human|json|pulumi|k8s` introspection of the required env-vars without booting.
  - `runProdApp({envSchema, pulumiPrefix, bootErrorReporter, envSource})` runs schema validation before any DB/Redis connection. `KUMIKO_DRY_RUN_ENV=1|human|json|pulumi|k8s` prints the inventory and exits.
  - Per-var metadata via Zod's `.meta({ kumiko: { pulumi: { name, generator, secret } } })` for deploy-time tooling overrides.

  **Backward-compat:** Apps without `envSchema` keep working — existing `requireEnv("DATABASE_URL")` calls in `runProdApp` are untouched. Sprint-9.2-9.5 migrates framework + bundled-features + apps to schema-only env handling.

  **Why:** 2026-05-21 Studio deploy stacked 7 hacks chasing missing env-vars (10+ pipeline-fail iterations, ended in rollback). Schema-first boot validation surfaces ALL misconfigs upfront with `pulumi config set …` suggestions, replacing the discover-by-failing loop with a single dry-run + secrets-bootstrap pass.

### Patch Changes

- Updated dependencies [145b8df]
- Updated dependencies [f34af9a]
- Updated dependencies [dff4123]
  - @cosmicdrift/kumiko-bundled-features@0.8.0
  - @cosmicdrift/kumiko-framework@0.8.0

## 0.7.0

### Minor Changes

- bcf43b6: es-ops: `SeedMembershipRow` exposes `streamTenantId` (stream-tenant aus `kumiko_events.v1`) neben dem payload-`tenantId`. Seed-Authors müssen den `kumiko_events`-JOIN nicht mehr selbst bauen — `m.streamTenantId` ist der korrekte Wert für `systemWriteAs`'s `tenantIdOverride` wenn das Aggregate von einem fremden Executor angelegt wurde (typisches `seedTenantMembership(by=systemAdmin)`-Pattern).

### Patch Changes

- Updated dependencies [bcf43b6]
  - @cosmicdrift/kumiko-framework@0.7.0
  - @cosmicdrift/kumiko-bundled-features@0.7.0

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
  - @cosmicdrift/kumiko-bundled-features@0.6.0

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
  - @cosmicdrift/kumiko-bundled-features@0.5.2

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
  - @cosmicdrift/kumiko-bundled-features@0.5.1

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
  - @cosmicdrift/kumiko-bundled-features@0.5.0

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
  - @cosmicdrift/kumiko-bundled-features@0.4.1

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
  - @cosmicdrift/kumiko-bundled-features@0.4.0

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
  - @cosmicdrift/kumiko-bundled-features@0.3.0

## 0.2.3

### Patch Changes

- Updated dependencies [1dbd038]
  - @cosmicdrift/kumiko-bundled-features@0.2.3
  - @cosmicdrift/kumiko-framework@0.2.3

## 0.2.2

### Patch Changes

- 7a7da3e: Re-publish 0.2.1 → 0.2.2 mit korrekt aufgelösten cross-package-Versionen.
  0.2.1 hatte `workspace:*` als Wert in den dependencies (npm publish ohne
  yarn-pack rewrite), Konsumenten bekamen "Workspace not found".

  publish-with-oidc.sh nutzt jetzt `yarn pack` (rewrited workspace:\*) +
  `npm publish <tarball>` (OIDC + provenance).

- Updated dependencies [7a7da3e]
  - @cosmicdrift/kumiko-framework@0.2.2
  - @cosmicdrift/kumiko-bundled-features@0.2.2

## 0.2.1

### Patch Changes

- 48b7f6a: CI: switch publish to npm-CLI with OIDC Trusted Publishing + provenance.
  No source changes — verifies the new publish path produces a verified-
  provenance attestation on npmjs.com instead of token-based publish.
- Updated dependencies [48b7f6a]
  - @cosmicdrift/kumiko-framework@0.2.1
  - @cosmicdrift/kumiko-bundled-features@0.2.1

## 0.2.0

### Minor Changes

- 6c70b6f: fix(tenant): seedTenant idempotent gegen Event-Store-Projection-Drift.

  Verhindert version_conflict beim App-Boot wenn Aggregat existiert aber
  Projection-Row fehlt (rebuild-drift, async-lag, manueller DB-Eingriff).

### Patch Changes

- Updated dependencies [6c70b6f]
  - @cosmicdrift/kumiko-framework@0.2.0
  - @cosmicdrift/kumiko-bundled-features@0.2.0

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
  - @cosmicdrift/kumiko-bundled-features@0.1.0
