# @cosmicdrift/kumiko-renderer-web

## 0.353.0

### Minor Changes

- a9ab2be: Stacked-area charts get a brush to drag the visible window, and the widget takes range presets itself

  The `stacked-area` dashboard panel accepts `brush: true`: a scrubber under the plot shows the whole series and lets the user drag or resize the visible window. Without `ranges` the window starts at today. A dragged window deselects the range switch, a range click resets the brush. The exported `StackedAreaChart` widget takes `ranges` and `brush` directly and renders its own range switch, so an app chart sets two props instead of carrying window logic. Panels and widgets without the new props render as before.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: The stacked-area panel and the StackedAreaChart widget accept brush and ranges, with the window anchored at today
  -->

### Patch Changes

- 8be6e6e: `buildNavRegistrySliceForApp` is now exported from the package entry next to `buildNavRegistrySlice`, so consumers can build the multi-feature nav slice from an `AppSchema`

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: buildNavRegistrySliceForApp is exported from the renderer-web entry
  -->

- 4c9cf19: Tabs-mode section descriptions render again, Save stays disabled on an untouched projectionDetail with extensions, select radiogroups and tab triggers no longer reference missing elements

  In `layout.mode: "tabs"` a fields section's `description` is shown as the card subtitle instead of being dropped. A projectionDetail without a fields section whose extension registers with the form host no longer shows an always-active Save. A select rendered as radio group outside a `Field` is named via `aria-label` instead of a dangling `aria-labelledby`, tab triggers drop the `aria-controls` that pointed at a tabpanel the strip never renders, and card-list meta items are pinned to one line height so the two-line clamp cuts between lines.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Tabs-mode section descriptions, disabled Save on untouched projectionDetail extensions and radiogroup/tab ARIA references are fixed
  -->

- 50f6ccb: Number inputs no longer keep a typed prefix, secretMint honours tenant currency, refEntity respects real field types

  A `NumberInput` draft that does not parse ("12abc", "12,5" on an integer field) now clears the value instead of leaving the last parseable prefix ("12") to be submitted. A `secretMint` screen with `currency: { kind: "tenant" }` money fields now waits for the tenant currency in both the mint and the confirm step, like `actionForm`, instead of seeding a bare `0`. `refEntity` on an `entityList` column or `entityEdit` field no longer overrides a real non-text entity field (a multi-reference stays multi, a sortable column stays sortable). The Tailwind scan skips compiled `__tests__` in `dist`.

  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: secretMint with tenant currency waits for the tenant currency in mint and confirm step
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: NumberInput clears an unparseable draft instead of keeping the last parseable prefix
  -->

  <!-- kumiko-changes
  feature: headless
  type: fix
  title: refEntity no longer overrides a real non-text entity field on list columns and edit fields
  -->

- d32c9b3: Stricter boot checks and role projection for screens and handlers

  Inline handler registration without `options.access` now throws immediately, a section with `fields: []` and `groups: []` fails boot, and unknown tones in `header.statusTones` or select `optionTones` fail boot instead of dropping the badge colour. The renderer falls back to the value heuristic for an unknown tone, and `statusToneForOptionTone` now returns `undefined` for it. `secretMint` confirm-step actions are stripped for roles that cannot see the target screen.

  Entity convention `create` handlers keep tenant-filtered lookups even when the handler declares `escapeHatch`/`crossTenant`. Duplicate `waitForEvent` steps on the same `awaits` event are rejected when the workflow pipeline is built. An empty `PROMETHEUS_METRICS_TOKEN` counts as unset instead of failing boot.

  `GET /api/sse` now closes itself when the JWT it was opened with expires. File uploads must attach to a registered file field (a non-file field answers 400 `unresolvable_field`), and a `.docx` upload must be a ZIP containing `word/` entries. Signature extra routes outside `/api` get the request-body cap (`maxRequestBytes`) before their body is read. `EXT_USER_DATA` registrations with neither an export nor a delete hook fail boot. The dashboard updated-at stamp follows live refetches and retries.

  Text fields accept `minLength` (enforced by the generated write schema), `enumOption` renders array values per entry, list columns can opt out of sorting with `sortable: false`, and `BUILT_IN_MEMBERSHIP_ROLES` exposes the ranked membership roles. The PAT list translates its scopes column, MFA code fields enforce their minimum length, plan checkout no longer repeats the billing-enabled and active-subscription gates.

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Unknown status tones fail boot and secretMint confirm actions respect role gating
  -->

  `jobs:query:list` (job-runs screen) now pages with a `cursor` and returns `nextCursor` while older runs exist. Ledger `create-transaction` requires `subjectType` and `subjectId` together and rejects empty strings (also on schedule fields). The form-draft sweep re-check is tenant-scoped. A workflow run resumed without a stored definition fingerprint logs a warning.

  `EventDef.piiFields` is now required in the type, screen definitions accept only `agent: { expose }` (`AgentScreenHints`), and `FormController.validate(scope)` rejects field names that the form values do not have. The dedupe doc and the security-baseline recipe note that late-bound state (sessions auto-revoke) binds on the kept instance.

  A text or longText field with `multiline.rows` that is not a positive integer now fails the app-schema build with the entity or screen and field name instead of silently rendering four rows. List columns of type multiSelect render one pill per value like select columns. `config:query:values` accepts an optional `keys` list, and the tenant-currency lookup of money fields asks for its one key only.

  `createKumikoApp` accepts `schemaUrl` for the schema fetch when the API lives on another origin than the SPA (a cross-origin URL is fetched with `credentials: "include"`). List select cells and a danger `Dialog` now follow the registered primitives: select pills use the registered `StatusBadge`, and a danger dialog focuses Cancel by default. Form drafts no longer store fields marked `sensitive: true`.

  German and Spanish translations for `jobs.errors.invalidCursor` were missing.

  The release workflow waits for npm `latest` only on the packages the changesets run actually published and skips packages published under another dist-tag. `check:dist` compiles the installed `styles.css` and fails when classes from renderer-web or the renderer's compiled dist are missing.

- Updated dependencies [3932e47]
- Updated dependencies [f05c4e7]
- Updated dependencies [4ec1c59]
- Updated dependencies [0609d09]
- Updated dependencies [4c9cf19]
- Updated dependencies [50f6ccb]
- Updated dependencies [d32c9b3]
- Updated dependencies [a9ab2be]
- Updated dependencies [b5466a7]
  - @cosmicdrift/kumiko-framework@0.353.0
  - @cosmicdrift/kumiko-types@0.353.0
  - @cosmicdrift/kumiko-renderer@0.353.0
  - @cosmicdrift/kumiko-headless@0.353.0
  - @cosmicdrift/kumiko-dispatcher-live@0.353.0

## 0.352.0

### Minor Changes

- b905d4b: Stat groups take a span, and a labeled group sizes its columns to its values

  `stat-group` panels accept `span: "half" | "full"` like chart, list, feed and progress-list panels; without it a group still takes the full row. A labeled group lays out one column per value up to three, so a group with two values no longer leaves an empty third column and a single value takes the whole card width. To color a value and its icon chip by result (for example by sign), return a tone from `toneField` and leave `accentColor` unset; the chip then follows the tone.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Stat group span and column count
  detail: Set span: "half" on a stat-group to place two groups side by side.
  -->

- 9fb0657: Select options can be disabled per tenant, and the tier-engine gates them on write

  A select option in the `select` primitive takes `disabled`, with the existing `description` as the hint. `renderer-web` mutes a disabled option and does not let it be chosen in the dropdown, the radio list, the radio cards and the segmented control; the dropdown appends the hint to the label in parentheses, the radio variants show it as the description line.

  `SelectFieldDef.optionsAvailabilityQuery` names a query that returns `{ rows: { value, disabled?, hint? }[] }`. The renderer loads it, resolving `optionsQueryPayload` like `optionsQuery` does, and merges it onto the static `options`: `disabled` disables the option, `hint` becomes its description. Static options stay authoritative, rows for unknown values are ignored, and the currently stored value always stays enabled so a downgraded tenant keeps seeing it. The field is also allowed on entity fields, and boot fails when the query is not a registered query handler.

  `createTierOptionGate` in the tier-engine takes the ascending tier order, `capsForTier` and `resolveTier`. Its `optionAvailability` builds the rows for such a query (an option the current tier does not allow is disabled and its hint names the lowest tier that allows it), and `withTierOptionGate` rejects a disallowed option on write with `UnprocessableError(code, { i18nKey, details: { field, value, requiredTier } })`. An update that resends the unchanged stored value of a no longer allowed option passes when the spec names the entity `table`. The wrapper spreads the wrapped handler, so `withCapEnforcement` and rate limits keep working.

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: SelectFieldDef.optionsAvailabilityQuery marks static select options as unavailable per tenant
  detail: The query returns { rows: { value, disabled?, hint? }[] }; the renderer merges it onto options and keeps the stored value enabled.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot validation and the client schema cover select optionsAvailabilityQuery on entity and screen fields
  -->

  <!-- kumiko-changes
  feature: headless
  type: improvement
  title: Edit view-model carries selectOptionsAvailabilityQuery for select fields
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Select inputs accept disabled options and load their availability from optionsAvailabilityQuery
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Disabled select options are muted and not choosable in dropdown, radio list, radio cards and segmented control
  -->

  <!-- kumiko-changes
  feature: tier-engine
  type: improvement
  title: createTierOptionGate builds the availability rows and gates select options by tier on write
  detail: withTierOptionGate rejects a disallowed option with the lowest tier that allows it and lets an unchanged stored value pass on update.
  -->

### Patch Changes

- e05c143: Navs whose parent does not exist in the app schema are dropped, transitively, instead of being promoted to the top level. A role-projected schema no longer shows an adopted child nav (e.g. AI providers for a TenantAdmin) when its parent section is system-admin only. Children whose parent exists but is filtered out by a workspace allowlist still surface at the top level.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: The sidebar drops navs whose parent is missing from the role-projected schema instead of promoting them to the top level
  -->

- Updated dependencies [9fb0657]
- Updated dependencies [9fb0657]
- Updated dependencies [b905d4b]
- Updated dependencies [9fb0657]
- Updated dependencies [9fb0657]
- Updated dependencies [9fb0657]
  - @cosmicdrift/kumiko-framework@0.352.0
  - @cosmicdrift/kumiko-types@0.352.0
  - @cosmicdrift/kumiko-headless@0.352.0
  - @cosmicdrift/kumiko-renderer@0.352.0
  - @cosmicdrift/kumiko-dispatcher-live@0.352.0

## 0.351.0

### Minor Changes

- 44be746: Dashboard panel gates, stat-group subtitle, progress sub line, stacked-area lines, marker kinds and ranges

  `stat`, `stat-group`, `chart`, `list`, `feed` and `progress-list` panels take `visibleWhen` (`DashboardPanelGate`), like `screen` panels. The gate query gets the screen filter and time range. The panel renders nothing while the gate loads or is unmet, and shows an error with retry when the gate query fails. Panels with the same gate query and payload share one live request. The boot validator checks the gate query and field and rejects `visibleWhen` on stat-group children.

  A labeled `stat-group` takes a `subtitle`. In an unlabeled group (KPI strip) each child keeps its `icon` and `accentColor`. `progress-list` rows take an optional `sub` (`DashboardText`) shown under the bar.

  `stacked-area` results can carry `lines` (`{ key, label, points, dashed? }`, drawn unstacked over the bands) and `markers[].kind`. New chart options: `seriesColors` (key to CSS color, wins over `seriesTones`), and only for stacked-area `markerKinds` (kind to `{ tone }` or `{ color }`: colored pin plus dashed guide line), `legendTotals: false` and `ranges` (a range switch in the panel header that windows bands, lines and markers by `months`). `StackedAreaChart` gets `lines`, `colors` and `showLegendTotals`; `ChartMarker` gets `color`.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Dashboard panels take visibleWhen; stat-group subtitle and strip icons, progress-list sub line, stacked-area lines, markerKinds, seriesColors, legendTotals and ranges
  -->

### Patch Changes

- b3ea111: Tabbed projectionDetail panels taller than the viewport scroll again

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Tabbed projectionDetail panels taller than the viewport scroll again
  -->

- 44be746: One Temporal implementation: `@cosmicdrift/kumiko-types/temporal`

  The new export returns the native `globalThis.Temporal` when the runtime has it (Bun 1.4, current browsers) and falls back to `temporal-polyfill` otherwise, installing it on `globalThis`. Framework, bundled features and renderers import from there, so values made by the framework pass `instanceof` and `z.instanceof(Temporal.Instant)` checks in app code. `ensureTemporalPolyfill()` puts the same instance on the global. Apps should import `Temporal` from `@cosmicdrift/kumiko-types/temporal` instead of `temporal-polyfill`.

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: New @cosmicdrift/kumiko-types/temporal export resolves one Temporal (native first, polyfill as fallback) for framework and app code
  migration: Replace imports from "temporal-polyfill" with "@cosmicdrift/kumiko-types/temporal" so app code and framework share one set of Temporal classes.
  -->

- Updated dependencies [44be746]
- Updated dependencies [44be746]
- Updated dependencies [44be746]
- Updated dependencies [44be746]
  - @cosmicdrift/kumiko-types@0.351.0
  - @cosmicdrift/kumiko-framework@0.351.0
  - @cosmicdrift/kumiko-headless@0.351.0
  - @cosmicdrift/kumiko-renderer@0.351.0
  - @cosmicdrift/kumiko-dispatcher-live@0.351.0

## 0.350.0

### Minor Changes

- 80ca7d3: Responsive row actions, Lightbox actions, navigate with search params, fresh facet counts

  `RowActionDisplay` gets `"responsive"`: a labelled button with icon in the table (768px and up), icon only in the narrow card layout with the label as accessible name. Without an icon it stays a button. Existing values keep their look. Below 768px, icon-only row actions and the row expand arrow have a 44px touch target.

  `Lightbox` takes `actions` (nodes in the top-left corner, e.g. a download button) and `showPosition` (default `true`; `false` hides the `{current} / {total}` counter).

  `NavApi.navigate`, `replace` and `hrefFor` take an optional `{ searchParams }` (`NavigateOptions`). Without it the query is dropped as before. `listFilterUrlKey(screenId, field)` builds the URL key a list reads a facet filter from.

  Facet chip counts refetch after a write from a row action, toolbar action, drawer or expanded row, and follow the entity's live events. Before, they kept the count from the first load.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Row actions with display "responsive", Lightbox actions and showPosition, navigate with searchParams, facet counts refresh after writes
  -->

### Patch Changes

- Updated dependencies [80ca7d3]
  - @cosmicdrift/kumiko-types@0.350.0
  - @cosmicdrift/kumiko-renderer@0.350.0
  - @cosmicdrift/kumiko-framework@0.350.0
  - @cosmicdrift/kumiko-headless@0.350.0
  - @cosmicdrift/kumiko-dispatcher-live@0.350.0

## 0.349.0

### Minor Changes

- 6e850b8: Dashboard panels: translatable texts, currency format, scrollable stacked-area

  Query handlers can send `{ i18nKey, i18nParams? }` (`DashboardI18nText`) wherever a dashboard panel shows text: stat value and sub line, feed `primary`/`trailing`, progress-list `label`/`value`, chart marker labels. Plain strings are shown unchanged. Params may be strings, numbers, nested `DashboardI18nText` (resolved first, e.g. a duration built from two plural keys), `{ kind: "money", amountMinor, currency }` (user locale) or `{ kind: "date", atMs }` (medium date, user time zone).

  `valueFormat: { kind: "currency", currency, fractionDigits? }` on stat and chart panels formats minor-unit values as currency in stat values, y ticks, legend totals and tooltips. `scrollable: true` on a `stacked-area` chart gives each bucket a fixed width, scrolls the plot horizontally with the y ticks fixed on the left, and opens at "today". The boot validator rejects an invalid currency code, `fractionDigits` outside 0..4 and `scrollable` on other chart kinds. `formatMoney` takes an optional `fractionDigits`.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Dashboard panel texts are translatable (i18nKey/i18nParams with nested, money and date params), panels get a currency valueFormat and stacked-area charts can scroll
  -->

### Patch Changes

- Updated dependencies [6e850b8]
- Updated dependencies [6e850b8]
  - @cosmicdrift/kumiko-types@0.349.0
  - @cosmicdrift/kumiko-framework@0.349.0
  - @cosmicdrift/kumiko-renderer@0.349.0
  - @cosmicdrift/kumiko-headless@0.349.0
  - @cosmicdrift/kumiko-dispatcher-live@0.349.0

## 0.348.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.348.1
- @cosmicdrift/kumiko-types@0.348.1
- @cosmicdrift/kumiko-dispatcher-live@0.348.1
- @cosmicdrift/kumiko-headless@0.348.1
- @cosmicdrift/kumiko-renderer@0.348.1

## 0.348.0

### Minor Changes

- 0c0c4d2: ModeSwitch pill variant and LanguageSwitcher chip variant

  `ModeSwitch` gets `variant="pill"` (grey track, raised active segment, dark mode aware) and a `className` prop; `outline` stays the default. `LanguageSwitcher` gets `variant="chip"`, a compact monospace chip with the uppercase locale code in a border; `default` stays as it was.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: ModeSwitch gains a pill variant and className, LanguageSwitcher gains a compact chip variant
  -->

- 0c0c4d2: TimeseriesChart: height, y-axis gridlines and a date axis

  `height` (px) replaces the fixed `h-16`; without it the chart looks as before. `yAxis: { ticks, format? }` draws that many gridlines with rounded value labels (0/200/400/600) in a left gutter, and the y-scale reaches the top tick. `xAxis: { ticks, format }` renders n evenly spaced date labels instead of the fixed start/mid/end of `axisLabels`.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: TimeseriesChart takes a height, an optional y-axis with gridlines and a date axis with n labels
  -->

### Patch Changes

- Updated dependencies [400490e]
- Updated dependencies [d7fd7e0]
- Updated dependencies [0c0c4d2]
- Updated dependencies [0c0c4d2]
- Updated dependencies [0c0c4d2]
  - @cosmicdrift/kumiko-framework@0.348.0
  - @cosmicdrift/kumiko-types@0.348.0
  - @cosmicdrift/kumiko-renderer@0.348.0
  - @cosmicdrift/kumiko-headless@0.348.0
  - @cosmicdrift/kumiko-dispatcher-live@0.348.0

## 0.347.0

### Patch Changes

- a35ad24: A locked screen's fallback shows no breadcrumb

  When `visibleWhen` is unmet, the route still names the locked screen, so the shell header kept that screen's breadcrumb above the fallback or the unavailable notice. The gate now mounts `<PageHeader hideBreadcrumb />`, and the shell header drops the breadcrumb while it is mounted. Embedded screens (dashboard panels, drawers) are not affected.

  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: The shell header drops the locked screen's breadcrumb while a visibleWhen fallback or notice is shown
  -->

- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [69c182c]
  - @cosmicdrift/kumiko-types@0.347.0
  - @cosmicdrift/kumiko-renderer@0.347.0
  - @cosmicdrift/kumiko-framework@0.347.0
  - @cosmicdrift/kumiko-headless@0.347.0
  - @cosmicdrift/kumiko-dispatcher-live@0.347.0

## 0.346.0

### Patch Changes

- Updated dependencies [6b8dde4]
  - @cosmicdrift/kumiko-framework@0.346.0
  - @cosmicdrift/kumiko-types@0.346.0
  - @cosmicdrift/kumiko-headless@0.346.0
  - @cosmicdrift/kumiko-renderer@0.346.0
  - @cosmicdrift/kumiko-dispatcher-live@0.346.0

## 0.345.0

### Patch Changes

- Updated dependencies [cef5fa0]
- Updated dependencies [07495cf]
- Updated dependencies [07495cf]
- Updated dependencies [07495cf]
- Updated dependencies [c325eb2]
  - @cosmicdrift/kumiko-framework@0.345.0
  - @cosmicdrift/kumiko-headless@0.345.0
  - @cosmicdrift/kumiko-renderer@0.345.0
  - @cosmicdrift/kumiko-dispatcher-live@0.345.0
  - @cosmicdrift/kumiko-types@0.345.0

## 0.344.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.344.0
- @cosmicdrift/kumiko-types@0.344.0
- @cosmicdrift/kumiko-dispatcher-live@0.344.0
- @cosmicdrift/kumiko-headless@0.344.0
- @cosmicdrift/kumiko-renderer@0.344.0

## 0.343.0

### Minor Changes

- 6adca33: Screens take `visibleWhen` and `fallback`. Every screen definition accepts an optional `visibleWhen: { query, field, eq }` (the same `DashboardPanelVisibility` as dashboard screen panels) and an optional `fallback` (same-feature short id or `<feature>:screen:<id>`). `KumikoScreen` evaluates the condition before the screen content mounts, so it also applies when the screen is opened by URL. While the query loads only a loading banner shows. If the condition is not met or the query fails, the fallback screen renders, or without a fallback a standard notice (`kumiko.screen.unavailable`, en/de/es). The gate is UI only; handlers still enforce access. The boot validator checks the query, the output field and the fallback screen, and rejects a `fallback` without `visibleWhen`. Panels with `visibleWhen` behave as before and share the new `evalVisibleWhen` helper exported from the renderer.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Screens take visibleWhen and fallback
  detail: |
    Any screen can gate itself on a query field with `visibleWhen`, including on direct URL access. Unmet or failed conditions render the `fallback` screen or a standard notice instead of the content. New i18n key: `kumiko.screen.unavailable`.
  -->

### Patch Changes

- Updated dependencies [23b0bec]
- Updated dependencies [446b714]
- Updated dependencies [cf6d31b]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [d32e123]
- Updated dependencies [6adca33]
- Updated dependencies [cf6d31b]
- Updated dependencies [446b714]
  - @cosmicdrift/kumiko-framework@0.343.0
  - @cosmicdrift/kumiko-types@0.343.0
  - @cosmicdrift/kumiko-renderer@0.343.0
  - @cosmicdrift/kumiko-headless@0.343.0
  - @cosmicdrift/kumiko-dispatcher-live@0.343.0

## 0.342.0

### Minor Changes

- e7f2d36: Banner takes title, titleTestId and variant "primary"

  `BannerProps` gets `title` (bold heading above the text), `titleTestId` and the variant `"primary"` for call-to-action notices: left accent in the primary color, neutral background, `actions` right of the text on wide screens and below it on narrow ones. Existing variants render unchanged.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Banner gets title, titleTestId and variant "primary"
  -->

- e7f2d36: TimeseriesChart and StackedAreaChart draw a single value; LanguageSwitcher takes triggerContent

  `TimeseriesChart` and `StackedAreaChart` show `emptyContent` only when there is no value at all. With exactly one value they draw a point at the horizontal centre with the y-scale widened around it, so it no longer sits on the edge. `LanguageSwitcher` takes `triggerContent: "code" | "label" | "icon-only"` (default `"code"`); `"label"` shows the label of the active locale in the trigger. `aria-label` and `title` are unchanged.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Single-value timeseries point and LanguageSwitcher triggerContent
  -->

### Patch Changes

- Updated dependencies [e7f2d36]
- Updated dependencies [0978e85]
- Updated dependencies [e7f2d36]
- Updated dependencies [0978e85]
- Updated dependencies [0978e85]
  - @cosmicdrift/kumiko-renderer@0.342.0
  - @cosmicdrift/kumiko-framework@0.342.0
  - @cosmicdrift/kumiko-headless@0.342.0
  - @cosmicdrift/kumiko-dispatcher-live@0.342.0
  - @cosmicdrift/kumiko-types@0.342.0

## 0.341.0

### Patch Changes

- 995c089: `DefaultAppShell` and `WorkspaceShell` render exactly one `main` landmark. `SidebarInset` is now a `div`, so the shell's own `main` around the screen content is the only one, and the `ShellHeader` sits outside it. Screen readers no longer announce two main regions, and `getByRole("main")` in E2E tests matches a single element.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: App shells render a single main landmark
  -->

- Updated dependencies [610201f]
- Updated dependencies [c5a7dc2]
- Updated dependencies [82309a5]
- Updated dependencies [c2c7862]
- Updated dependencies [610201f]
- Updated dependencies [37c0974]
- Updated dependencies [e7dbdb6]
- Updated dependencies [1feae69]
- Updated dependencies [dba5100]
- Updated dependencies [c5e6814]
- Updated dependencies [8443f22]
- Updated dependencies [1f0a63b]
- Updated dependencies [37c0974]
  - @cosmicdrift/kumiko-framework@0.341.0
  - @cosmicdrift/kumiko-types@0.341.0
  - @cosmicdrift/kumiko-renderer@0.341.0
  - @cosmicdrift/kumiko-headless@0.341.0
  - @cosmicdrift/kumiko-dispatcher-live@0.341.0

## 0.340.0

### Patch Changes

- Updated dependencies [483bb16]
  - @cosmicdrift/kumiko-framework@0.340.0
  - @cosmicdrift/kumiko-types@0.340.0
  - @cosmicdrift/kumiko-headless@0.340.0
  - @cosmicdrift/kumiko-renderer@0.340.0
  - @cosmicdrift/kumiko-dispatcher-live@0.340.0

## 0.339.0

### Minor Changes

- d5b87a1: Both framework lightboxes can now page through several images. The React `Lightbox` primitive accepts `images`, `index` and `onIndexChange` as an alternative to `src`/`alt`, and the Apex marketing lightbox walks all `.shot-frame` screenshots on the page. Both wrap around at the ends and respond to the arrow keys.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Lightbox pages through multiple images
  detail: |
    `LightboxProps` is now a union: the existing `src`/`alt` form is unchanged, and the new `images` + `index` + `onIndexChange` form renders previous/next buttons, a position counter and ArrowLeft/ArrowRight navigation with wrap-around when more than one image is given. The Apex lightbox collects every `.shot-frame img` on open and gains previous/next buttons; its CSP script hash changed. New i18n keys: `kumiko.lightbox.previous`, `kumiko.lightbox.next`, `kumiko.lightbox.position`.
  -->

- b4c15f6: Theme mode auto follows prefers-color-scheme

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Theme preference auto follows the OS color scheme live; ThemeToggle and ThemeMenuItem step through light, dark and auto, a stored choice wins, and defineAppTheme accepts defaultColorScheme
  migration: |
    Apps with a theme-restore inline script in their host HTML must update it. The toggle can now store "auto", which an old script that only checks for "dark" treats as light, so dark-mode users see a light flash on load. Use the script from the comment in renderer-web tokens.ts, which also handles "auto" via matchMedia. Under a strict CSP, update the script hash or keep the nonce.
  -->

- 10e84fb: Build info is baked into index.html as a meta tag instead of an inline script

  <!-- kumiko-changes
  feature: server-runtime
  type: fix
  title: Prod builds no longer inject an inline script for the build info, so strict CSPs without unsafe-inline work without hashes or nonces
  migration: |
    window.__KUMIKO_BUILD__ no longer exists. Code that read it (for example a version footer) now gets undefined and silently renders nothing. Replace the global with readLoadedBuild() from @cosmicdrift/kumiko-renderer-web, which returns { id, builtAt } from the new <meta name="kumiko-build"> tag, and drop the Window augmentation for __KUMIKO_BUILD__. The UpdateChecker needs no change.
  -->

- 1a3ec61: `TimeseriesChart` accepts an optional `referenceLines` prop that draws dashed horizontal threshold lines (for example a p95 or an SLO target) with an accessible label. A line above the data maximum extends the y-scale.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: TimeseriesChart draws optional reference lines
  migration: |
    No code change needed. Pass `referenceLines={[{ value, label, tone }]}` to draw a dashed threshold such as p95 or an SLO target.
  -->

### Patch Changes

- 1eef322: format boolean renders a localized Yes/No instead of raw true/false

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Columns with format boolean show a check mark with the accessible name Yes, or a dash with No, instead of raw true/false
  migration: |
    No code change needed.
  -->

- 53efdc7: `Field layout="inline"` labels wrap instead of truncating. A long label next to a checkbox (the checkout consent texts) no longer widens its container past the viewport, which pushed the dialog's action buttons out of reach.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Inline field labels wrap instead of truncating
  detail: |
    `Field layout="inline"` no longer puts its label in a single truncated line. Long checkbox labels such as the checkout consent texts wrap, so the dialog stays inside the viewport and its buttons stay reachable.
  migration: |
    keine
  -->

- 8389938: LanguageSwitcher is axe-clean while open

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: The open LanguageSwitcher no longer hides the app root with aria-hidden and renders its menu inside the surrounding header landmark
  migration: |
    No code change needed.
  -->

- Updated dependencies [5b6e5f7]
- Updated dependencies [c1e6186]
- Updated dependencies [fcbf184]
- Updated dependencies [d5b87a1]
- Updated dependencies [b4c15f6]
- Updated dependencies [e3adda3]
- Updated dependencies [1954386]
- Updated dependencies [b040ca7]
- Updated dependencies [252f749]
  - @cosmicdrift/kumiko-framework@0.339.0
  - @cosmicdrift/kumiko-types@0.339.0
  - @cosmicdrift/kumiko-renderer@0.339.0
  - @cosmicdrift/kumiko-headless@0.339.0
  - @cosmicdrift/kumiko-dispatcher-live@0.339.0

## 0.338.0

### Patch Changes

- Updated dependencies [42450a6]
- Updated dependencies [c710f1e]
- Updated dependencies [3613e5a]
- Updated dependencies [76ba2ab]
- Updated dependencies [3451156]
- Updated dependencies [4a13a0e]
- Updated dependencies [57467b5]
- Updated dependencies [e8e5e2f]
- Updated dependencies [bac056f]
- Updated dependencies [f4f3d4a]
- Updated dependencies [87938e0]
- Updated dependencies [51b4867]
- Updated dependencies [d1bba78]
  - @cosmicdrift/kumiko-renderer@0.338.0
  - @cosmicdrift/kumiko-types@0.338.0
  - @cosmicdrift/kumiko-framework@0.338.0
  - @cosmicdrift/kumiko-dispatcher-live@0.338.0
  - @cosmicdrift/kumiko-headless@0.338.0

## 0.337.1

### Patch Changes

- Updated dependencies [b1b01b8]
- Updated dependencies [6c1c1d4]
  - @cosmicdrift/kumiko-framework@0.337.1
  - @cosmicdrift/kumiko-renderer@0.337.1
  - @cosmicdrift/kumiko-types@0.337.1
  - @cosmicdrift/kumiko-headless@0.337.1
  - @cosmicdrift/kumiko-dispatcher-live@0.337.1

## 0.337.0

### Minor Changes

- a7fcca9: A number field's unit now always sits inside the field. Before, a label wider than the input (for example once the "changed" marker appeared) widened the form cell, and the unit moved to the right edge of the cell, next to the field. relatedList `groupBy.label` is optional: a group with neither `label` nor a `labels` entry shows its rows without a header and stays open, so a list can keep a header for one group only, such as the done posts. Boot rejects a `collapsedWhen` group that has no header. `DataTableRowGrouping.headerLabel` may return `undefined` for such a group. The required i18n keys now include the `groupBy` header keys of an entityList `expandableRow`, not only those of projectionDetail sections.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: A number field's unit stays inside the field when the label is wider than the input
  detail: |
    Icon, input and unit of a `kind: "number"` input share one box (`data-slot="number-field"`), and the form grid's number cell sizes that box to 8rem instead of the bare input. Before, a label wider than the input (a long label, or the "changed" marker appearing while editing) widened the cell, and the unit was anchored to the cell's right edge, next to the field.
  migration: |
    No code change needed. Custom CSS that sized number inputs through `[&_input]` inside the number cell targets `[data-slot=number-field]` now.
  -->

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: relatedList groupBy.label is optional; groups without a header show their rows directly
  detail: |
    `RelatedListGroupBy.label` is optional. The header key of a group is `labels[value] ?? label`; a group without one renders its rows without a header row and never collapses. `relatedListGroupKey` and `relatedListGroupHeaderLabel` resolve the group key and its header key; `collapsedWhen: null` now matches rows whose field is empty.
  migration: |
    No code change needed. To hide a header, drop `label` and name only the groups that keep one in `labels`, for example `{ field: "status", collapsedWhen: "done", labels: { done: "<key>" } }`.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot rejects a collapsed relatedList group without a header; expandableRow groupBy keys are required i18n keys
  detail: |
    Boot fails when `groupBy.collapsedWhen` names a group that has neither `label` nor a `labels` entry, because its rows could never be opened. The required surface keys now include `groupBy.label` and `groupBy.labels` of an entityList `expandableRow`, as they already did for projectionDetail relatedList sections.
  migration: |
    Add translations for expandableRow `groupBy` header keys if the i18n check reports them missing.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: DataTableRowGrouping.headerLabel may return undefined
  detail: |
    `DataTableRowGrouping.headerLabel` returns `string | undefined`. `undefined` means the group has no header: the default web DataTable renders its rows without a header row and never collapses them.
  migration: |
    Custom DataTable primitives that render `rowGrouping` handle `undefined` from `headerLabel` by rendering the group's rows without a header.
  -->

### Patch Changes

- 3ad5398: A rejected SSE connection ends the web session

  When the server refuses the live-events EventSource with a session 401, createKumikoApp now raises the same session-ended signal as a 401 from the dispatcher, so the user sees the session-end notice instead of silently losing live updates.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: A rejected SSE connection ends the web session
  -->

- 4224359: The row-actions kebab confirm dialog uses `confirmLabel` like the inline path. A list cell with `renderer.locale` explicitly set to `undefined` falls back to the app locale. The narrow-viewport card list keeps the bare `testId` on a wrapper, and its sort select shows a sort that targets a non-sortable column instead of "Unsorted". A bare form renders its `headerRegion`. The dashboard time range no longer needs a type assertion.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Kebab confirmLabel, cell locale fallback, card-list sort select and bare-form headerRegion
  -->

- c55370a: The FloatingPanel grip button drags the panel with the pointer again. Drawer passes `style` as `undefined` when no width or offset applies. Image resize releases the decoded bitmap when no 2d context is available. Nav tree actions that set both `screen` and `target` warn once that `target` is ignored.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: FloatingPanel grip pointer drag, Drawer style undefined, resize bitmap release, nav action screen+target warning
  -->

- 2bd9f3d: Secret reveal rows with equal labels get distinct React keys. A nested form's submit routing also covers `input[type=submit]` and `input[type=image]`. `Grid` ignores null and boolean children when computing `maxRows`, and its gap is the themeable `--kumiko-grid-gap` variable shared with the clip height. Card meta rows clip at the inline start so RTL layouts hide the leading separator too. The QR secret value imports `qrcode/lib/browser.js` so Metro does not pull Node-only dependencies.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Secret reveal keys, nested-form input submit routing, Grid maxRows/gap, RTL card meta, browser QR import
  -->

- dbf6a5f: `createKumikoApp({ screenWidth })` now also applies to the default entityEdit form, which previously stayed at a fixed 640px column. Without the setting the column keeps its 640px width.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: screenWidth setting now widens the default entityEdit form too
  -->

- Updated dependencies [9237bbc]
- Updated dependencies [c68ebb6]
- Updated dependencies [3ad5398]
- Updated dependencies [3ad5398]
- Updated dependencies [3ad5398]
- Updated dependencies [3ad5398]
- Updated dependencies [a7fcca9]
- Updated dependencies [469df86]
- Updated dependencies [8b6daed]
- Updated dependencies [c2da99c]
- Updated dependencies [7949847]
- Updated dependencies [a5023de]
- Updated dependencies [edc2b80]
- Updated dependencies [acde687]
- Updated dependencies [f813603]
- Updated dependencies [b79a8a3]
- Updated dependencies [7d00ea9]
- Updated dependencies [e889f3f]
  - @cosmicdrift/kumiko-headless@0.337.0
  - @cosmicdrift/kumiko-renderer@0.337.0
  - @cosmicdrift/kumiko-framework@0.337.0
  - @cosmicdrift/kumiko-types@0.337.0
  - @cosmicdrift/kumiko-dispatcher-live@0.337.0

## 0.336.1

### Patch Changes

- Updated dependencies [ad3999e]
  - @cosmicdrift/kumiko-framework@0.336.1
  - @cosmicdrift/kumiko-headless@0.336.1
  - @cosmicdrift/kumiko-renderer@0.336.1
  - @cosmicdrift/kumiko-dispatcher-live@0.336.1
  - @cosmicdrift/kumiko-types@0.336.1

## 0.336.0

### Minor Changes

- b83c348: Live updates over `/api/sse` no longer carry field values. A frame now holds only the entity, the event type, id, version and createdAt, and clients load the data with a query, which runs its own access check. Anonymous connections receive signals only for entities that an anonymously callable query declares through the new `liveEntities` option on a query handler. Frames without an entity, such as in-app notifications, now go only to the addressed user. `createSseRoute` takes a second argument with the entities that anonymous connections may follow, and `collectAnonymousLiveEntities(registry)` computes it. Boot fails when `liveEntities` names an unknown entity.

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: /api/sse sends change signals without field values; anonymous connections only for declared entities
  detail: |
    The SSE broadcast consumer no longer puts the event payload (changes, previous) on the tenant channel, because that channel fans out to every tenant member and to anonymous connections. Entity frames carry `{ id, aggregateType, eventType, version, createdAt }`. Anonymous connections get entity signals only for entities named by an anonymously callable query via the new `liveEntities` option; the query name alone grants nothing, because a signal carries the id of every row, including rows the query filters out. Frames without an entity are delivered only when `data.userId` matches the connected user. Boot fails when `liveEntities` names an unregistered entity.
  migration: |
    Code that reads `data.payload` from SSE frames must load the data with a query after the signal instead. Public pages that update anonymously add `liveEntities: ["<entity>"]` to the anonymous query they refetch (for example a `page:current` query), otherwise the live update stays off for anonymous visitors. `createSseRoute(broker)` now needs a second argument, `{ anonymousLiveEntities: collectAnonymousLiveEntities(registry) }`.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: LiveEvent data has no payload, it carries eventType
  detail: |
    `LiveEvent.data` is now `{ id, aggregateType, eventType, version, createdAt }`. The server sends signals only, so consumers refetch through a query.
  migration: |
    Replace reads of `event.data.payload` with a query refetch. `useQuery({ live: true })` already does this and needs no change.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: EventSource live events parse the signal-only frame
  detail: |
    `createEventSourceLiveEvents` forwards the new frame shape without payload and with `eventType`.
  migration: |
    No code change needed.
  -->

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: Query handlers can declare liveEntities
  detail: |
    `QueryHandlerDefinition` and the inline `queryHandler` options accept `liveEntities`, the entities whose changes the query reflects. Anonymous callers with access to the query receive /api/sse change signals for them.
  migration: |
    No code change needed.
  -->

### Patch Changes

- 47e769d: On narrow viewports, a wizard that edits an existing record shows the step label as an expandable step list (same done and jump rules as the rail), so phones can jump between steps. Below `sm` the pinned form footer is always one fixed-height row: Back as an icon button, every other action in a "…" popover (shown only while one of them is enabled, with a dot when there are unsaved changes), and the primary action filling the rest with a one-line label. `@cosmicdrift/kumiko-renderer` exports `FOOTER_ACTION_ROLE_PROP` and `NARROW_LABEL_PROP` so custom footer buttons can mark themselves as Back or primary and give a short phone label.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Update-mode wizards get a step picker on narrow viewports; the pinned footer is a single fixed row on phones
  detail: |
    `StepBar` with `onStepSelect` and `selectableSteps="all"` renders the compact label as a dropdown listing every step. Below `sm` the pinned footer is one row: Back as icon, other actions in a "…" popover that only shows while one of them is enabled, primary action filling the rest. New renderer markers `FOOTER_ACTION_ROLE_PROP` and `NARROW_LABEL_PROP` classify custom footer buttons.
  migration: |
    No code change needed.
  -->

- Updated dependencies [e91de78]
- Updated dependencies [e19453a]
- Updated dependencies [83378b1]
- Updated dependencies [c95f017]
- Updated dependencies [58154f0]
- Updated dependencies [b83c348]
- Updated dependencies [4618e1d]
- Updated dependencies [47e769d]
- Updated dependencies [7d5428e]
  - @cosmicdrift/kumiko-framework@0.336.0
  - @cosmicdrift/kumiko-renderer@0.336.0
  - @cosmicdrift/kumiko-types@0.336.0
  - @cosmicdrift/kumiko-headless@0.336.0
  - @cosmicdrift/kumiko-dispatcher-live@0.336.0

## 0.335.0

### Minor Changes

- 96443f1: Review round 2 fixes for renderer-web.

  - `InfinityList` now defaults `live` to `false` (it was `true`). Lists that relied on the implicit realtime refresh no longer update on SSE events until they pass `live={true}`.
  - A number input with a `unit` exposes the unit to screen readers through `aria-describedby` instead of hiding it with `aria-hidden`.
  - `Drawer` with an explicit `width` is capped at `85vw`, the same limit as the default width.

  <!-- kumiko-changes
  feature: renderer-web
  type: breaking
  title: InfinityList live defaults to false
  migration: |
    Pass `live={true}` to every `<InfinityList>` that should refresh from SSE events. Without it the list only loads on mount and on pagination.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Number input unit is announced by screen readers and Drawer width is capped to the viewport
  -->

- 7cdc623: A wizard that edits an existing record now shows each step as done by what the record already holds, and every step is a jump target. A fields step counts as done when its fields validate and at least one visible, editable field that is not a select or boolean has a value, or when the user passed it with Next. Jumping forward still validates the step you leave. Extension steps report completeness through the new `reportStepComplete` prop of `ExtensionSectionProps`. `StepBar` gets `doneSteps` and `selectableSteps`. Create-mode wizards are unchanged. A `writeHandler` record action on a projectionDetail or entityEdit screen gets an optional `redirect` (same forms as entityEdit `redirect`, a valid `returnTo` wins), and a delete action that removes the shown record now leaves the screen (`returnTo`, else `listScreenId` or the entity's list screen) instead of showing "record not found". The boot validator checks `redirect` targets on these actions.

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Wizard editing an existing record shows data-based done state and allows jumping to any step; delete record actions leave the screen
  detail: |
    Update-mode wizards compute done per step from the record (valid, non-empty fields, or passed via Next) and make every non-current step a jump target; forward jumps run the current step's validate gate. `ExtensionSectionProps.reportStepComplete` lets extension steps report completeness. `StepBar` gets `doneSteps` and `selectableSteps`. A writeHandler record action with `redirect`, or a delete of the shown record, navigates away (returnTo, redirect, listScreenId, entity list) instead of refetching.
  migration: |
    Extension wizard steps in an entityEdit that edits an existing record should call `reportStepComplete(true)` (usually from an effect) once they hold their data, otherwise the step bar shows them as not done until the user passes them with Next. This also applies to singleton wizards (e.g. a company-setup wizard), whose steps now show done by data and are all jump targets; tests that assumed back-only chips must be updated. A delete writeHandler action on a projectionDetail or entityEdit now navigates away after success (returnTo, else listScreenId or the entity's list) instead of refetching into "record not found"; set `redirect` to choose another target. List row actions are unchanged.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: StepBar supports explicit done state and jumping to any non-current step
  detail: |
    The default `StepBar` forwards the new `doneSteps` and `selectableSteps` props: an upcoming chip can be a button that shows its number, and done state no longer has to follow position.
  migration: |
    No code change needed.
  -->

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: RowActionWriteHandler gets an optional redirect for record actions
  detail: |
    `redirect` takes the same forms as entityEdit `redirect` and is honored on projectionDetail and entityEdit header and section actions, not on list row actions.
  migration: |
    No code change needed.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot validator checks redirect targets of writeHandler record actions
  detail: |
    An unknown `redirect` screen on a projectionDetail or entityEdit action or section action fails boot, like entityEdit `redirect`.
  migration: |
    If a writeHandler record action already carries a `redirect` that does not resolve to a registered screen, fix or remove it.
  -->

### Patch Changes

- ff1dea2: Agent tool manifests no longer offer the caller-chosen `id` on create tools, since agent dispatch never runs as a system identity and the value was silently dropped. Combobox options now carry a value-based `data-testid`.

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Agent tool manifests no longer offer the caller-chosen id on create tools
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Combobox options carry a value-based data-testid
  -->

- a4fa088: A projectionDetail screen with a header card (headerRegion with metrics or header actions) on a full-height screen form without tabs now defaults to a `4xl` column instead of 640px, and the metric band lines up with the form column instead of carrying its own padding. An explicit `layout.width` still wins. Explicit screen form widths (`3xl`, `4xl`, `full`) now left-align with the form column instead of centering, which moves screens such as the showcase item edit. Typing into a password input that shows a clear or undo action no longer remounts the input and drops focus after the first character.

  The secretMint reveal phase with a confirm step renders as one screen form. The reveal block (title, warning, secret) leads the confirm form through the new `RenderEdit` prop `leadContent`, and the confirm form no longer sits in a second card. The `kumiko-screen-secret-mint-card` test id now marks only that reveal block. The confirm step shows the parent screen's translated title (new `RenderEdit` prop `i18nScreenId`) instead of the raw key `<screen>:confirm`.

  Text config keys stored encrypted at rest (`encrypted: true` or `backing: "secrets"`, such as the Stripe API key and webhook secret) are write-only on generated settings screens. The field shows whether this scope stores a value, keeps it unless a new one is typed, and resets it when cleared. Hand-written configEdit text fields over such keys become write-only as well, and form drafts never store write-only fields. `config:write:set` answers with the mask for these keys, and pattern, select option and extension validation errors no longer return the value. A hand-written configEdit screen may declare `writeOnly` only on a field whose key is encrypted at rest; other keys fail at boot.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Header-card detail screens default to a 4xl column; metric band aligns with the form column; explicit screen form widths left-align; password input keeps focus
  -->

  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: secretMint reveal and confirm render as one screen form with the translated screen title; new RenderEdit props leadContent and i18nScreenId
  -->

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Encrypted-at-rest text config keys derive writeOnly settings fields; boot validator allows writeOnly on configEdit only for those keys
  -->

  <!-- kumiko-changes
  feature: config
  type: breaking
  title: config:write:set masks the echoed value for encrypted-at-rest keys; validation errors no longer include the value
  migration: |
    A caller that reads `data.value` from a `config:write:set` result for a key with `encrypted: true` or `backing: "secrets"` now gets the mask. Use the value it sent instead. Tests that match the `value` param of a validation error on such a key need to drop that expectation.
  -->

- 827da80: Page title stays visible on narrow screens

  Wide header actions no longer push the page title out of the header on phones; the actions area shrinks instead.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Page title stays visible on narrow screens
  -->

- 1da9e2c: Dashboard list columns accept `display: "datetime"`, which formats an ISO string or epoch-ms value in the user's locale and time zone. The admin-shell overview lists use it for `startedAt` and `failedAt` instead of showing raw ISO strings.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Dashboard list columns support display "datetime"; overview lists no longer show raw ISO timestamps
  -->

- 67703a0: `createLegalPagesFeature` now throws when custom `routes` cover no default required block and `requiredBlocks` is omitted, instead of failing the production boot check later. The text-block and system-template seed race loser now honours `ifExists: "skip"` and the no-op comparison. `SegmentedSelect` keeps the first segment tabbable when the stored value matches no option. The `subscribePathname` option documents that the `popstate` default misses `pushState` navigation.

  <!-- kumiko-changes
  feature: legal-pages
  type: fix
  title: Legal pages fail fast on custom routes without required blocks; seed race honours skip
  -->

- e810c7d: Dashboard time-range queries now send the user's time zone, so metric day buckets line up with the axis labels instead of being cut in UTC. `kumiko-bundled-features` declares `ioredis` and `hono`, which its emitted type declarations import.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Dashboard time-range queries carry the user's time zone so day buckets match the axis labels
  -->

- d7d5bd7: Renderer review fixes. Deleting a secret on a secretsEdit screen now asks for confirmation first (new `config.secrets.deleteConfirm` key) and the delete button is disabled while a save or delete is running. The multiSelect checkbox group is exposed as a labelled group (`GridProps.ariaLabelledBy`). The inline reference-create dialog seeds `currency: { kind: "tenant" }` money fields from the tenant currency. Fields declared only inside a section `groups` entry now get their `visible`/`readOnly`/`required` conditions registered. `onChange`'s `valid` ignores issues on hidden fields and outside the `fields` scope, like submit does (shared `relevantFieldIssues` helper). Copy-link in the form footer keeps a 44px touch target on narrow viewports. A free-text sibling-field number unit longer than 8 characters is no longer rendered as a suffix.

  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Secret delete confirmation, grouped-field conditions, scoped valid flag, tenant currency in reference-create dialog
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Labelled multiSelect checkbox group, mobile touch target for secondary form actions, bounded number unit suffix
  -->

- ca8c8e0: A nested `Form` that degrades to a `<div>` now submits on Enter inside its own inputs and ignores submit buttons that belong to a portal or a deeper nested form. The textarea `onSubmitShortcut` no longer fires when the caller's `onKeyDown` called `preventDefault()`. `Card` no longer lets `dataAttributes` override `data-slot`.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Textarea respects preventDefault, Card data-slot is not overridable, degraded FormRoot scopes Enter and submit to its own inputs
  -->

- 292b11e: The row-actions kebab no longer returns focus to its trigger while a confirm dialog is open, so keyboard and screen-reader users reach the dialog buttons. Column headers of the embedded-list desktop table truncate (with a `title`) inside their fixed-width column instead of overlapping the neighbouring header.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Row-actions kebab keeps focus in the confirm dialog, embedded-list headers truncate in fixed columns
  -->

- 8a49831: Ended session leads back to the login screen

  When the server ends a session (revoked, expired), the app now shows the login screen with a short hint instead of a raw error banner. After signing in again the user lands on the same screen as before.

  <!-- kumiko-changes
  feature: auth-email-password
  type: fix
  title: Ended session leads back to the login screen
  -->

- Updated dependencies [ff1dea2]
- Updated dependencies [d973444]
- Updated dependencies [a4fa088]
- Updated dependencies [ed072dc]
- Updated dependencies [44c5898]
- Updated dependencies [c97a39a]
- Updated dependencies [bf12ac5]
- Updated dependencies [6d4068f]
- Updated dependencies [1e9cc86]
- Updated dependencies [1da9e2c]
- Updated dependencies [a86aa83]
- Updated dependencies [f86bcd2]
- Updated dependencies [a8f5305]
- Updated dependencies [0705037]
- Updated dependencies [4805c38]
- Updated dependencies [4f6e8d7]
- Updated dependencies [099f406]
- Updated dependencies [70aa253]
- Updated dependencies [837245e]
- Updated dependencies [5b6f9da]
- Updated dependencies [4805c38]
- Updated dependencies [4805c38]
- Updated dependencies [c791abd]
- Updated dependencies [782fdea]
- Updated dependencies [0191e3e]
- Updated dependencies [b18daf9]
- Updated dependencies [ff29a06]
- Updated dependencies [dae5a21]
- Updated dependencies [67703a0]
- Updated dependencies [567a4bd]
- Updated dependencies [f5ff653]
- Updated dependencies [5bca19c]
- Updated dependencies [85dead2]
- Updated dependencies [9acf185]
- Updated dependencies [d7d5bd7]
- Updated dependencies [e4171a0]
- Updated dependencies [57f0e78]
- Updated dependencies [5e9cc10]
- Updated dependencies [a86aa83]
- Updated dependencies [a39d8a6]
- Updated dependencies [9061d9e]
- Updated dependencies [e550021]
- Updated dependencies [1e25ae5]
- Updated dependencies [8a49831]
- Updated dependencies [4e617da]
- Updated dependencies [3d37d50]
- Updated dependencies [7cdc623]
  - @cosmicdrift/kumiko-framework@0.335.0
  - @cosmicdrift/kumiko-renderer@0.335.0
  - @cosmicdrift/kumiko-types@0.335.0
  - @cosmicdrift/kumiko-headless@0.335.0
  - @cosmicdrift/kumiko-dispatcher-live@0.335.0

## 0.334.0

### Minor Changes

- 6633f59: Form gaps for settings screens:

  - A `writeForm` section that fills a whole tab puts its submit button into the pinned form footer.
  - `optionsQuery` rows may carry `description` (muted second line) and `group` (heading). The combobox and the radio list show both. Options with either one never render as segments.
  - `optionsQueryPayload` values may be `{ field: "<sibling>" }`. The select reloads when that field changes and clears a value the new rows no longer contain. A cleared config select resets the key, so the inherited value applies again. On config keys, `field` names another key of the same feature on the same settings mask. The boot validator checks the names, and `writeForm` fieldDefs now go through the select checks too.
  - The origin line and cascade level rows on `configEdit` fields show the option label instead of the raw value or id.
  - New `writeOnly: true` on entity text fields with `find: "secret"`. Reads return `true` (set) or `null` and never the value. On write, `""` keeps the stored value and `null` clears it. The edit form shows a masked input with a "set" placeholder and a remove action. `maskWriteOnlyFields(entity, row)` is exported from `@cosmicdrift/kumiko-framework/engine` for custom query handlers that return executor rows.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Settings form gaps: writeForm footer submit, option description/group, dependent optionsQueryPayload, config badge label, writeOnly secret fields
  -->

- bc0172a: Generated config screens (configEdit, secretsEdit, extension-selector dashboard) render as a settings list: section header on top, one row per key with label, description, origin and reset on the left and the control on the right, hairlines between rows and an accent line on values set at the current level. `EditLayout.variant: "settings-list"` enables the layout, `RenderEditProps.dirtyFooter` shows the unsaved count with Discard and Save changes, `validateOnChange` shows field errors while typing. Number bounds on config keys are validated on the client and read "Must be 1000 or less" / "Must be at least 1". Rows split into two columns by container width, so they stack next to a sidebar on tablets.

  `DashboardScreenDefinition.showUpdatedAt` (default true) hides the "As of" timestamp; the selector dashboard sets it to false. `DashboardScreenPanel.chromeless` embeds a panel's screen without card frame and without its own screen padding, aligned to the page grid; the selector dashboard uses it. Features can name the config section via `<feature>.settings.section`; tenant-settings uses it and the platform screen is titled "Tenant defaults" to match the navigation.

  Consumer tests on secretsEdit need updating: the `required-marker-<field>` test id is gone (a missing required secret now shows as the `secret-not-set-<field>` status), a stored secret gets `secret-saved-<field>`, and `secrets-edit-submit` stays disabled until at least one secret is entered.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Settings list layout for generated config and secrets screens
  -->

### Patch Changes

- b35fe6b: Screen layouts line up across screen types. Forms, lists and dashboards share one screen inset (`px-4 md:px-10`), stacked related lists no longer pad themselves inside their section, the reference create dialog renders its form bare under the modal title, secretMint reveal and done phases use the form screen layout (new `CardOptions.screenBody`), and a projectionDetail with a header card renders as a screen form instead of a card form.

  A projectionDetail with a header card and without `layout.width` now uses the screen form column width (640px), the same as the edit screen of that record. Set `layout.width` on the detail screen to keep it wider.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Shared screen inset and aligned layouts for lists, forms, dialogs and secret mint
  -->

- Updated dependencies [6633f59]
- Updated dependencies [6633f59]
- Updated dependencies [b35fe6b]
- Updated dependencies [bc0172a]
  - @cosmicdrift/kumiko-types@0.334.0
  - @cosmicdrift/kumiko-framework@0.334.0
  - @cosmicdrift/kumiko-headless@0.334.0
  - @cosmicdrift/kumiko-renderer@0.334.0
  - @cosmicdrift/kumiko-dispatcher-live@0.334.0

## 0.333.0

### Minor Changes

- 90420cb: Additive screen options for list, drawer, form and wizard screens

  entityList: `facets` (per-field `display: "chips"`, `showCounts`, `hideEmpty`, `extraOptions`, or `false` to hide), `defaultFilters` (initial value only, the URL wins, "no filter" stays chosen) and `rowActionMode`. Row actions get `display: "button" | "link" | "icon"`; with `display` set an action stays inline next to the kebab. Drawer actions get `title` / `subtitle` (i18n keys, `{param}` filled from the row prefill). Edit fields get `submit: false` (kept out of the payload), actionForm gets `footerActions` (patch values, then submit), relatedList gets `groupBy` / `rowTone` / `rowActionMode`. Wizard sections get `subtitle`, `layout.wizard.aside.upNext` adds an "up next" box, entityEdit gets `titleTemplate`. `Button` gets a `pressed` style, the DataTable contract `rowGrouping` / `rowTone`, `StepBar` `subtitles` / `upNext`, `Drawer` `subtitle`.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: New optional screen options for facet chips, default filters, row action display, drawer titles, footer actions, grouped related lists and wizard side info
  migration: No code change needed.
  -->

  - Screenshot runner: `SCREENSHOT_DESKTOP_WIDTH` overrides the desktop viewport width (default 1920).

### Patch Changes

- 75bd427: `ActionOverflowMenu` renders its trigger as the outline icon Button, so it has the same size, border and 44 px phone touch target as the icon buttons next to it.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Overflow menu trigger matches neighbouring icon buttons
  -->

- Updated dependencies [2d7f76f]
- Updated dependencies [90420cb]
  - @cosmicdrift/kumiko-framework@0.333.0
  - @cosmicdrift/kumiko-types@0.333.0
  - @cosmicdrift/kumiko-headless@0.333.0
  - @cosmicdrift/kumiko-renderer@0.333.0
  - @cosmicdrift/kumiko-dispatcher-live@0.333.0

## 0.332.0

### Minor Changes

- b81f794: projectionDetail header subtitle with several parts and links

  `header.subtitle` accepts a list of parts (field name or `{ field, navigate }`). Empty parts drop out, the rest are joined by a "·" separator, and a part with `navigate` links to the referenced record (entity or screen target, only when reachable). The Link primitive gets an optional `onPress` for SPA navigation, Text an optional `decorative` flag. `subtitleHref` stays valid with the string form only; the boot validator rejects the combination with a list.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: projectionDetail header subtitle can show several parts, each optionally linking to the referenced record
  migration: No code change needed.
  -->

### Patch Changes

- ae6d506: Narrow-card meta separator ("·") is now rendered as an element instead of `before:content`, so it survives consumer Tailwind scans of the published dist. The value span keeps its `data-testid` and exact text. The mobile page-header overflow trigger (`shell-header-overflow-trigger`) now has its own aria-label "Page actions" (was "More actions", same as row menus); E2E selectors by label need updating.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Card subtitle separators render in apps again, header overflow trigger has its own label
  -->

- 14c0fb8: The phone header overflow is now a right-aligned menu (`role="menu"`, arrow-key navigation) instead of a full-width panel, and `ThemeToggle` renders as a labelled row inside it. `ThemeToggle` titles default to the new i18n keys `kumiko.theme.dark` / `kumiko.theme.light`. On phones, a list's primary toolbar action without `onCreate` moves into the page header as an icon button.

  Inline embedded-list tables no longer squeeze reference, select and number columns: columns have realistic minimum widths (the table scrolls horizontally below their sum), widths sit on `<col>` so text and reference columns take the free space, and the sticky actions column fits its four buttons.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Phone header overflow is a right-aligned menu with labelled rows, primary list toolbar action moves into the header on phones
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Embedded list tables keep readable column widths and scroll instead of squeezing, actions column fits its buttons
  -->

- b4e827d: `ActionMenuItemSpec` takes an optional `testId` that overrides the menu entry's default `data-testid` in the action overflow menu and the phone header menu. `Button` takes `expanded` (rendered as `aria-expanded`). New icon key `chevron-up`. Below 768 px the whole `header-actions` container sits in the closed "…" menu: E2E settled checks should wait for `[data-kumiko-layout="shell-header"]` and open header actions via `shell-header-overflow-trigger`.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Menu items accept testId, Button accepts expanded, chevron-up icon
  -->

- Updated dependencies [991ed87]
- Updated dependencies [dcf135e]
- Updated dependencies [ae6d506]
- Updated dependencies [3917e63]
- Updated dependencies [b81f794]
- Updated dependencies [541d24b]
- Updated dependencies [e82b023]
- Updated dependencies [14c0fb8]
- Updated dependencies [b4e827d]
- Updated dependencies [dcf135e]
- Updated dependencies [dcf135e]
  - @cosmicdrift/kumiko-framework@0.332.0
  - @cosmicdrift/kumiko-renderer@0.332.0
  - @cosmicdrift/kumiko-types@0.332.0
  - @cosmicdrift/kumiko-headless@0.332.0
  - @cosmicdrift/kumiko-dispatcher-live@0.332.0

## 0.331.0

### Minor Changes

- 16797a4: entityList rows can expand into a related list

  `expandableRow` on an entityList declares a related list under each row, with the same fields as a projectionDetail `relatedList` section (query, `parentFilter` or `parentParam`, columns, row and toolbar actions, emptyState). The parent id is the row's `id`. An arrow button at the start of the row opens and closes the area, carries `aria-expanded`, and works by keyboard. Several rows can be open at once. A successful write from the area reloads both the related list and the parent list, so counters on the parent row update. The boot validator and the role projection check the area like a relatedList section. `DataTableProps` gains `expandedRowIds`, `onToggleRowExpanded` and `renderExpandedRow` for custom DataTable primitives.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: entityList rows can expand into a related list with its own row actions (expandableRow)
  -->

- 50ddb3c: Phone-width shell header keeps the title readable and moves actions into one menu

  Below 768px the shell header no longer squeezes or clips the title next to header actions. The title stays on one line with an ellipsis and takes the free space. The primary action renders as an icon-only button with `aria-label` and tooltip; a primary that is `style: "danger"`, needs a confirm, or has no icon goes into the menu instead. All other screen actions and the app's `headerActions` move into a single "…" menu in the shell header. This applies to entityList, edit and projectionDetail screens without any app opt-in. Desktop layout is unchanged.

  `PageHeaderProps` gains `overflowItems` (screen actions for that menu), and `usePageHeaderCompact()` tells a screen whether the compact header is active. App header actions stay mounted while the menu is closed, so global listeners such as a ⌘K shortcut keep working. Icon-only buttons now get `title` from `ariaLabel` when no title is set.

  Also on phones: card subtitles with several meta values wrap to two lines instead of truncating each value; dates, numbers, money and badges never break inside. In the inline form table, "add row" sits below the horizontal scroll area so it stays reachable, and row action buttons in the card layout are 40px.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Phone-width header keeps the title and collects actions in one menu; card meta wraps; inline table add-row stays reachable
  migration: |
    No code change is required. Below 768px, app `headerActions` and secondary screen actions now live in the shell's "…" menu (`shell-header-overflow-trigger`, panel `shell-header-overflow`, items `shell-header-overflow-item-<actionId>`). Mobile e2e tests that clicked these buttons inline must open the menu first. The list "create" button keeps its test id but has no visible text on phones; select it by its aria-label. App header actions stay mounted while the menu is closed, so keyboard shortcuts registered in effects keep working. Apps that replace the `PageHeader` primitive lose the secondary actions on phones, because only the default primitive forwards `overflowItems` to the shell menu.
  -->

### Patch Changes

- c398ed1: Card subtitles never show a "·" separator at the start of a line

  On phones the card meta values wrap as whole items onto at most two lines. The separator in front of a value that starts a line is clipped, and a single value too long for a line is truncated with an ellipsis.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Card subtitle separators no longer appear at the start of a wrapped line
  -->

- d22049b: Inline tables size columns by type, the actions column stays visible, and long select labels truncate

  The embedded-list table now fills the form field width instead of sizing to its content: number, money, date and select columns get a fixed width, text and reference columns take the free space. Wide tables scroll horizontally with the actions column pinned to the right edge. Combobox and select triggers keep a long selected label on one line, truncated with the full text as tooltip, instead of wrapping and centering it.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Inline tables size columns by type with a pinned actions column, long select labels truncate
  -->

- 0dc0b1f: Dotted select values keep their stored spelling in lists

  An untranslated select value in a list cell fell back to a humanized slug, so "mobile.de" showed as "Mobile.de". Dotted values such as domains now stay as stored. Registered option translations are unaffected, and they work with dotted values.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Untranslated select values like "mobile.de" are no longer capitalized in list cells
  -->

- d22049b: StatCard no longer cuts a label mid-word next to a delta badge

  The StatCard header row now wraps: when the label has no room for its longest word beside the delta chip (narrow cards on phones), the chip moves to its own line below icon and label. Wide cards keep the chip on the right in the same row.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: StatCard header wraps so a delta badge no longer clips the label mid-word
  -->

- Updated dependencies [16797a4]
- Updated dependencies [6b95958]
- Updated dependencies [50ddb3c]
- Updated dependencies [3ea4ffc]
- Updated dependencies [e4ea9f0]
  - @cosmicdrift/kumiko-types@0.331.0
  - @cosmicdrift/kumiko-framework@0.331.0
  - @cosmicdrift/kumiko-headless@0.331.0
  - @cosmicdrift/kumiko-renderer@0.331.0
  - @cosmicdrift/kumiko-dispatcher-live@0.331.0

## 0.330.2

### Patch Changes

- Updated dependencies [32a6102]
  - @cosmicdrift/kumiko-framework@0.330.2
  - @cosmicdrift/kumiko-headless@0.330.2
  - @cosmicdrift/kumiko-renderer@0.330.2
  - @cosmicdrift/kumiko-dispatcher-live@0.330.2
  - @cosmicdrift/kumiko-types@0.330.2

## 0.330.1

### Patch Changes

- d064b0d: Boolean fields in flow forms use the new FieldCellWidth "toggle", which replaces "auto"

  In flow forms (screen forms and drawers) a boolean field's label now shares the top line with its neighbours' labels and the switch sits on the input line. The `FieldCellWidth` union loses `"auto"` and gains `"toggle"`; the default web Grid maps it to a fixed minimum width.

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Boolean fields in flow forms use FieldCellWidth "toggle" instead of "auto"
  migration: |
    Custom Grid/GridCell primitives keyed by FieldCellWidth: rename `auto` to `toggle`.
  -->

- 5bc2a13: FloatingPanel no longer starts a header drag for pointer events bubbling from portalled children, so header dropdown menu items react to mouse clicks again.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: FloatingPanel header menus react to mouse clicks again; portalled children no longer start a header drag
  -->

- 63a63d6: NumberInput selects its value on focus, createScreen counts as nav parent, NumberField passes grouping, mobile card subtitles name boolean columns

  Focusing a prefilled `NumberInput` swapped the grouped display ("10.000") for the raw value and left the cursor at the end, so typing or Playwright's `fill("100")` appended ("10000100"). The raw value is now selected on focus, like `MoneyInput`; a click therefore no longer places the caret. A screen reached only through an entityList's `createScreen` now resolves that list as its parent, so the nav-area boot check passes without `listScreenId` and the breadcrumb shows the list. `NumberField` forwards `grouping` to the number input. In the mobile card layout a true boolean column shows its column label in the subtitle line instead of a bare check mark; false and blank values (including whitespace) are left out together with their separator; a boolean column with its own `trueLabel` keeps it. Role-projected schemas drop an entityList's `createScreen` when the target screen is not granted. `StatCard` labels wrap to two lines (full text in the tooltip) instead of truncating, and the sidebar footer gets a top border. Correction to the 0.328.0 `rowActionMode` note: with `onRowClick` the first cell renders as a keyboard-operable `button`, not a link; tests should query it by role `button`.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: NumberInput selects on focus, createScreen counts as nav parent, mobile card subtitles name boolean columns
  migration: |
    None. Tests that read a bare check mark from a mobile card subtitle now find the column label.
  -->

- 39c2fbd: projectionDetail tab panels get page padding, recordTitleField on projectionDetail

  Tab panels on a projectionDetail with `layout.mode: "tabs"` now pad their content like the rest of the page: extension, field-section, groups and writeForm tabs render as an unframed padded panel with space below the tab strip. relatedList tabs stay flush. This fixes extension tabs sitting flush against the shell edge since 0.330.0. `CardOptions.framed` (default true) drops the card frame and keeps the padding. A projectionDetail without `header` can set `recordTitleField`: the query output field then titles the page header (breadcrumb "list > record"). The boot check requires the field to be in the query's outputSchema and rejects it next to `header`.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: projectionDetail tab panels get page padding, recordTitleField on projectionDetail
  migration: |
    Extension tab panels get their padding back, so extension components that added their own padding to make up for the flush panel in 0.330.0 should drop it. Set `recordTitleField: "<field>"` on a projectionDetail without `header` to show the record name in the breadcrumb.
  -->

- Updated dependencies [d064b0d]
- Updated dependencies [63a63d6]
- Updated dependencies [39c2fbd]
- Updated dependencies [03ad4bc]
  - @cosmicdrift/kumiko-renderer@0.330.1
  - @cosmicdrift/kumiko-framework@0.330.1
  - @cosmicdrift/kumiko-types@0.330.1
  - @cosmicdrift/kumiko-headless@0.330.1
  - @cosmicdrift/kumiko-dispatcher-live@0.330.1

## 0.330.0

### Minor Changes

- dc5981b: Dashboard screens get new chart kinds, panel states and a time range; admin-shell overviews are built from metrics

  Dashboard panels gain the chart kinds `stacked-bars`, `segment-bars` and `stacked-area`, a subtitle, per-series tones, static query `params`, `ignoreScreenFilter`, an empty label and hint, a `span` (half/full width), a stat `sparklineField` and static `tone`, a `negative` tone, an unlabelled `stat-group` KPI strip and bar/badge list columns. Every panel shows skeleton, empty and error states with retry. A screen can declare a `timeRange` control and a `scope` badge and notice. The admin-shell overview screens use all of this and show the metrics of the new `metrics` and `metrics-system` features. `deliveries-by-channel` now labels the email, in-app and push channels.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Dashboard screens get stacked-bars, segment-bars and stacked-area charts, panel states, time range, scope badge and bar/badge list columns
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: breaking
  title: Dashboard screens show screen.description only when it is an i18n key; plain-text descriptions stay agent-facing and are no longer rendered
  migration: |
    To keep a visible subtitle under a dashboard title, set screen.description to an i18n key (for example "my-feature:screen.overview.description") and register its translations.
  -->

  <!-- kumiko-changes
  feature: metrics
  type: fix
  title: deliveries-by-channel shows readable channel labels instead of raw channel ids
  -->

  <!-- kumiko-changes
  feature: admin-shell
  type: breaking
  title: admin-shell requires the metrics and metrics-system features and builds its overview dashboards from a metrics list
  migration: |
    Mount createMetricsFeature({ metrics: DEFAULT_METRICS }) and createSystemMetricsFeature({ metrics: DEFAULT_METRICS }) from the metrics bundled feature before admin-shell. DEFAULT_METRICS also requires the delivery, sessions, jobs and tenant features.

    If you do not mount all of them, pass the same reduced list to all three: createMetricsFeature({ metrics }), createSystemMetricsFeature({ metrics }) and createAdminShellFeature({ metrics }). Overview panels exist only for metric ids in that list.
  -->

### Patch Changes

- 7a886f1: Published `.d.ts` resolve without extra setup; READMEs ship; renderer-web is a declared dependency

  The emitted declarations that mention `Temporal` or `Bun` now carry a preserved `/// <reference types>` for `temporal-polyfill/global` and `bun-types`, so a consumer without `bun-types` in its tsconfig no longer gets unresolved `Temporal`/`Bun` errors from our declarations. `kumiko-server-runtime` and `kumiko-dev-server` declare `@cosmicdrift/kumiko-renderer-web` as a dependency (they resolve its `styles.css`; it was already installed through bundled-features) and `bun-types` as a dependency. `bundled-features`, `server-runtime`, `dev-server`, `dispatcher-live`, `headless`, `renderer`, `renderer-web` and `cli` ship the README.md their `files` list already named. `bun run check:dist` now typechecks the packed install, checks README shipping, runtime-resolved package declarations and the `styles.css` resolve.

  <!-- kumiko-changes
  feature: server-runtime
  type: fix
  title: server-runtime and dev-server declare their renderer-web dependency and their .d.ts resolve Bun and Temporal types without consumer setup
  -->

- 1e18129: Number fields use a locale-aware text input (role textbox, not spinbutton)

  Number, bigInt and decimal fields render a text input (role `textbox`) with a decimal or numeric keypad instead of `<input type="number">`. The blurred value is formatted with the app locale and the field `grouping` option (false hides the thousands separator); while focused the raw value is edited. Invalid locale tags fall back to en-US instead of throwing. Numeric and date table cells use tabular figures; the global body default is removed.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Number fields use a locale-aware text input (role textbox, not spinbutton)
  migration: |
    Number inputs are now text inputs. Tests that query a number field by the `spinbutton` role must use `textbox`; code that read `input.valueAsNumber` must parse `input.value`.
  -->

- f0dabdf: List tables no longer render a one-item kebab for a row whose only action is the rowClick action

  With a clickable row the `rowClick` action is no longer repeated in the row kebab, and a list left without menu actions gets no actions column. A row with an empty first cell keeps a screen-reader-only link labelled with the action. `"inline"` mode and editable cells are unchanged.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: List tables no longer render a one-item kebab for a row whose only action is the rowClick action
  -->

- Updated dependencies [dc5981b]
- Updated dependencies [7a886f1]
- Updated dependencies [f0dabdf]
- Updated dependencies [89e32ce]
- Updated dependencies [f19fb5c]
- Updated dependencies [1e18129]
- Updated dependencies [1e18129]
  - @cosmicdrift/kumiko-framework@0.330.0
  - @cosmicdrift/kumiko-renderer@0.330.0
  - @cosmicdrift/kumiko-types@0.330.0
  - @cosmicdrift/kumiko-headless@0.330.0
  - @cosmicdrift/kumiko-dispatcher-live@0.330.0

## 0.329.0

### Minor Changes

- 9bbdb64: Button gains `title` and `pressed`; icon set gains `camera` and `headphones`

  `title` renders the native tooltip attribute, `pressed` renders `aria-pressed` for toggle buttons. `camera` and `headphones` join the `NavIconKey` vocabulary and the lucide-backed icon registry.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Button gains title and pressed props; icon set gains camera and headphones
  -->

### Patch Changes

- Updated dependencies [9bbdb64]
- Updated dependencies [9bbdb64]
  - @cosmicdrift/kumiko-renderer@0.329.0
  - @cosmicdrift/kumiko-types@0.329.0
  - @cosmicdrift/kumiko-framework@0.329.0
  - @cosmicdrift/kumiko-headless@0.329.0
  - @cosmicdrift/kumiko-dispatcher-live@0.329.0

## 0.328.1

### Patch Changes

- 51a6a91: kumiko-headless, kumiko-dispatcher-live, kumiko-renderer and kumiko-renderer-web are published as compiled JavaScript plus .d.ts

  The four client packages now ship `dist` (`.js` and `.d.ts`) instead of TypeScript source. Export keys are unchanged; only the targets behind them move to `dist`. `kumiko-renderer-web` still ships `src/styles.css` and `src/fonts` as source, because the stylesheet and the font server resolve them by path; its Tailwind `@source` list now also scans the compiled `dist` of renderer-web and renderer. `kumiko-renderer-web` now declares `kumiko-framework` and `kumiko-types` as dependencies, which its code already imported.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: kumiko-headless, kumiko-dispatcher-live, kumiko-renderer and kumiko-renderer-web are published as compiled JavaScript plus .d.ts
  -->

- Updated dependencies [51a6a91]
- Updated dependencies [863e8e4]
- Updated dependencies [863e8e4]
  - @cosmicdrift/kumiko-headless@0.328.1
  - @cosmicdrift/kumiko-dispatcher-live@0.328.1
  - @cosmicdrift/kumiko-renderer@0.328.1
  - @cosmicdrift/kumiko-framework@0.328.1
  - @cosmicdrift/kumiko-types@0.328.1

## 0.328.0

### Minor Changes

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

- Updated dependencies [822928f]
- Updated dependencies [fa7b1ff]
  - @cosmicdrift/kumiko-headless@0.328.0
  - @cosmicdrift/kumiko-renderer@0.328.0
  - @cosmicdrift/kumiko-dispatcher-live@0.328.0

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
  - @cosmicdrift/kumiko-renderer@0.327.0
  - @cosmicdrift/kumiko-headless@0.327.0
  - @cosmicdrift/kumiko-dispatcher-live@0.327.0

## 0.326.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.326.1
- @cosmicdrift/kumiko-headless@0.326.1
- @cosmicdrift/kumiko-renderer@0.326.1

## 0.326.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.326.0
- @cosmicdrift/kumiko-renderer@0.326.0
- @cosmicdrift/kumiko-dispatcher-live@0.326.0

## 0.325.2

### Patch Changes

- Updated dependencies [45ce791]
  - @cosmicdrift/kumiko-renderer@0.325.2
  - @cosmicdrift/kumiko-dispatcher-live@0.325.2
  - @cosmicdrift/kumiko-headless@0.325.2

## 0.325.1

### Patch Changes

- Updated dependencies [f3482c4]
  - @cosmicdrift/kumiko-headless@0.325.1
  - @cosmicdrift/kumiko-renderer@0.325.1
  - @cosmicdrift/kumiko-dispatcher-live@0.325.1

## 0.325.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.325.0
- @cosmicdrift/kumiko-renderer@0.325.0
- @cosmicdrift/kumiko-dispatcher-live@0.325.0

## 0.324.0

### Patch Changes

- 0748ee6: Fix root-screen resolution so a bookmarked screen removed by role projection falls back to a reachable landing screen instead of rendering "Screen not found".

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: An explicit screenQn missing from the role-projected schema falls back to the first reachable screen
  detail: |
    createKumikoApp's root route used an explicit screenQn unchecked; when the server's role
    projection removed that screen for the caller, /a showed "Screen not found". It now lands
    on the first reachable screen. A visible explicit screen and unprojected schemas are unchanged.
  -->

  - @cosmicdrift/kumiko-headless@0.324.0
  - @cosmicdrift/kumiko-renderer@0.324.0
  - @cosmicdrift/kumiko-dispatcher-live@0.324.0

## 0.323.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.323.0
- @cosmicdrift/kumiko-renderer@0.323.0
- @cosmicdrift/kumiko-dispatcher-live@0.323.0

## 0.322.0

### Patch Changes

- Updated dependencies [9e7bedc]
  - @cosmicdrift/kumiko-renderer@0.322.0
  - @cosmicdrift/kumiko-headless@0.322.0
  - @cosmicdrift/kumiko-dispatcher-live@0.322.0

## 0.321.0

### Patch Changes

- fa27809: A pure SystemAdmin (or any caller whose visible screens are all role-restricted) landed on a "no-open-screen" error banner in fetch mode

  `AppSchemaBoundary`'s landing fallback (`screenQn ?? firstOpenScreenQn(app.features)`) assumed the fetched `GET /api/schema` still contained the caller's role-restricted screens, but that schema is already role-projected server-side — invisible screens and navs are removed before the client ever sees them. A caller left with only role-restricted screens (e.g. a pure `SystemAdmin`) got `firstOpenScreenQn` returning `undefined` and saw the error banner instead of their app.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Landing fallback for a role-projected fetched schema now considers every nav-reachable screen, not just open-to-all ones
  detail: |
    New export `firstLandingScreenQnForProjectedSchema(features)`: tries
    `firstOpenScreenQn(features)` first (so regular users keep today's
    landing), then falls back to the first nav-reachable screen regardless
    of `access` (the server already removed anything the caller's roles may
    not see). `AppSchemaBoundary` now takes a `schemaIsRoleProjected: boolean`
    prop; `KumikoAppRoot` passes `isFetchMode`. The sync path
    (`options.schema`/injected `__KUMIKO_SCHEMA__`, unprojected, pre-auth)
    is unchanged and still strict.
  migration: |
    No action needed — this only affects the fetch-mode landing fallback and
    widens it, it never narrows an existing landing choice.
  -->

  - @cosmicdrift/kumiko-headless@0.321.0
  - @cosmicdrift/kumiko-renderer@0.321.0
  - @cosmicdrift/kumiko-dispatcher-live@0.321.0

## 0.320.0

### Minor Changes

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

- c61cc7a: `navigateWithReturnTo` accepts entity ObjectTargets, so row navigate actions, legacy rowClick and the default detailFor row click now carry `returnTo` the same way screen targets already do (fw#3260)

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: navigateWithReturnTo carries returnTo for entity ObjectTargets
  detail: |
    navigateWithReturnTo now accepts a NavTarget (ScreenTarget or ObjectTarget),
    not just ScreenTarget. For an entity target it compares the resolved href
    against the host's to detect a self-navigate (no returnTo) and otherwise
    sets returnTo to the host snapshot, same as the existing screen-target
    path. runProjectionRowNavigate, buildNavigateRecordAction, EntityListBody's
    row navigate and related-list-section's legacy rowClick now go through
    this for entity actions.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: The default detailFor row click carries returnTo
  detail: |
    create-app's default row click to a declared detailFor screen now calls
    navigateWithReturnTo with the current host, so navigating to an entity's
    detail screen from a list carries returnTo like every other navigate
    action already does.
  -->

- 02cc7b3: GET /api/schema now returns a per-role projection instead of the full AppSchema to every authenticated user

  `buildAppSchema`'s output previously shipped every screen, nav, workspace and content-collection to any signed-in caller, regardless of role — a screen's own `access` rule only ever hid it in the UI, never removed it from the payload a curious client could still read. `projectAppSchemaForRoles` now strips every screen/nav/workspace/content-collection reference the caller's roles can't see (screens, nav entries, row/toolbar/related-list actions, entityEdit redirects, dashboard panels and metric navigation targets, tree actions, workspace nav membership) before the route serializes a response, closing empty parent nav sections and workspaces left with no surviving members along the way. Entities and translations are still shipped in full — the projection is a UI-visibility concern, not an entity-authorization concern; the dispatcher's `hasAccess` default-deny check is unchanged.

  The route now builds the full schema lazily once per process and caches the projected JSON/ETag per canonical (deduplicated, sorted) role set — tenant is deliberately not part of the cache key, since the projection only depends on roles.

  `isUiAccessGranted` is the new shared default-visible UI predicate in `@cosmicdrift/kumiko-types`, re-exported through `framework/ui-types`. The renderer's `screenAccessAllows` is now an alias of it, and headless nav resolution and renderer-web's workspace filter call it directly instead of carrying their own copies.

  A deep link to a screen the caller's roles no longer receive now shows the "screen not found" banner instead of the access-denied banner, because the screen is no longer part of that caller's schema.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: GET /api/schema now returns a per-role projection instead of the full AppSchema to every authenticated user
  -->

- Updated dependencies [c61cc7a]
- Updated dependencies [fe36eeb]
- Updated dependencies [02cc7b3]
- Updated dependencies [c61cc7a]
  - @cosmicdrift/kumiko-renderer@0.320.0
  - @cosmicdrift/kumiko-headless@0.320.0
  - @cosmicdrift/kumiko-dispatcher-live@0.320.0

## 0.319.0

### Patch Changes

- @cosmicdrift/kumiko-renderer@0.319.0
- @cosmicdrift/kumiko-dispatcher-live@0.319.0
- @cosmicdrift/kumiko-headless@0.319.0

## 0.318.0

### Minor Changes

- 4fac08d: App theme as one input: `createThemePlugin` from `@cosmicdrift/kumiko-renderer-web/theme-plugin`, plus font, shadow and spacing tokens

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: App theme as one Tailwind plugin instead of duplicated @theme and :root blocks
  detail: |
    An app declares its colors (a string, or `{ light, dark }`), base radius, fonts, card shadow and card padding once in `defineAppTheme({...})`, default-exports `createThemePlugin(theme)` from e.g. `src/theme.ts`, and adds `@plugin "./theme.ts";` after the renderer-web import in its styles.css. The plugin writes into the same base layer after the framework palette, so the app values win in light and dark mode without repeating them in `:root`/`.dark`; colors the framework does not know get utilities (`bg-brand-soft`). `fonts.sans` also sets the body font. The framework's `--card-padding/--card-radius/--card-shadow` defaults moved into `@layer base` (an app's unlayered `:root` still overrides them, an app `@theme` value still does not). CoreTokens gain `font`, `shadow.card` and `spacing.card`. Apps that already duplicate their palette in unlayered `:root`/`.dark` blocks must drop those blocks when switching to the plugin, since unlayered CSS beats it.
  -->

- 4fac08d: Formal or informal address per surface: FormalityProvider, `createPublicSurface({ formality })` and a `de-x-formal` bundle in locale-de

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Formal or informal address per surface
  detail: |
    `FormalityProvider` (and `createPublicSurface({ formality: "formal" })`) makes `t()` look up `<locale>-x-formal` across all plugin bundles before the plain locale, so public pages can say "Sie" while the app keeps "du". `formalLocaleTag(locale)` builds the tag. locale-de now ships `de-x-formal` overrides for its framework strings. Only bundle lookups are affected: an app resolver that already knows a key answers first, and an app that overrides a framework key in plain "de" needs a matching "de-x-formal" entry for formal surfaces.
  -->

- 4fac08d: Building blocks for public and wizard pages: clickable StepBar, success progress tone, StickyActionBar, CopyButton/ShareButton, PromoPanel, PhotoSlots and PublicShell

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Public-page building blocks (StepBar back navigation, sticky actions, copy/share, promo, photo slots, public shell)
  detail: |
    StepBar takes `onStepSelect` (completed steps become buttons, so a wizard can jump back) and `narrowLayout` ("label" or "steps"); wizard forms wire it to jump back without validating. ProgressBar gains `tone: "success"`. New optional primitives: StickyActionBar (bottom-pinned action row with safe-area padding and an optional back action), CopyButton (clipboard with a copied state), ShareButton (`target: "whatsapp"` opens wa.me, `target: "system"` opens the share sheet and renders nothing where the browser has none, so pair it with a CopyButton) plus `buildWhatsAppShareUrl`, and PromoPanel (offer surface on its own `--color-promo*` tokens instead of an info banner). New widgets: PhotoSlots (one tile per required shot with thumbnail, per-slot upload and error, optional camera capture; UploadZone forwards `capture` too) and PublicShell (`variant` "marketing", "focus" with a progress slot, or "card"). The new primitives are optional in CorePrimitives, so existing registries keep compiling.
  -->

- 4c5152f: Add PlanCard/PlanGrid widgets for billing plan catalogs

  PlanCard renders a plan's title, price (via formatMoney), features, a primary cta and an optional secondaryAction (e.g. manage-subscription), with current/disabled states. PlanGrid lays out a set of PlanCards responsively. Used by billing-foundation's BillingPlansPanel.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Add PlanCard/PlanGrid widgets for billing plan catalogs
  -->

### Patch Changes

- Updated dependencies [4fac08d]
- Updated dependencies [4fac08d]
- Updated dependencies [4fac08d]
  - @cosmicdrift/kumiko-renderer@0.318.0
  - @cosmicdrift/kumiko-headless@0.318.0
  - @cosmicdrift/kumiko-dispatcher-live@0.318.0

## 0.317.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.317.0
- @cosmicdrift/kumiko-renderer@0.317.0
- @cosmicdrift/kumiko-dispatcher-live@0.317.0

## 0.316.0

### Patch Changes

- aa32979: An app footer-slot action can now opt into the wizard's sticky primary group (fw#1918 follow-up)

  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: An app footer-slot action can opt into the wizard's sticky primary group
  detail: |
    fw#1918 pinned the primary action into a sticky footer on mobile by checking
    each form-action element's `type === "submit"` prop. An app's
    `screen.slots.footer` renders through EditSlotMount, which never carries
    `type="submit"` (its button is opaque app code), so that slot always landed
    in the non-sticky secondary group even on a wizard's last step — regressing
    apps like offlot-app whose wizard-final "Publish" action lives in the footer
    slot. `ScreenSlots.footerPrimary?: boolean` now marks that slot as the
    sticky-primary action; `FormFooter` in kumiko-renderer-web recognizes it via
    the shared `STICKY_PRIMARY_ACTION_PROP` marker exported from kumiko-renderer.
    Built-in submit buttons are unaffected.
  migration: |
    Additive — no action needed unless a footer-slot action must become the
    sticky primary action on mobile. Set `slots.footerPrimary: true` next to
    that screen's `slots.footer` registration to opt in.
  -->

- Updated dependencies [aa32979]
  - @cosmicdrift/kumiko-renderer@0.316.0
  - @cosmicdrift/kumiko-headless@0.316.0
  - @cosmicdrift/kumiko-dispatcher-live@0.316.0

## 0.315.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.315.0
- @cosmicdrift/kumiko-renderer@0.315.0
- @cosmicdrift/kumiko-dispatcher-live@0.315.0

## 0.314.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.314.0
- @cosmicdrift/kumiko-renderer@0.314.0
- @cosmicdrift/kumiko-dispatcher-live@0.314.0

## 0.313.0

### Patch Changes

- 8e5e170: Four mobile-viewport (390px) fixes: tab-strip overflow, sticky wizard footer, facet-reset i18n, segmented-select placeholder/borders

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: DefaultTabs shows an edge fade and keeps the active tab scrolled into view when the strip overflows on narrow viewports
  detail: |
    At 390px, a tab strip with more tabs than fit gave no visible hint that
    it scrolled, and the active tab could end up scrolled out of view with
    no way to tell. The scroller now renders a mask-image edge fade on
    whichever side is scrollable (updated on scroll/resize via a guarded
    ResizeObserver), and scrolls the active trigger into view via
    `scrollLeft` — not `scrollIntoView`, which would also scroll the page
    vertically — on mount and on every activeId change.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Wizard form footer on mobile now only pins the primary action, not Back/Cancel
  detail: |
    Below 640px, DefaultForm's stickyActions pinned the whole footer
    (Back, Next/Submit, and secondaryActions like Cancel) to the viewport
    bottom together. Only the actual submit-type action needs that
    treatment (fw#1918: stay reachable above a virtual keyboard) — Back and
    secondaryActions now render in normal document flow alongside each
    other, while the primary action keeps its own `max-sm:fixed` bar.
    Desktop (sm+) layout is unchanged.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: DataTable's facet-reset button is now translatable ("Reset")
  detail: |
    The facet-filter Reset button rendered a hardcoded English "Reset"
    regardless of locale. It now resolves kumiko.list.filter.reset (falling
    back to "Reset"), with German ("Zurücksetzen") and Spanish
    ("Restablecer") translations added to locale-de/locale-es.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Select-as-SegmentedSelect excludes the placeholder option and fixes borders on wrapped segments
  detail: |
    A `""`-value placeholder option counted toward the ≤4-option segmented-
    control threshold and rendered as its own (permanently unchecked)
    segment — it's now filtered out of both the eligibility count and the
    rendered segments, consistently for the radio-group and dropdown
    fallback. Separately, the container's `divide-x` only drew vertical
    borders between siblings in source order, which misplaced borders once
    segments wrapped to a second row (a stray left border, no line between
    rows); each segment now carries its own collapsing top/left border
    instead, correct for any wrap arrangement.
  -->

- Updated dependencies [8e5e170]
  - @cosmicdrift/kumiko-renderer@0.313.0
  - @cosmicdrift/kumiko-headless@0.313.0
  - @cosmicdrift/kumiko-dispatcher-live@0.313.0

## 0.312.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.312.0
- @cosmicdrift/kumiko-renderer@0.312.0
- @cosmicdrift/kumiko-dispatcher-live@0.312.0

## 0.311.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.311.0
- @cosmicdrift/kumiko-headless@0.311.0
- @cosmicdrift/kumiko-renderer@0.311.0

## 0.310.0

### Patch Changes

- Updated dependencies [4f36c3f]
  - @cosmicdrift/kumiko-renderer@0.310.0
  - @cosmicdrift/kumiko-headless@0.310.0
  - @cosmicdrift/kumiko-dispatcher-live@0.310.0

## 0.309.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.309.0
- @cosmicdrift/kumiko-renderer@0.309.0
- @cosmicdrift/kumiko-dispatcher-live@0.309.0

## 0.308.0

### Patch Changes

- 6e5ed00: The DefaultTabs strip scrolls horizontally in itself instead of widening the page (fw#3234)

  A tab strip with more tabs than fit the viewport previously pushed the page's own width out. The strip now sits in its own overflow-x-auto container (`min-w-0` on both the Tabs root and that container, so the flex child can actually shrink below its content width for overflow-x-auto to take effect).

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: The DefaultTabs strip scrolls horizontally in itself instead of widening the page (fw#3234)
  -->

- 685ecc9: `import { z } from "zod"` pulled the whole zod namespace — including all 63 locales and the json-schema module — into every client bundle that imported it (359 KB in a publicstatus admin bundle). All framework packages now use `import * as z from "zod"`, which Bun.build can tree-shake (a probe bundle went from 264 KB to 67 KB). A new Biome rule (`noRestrictedImports` on `packages/*/src/**`) keeps `{ z }` from coming back.

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: zod namespace import lets client bundles tree-shake unused locales
  -->

- Updated dependencies [6e5ed00]
- Updated dependencies [6e5ed00]
- Updated dependencies [685ecc9]
  - @cosmicdrift/kumiko-headless@0.308.0
  - @cosmicdrift/kumiko-renderer@0.308.0
  - @cosmicdrift/kumiko-dispatcher-live@0.308.0

## 0.307.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.307.0
- @cosmicdrift/kumiko-renderer@0.307.0
- @cosmicdrift/kumiko-dispatcher-live@0.307.0

## 0.306.0

### Patch Changes

- Updated dependencies [961c8c2]
- Updated dependencies [d92ebf4]
  - @cosmicdrift/kumiko-renderer@0.306.0
  - @cosmicdrift/kumiko-headless@0.306.0
  - @cosmicdrift/kumiko-dispatcher-live@0.306.0

## 0.305.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.305.0
- @cosmicdrift/kumiko-renderer@0.305.0
- @cosmicdrift/kumiko-dispatcher-live@0.305.0

## 0.304.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.304.0
- @cosmicdrift/kumiko-headless@0.304.0
- @cosmicdrift/kumiko-renderer@0.304.0

## 0.303.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.303.0
- @cosmicdrift/kumiko-renderer@0.303.0
- @cosmicdrift/kumiko-dispatcher-live@0.303.0

## 0.302.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.302.0
- @cosmicdrift/kumiko-renderer@0.302.0
- @cosmicdrift/kumiko-dispatcher-live@0.302.0

## 0.301.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.301.0
- @cosmicdrift/kumiko-renderer@0.301.0
- @cosmicdrift/kumiko-dispatcher-live@0.301.0

## 0.300.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.300.0
- @cosmicdrift/kumiko-renderer@0.300.0
- @cosmicdrift/kumiko-dispatcher-live@0.300.0

## 0.299.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.299.0
- @cosmicdrift/kumiko-headless@0.299.0
- @cosmicdrift/kumiko-renderer@0.299.0

## 0.298.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.298.0
- @cosmicdrift/kumiko-renderer@0.298.0
- @cosmicdrift/kumiko-dispatcher-live@0.298.0

## 0.297.0

### Minor Changes

- f20a9d6: `NavIconKey` gains `"image"`

  The icon vocabulary had no picture icon, so a photos action or nav entry had to
  borrow `file` or `folder`. `"image"` maps to lucide's `ImageIcon` in the web
  renderer.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: NavIconKey gains "image"
  -->

### Patch Changes

- @cosmicdrift/kumiko-renderer@0.297.0
- @cosmicdrift/kumiko-headless@0.297.0
- @cosmicdrift/kumiko-dispatcher-live@0.297.0

## 0.296.0

### Patch Changes

- Updated dependencies [cb6e8a4]
- Updated dependencies [3c34575]
  - @cosmicdrift/kumiko-renderer@0.296.0
  - @cosmicdrift/kumiko-headless@0.296.0
  - @cosmicdrift/kumiko-dispatcher-live@0.296.0

## 0.295.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.295.0
- @cosmicdrift/kumiko-headless@0.295.0
- @cosmicdrift/kumiko-renderer@0.295.0

## 0.294.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.294.1
- @cosmicdrift/kumiko-renderer@0.294.1
- @cosmicdrift/kumiko-dispatcher-live@0.294.1

## 0.294.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.294.0
- @cosmicdrift/kumiko-renderer@0.294.0
- @cosmicdrift/kumiko-dispatcher-live@0.294.0

## 0.293.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.293.0
- @cosmicdrift/kumiko-renderer@0.293.0
- @cosmicdrift/kumiko-dispatcher-live@0.293.0

## 0.292.0

### Minor Changes

- 6d53c10: A projectionList can declare a time-range filter

  A list bound to a query that already accepts time bounds had no way to expose them: `ListFacetSpec` knew `select`, `boolean` and `reference`, so every list with a timestamp — which, through `createdAt`, is practically every list — could be searched but not narrowed to "the week the incident happened". The audit log shipped a `description` promising date filters that no control backed.

  `{ type: "dateRange", field, label, params: { from, to } }` closes that. The renderer maps it to two native `<input type="date">` next to the facet dropdowns (no date dependency; the browser supplies the calendar, the locale and the keyboard handling) and sends the picked bounds as the two query params the facet names — explicit rather than a `from`/`to` convention, since a query is free to call them anything, and checked against the handler's Zod schema at boot. Filtering stays server-side; either bound alone is a valid open interval; changing the range resets the page like every other facet; an inverted range is clamped in the UI instead of reaching the handler's `from <= to` refine.

  A calendar date covers a whole day in the viewer's time zone: "to the 14th" includes everything through the last instant of the 14th, computed across DST boundaries rather than by adding 24 hours. `audit:screen:audit-log` now declares the facet on `createdAt`, so its description holds.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: A projectionList can declare a time-range filter
  -->

### Patch Changes

- Updated dependencies [787c572]
- Updated dependencies [6d53c10]
- Updated dependencies [b0e4cd4]
  - @cosmicdrift/kumiko-renderer@0.292.0
  - @cosmicdrift/kumiko-headless@0.292.0
  - @cosmicdrift/kumiko-dispatcher-live@0.292.0

## 0.291.0

### Patch Changes

- Updated dependencies [0fd6bb5]
- Updated dependencies [229298b]
- Updated dependencies [4c06abc]
  - @cosmicdrift/kumiko-renderer@0.291.0
  - @cosmicdrift/kumiko-headless@0.291.0
  - @cosmicdrift/kumiko-dispatcher-live@0.291.0

## 0.290.0

### Minor Changes

- bcfbb28: Export Icon and NavIconKey from the package root

  Export `Icon` and `NavIconKey` from the package root so consumers can render a decorative icon outside `Button`/`Input`.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Export Icon and NavIconKey from the package root
  -->

### Patch Changes

- d2bd28d: DetailList sizes its label column from the container

  DetailList now sizes its label column from its own container width instead of the viewport, so it stacks correctly in narrow panels regardless of screen size.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: DetailList sizes its label column from the container
  -->

- Updated dependencies [9da6b5f]
  - @cosmicdrift/kumiko-renderer@0.290.0
  - @cosmicdrift/kumiko-headless@0.290.0
  - @cosmicdrift/kumiko-dispatcher-live@0.290.0

## 0.289.0

### Patch Changes

- 8b14589: fix(renderer-web): timestamp input emits seconds

  `inputValueToTimestamp` assembled the Z-instant from hours and minutes and
  left the seconds off (`2026-09-01T10:00Z`). Write schemas validate
  `timestamp` fields without `locatedBy` using `z.iso.datetime()`, which
  requires `HH:mm:ssZ`.

  Externally visible: a required `timestamp` field without `locatedBy` could
  never be saved through the web UI — every save ended in `422 invalid_format`
  on that field. The Bug-Bash-2 regression test (`timestamp-input.test.tsx`)
  already covered the case and was red; back then the missing `Z` was added,
  the seconds were not.

  The emitted seconds are always `00` in practice, because
  `timestampToInputValue` truncates inbound values to minutes. That truncation
  is pre-existing and untouched here.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: timestamp input emits seconds
  -->

- Updated dependencies [a200a5c]
  - @cosmicdrift/kumiko-headless@0.289.0
  - @cosmicdrift/kumiko-renderer@0.289.0
  - @cosmicdrift/kumiko-dispatcher-live@0.289.0

## 0.288.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.288.0
- @cosmicdrift/kumiko-headless@0.288.0
- @cosmicdrift/kumiko-renderer@0.288.0

## 0.287.0

### Patch Changes

- 76f2631: `validateBoot` now accepts an optional `navAllowlist` and warns at boot for every declared nav whose screen isn't reachable from any allowlisted nav entry, since such a screen was silently unreachable via the sidebar with no signal (fw#3019, hit twice: solon#113 and offlot's VIN screen). A new `navAllowlistExempt` option suppresses the warning for navs that are deliberately left out of the allowlist because their screen is reachable another way (e.g. a generated settings hub). When an app has no explicit `navAllowlist` but does have workspaces, the allowlist is now derived automatically from `r.workspace({ nav })` and `r.nav({ workspaces })` assignments — covering solon#113's case without requiring solon to pass anything. `filterAppSchemaNavsByAllowlist` and `NavReparentOverride`, previously duplicated per-app, are now exported from `@cosmicdrift/kumiko-renderer-web`.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: boot-time reachability warning for nav entries outside the app's sidebar allowlist, filter helper moved into the framework
  detail: |
    Adds `warnOnUnreachableNavScreens(allNavQns, allowedNavQns, navAllowlistExempt?)`
    to packages/framework/src/engine/boot-validator/nav.ts, in the same
    non-fatal console.warn style as the existing warnOnNavAccessInversion.
    The rule checks screen reachability, not nav-QN membership: it builds
    the set of screens reached by an allowlisted nav, then warns for every
    unallowlisted nav whose screen isn't in that set. A naive "nav QN not
    in allowlist" rule was tried first and measured against the real
    offlot-app schema (58 navs, 30 allowlisted) — it fired 28 warnings per
    boot, mostly app-shell leaves that intentionally re-target a screen an
    allowlisted nav already reaches, which would have buried the one real
    bug (offlot's VIN screen) in noise. The reachability rule fires 8 times
    on the same schema, all of them either the real bug or exemptable.
    ValidateBootOptions gains `navAllowlist?: ReadonlySet<string>` and
    `navAllowlistExempt?: ReadonlySet<string>`; when navAllowlist is set,
    validateBoot calls the new warning right after warnOnNavAccessInversion,
    passing navAllowlistExempt through so an app can mark navs whose screen
    is reachable outside the sidebar (e.g. as a sub-page of a generated
    settings hub) without regenerating the noise.
    Separately, `filterAppSchemaNavsByAllowlist` and `NavReparentOverride`
    move from offlot-app's local copy into
    packages/renderer-web/src/layout/filter-app-schema-navs.ts and are now
    exported from @cosmicdrift/kumiko-renderer-web, reusing nav-tree.tsx's
    existing (now exported) qualifyNavId instead of keeping a second copy
    of that qualification logic in sync across apps.
    fw#3019 covered offlot's app-local allowlist but not solon#113, which
    assigns navs to workspaces via `r.workspace({ nav: [...] })` and never
    passes navAllowlist — the warning stayed silent for that shape.
    packages/framework/src/engine/boot-validator/workspaces.ts gains
    `deriveNavAllowlistFromWorkspaces(allNavQns, allWorkspaceQns)`, which
    unions every `WorkspaceDefinition.nav` entry with every nav QN whose
    `NavDefinition.workspaces` self-assigns to at least one workspace — both
    fields already hold fully-qualified QNs (same as validateWorkspaces /
    validateNavs compare them), so no re-qualification step is needed.
    `resolveNavAllowlist(explicitAllowlist, allNavQns, allWorkspaceQns)`
    wraps it: an explicit `navAllowlist` always wins, otherwise the derived
    set is used only when the app has at least one workspace (an app with
    none must produce no warnings), else `undefined` (no check runs).
    validateBoot now calls `resolveNavAllowlist` before
    warnOnUnreachableNavScreens instead of gating on `options.navAllowlist`
    directly.
  -->

  - @cosmicdrift/kumiko-headless@0.287.0
  - @cosmicdrift/kumiko-renderer@0.287.0
  - @cosmicdrift/kumiko-dispatcher-live@0.287.0

## 0.286.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.286.0
- @cosmicdrift/kumiko-renderer@0.286.0
- @cosmicdrift/kumiko-dispatcher-live@0.286.0

## 0.285.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.285.2
- @cosmicdrift/kumiko-renderer@0.285.2
- @cosmicdrift/kumiko-dispatcher-live@0.285.2

## 0.285.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.285.1
- @cosmicdrift/kumiko-headless@0.285.1
- @cosmicdrift/kumiko-renderer@0.285.1

## 0.285.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.285.0
- @cosmicdrift/kumiko-renderer@0.285.0
- @cosmicdrift/kumiko-dispatcher-live@0.285.0

## 0.284.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.284.0
- @cosmicdrift/kumiko-renderer@0.284.0
- @cosmicdrift/kumiko-dispatcher-live@0.284.0

## 0.283.0

### Patch Changes

- Updated dependencies [a628640]
  - @cosmicdrift/kumiko-renderer@0.283.0
  - @cosmicdrift/kumiko-headless@0.283.0
  - @cosmicdrift/kumiko-dispatcher-live@0.283.0

## 0.282.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.282.0
- @cosmicdrift/kumiko-headless@0.282.0
- @cosmicdrift/kumiko-renderer@0.282.0

## 0.281.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.281.0
- @cosmicdrift/kumiko-renderer@0.281.0
- @cosmicdrift/kumiko-dispatcher-live@0.281.0

## 0.280.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.280.0
- @cosmicdrift/kumiko-renderer@0.280.0
- @cosmicdrift/kumiko-dispatcher-live@0.280.0

## 0.279.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.279.0
- @cosmicdrift/kumiko-renderer@0.279.0
- @cosmicdrift/kumiko-dispatcher-live@0.279.0

## 0.278.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.278.0
- @cosmicdrift/kumiko-renderer@0.278.0
- @cosmicdrift/kumiko-dispatcher-live@0.278.0

## 0.277.0

### Patch Changes

- Updated dependencies [11e6de2]
  - @cosmicdrift/kumiko-renderer@0.277.0
  - @cosmicdrift/kumiko-headless@0.277.0
  - @cosmicdrift/kumiko-dispatcher-live@0.277.0

## 0.276.0

### Minor Changes

- a5347bc: entityEdit and actionForm screens accept `slots.titleAction`: an extension component rendered on the right of the form title, in the same row — for status chips or allowance badges that belong to the screen. `FormProps.titleAction` carries it to the primitives; the web form renders it in `<testId>-title-action`.

### Patch Changes

- Updated dependencies [a5347bc]
  - @cosmicdrift/kumiko-renderer@0.276.0
  - @cosmicdrift/kumiko-headless@0.276.0
  - @cosmicdrift/kumiko-dispatcher-live@0.276.0

## 0.275.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.275.0
- @cosmicdrift/kumiko-renderer@0.275.0
- @cosmicdrift/kumiko-dispatcher-live@0.275.0

## 0.274.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.274.0
- @cosmicdrift/kumiko-renderer@0.274.0
- @cosmicdrift/kumiko-dispatcher-live@0.274.0

## 0.273.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.273.0
- @cosmicdrift/kumiko-renderer@0.273.0
- @cosmicdrift/kumiko-dispatcher-live@0.273.0

## 0.272.0

### Patch Changes

- Updated dependencies [019d115]
  - @cosmicdrift/kumiko-renderer@0.272.0
  - @cosmicdrift/kumiko-headless@0.272.0
  - @cosmicdrift/kumiko-dispatcher-live@0.272.0

## 0.271.0

### Minor Changes

- 94b9d44: Record screens (`projectionDetail` in tabs mode) get a more consistent "Akte" layout. The head card's status badge now sits vertically centered next to the title (`Grid columns="auto"` gains `items-center`), and header actions render inside the head Card's own `headerActions` slot alongside the title/subtitle slots instead of trailing after the metrics band — the head card is built through `DefaultCard`'s existing slot API rather than raw children, with no new primitive. The screen's `description` no longer doubles as a subtitle in tabs mode (the head card already carries title/subtitle/status); it still renders as the form subtitle outside tabs mode, unchanged.

  A `relatedList` section in tabs mode now keeps the same table frame, search box, and facet toolbar a plain list screen has, instead of dropping its card chrome (`chromeless` is no longer set there); only `scrollBody` stays, so a long tab still scrolls inside the panel. `EditRelatedListSection.toolbarActions` is now typed `readonly RelatedListToolbarAction[]` — a relatedList-only extension of `ToolbarAction` (a plain `ToolbarAction` is still a valid entry) that adds `visible?: FieldCondition` on every variant and `params?: RowFieldExtractor` on the `navigate` variant, both evaluated against the enclosing `projectionDetail`'s own record — the "Akte" — instead of a row, the same way header actions (`screen.actions`) already evaluate `visible`/`params` against it. A shared `buildProjectionToolbarActions` in `@cosmicdrift/kumiko-renderer` backs `entityList`/`projectionList`/`relatedList` alike, replacing three near-duplicate implementations; its new optional `record` option carries the parent record through to `visible`/`params` resolution and is only ever passed by `RelatedListSection`. A drawer-kind toolbar action without `onOpenDrawer` wired drops with the same dev warning `rowActions` already give. A navigate-kind toolbar action's declared `params` replaces the section's implicit `{ [parentParam]: parentId }` prefill (e.g. `{ map: { leaseId: "id" } }` to prefill a differently-named form field); without `params` the implicit prefill is unchanged. The boot validator checks `visible.field` and `params`' pick/map source fields against the projectionDetail's query `outputSchema` (`validateActionFieldRefs`, reused from the existing rowAction/toolbarAction check) — additive like the rest of `query-output-columns.ts`: a query with no introspectable `outputSchema` skips the check rather than throwing.

  A list facet can now be `type: "reference"` — its options load at render time from another entity's own list query (label field configurable, value = row id), the same target convention (`entity`/`feature:entity`) as `ListColumnSpec.refEntity`. It works for `entityList` (derived from a `reference` field marked `filterable: true`), `projectionList`, and `relatedList` facets alike, sharing one `ResolvedFacetSpec`/`resolveProjectionFacetSpecs`/`resolveEntityFacetSpecs` pipeline and a new `ReferenceFacetBridges` component (mirrors the existing reference-column lookup bridge). The boot validator checks the referenced entity exists, and — unlike `select`/`boolean` facets — no longer requires a declared column of the same name: a reference facet legitimately filters by an id field (e.g. `propertyId`) while a different column displays the human-readable value (e.g. `propertyLabel`), so the same-name-column check would reject working screens. Its mandatory `entity` (checked above) is this facet type's own field inventory, filling the role the column-name check plays for the other two. `select`/`boolean` facets are unaffected — they still require a matching column.

  `EditRelatedListSection` gains `parentFilter?: { field: string }`, an alternative to `parentParam` that sends the parent record's id as a server-side `filter: { field, op: "eq", value: parentId }` clause instead of a bespoke top-level payload key. This lets a tab section reuse the generic `<entity>:list` query directly — search (including the search index and reference-label search), facets, and their DB-side execution stay identical to a plain list screen, with no bespoke child-rows handler needed. `parentFilter` and `parentParam` are mutually exclusive (the boot validator rejects both); the boot validator also checks `parentFilter.field` against the entity behind `query` when that query is one of the entity-convention factories (`defineEntityListHandler` et al.), and that the query's Zod schema accepts `filter` — same additive, capability-based policy as the existing `filter`/`facets` checks. Toolbar-action prefill (the "+ Add" button's create-form defaults) uses `parentFilter.field` instead of `parentParam`/`id` when `parentFilter` is set, same as the rest of the payload. User-selected facets keep writing only to `filters`, so a parent filter can never be cleared by a facet interaction.

  A `fields`-kind section inside a `projectionDetail`'s tabs layout now renders as its own titled card (2 columns by default) instead of a bare, title-less grid — the tab strip's own short label and the card's title are different strings, so they don't visually duplicate. `EditFieldsSection` gains an optional `groups?: readonly { title, fields, columns? }[]` (mutually exclusive with `fields`, which becomes `[]` when using groups) — each group renders as its own card (2 columns by default); the boot validator checks every field named in a group exists and rejects declaring both `fields` and `groups` non-empty, or neither.

  The bundled `notesHistory` client's `NotesSection` is now two cards — "New note" (the textarea, a subtle "Ctrl+Enter saves" hint, and the submit button) and "History" (entries separated by dividers instead of individual bordered boxes) — built from primitives only. New i18n keys `notesHistory.section.newNoteTitle`, `notesHistory.section.historyTitle`, `notesHistory.section.shortcutHint`.

  **Breaking for apps composing their own feature sets:** the boot validator now requires every screen to be reachable from the app's nav tree — via its own `nav`, a standalone `r.nav()` elsewhere (same convention a consuming app already uses to place a bundled settings-area screen), or a resolvable parent list (`listScreenId`, or a rowAction/toolbarAction/drawer navigate target from an `entityList`/`projectionList`, or — for `entityEdit` — a same-entity `entityList`) — unless the screen declares `dormant: true`. `dormant` (previously `custom`-only) is now available on every screen type; the resolution and the shared `resolveNavParentScreen` helper are the same ones the renderer's breadcrumb/`NavTree` already use, moved into `@cosmicdrift/kumiko-framework/engine/screen-helpers.ts` and re-exported through `ui-types` instead of being duplicated. The check is skipped entirely when a composed feature set registers no nav entries anywhere (a feature/recipe/test fixture booted without an app shell has no nav tree to be orphaned from). Bundled screens already relying on app-side placement are now marked `dormant: true`: `tenant-list`, `user-list`, `sessions-list`/`my-sessions`, `tier-admin`, `api-tokens` (personal-access-tokens list), `tag-list`, `profile` (user-profile), `download-attempt-list`/`privacy-center` (user-data-rights), and `page-list`/`branding-settings` (managed-pages); the three `auth-mfa` self-service screens (`mfa-enable`, `mfa-disable`, `mfa-regenerate-recovery`) are marked `dormant: true` as reachable only via a direct link.

  `ActionFormScreenDefinition` gains `fieldLabels?: Readonly<Record<string, string>>` — same type and semantics as `EntityEditScreenDefinition.fieldLabels`, threaded through the existing `synthesizeActionFormScreen` shim into the same `computeEditViewModel` label resolution entityEdit already uses (no separate resolution path), and honored by `required-surface-keys.ts`'s i18n-completeness check the same way entityEdit's override already is.

### Patch Changes

- Updated dependencies [94b9d44]
  - @cosmicdrift/kumiko-headless@0.271.0
  - @cosmicdrift/kumiko-renderer@0.271.0
  - @cosmicdrift/kumiko-dispatcher-live@0.271.0

## 0.270.0

### Minor Changes

- dba0a60: `openToAll: true` is removed from `OpenToAllAccessRule` — every `openToAll` grant now requires `{ reason: string }`. `isOpenToAllGranted` denies a bare `true` reaching it from an untyped source (pattern JSON, Designer) the same way it already denied a malformed object. The boot validator rejects an untyped `openToAll: true` access declaration with an error pointing at `{ reason }`. The pattern-library Designer access field is now a required text input on `access.openToAll.reason` instead of a boolean toggle. `build-config-feature-schema.ts` synthesizes `{ openToAll: { reason: "..." } }` (instead of `{ openToAll: true }`) for a config key whose roles include `"all"`. `boot-validator/nav.ts` and `renderer-web/app/create-app.tsx` switched from `"openToAll" in access` to `isOpenToAllGranted(access)`. The feature-AST extractor now also extracts `escapeHatch: { reason }` on write/query handlers and on `r.hook` options.

  New codemod `scripts/codemod/migrate-open-to-all.ts` rewrites `openToAll: true` to `openToAll: { reason }` in test files and reports every non-test site for a manual reason.

### Patch Changes

- @cosmicdrift/kumiko-headless@0.270.0
- @cosmicdrift/kumiko-renderer@0.270.0
- @cosmicdrift/kumiko-dispatcher-live@0.270.0

## 0.269.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.269.2
- @cosmicdrift/kumiko-renderer@0.269.2
- @cosmicdrift/kumiko-dispatcher-live@0.269.2

## 0.269.1

### Patch Changes

- 5342133: Fix `Drawer` with `variant="flush" belowHeader` on `side="left"|"right"`: the panel used `h-full` (100% viewport height) together with the header-offset `top`, pushing its bottom edge (and any footer slot) past the viewport. It now switches to `h-auto` so the panel's height follows the top/bottom insets instead, keeping the bottom edge on-screen.
  - @cosmicdrift/kumiko-dispatcher-live@0.269.1
  - @cosmicdrift/kumiko-headless@0.269.1
  - @cosmicdrift/kumiko-renderer@0.269.1

## 0.269.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.269.0
- @cosmicdrift/kumiko-renderer@0.269.0
- @cosmicdrift/kumiko-dispatcher-live@0.269.0

## 0.268.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.268.0
- @cosmicdrift/kumiko-renderer@0.268.0
- @cosmicdrift/kumiko-dispatcher-live@0.268.0

## 0.267.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.267.0
- @cosmicdrift/kumiko-renderer@0.267.0
- @cosmicdrift/kumiko-dispatcher-live@0.267.0

## 0.266.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.266.0
- @cosmicdrift/kumiko-renderer@0.266.0
- @cosmicdrift/kumiko-dispatcher-live@0.266.0

## 0.265.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.265.0
- @cosmicdrift/kumiko-renderer@0.265.0
- @cosmicdrift/kumiko-dispatcher-live@0.265.0

## 0.264.1

### Patch Changes

- c42f1b6: `styles.css`'s Tailwind `@source` scan was missing `bundled-features` entirely, so any app that only imports `@cosmicdrift/kumiko-renderer-web/styles.css` (without its own extra `@source` lines, the workaround `publicstatus` already had to add) shipped unstyled utility classes for every bundled-features web component — `LoginScreen`, the admin shell, MFA and PAT screens, and others. The pre-existing `renderer` scan line was also silently broken for real (non-workspace) consumer installs, since it targeted the unscoped package name (`renderer`) instead of the registry name (`kumiko-renderer`) that actually exists under `node_modules/@cosmicdrift/`.

  Both sibling packages are now scanned with two `@source` variants each — one for the workspace layout (bun-symlinked, resolves via realpath to the unscoped package dir) and one for a real standalone consumer install (scoped registry name) — so classes from `bundled-features` and `renderer` are generated in both layouts without app-side workarounds. Apps that added their own `@source` lines for `bundled-features` (e.g. `publicstatus`) can drop them; the scan now happens once here.

  - @cosmicdrift/kumiko-dispatcher-live@0.264.1
  - @cosmicdrift/kumiko-headless@0.264.1
  - @cosmicdrift/kumiko-renderer@0.264.1

## 0.264.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.264.0
- @cosmicdrift/kumiko-renderer@0.264.0
- @cosmicdrift/kumiko-dispatcher-live@0.264.0

## 0.263.0

### Minor Changes

- db13c00: Three additive primitive gaps closed, surfaced while wiring an AI-agent panel and the Designer's file links:

  - `ShellHeader` now exposes its rendered height as the `--shell-header-height` CSS variable (`0` when no `ShellHeader` is mounted). `Drawer` gets an optional `belowHeader?: boolean` (`variant="flush"` only) that docks the panel below the app header instead of covering it — default `false` keeps today's edge-to-edge behavior.
  - `Card`, `Link`, `Button` and `Input` (`kind="text"`/`"textarea"`) get an optional `dataAttributes?: Readonly<Record<\`data-${string}\`, string>>`prop, forwarded to the rendered DOM node in the web renderer — an escape hatch for E2E selectors that don't warrant a dedicated typed prop, without dropping to a raw`<a>`/`<div>`.
  - `Input` (`kind="text"`/`"textarea"`) gets an optional `onKeyDown` handler, forwarded in the web renderer, so a caller can build "Enter sends, Shift+Enter inserts a newline" at the field itself instead of the surrounding `Form`. Composes with the existing `onSubmitShortcut` (`kind="textarea"`) — both fire on the same keystroke when both are set.

### Patch Changes

- Updated dependencies [db13c00]
- Updated dependencies [f6732fa]
  - @cosmicdrift/kumiko-renderer@0.263.0
  - @cosmicdrift/kumiko-headless@0.263.0
  - @cosmicdrift/kumiko-dispatcher-live@0.263.0

## 0.262.0

### Patch Changes

- Updated dependencies [352d623]
  - @cosmicdrift/kumiko-renderer@0.262.0
  - @cosmicdrift/kumiko-headless@0.262.0
  - @cosmicdrift/kumiko-dispatcher-live@0.262.0

## 0.261.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.261.0
- @cosmicdrift/kumiko-renderer@0.261.0
- @cosmicdrift/kumiko-dispatcher-live@0.261.0

## 0.260.0

### Minor Changes

- 71b9c4b: Four "Akte" bedienkonzept ergonomics improvements for record screens:

  - `projectionDetail`'s header now renders the status badge directly next to the record title instead of on its own line with the subtitle, so the record's state is visible at a glance without a second line.
  - `entityList`, `projectionList` and `relatedList` rows now get a default "Edit" row action for free whenever the row's entity has an accessible `entityEdit` screen somewhere in the app — no more hand-declaring the same navigate rowAction on every list. A screen that already declares its own `id: "edit"` rowAction keeps it unchanged (the declared one always wins, never doubled up).
  - Multi-line text inputs (`Input kind="textarea"`) accept a new `onSubmitShortcut` prop: Ctrl+Enter / Cmd+Enter now submits instead of inserting a newline, wired up in the notes-history `NotesSection` so adding a note no longer requires reaching for the mouse.
  - `entityEdit`'s `redirect` now accepts the same object form as `actionForm`'s (`{ screen, idFrom }`), so a child record's edit screen (a deposit movement, a protocol section) can redirect back into the parent's Akte with the parent's id instead of only a list. The id is read from the write handler's success payload first, falling back to the already-loaded record's own field when the handler reports only its own id — matching how `actionForm`'s object-form redirect already resolves.
  - The ledger's `reverse-transaction` (Storno) handler now copies `subjectType`/`subjectId` from the transaction it reverses onto the reversing entry, matching `confirm-schedule-period`. A Storno of a booking without a subject stays without one. Without this, a Storno booked against a subject (a lease, a contract) dropped out of any `subjectId` filter, so an Akte's booking list showed a stale entry with no visible counter-booking.
  - `MetricNavigate` gains an optional `tab`: a metric click can now jump straight into a tab of the current or a target Akte instead of only entities/screens. Set alone, it activates that section on the current record; combined with `screen`/`entity`, it also sets the `?tab=` search param at the destination. The boot-validator rejects an unknown tab id when the target is the current screen.

- 0e819a0: entityEdit/wizard screens mount `slots.footer` (resolved via `extensionSectionComponents`, like the list `slots.header`) in the form footer next to the submit action; the component receives `entityName`, `entityId`, `values`, `hasUnsavedChanges`, `wizardStep` ({index,isLast}, wizard only). Screens without the slot are unchanged; footer action row now wraps on narrow viewports.

  `slots.header` is now also rendered on entityEdit/wizard/projectionDetail/actionForm screens (previously silently ignored outside lists), above the form card.

### Patch Changes

- Updated dependencies [71b9c4b]
- Updated dependencies [0e819a0]
  - @cosmicdrift/kumiko-renderer@0.260.0
  - @cosmicdrift/kumiko-headless@0.260.0
  - @cosmicdrift/kumiko-dispatcher-live@0.260.0

## 0.259.0

### Minor Changes

- 20dc41a: fw#2844 (decision fw#2841): declarative screens are composable. A `dashboard` takes a new `DashboardScreenPanel` (`kind: "screen"`) that embeds another registered screen — `screen` is a same-feature short id or a cross-feature QN `<feature>:screen:<id>`, resolved like actionForm `redirect`. Together with `kind: "custom"` for app content this replaces the "framework screen plus own content" custom screens three consumer apps carried with an `app-feature-structure` lint-ignore.

  - The boot-validator rejects an unresolvable target and target types that can't stand in a tile: `dashboard` (no nesting), `entityEdit`/`projectionDetail` (need a route id), `custom` (use a custom panel), `entityList`. Embeddable: `projectionList`, `actionForm`, `secretMint`, `configEdit`, `secretsEdit`.
  - `visibleWhen: { query, field, eq }` shows the panel only while `field` of the query's flat result equals `eq`. The query runs live, so a write that flips the state (e.g. `auth-mfa:query:user-mfa:status`) swaps panels without reload; hidden while loading. The query is checked against registered query handlers at boot.
  - A user without access to the target screen doesn't get the tile at all — no "access denied" banner inside an otherwise working page.
  - `@cosmicdrift/kumiko-renderer` exports `useEmbeddedScreen(hostFeatureName, screen)`; `DashboardBodyProps` gains the required `featureName` (KumikoScreen passes it; only relevant for a custom dashboard body implementation).

  Bundled self-service screens so account security needs no custom code:

  - `auth-mfa`: `auth-mfa-disable` (actionForm on `auth-mfa:write:disable`) and `auth-mfa-regenerate-recovery` (secretMint on `auth-mfa:write:regenerate-recovery`, one-time reveal of the new codes), next to the existing `auth-mfa-enable`. Exported ids `MFA_DISABLE_SCREEN_ID`, `MFA_REGENERATE_RECOVERY_SCREEN_ID`.
  - `sessions`: `my-sessions` (projectionList, open to every signed-in user) on `sessions:query:user-session:mine` — revoke per row (hidden on the current session) and "sign out all other devices". Exported id `SESSION_MINE_SCREEN_ID`.

  **BREAKING**

  `sessions:query:user-session:mine` returns the paged envelope `{ rows, nextCursor: null }` instead of a bare array, so the projectionList can bind to it (same migration `personal-access-tokens:query:mine` went through). Migration: read `data.rows` instead of `data`. The account-security custom screens in money-horse, publicstatus and kumiko-studio that call this query are superseded by the composition above (money-horse#477, publicstatus#435, kumiko-studio#283).

### Patch Changes

- Updated dependencies [20dc41a]
  - @cosmicdrift/kumiko-renderer@0.259.0
  - @cosmicdrift/kumiko-headless@0.259.0
  - @cosmicdrift/kumiko-dispatcher-live@0.259.0

## 0.258.1

### Patch Changes

- b555e6c: Fix consumer typecheck failures against the published package: `@types/qrcode` was only in `devDependencies`, but both packages publish their `.tsx` sources (typechecked by consumers) and import the runtime `qrcode` package. Consumers don't install `devDependencies`, so `qrcode`'s missing type declarations broke their typecheck (`TS7016`/`TS7006` in `primitives/index.tsx`, introduced by #2840). Moved `@types/qrcode` to `dependencies` in both packages.
- 2eb767b: DataTable column headers now use the same horizontal padding as their body cells, so header labels line up with the values below them.
  - @cosmicdrift/kumiko-headless@0.258.1
  - @cosmicdrift/kumiko-renderer@0.258.1
  - @cosmicdrift/kumiko-dispatcher-live@0.258.1

## 0.258.0

### Minor Changes

- 021e706: `Drawer` gains two optional props, both additive with defaults matching today's behavior exactly: `variant?: "floating" | "flush"` (default `"floating"`) docks the panel flush against the viewport edge instead of the floating detached-panel treatment — full extent, no corner radius, and a border only on the edge facing the app content; `width?: number | string` (default: today's `max(600px, 37.5vw)`) sets the panel's base width for `side="left"|"right"`, superseded by `resize` when that's set. Lets consumers like the AI agent panel render a bounded, edge-docked chat drawer instead of the wide floating panel that overlaps the app header.
- f2e57b4: fw#2548: new `secretMint` screen type for "mint → one-time reveal → confirm" flows — an API token, recovery codes, or any other secret that a write-handler hands back only once in its success payload. `actionForm` can't express this: it discards the success payload after extracting the navigation id, and no query can ever redisplay a secret that was never stored in the clear. `secretMint` renders the same field/section form as `actionForm`, then swaps to a one-time reveal card built from `reveal.fields` — a whitelist of success-payload fields, never the payload as a whole — with an explicit confirm before navigating on. The revealed values live only in the form component's own state, never in the URL, a query cache, or nav. `TextFieldDef` grows a `format: "password"` render hint (masked input, no storage semantics) — such a field is also excluded from a wizard's persisted draft blob, so it is never written to the server in the clear or restored on resume — and the renderer ships a new `SecretReveal` primitive for the reveal card (falls back to `Grid`/`GridCell` when a platform hasn't registered one).

  `personal-access-tokens` is migrated onto it end to end: the former dormant `type: "custom"` screen (a hand-written client component) is now two declarative screens — a `projectionList` for "your tokens" (with a `revoke` row action) and the new `secretMint` for minting one, wired through `patGrantOptions`/`patScopeOptionTranslations`. No app needs a client plugin for this feature anymore.

  **BREAKING**

  1. `personal-access-tokens:query:mine` now returns the paged envelope `{ rows, nextCursor }` instead of a blank array. Migration: callers read `response.rows`. The handler also newly accepts `limit`/`sort`/`sortDirection` and each row carries a computed `status` (`"active" | "revoked" | "expired"`).

  2. The subpath export `@cosmicdrift/kumiko-bundled-features/personal-access-tokens/web` is gone (`personalAccessTokensClient()`, `PatTokensScreen`, `defaultTranslations`). The PAT screens are declarative now and need no client plugin. Migration: remove the `personalAccessTokensClient()` entry from `createKumikoApp({ clientFeatures: [...] })`; an app that embedded `<PatTokensScreen embedded />` directly should navigate to the feature's `api-tokens` screen instead.

- 27166cb: fw#2838: `auth-mfa`'s TOTP enrollment is declarative — the last `type: "custom"` screen in the bundled features, and with it the second `app-feature-structure` lint-ignore, is gone. The enable flow is now one `secretMint` screen: mint (no input) → one-time reveal of the QR code, the manual base32 secret and the eight recovery codes → a confirm step that arms MFA with a code from the authenticator app. The recovery codes still exist only in `enable-start`'s success payload, are never persisted in the clear and no query re-serves them; the short-lived `setupToken` is threaded from the mint payload into the confirm payload through component state alone — it is deliberately not part of `reveal.fields`, so it never reaches the screen, the URL, a query cache or a persisted draft.

  Three generic additions to the `secretMint` screen type carry it (none of them auth-mfa-specific, no feature flags):

  1. `SecretMintConfirmStep` (`screen.confirm`) — a proof-of-receipt form rendered on the reveal card in place of the bare acknowledge button, for a mint whose effect is only armed once the user proves they received the secret. `carry` names mint success-payload fields that are merged into the confirm payload at submit time; they live in component state only and are never rendered or written into form values. The boot-validator rejects a confirm step with no fields, a `wizard`/`tabs` layout, `draft: true` (a persisted draft of a reveal-phase form is the exact leak fw#2548 closed) and a `carry` entry that collides with a confirm field name.
  2. `SecretRevealField.display: "qr"` — renders the value as a scannable QR code. `renderer-web`'s `SecretReveal` primitive ships the implementation (new `qrcode` dependency); platforms without a QR-capable primitive fall back to the monospaced text.
  3. A `secretMint` may declare `fields: {}` with `layout: { sections: [] }` when the mint takes no user input at all — the secret is server-generated and the mint step is just its submit button. `actionForm` still requires at least one field.

  A `secretMint` without a `redirect` now shows a done banner (`kumiko.secretMint.done`, or `confirm.doneMessage`) after the reveal is confirmed, instead of falling back to the mint form where a stray click would mint the secret again.

  `auth-mfa:write:enable-start` takes `accountLabel` as optional now and derives it from the caller's own email when omitted (there is no client component left that could pass the session email); its success payload additionally carries `totpSecret`, the base32 secret the otpauth URI already embeds, for the reveal's manual-entry display. Both are backward compatible. `auth-mfa:query:user-mfa:status` backs no declarative list and keeps its plain `{ enabled }` shape — no paged-envelope migration like `personal-access-tokens:query:mine` needed.

  **BREAKING**

  `@cosmicdrift/kumiko-bundled-features/auth-mfa/web` no longer exports `MfaEnableScreen` / `MfaEnableScreenProps`, and `authMfaClient()` no longer maps a component onto the `auth-mfa-enable` screen id. The subpath itself stays — the login-time `MfaVerifyScreen`, `MfaDisableDialog`, `MfaRegenerateRecoveryDialog` and `MfaSetupPreauthScreen` are unchanged, and `authMfaClient()` is still required for their translations. Migration: an app that embedded `<MfaEnableScreen embedded />` navigates to the `auth-mfa-enable` screen instead; the `onEnabled` callback has no successor — the screen ends on its own done banner, and a host screen that gated on it should re-read `auth-mfa:query:user-mfa:status` when the user navigates back. The `auth.mfa.enable.*` translation keys that only the deleted component used are gone from the client bundle's defaults; overrides for them can be dropped.

- 021e706: Add `mic` and `circle-stop` to the `NavIconKey` vocabulary, with matching lucide-react entries in `NAV_ICONS`. Lets voice-recording controls (e.g. the AI agent panel's speech input) render as `icon`/`size="icon"` buttons instead of falling back to text labels that crowd the input row.
- 021e706: `Input` gains `placeholder` for `kind="textarea"`, `kind="password"` and `kind="number"`, matching the hint-text behavior already present for `kind="text"` — a multiline field no longer loses its placeholder when it grows from single-line, and password/number fields can now carry one too. `Button`'s `children` prop is now optional: an icon-only button (`size="icon"` with a resolved `icon`) no longer needs a dummy `children` value, since the icon plus `ariaLabel` already carry the button's content and accessible name.

### Patch Changes

- Updated dependencies [f2e57b4]
- Updated dependencies [db2f2ed]
- Updated dependencies [27166cb]
- Updated dependencies [021e706]
  - @cosmicdrift/kumiko-renderer@0.258.0
  - @cosmicdrift/kumiko-headless@0.258.0
  - @cosmicdrift/kumiko-dispatcher-live@0.258.0

## 0.257.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.257.0
- @cosmicdrift/kumiko-headless@0.257.0
- @cosmicdrift/kumiko-renderer@0.257.0

## 0.256.0

### Patch Changes

- Updated dependencies [57f2a6f]
  - @cosmicdrift/kumiko-renderer@0.256.0
  - @cosmicdrift/kumiko-headless@0.256.0
  - @cosmicdrift/kumiko-dispatcher-live@0.256.0

## 0.255.2

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.255.2
- @cosmicdrift/kumiko-headless@0.255.2
- @cosmicdrift/kumiko-renderer@0.255.2

## 0.255.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.255.1
- @cosmicdrift/kumiko-renderer@0.255.1
- @cosmicdrift/kumiko-dispatcher-live@0.255.1

## 0.255.0

### Minor Changes

- 0374846: Record-Akte "Bedienkonzept": tabbed detail screens render without a nested card and show a record-field count in the tab label; the metrics band supports click-to-navigate metrics with an overridable label and no longer requires a `fieldLabels` entry when the metric declares its own; the record header subtitle can link out to an absolute URL; header actions never collapse to icon-only, and row actions always keep `[Bearbeiten]` as a visible text button with the rest collapsed to a kebab menu; and `SidebarPanel` gained a `tone="surface"` option for lists that need content colors instead of navigation chrome. Also fixes the confirm dialog so Enter confirms instead of accidentally cancelling.

  Consumer note: a record header with more than two actions now also keeps only one labeled button (`[Bearbeiten]` if declared, else the primary action) and moves the rest into an overflow menu — the same A7 rule already applied to table rows.

### Patch Changes

- Updated dependencies [0374846]
  - @cosmicdrift/kumiko-renderer@0.255.0
  - @cosmicdrift/kumiko-headless@0.255.0
  - @cosmicdrift/kumiko-dispatcher-live@0.255.0

## 0.254.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.254.0
- @cosmicdrift/kumiko-renderer@0.254.0
- @cosmicdrift/kumiko-dispatcher-live@0.254.0

## 0.253.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.253.0
- @cosmicdrift/kumiko-headless@0.253.0
- @cosmicdrift/kumiko-renderer@0.253.0

## 0.252.1

### Patch Changes

- fa78b6d: Fix several `description` slots declared in `packages/types/src/screen.ts` that were never reaching the rendered DOM:

  - `EditWriteFormSection.description` (projectionDetail write-form sections) never reached `WriteFormSection`'s `Section` primitive as a `subtitle`.
  - `RenderEdit` suppressed the screen-level subtitle (from `EntityEditScreenDefinition`/`ProjectionDetailScreenDefinition.description`) whenever `hideSectionTitles` was set — i.e. on every tabs-mode `projectionDetail` screen — even though hiding section titles has nothing to do with hiding the screen's own explanation.
  - `ConfigEditScreenDefinition.description` was dropped by `config-edit-shim.ts`'s `synthesizeConfigEditScreen`, unlike the equivalent `action-form-shim.ts`/`projection-detail-shim.ts` passthroughs.
  - `SecretsEditScreenDefinition.description` was never read by `SecretsEditBody`.
  - `DashboardScreenDefinition.description` was never read by `WebDashboardBody`.

  `entityList`/`projectionList` `.description` and `CustomScreenDefinition.description` are left as-is: the screen title itself was deliberately moved out of `DataTable`'s toolbar into the shell breadcrumb (a nav label, not a description slot), and `CustomScreenBody` renders the author's component with no framework chrome — closing either would mean inventing a new render region, out of scope for this fix.

- Updated dependencies [fa78b6d]
  - @cosmicdrift/kumiko-renderer@0.252.1
  - @cosmicdrift/kumiko-dispatcher-live@0.252.1
  - @cosmicdrift/kumiko-headless@0.252.1

## 0.252.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.252.0
- @cosmicdrift/kumiko-headless@0.252.0
- @cosmicdrift/kumiko-renderer@0.252.0

## 0.251.0

### Minor Changes

- 38b9d84: fw#2640: list screens now end at the same footer distance as every other screen. Form, custom and dashboard screens take their insets from the shared `screenPaddingClassName` token (`px-6 pt-6 pb-12`) via `FormScreenShell`/`PageSection`, but an `entityList`/`projectionList` screen has neither container around it — its screen chrome is `DataTable`'s own outer wrapper, which carried a symmetric `p-6`. A list therefore stopped 24px above the viewport edge while a form stopped 48px above it. `DataTableProps` gains `screenPadding`, set by `EntityListBody` and `ProjectionListBody` (via `RenderList`), which swaps that wrapper's inset for the same shared token — one screen-padding token for all screen types instead of a list-only inset.

  The default is unchanged, so a `DataTable` embedded in a host that already provides its own boundary keeps the symmetric inset: `relatedList` sections (stacked and tabs mode alike) and app-side `<DataTable>` usages render exactly as before. A host sets `screenPadding` or `scrollBody`, not both — the wider bottom inset competes with the flex-fill height budget a tab-panel list depends on.

### Patch Changes

- fb59575: fw#2778: a projectionDetail tab whose only content is a `relatedList` no longer stretches the tab panel to the bottom of the card when the list is short. Since fw#2722/#2737 the whole `fillHeight`/`scrollBody` chain (form card, header/body wrappers, `RelatedListSection`'s `FillContainer`, `DataTable`'s outer wrapper) used `flex-1`, which claims all remaining flex space regardless of content size. Every link in that chain except the two terminal scroll surfaces (`tableInner`/`cardsInner`) now falls back to its initial `flex: 0 1 auto` (sizing to content) while keeping `min-h-0`, so a short list sizes to its rows and a long list still caps at the panel height and scrolls internally, exactly as before. Siblings above/below the card (headerRegion, card title, footer actions, the toolbar row) got `shrink-0` so they stay uncompressed once the card itself is allowed to shrink.
- Updated dependencies [38b9d84]
- Updated dependencies [28ad1f3]
- Updated dependencies [fb59575]
  - @cosmicdrift/kumiko-renderer@0.251.0
  - @cosmicdrift/kumiko-headless@0.251.0
  - @cosmicdrift/kumiko-dispatcher-live@0.251.0

## 0.250.0

### Minor Changes

- 0be08d9: fw#2606: the default presentation heuristic for `kind: "select"` no longer looks at label length. Until now a select rendered as a segmented radio group only when it had at most four options **and** every label was at most 14 characters long. Labels reach the primitive already translated, so the second condition made the widget type depend on the active UI language: the same field rendered as `segmented-${id}` in German and as `combobox-${id}` in English, which broke language-independent e2e selectors and made a row of fields jump on locale switch. The option count is now the only criterion (still at most four); labels that no longer fit wrap inside the group, which already has `flex-wrap`.

  Consumer note: selects with at most four options and long labels now expose `role="radiogroup"` where they previously rendered a combobox. `display: "dropdown"` on the field (or on the `Input` primitive) keeps the combobox where that is the wanted presentation.

- 3737271: fw#2752: `style: "danger"` is now allowed on the `navigate` and `drawer` variants of `RowAction` and `ToolbarAction` — there it only renders the action red, the forced confirm dialog stays bound to the `writeHandler` variants. `ActionFormScreenDefinition.submitStyle: "danger"` marks the form's submit button as destructive.

### Patch Changes

- Updated dependencies [0be08d9]
- Updated dependencies [3737271]
  - @cosmicdrift/kumiko-headless@0.250.0
  - @cosmicdrift/kumiko-renderer@0.250.0
  - @cosmicdrift/kumiko-dispatcher-live@0.250.0

## 0.249.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.249.0
- @cosmicdrift/kumiko-renderer@0.249.0
- @cosmicdrift/kumiko-dispatcher-live@0.249.0

## 0.248.0

### Minor Changes

- 109ff0d: fw#2750: `TreeAction` (the type behind `NavDefinition.createAction` and `.actions`, the "+" and hover-actions on a nav node) now carries `screen` as an alternative to `target` — the same `screen` XOR `target` polymorphism the node itself already has. `target` is now optional. Previously an action could only dispatch via `TargetRef` (the EditorPanel path), so an app with plain screen routes had no way to wire a "+" affordance to a normal route.

  The boot validator (`validateNavs`) rejects a `createAction`/`actions[]` entry that sets neither or both of `screen`/`target`, and rejects a `screen` that isn't a registered screen QN — same error class as the node's own dangling-`screen` check.

  `renderer-web`'s `NodeActions` renders a `KumikoLink` to the route for a `screen`-action and keeps the dispatch-button for a `target`-action, same look either way. Also fixed while touching this: the actions container was hard-pinned `right-7` to clear the collapse-chevron even on non-expandable nodes (the common case for a flat app nav), leaving a 28px gap; it now sits at `right-1` when the node has no chevron.

### Patch Changes

- Updated dependencies [ce67e09]
  - @cosmicdrift/kumiko-renderer@0.248.0
  - @cosmicdrift/kumiko-headless@0.248.0
  - @cosmicdrift/kumiko-dispatcher-live@0.248.0

## 0.247.0

### Minor Changes

- 25cbdd2: fw#2722 (remaining scope — Card-Rahmen already shipped separately): a `relatedList` section can now sort and no longer stretches the page.

  **Sorting.** `ListColumnSpec` gains a `sortable?: boolean` flag and `EditRelatedListSection` gains `defaultSort?: ListSortSpec` — declared per-column, the same shape `entityList.defaultSort` uses, and validated the same way at boot (`defaultSort.field` must name a listed, `sortable: true` column, or the app fails to boot). Both are opt-in: a `relatedList` section that declares neither behaves exactly as before.

  Sorting is applied **client-side**, over the rows already loaded for the section. Unlike `entityList`/`projectionList`, a `relatedList` section has no pager at all — one one-shot fetch, no cursor, no `onReachEnd`. When the server-side `limit` truncates that fetch (`PagedRows.nextCursor !== null`), the loaded rows are only the first page in the server's own order, not "the top N by this column" — sorting that subset client-side would otherwise silently misrepresent it as the latter. `RelatedListSection` now renders an info `Banner` above the table whenever `nextCursor !== null`, independent of whether a sort is active, naming how many rows are shown (`kumiko.list.related-list-truncated`, added to `i18n-defaults.ts` and the `locale-de`/`locale-es` packages). Sending the sort to the server instead would need pagination this section doesn't have, so it was not built for this PR.

  **Height.** A `relatedList` section in a tabs-mode Akte (the layout that already hides the section title, `hideSectionTitles: true`) now fills the tab panel's available height and scrolls its table internally, instead of a fixed `60vh` guess or growing the whole page — the concrete complaint (a 40-row Akte tab pushing the page and making the record unusable, on any viewport height) is fixed. `FormProps` gains a `fillHeight` flag; `RenderEdit` sets it only when tabs mode has narrowed the form to a single, active `relatedList` section (`hideSectionTitles === true && filteredSections[0]?.kind === "relatedList"`) — every other form (multi-section, non-`relatedList` tabs, stacked non-tabs forms, `entityList`/`projectionList`) is untouched. The flag threads a `flex-1 min-h-0` chain from `FormRoot` through `FormScreenShell`, the form's card, `RelatedListSection`'s own wrapper, down to `DataTableProps.scrollBody`'s table body (now `flex-1 min-h-0 overflow-y-auto` instead of `h-[60vh] overflow-y-auto`) — the narrow-viewport card list (`scrollBody`'s `cardsInner()` branch) gets the same `flex-1 min-h-0 overflow-y-auto` treatment so it scrolls internally instead of clipping. No change to `app-layout.tsx`/`DefaultAppShell` was needed: `<main>` is already viewport-bounded with a passive `overflow-auto`, so a child that itself never grows past `<main>`'s available height never triggers it — avoiding nested scrollbars without touching shell code shared by every screen. This depends on the shell's `fill` prop staying at its default `true` (an app-level choice, not per-screen); `fill={false}` is an explicit page-scroll escape hatch that leaves `<main>` height-unbound, so the chain degrades gracefully to the pre-fix, unbounded-growth behavior rather than clipping — grepped across every consuming app repo in the workspace, none currently sets `fill={false}`.

  `@cosmicdrift/kumiko-renderer` stays platform-neutral (no DOM/Tailwind), so the terminal link of this chain — the wrapper around `RelatedListSection`'s `hideTitle` content — can't be a raw `<div>`. `CorePrimitives` gains an optional `FillContainer` primitive (same additive-rollout pattern as `JsonView`/`Drawer`/`Progress`: existing partial `CorePrimitives` test doubles keep compiling), implemented in `renderer-web` as the `flex-1 min-h-0 flex-col` div; `RelatedListSection` falls back to rendering its content unwrapped when a host has no `FillContainer` (e.g. a native impl, where the parent is already a bounded viewport and the wrapper is meaningless).

  Not included: search/facets on `relatedList` (`ListFacetSpec`, as `projectionList` has it). Doing this properly would mean replacing `RelatedListSection`'s synthetic minimal entity (a `{ type: "text" }` field per column, with no real query-schema/facet metadata behind it) with genuine reuse of the `projectionList` path — a structural rebuild out of scope for this PR. Left for a follow-up ticket.

  https://claude.ai/code/session_0135cRvFdyV956Aae8PxyyDd

### Patch Changes

- Updated dependencies [25cbdd2]
- Updated dependencies [0d5f918]
- Updated dependencies [f2f67f5]
  - @cosmicdrift/kumiko-headless@0.247.0
  - @cosmicdrift/kumiko-renderer@0.247.0
  - @cosmicdrift/kumiko-dispatcher-live@0.247.0

## 0.246.0

### Minor Changes

- 0f9687f: fw#2723: `EntityEditScreenDefinition.description` / `ActionFormScreenDefinition.description` (and, by the same `RenderEdit` render path, `ProjectionDetailScreenDefinition.description`) now render as the form's subtitle, in the same visual slot a section's own `description` already fills. The value is run through translate(): an i18n key (the established convention for `description`) resolves to its translation, plain prose passes through unchanged. An i18n `screen:<id>.subtitle` key still wins when present; the field falls back to nothing (no empty subtitle) when neither is set. The existing use of `description` as agent/API metadata is unaffected. Bumped `minor` rather than `patch`: this makes a previously inert, already-shipped field visible in the UI for the first time — an author who set it purely as metadata now sees it rendered.

  fw#2722 (partial — search/sort and list height are still open): a `relatedList` section in a tabs-mode Akte no longer shows a card frame around its table. The tab panel is already the visual boundary — a card nested inside it separated nothing further. `DataTableProps` gained a `chromeless` flag (off by default, so every other `DataTable` consumer — `entityList`, `projectionList` — is unaffected); `RelatedListSection` sets it whenever the enclosing layout already hid the section title (`hideSectionTitles: true`, tabs mode).

  https://claude.ai/code/session_0135cRvFdyV956Aae8PxyyDd

- b5e44ad: Fix a double orientation loss (fw#2724): navigating from a list into a sub-screen that has no nav entry of its own (an `entityEdit`/`actionForm` reached via a row action, for example) used to mark nothing in the sidebar AND shrink the breadcrumb to a single crumb — nearly every non-nav-listed screen in a real consumer app.

  - `listScreenId` (already available on `custom`/`projectionDetail`) is now also accepted on `entityEdit` and `actionForm` screens, naming the parent list screen for breadcrumb and nav-highlight resolution.
  - An explicit `listScreenId` now wins over the existing rowAction/entity-list heuristics on every screen type that carries it (previously the heuristic could override a declared `listScreenId` on `custom`/`projectionDetail`; both resolutions agree on every screen shipped in bundled-features, so no visible change there).
  - `NavTree`'s active-item marking now shares this exact resolution with the breadcrumb (`resolveParentScreenId` in `shell-breadcrumb.ts`): when the routed screen has no node of its own in the nav tree, the resolved parent's nav entry is highlighted instead of nothing. `aria-current="page"` stays reserved for the screen that IS the routed one — the parent-fallback match gets the visual highlight only, not that assertion.
  - This is a visible behavior change for existing apps, by design: any `entityEdit` screen without its own nav entry that shares an entity with a listed `entityList` (or is a rowAction target of one) now lights up that list's nav entry — nothing needs to be declared for this, the existing heuristic just now also drives nav highlighting, not only the breadcrumb.

### Patch Changes

- Updated dependencies [0f9687f]
  - @cosmicdrift/kumiko-renderer@0.246.0
  - @cosmicdrift/kumiko-headless@0.246.0
  - @cosmicdrift/kumiko-dispatcher-live@0.246.0

## 0.245.0

### Minor Changes

- eb6fe2f: fw#2711: a `select` field can now request a radio group instead of hoping for one.

  The web renderer already rendered `kind: "select"` as a WAI-ARIA radio group, but only behind a heuristic — at most 4 options, every label at most 14 characters. An app that wanted the radio group had no way to ask for it; one 15-character label silently turned the whole group into a dropdown. The next consumer then reached for raw `<input type="radio">`, because that was the only way to decide the presentation.

  `SelectFieldDef` and the `Input` primitive's `kind: "select"` both gain an optional `display: "radio" | "dropdown"`. `"radio"` always renders the radio group, whatever the label lengths and option count; `"dropdown"` always renders the combobox. Omitted keeps the existing heuristic, so no existing field changes its rendering.

  `display` is a request, not a contract: custom primitives implementations may ignore it and keep their own presentation. An empty `options` list still renders the dropdown even with `display: "radio"` — an empty radio group has nothing to operate.

### Patch Changes

- Updated dependencies [eb6fe2f]
  - @cosmicdrift/kumiko-headless@0.245.0
  - @cosmicdrift/kumiko-renderer@0.245.0
  - @cosmicdrift/kumiko-dispatcher-live@0.245.0

## 0.244.0

### Patch Changes

- 37fd2ad: Unify screen padding across `PageSection` and `FormScreenShell` (fw#2640). Both now render the shared `screenPaddingClassName` (`px-6 pt-6 pb-12`) instead of `p-6` vs. `px-6 pt-6 pb-12`, so the footer inset below a custom screen or dashboard no longer depends on the screen type. Visible change: custom screens and dashboard screens gain 24px of bottom inset; form screens are unchanged.
  - @cosmicdrift/kumiko-headless@0.244.0
  - @cosmicdrift/kumiko-renderer@0.244.0
  - @cosmicdrift/kumiko-dispatcher-live@0.244.0

## 0.243.4

### Patch Changes

- 8c7b961: Fix `DataTable`'s toolbar cutting off `toolbarEnd` buttons on narrow viewports (e.g. `coa-mapping-list`, `statement-upload-list` at 390px). Neither the toolbar container nor its `toolbarEnd` wrapper allowed wrapping, so extra buttons ran off the right edge instead of onto a new line. Both now carry `flex-wrap`; `ml-auto` still right-aligns `toolbarEnd` on its own flex line once wrapped, so the desktop layout is unchanged when there's enough width.
  - @cosmicdrift/kumiko-dispatcher-live@0.243.4
  - @cosmicdrift/kumiko-headless@0.243.4
  - @cosmicdrift/kumiko-renderer@0.243.4

## 0.243.3

### Patch Changes

- b8e1ce5: Fix the root cause behind fw#2703: any extension section that renders its own `<Form>` via `BareFormProvider` (not just the two `user-profile` sections fw#2703 patched) landed inside `RenderEdit`'s host `<form>`, producing invalid nested `<form>` elements. In a real browser this can make the section's submit fall back to a native GET of the _outer_ form, putting the form's field values in the URL query string.

  `DefaultForm` (`packages/renderer-web/src/primitives/index.tsx`) now checks whether it is already rendering inside another form (`InsideFormContext`) and degrades to a `<div>` instead of a second `<form>` in that case. A captured click on the degraded section's own submit button is intercepted and routed to its `onSubmit` directly, so the button still submits the _inner_ section instead of activating the real ancestor `<form>`.

  Closes #2705.

  - @cosmicdrift/kumiko-dispatcher-live@0.243.3
  - @cosmicdrift/kumiko-headless@0.243.3
  - @cosmicdrift/kumiko-renderer@0.243.3

## 0.243.2

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.243.2
- @cosmicdrift/kumiko-headless@0.243.2
- @cosmicdrift/kumiko-renderer@0.243.2

## 0.243.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.243.1
- @cosmicdrift/kumiko-headless@0.243.1
- @cosmicdrift/kumiko-renderer@0.243.1

## 0.243.0

### Patch Changes

- c56d418: `multiline: { rows: N }` on a `text`/`longText` field now visibly changes the textarea height. The row count reached the rendered `<textarea rows>` attribute all along, but the vendored shadcn Textarea carries `field-sizing: content`, which derives the box height from the content and makes the attribute inert — a declared `rows: 16` still rendered a ~3-line field. The default textarea primitive now also derives an inline `min-height` from `rows`, so the field starts at the declared number of lines and keeps growing with its content. Textareas without an explicit `rows` are unchanged (`min-h-16` as before).
- 91c31af: Raise the tiptap family floor to `^3.30.5` (`@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`).

  `^3.29.2` allowed the fixed version but did not force it, so a lockfile resolved before the advisory stayed on the vulnerable 3.29.2. The tiptap packages are pinned exactly to each other and have to move together, which left consumers working around it with a large `overrides` block. Raising the floor here makes the old resolution impossible at the source.

- Updated dependencies [1feba52]
- Updated dependencies [349d763]
- Updated dependencies [f1e3452]
- Updated dependencies [c56d418]
  - @cosmicdrift/kumiko-headless@0.243.0
  - @cosmicdrift/kumiko-renderer@0.243.0
  - @cosmicdrift/kumiko-dispatcher-live@0.243.0

## 0.242.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.242.0
- @cosmicdrift/kumiko-renderer@0.242.0
- @cosmicdrift/kumiko-dispatcher-live@0.242.0

## 0.241.0

### Minor Changes

- 33059e9: `admin-shell`'s `tenant-overview` and `platform-overview` screens now use declarative `dashboard` screens (`kind: "stat"` panels) instead of custom React components — both render through the generic renderer. Fixes the platform-overview "undefined" tile bug: `tenant:query:list` and `jobs:query:list` didn't return `total` even with `totalCount: true` requested, because their Zod schemas stripped the field before the handler ever saw it.

  Adds `DashboardStatPanel.params` (`@cosmicdrift/kumiko-types`) — static, author-set query parameters merged under the panel's dynamic `filterParams` (`@cosmicdrift/kumiko-renderer-web`'s dashboard body now does that merge).

  Additive query-handler changes: `tenant:query:list` and `jobs:query:list` accept `totalCount: boolean` and return `total` when set (`jobs:query:list`'s total is a real count, not `rows.length`, so it isn't capped by `limit`); `config:query:readiness` gains `missingCount`/`missingTone` alongside the existing `missing` array.

  `PlatformOverviewScreen`/`TenantOverviewScreen` and their supporting `overview-layout`/`overview-query` modules are gone (never public exports — the renderer selects screens by `screen.type`, not a client component registry). The `overview-allowlist` exports (`isOverviewQueryAllowed`, `overviewAllowedQueries`, the allow/forbidden-list constants) stay — they're now checked against the screen definitions in tests instead of gating a client-side dispatch call.

- e6d5315: Adds an optional `JsonView` primitive (`@cosmicdrift/kumiko-renderer`'s `CorePrimitives`/`JsonViewProps`) for structured, syntax-highlighted JSON display, with a web implementation (`@cosmicdrift/kumiko-renderer-web`'s `DefaultJsonView`). Fixes `format: "json"` fields (audit `payload`/`metadata`, job `logs`) and the jsonb/embedded/files/images fallback banner rendering as an unreadable single line — HTML collapses the whitespace/newlines `applyFormatSpec("json")` already produces. `JsonView` receives the raw value (not a pre-stringified string) and stringifies + tokenizes itself; also wired into `EditorPanel`'s unresolved-target args display.

  Optional (not required) on `CorePrimitives` so existing partial `CorePrimitives` mocks/providers keep compiling; every call site falls back to the prior `<Text>`/`<pre>` behavior when no `JsonView` is registered. Never throws on circular references, `BigInt`, or other non-serializable input.

### Patch Changes

- Updated dependencies [43b41b5]
- Updated dependencies [8289b69]
- Updated dependencies [e6d5315]
- Updated dependencies [24d48d5]
  - @cosmicdrift/kumiko-headless@0.241.0
  - @cosmicdrift/kumiko-renderer@0.241.0
  - @cosmicdrift/kumiko-dispatcher-live@0.241.0

## 0.240.0

### Patch Changes

- Updated dependencies [db53bbc]
  - @cosmicdrift/kumiko-headless@0.240.0
  - @cosmicdrift/kumiko-renderer@0.240.0
  - @cosmicdrift/kumiko-dispatcher-live@0.240.0

## 0.239.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.239.0
- @cosmicdrift/kumiko-renderer@0.239.0
- @cosmicdrift/kumiko-dispatcher-live@0.239.0

## 0.238.0

### Patch Changes

- Updated dependencies [8206493]
  - @cosmicdrift/kumiko-headless@0.238.0
  - @cosmicdrift/kumiko-renderer@0.238.0
  - @cosmicdrift/kumiko-dispatcher-live@0.238.0

## 0.237.2

### Patch Changes

- 562b11f: Add an app-wide `screenWidth` option to `createKumikoApp` so a consumer can set the default width for every form/detail screen that doesn't set its own `layout.width`, instead of forking every bundled-feature screen it doesn't own to change one Tailwind class. `FormScreenShell` now reads its default from a `ScreenWidthProvider` context (exported from `@cosmicdrift/kumiko-renderer-web`) instead of a hardcoded `max-w-4xl`; per-screen `layout.width` still wins over the app default. Behavior is unchanged for apps that don't pass `screenWidth` (default stays `"4xl"`).

  Also removes the now-redundant hardcoded `maxWidth` on the bundled `profile`, `privacy-center`, `tier-admin`, and admin-shell overview screens so they inherit the app default too.

  Fixes the Cancel button on form/detail screens having no visible hover state: it used the `link` button variant, which strips the button's box (`h-auto px-0 py-0`); it now uses `secondary` (outline + `hover:bg-accent`) like the framework's other secondary actions.

  Fixes the profile screen's email/password row rendering as two unevenly sized cards followed by a stray full-width row: `items-start` opted the row out of the grid's default stretch behavior, so two cards of different content height sat at their own heights instead of matching each other.

- Updated dependencies [562b11f]
  - @cosmicdrift/kumiko-renderer@0.237.2
  - @cosmicdrift/kumiko-headless@0.237.2
  - @cosmicdrift/kumiko-dispatcher-live@0.237.2

## 0.237.1

### Patch Changes

- da3aed4: Fix the `DataTable` empty state rendering the literal English `No entries.` in translated apps: `DefaultDataTable` now resolves its default empty label through `kumiko.list.no-entries` (already shipped in the framework catalog and translated in `@cosmicdrift/kumiko-locale-de`/`-es`) instead of a hardcoded string. This covers every caller that does not pass its own `emptyState` — notably the `relatedList` path of a `projectionDetail`, where an empty list in a German app showed `No entries.` Callers outside a `LocaleProvider` still fall back to the English literal.
  - @cosmicdrift/kumiko-headless@0.237.1
  - @cosmicdrift/kumiko-renderer@0.237.1
  - @cosmicdrift/kumiko-dispatcher-live@0.237.1

## 0.237.0

### Patch Changes

- 9b2eae0: Fix a list screen looking clickable when clicking a row was actually a silent no-op: `effectiveOnRowClick` in `createKumikoApp` is now `undefined` for the active list screen unless it has a reachable target (a `detailFor` detail screen for its entity, an app-wide `onRowClick`, or an `entityEdit` screen for the entity) — no target now means no `cursor-pointer` and no click handler on the rows instead of an unconditionally-wired one.

  Also:

  - Corrected `FormScreenShell`'s doc comment, which claimed its default width matches full-width list chrome — the actual default is `4xl` (a centered column).
  - `PageSection` (primitives/layout.tsx) gains an optional `maxWidth` prop reusing the same 3xl/4xl/full class map as `FormScreenShell` (now defined once and shared); `dashboard-body.tsx`'s hand-rolled dashboard-screen container (`WebDashboardBody`, not the list path — a list screen's own padding comes from `DataTable`'s wrapper in primitives/index.tsx, left as-is) now renders through `PageSection` instead of duplicating its padding.
  - The nav boot-validator now warns (never fails boot) when a nav leaf's role gate is disjoint from its parent section's role gate — a section that only certain roles can reach but whose child requires a completely different role set renders with zero visible children for every user who can see it.
  - @cosmicdrift/kumiko-headless@0.237.0
  - @cosmicdrift/kumiko-renderer@0.237.0
  - @cosmicdrift/kumiko-dispatcher-live@0.237.0

## 0.236.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.236.1
- @cosmicdrift/kumiko-renderer@0.236.1
- @cosmicdrift/kumiko-dispatcher-live@0.236.1

## 0.236.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.236.0
- @cosmicdrift/kumiko-renderer@0.236.0
- @cosmicdrift/kumiko-dispatcher-live@0.236.0

## 0.235.4

### Patch Changes

- @cosmicdrift/kumiko-headless@0.235.4
- @cosmicdrift/kumiko-renderer@0.235.4
- @cosmicdrift/kumiko-dispatcher-live@0.235.4

## 0.235.3

### Patch Changes

- @cosmicdrift/kumiko-headless@0.235.3
- @cosmicdrift/kumiko-renderer@0.235.3
- @cosmicdrift/kumiko-dispatcher-live@0.235.3

## 0.235.2

### Patch Changes

- Updated dependencies [1ce74b3]
  - @cosmicdrift/kumiko-headless@0.235.2
  - @cosmicdrift/kumiko-renderer@0.235.2
  - @cosmicdrift/kumiko-dispatcher-live@0.235.2

## 0.235.1

### Patch Changes

- Updated dependencies [4c83a80]
- Updated dependencies [05a1622]
  - @cosmicdrift/kumiko-headless@0.235.1
  - @cosmicdrift/kumiko-renderer@0.235.1
  - @cosmicdrift/kumiko-dispatcher-live@0.235.1

## 0.235.0

### Patch Changes

- Updated dependencies [38d7ffc]
  - @cosmicdrift/kumiko-renderer@0.235.0
  - @cosmicdrift/kumiko-headless@0.235.0
  - @cosmicdrift/kumiko-dispatcher-live@0.235.0

## 0.234.0

### Minor Changes

- 40a8143: Edit masks and screen actions now carry visual defaults instead of stacking identical text buttons.

  - `RowAction` accepts an `icon` key, and `entityEdit` screens accept `actions` at all — an edit mask is no longer limited to Cancel and Save. Actions without a declared icon derive one from their id, so existing screens gain icons without a schema change.
  - More than two icon-bearing actions collapse to icon-only buttons; the delete action moves to the far left of the form footer.
  - Boolean fields render as a switch with the label above; select fields with at most four options render as a segmented group at content width instead of a full-width dropdown.
  - Text fields derive a prefix icon from their name (email, phone, url, city, …).
  - The form card gets a tinted, divided header band matching its footer, and metric cells render as dividers rather than nested cards.

  Consumer note: boolean fields now expose `role="switch"` instead of `role="checkbox"`, and selects with at most four options expose `role="radiogroup"` with `role="radio"` children plus a `segmented-kumiko-edit-<field>` test id instead of a combobox. End-to-end tests that drive these controls by their old role — `setChecked` on a checkbox, or opening a combobox popover — need to be updated. `layout: "inline"` still renders a checkbox, and selects with more than four options still render a dropdown.

- 77dd894: List cells now render what the rest of the UI already could: coloured status badges and collapsed row actions.

  - A `select`-typed column whose raw value is a known status word (`active`, `pending`, `failed`, …) renders the toned status pill the projectionDetail header already used, instead of a grey outline badge. Values outside that vocabulary keep the neutral pill, and `text`/`multiSelect` columns are untouched.
  - `entityList` and `projectionList` row actions where every action resolves an icon now render inline and collapse to icon-only buttons, the same rule the edit mask footer follows. Each button keeps its action label as `aria-label` and `title`.

  Consumer note: a list with more than two row actions that all resolve an icon moves from the "More actions" kebab to a row of icon-only buttons. End-to-end tests that open the kebab (`[data-testid$="-actions-menu"]`) to reach such an action need to click the action button directly instead. A group with at least one icon-less action keeps the kebab. `RenderList` accepts a `rowActionMode` prop to pass the mode explicitly, and `statusToneForValue` is exported from `@cosmicdrift/kumiko-renderer` for apps that map their own status values.

### Patch Changes

- Updated dependencies [40a8143]
- Updated dependencies [77dd894]
  - @cosmicdrift/kumiko-renderer@0.234.0
  - @cosmicdrift/kumiko-headless@0.234.0
  - @cosmicdrift/kumiko-dispatcher-live@0.234.0

## 0.233.0

### Minor Changes

- ff39c70: Entity-list tables now render as cards below 768px instead of scrolling columns out of reach. Every ViewModel column still shows, actions stay visible, and a native sort select replaces the header-click sort that has no header to attach to at that width.
- b0b9484: `NumberFieldDef` gained a `unit` option: an editable number field can now show a unit-of-measure suffix in its input, either a static string (`unit: "km"`) or a sibling field's live value (`unit: { field: "mileageUnit" }`), so the unit can vary per record (e.g. an odometer reading in "mi" or "km"). Display-only — the stored numeric value is never converted. Added `mi` (miles) to the read-only `unit` format registry's vocabulary alongside it.

### Patch Changes

- 56c3f2d: Form action bars now group into two rows: destructive/record actions (Delete, copy-link, custom actions, Cancel) on their own row, wizard/submit navigation on the other — desktop shows them side by side, narrow viewports stack the primary action on top. Buttons gained `icon`/`iconEnd` props (resolved against the shared `NavIconKey` vocabulary, now covering button icons too) and a new `danger-ghost` variant for destructive actions rendered as red text instead of a red fill.
- dd6cf49: Fixed three renderer defects visible in every app (fw#2569):

  - The sessions and tenant-members projectionList screens showed raw ISO timestamps for `createdAt`/`expiresAt`/`revokedAt`/`lastSeenAt` — those columns now declare `renderer: { format: "timestamp" }` like their detail-screen counterparts already did.
  - `defaultCellRender` now warns once per column (dev builds only) when a `text` column renders a full ISO-8601 datetime string, pointing at the missing `renderer: { format: "timestamp" }` — the value itself is still rendered unchanged, no auto-formatting/guessing.
  - The desktop sidebar's nav label now carries a native `title` attribute with the full label, so a truncated entry (e.g. "Händler-Einstellungen (Plattform-Standard)") is still reachable via hover instead of being silently cut off.

- Updated dependencies [56c3f2d]
- Updated dependencies [b0b9484]
  - @cosmicdrift/kumiko-renderer@0.233.0
  - @cosmicdrift/kumiko-headless@0.233.0
  - @cosmicdrift/kumiko-dispatcher-live@0.233.0

## 0.232.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.232.0
- @cosmicdrift/kumiko-renderer@0.232.0
- @cosmicdrift/kumiko-dispatcher-live@0.232.0

## 0.231.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.231.0
- @cosmicdrift/kumiko-renderer@0.231.0
- @cosmicdrift/kumiko-dispatcher-live@0.231.0

## 0.230.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.230.0
- @cosmicdrift/kumiko-headless@0.230.0
- @cosmicdrift/kumiko-renderer@0.230.0

## 0.229.1

### Patch Changes

- 1d885e7: Fixes fw#2528: the shared `cardFooter` action-bar row (`Form`/`Section`/`Card`, including `stickyActions`) now wraps instead of overflowing off-screen once its buttons no longer fit — on a 390px viewport a five-button wizard footer left the leftmost buttons (Cancel, Back) unreachable, with no way to scroll them into view under `stickyActions`' fixed positioning. `Form`'s `stickyActions` mobile content-padding grew from `max-sm:pb-24` to `max-sm:pb-32` to keep the last field clear of a two-row wrapped footer. `Drawer`'s footer row shares the same unwrapped shape (its own comment notes it mirrors `cardFooter`) and gets the same fix.
- a9a789e: Fixes two mobile/tablet layout overflow bugs.

  `entityList`'s row-actions column was unconditionally `sticky right-0` — on narrow viewports (e.g. 390px phones), once the table was wider than its container, this pinned the actions cell on top of the natural position of a preceding data column, rendering that value invisible even though it was inside the visible viewport. The sticky pin is now scoped to `md:` and up: below md, actions scroll with the row like any other cell (reachable via the table's own `overflow-x-auto` container); at md+, they stay pinned to the right edge as intended for wide tables.

  Separately, the sidebar-based app shells (`DefaultAppShell`, `WorkspaceShell`) rendered their content inset without `min-width: 0`, so a flex row child never shrinks below its content's intrinsic width. A screen with wide content (e.g. many table columns) grew the inset — and with it the whole sidebar row — past the viewport, making the whole page scroll horizontally instead of the screen's own scrollable container. Fixed by adding `min-w-0` to the shared inset classes.

  - @cosmicdrift/kumiko-dispatcher-live@0.229.1
  - @cosmicdrift/kumiko-headless@0.229.1
  - @cosmicdrift/kumiko-renderer@0.229.1

## 0.229.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.229.0
- @cosmicdrift/kumiko-renderer@0.229.0
- @cosmicdrift/kumiko-dispatcher-live@0.229.0

## 0.228.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.228.0
- @cosmicdrift/kumiko-headless@0.228.0
- @cosmicdrift/kumiko-renderer@0.228.0

## 0.227.0

### Patch Changes

- d309e7d: Fixes `projectionDetail` record-layout polish (0.226.0 regression): the metrics band now renders through a new `Metric` core-primitive (compact, left-aligned, non-stretched tiles that wrap on narrow viewports) instead of naked `Text`, which had rendered label and value glued together with no visual hierarchy. The header/metrics/tab strip now share the record card's page padding and get visible vertical spacing between them, via a new `Form.headerRegion` slot. `hideSectionTitles` now also suppresses `RenderEdit`'s own top-level form title (previously only section titles were suppressed), fixing a duplicate heading above the active tab's content in `layout.mode: "tabs"`.

  Also fixes fw#2518: navigating from one `projectionDetail` record to the next didn't remount the body, so the screen briefly showed the previous record's fields. `ProjectionDetailBody` is now keyed on the record identifier alone (never the active tab, so switching tabs doesn't refire the detail query).

- Updated dependencies [5f157b6]
- Updated dependencies [d309e7d]
  - @cosmicdrift/kumiko-headless@0.227.0
  - @cosmicdrift/kumiko-renderer@0.227.0
  - @cosmicdrift/kumiko-dispatcher-live@0.227.0

## 0.226.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.226.0
- @cosmicdrift/kumiko-renderer@0.226.0
- @cosmicdrift/kumiko-dispatcher-live@0.226.0

## 0.225.0

### Minor Changes

- 5185710: Add an optional `tone` to the `Progress` primitive (`default`/`warn`/`danger`, fill color only) and wire `cap-overview`'s usage bar to derive it from the same `computeTone(fraction)` the dashboard cards already use. Previously the bar always rendered the neutral fill regardless of how far over the cap usage was — a tenant at 120% of a limit looked identical to one at 4%.
- d63b2e8: `projectionDetail` screens can now declare an optional record header (`header: { title, subtitle?, status? }`), a metrics band (`metrics: string[]`, labeled via `fieldLabels`), and a tabbed layout (`layout.mode: "tabs"`) alongside the existing single-section layout. All three are additive — a screen that doesn't set them renders unchanged. Tabs are read via a new `Tabs` Core-Primitive (wired to a vendored shadcn/Radix implementation in `kumiko-renderer-web`) and driven by the `?tab=` search param; only the active tab's section mounts, so its query fires on selection instead of upfront.

### Patch Changes

- aa1a1a7: Back a dashboard screen's filter value with a URL search param (`nav.searchParams[filter.id]`) instead of local state, matching `useListUrlState`'s replaceState semantics for pagination. A `navigate` rowAction's `params` extractor can now deep-link into a dashboard's filter — the value is bookmarkable and survives a reload, the same way an entityList/projectionList filter prefill already did.
- Updated dependencies [5185710]
- Updated dependencies [d63b2e8]
  - @cosmicdrift/kumiko-renderer@0.225.0
  - @cosmicdrift/kumiko-headless@0.225.0
  - @cosmicdrift/kumiko-dispatcher-live@0.225.0

## 0.224.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.224.2
- @cosmicdrift/kumiko-renderer@0.224.2
- @cosmicdrift/kumiko-dispatcher-live@0.224.2

## 0.224.1

### Patch Changes

- Updated dependencies [d3e822c]
  - @cosmicdrift/kumiko-renderer@0.224.1
  - @cosmicdrift/kumiko-dispatcher-live@0.224.1
  - @cosmicdrift/kumiko-headless@0.224.1

## 0.224.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.224.0
- @cosmicdrift/kumiko-headless@0.224.0
- @cosmicdrift/kumiko-renderer@0.224.0

## 0.223.0

### Minor Changes

- c4d07f5: `createMultiSelectField` can now render as a checkbox grid instead of the combobox dropdown. Set `display: "checkboxes"` on the field to get one checkbox per option plus a select-all/deselect-all toggle; omitting `display` keeps the existing combobox behavior unchanged.

  Two more options come on top, both only meaningful with `display: "checkboxes"`:

  - `columns` (1–4) sets the grid's column count at the widest breakpoint; narrow viewports always collapse to a single column.
  - `maxRows` caps how many grid rows stay visible before the grid becomes vertically scrollable; omitted, the grid grows with its content.

  Setting `columns` or `maxRows` without `display: "checkboxes"`, or an invalid `maxRows` (not a positive integer), fails at boot.

### Patch Changes

- Updated dependencies [c4d07f5]
  - @cosmicdrift/kumiko-headless@0.223.0
  - @cosmicdrift/kumiko-renderer@0.223.0
  - @cosmicdrift/kumiko-dispatcher-live@0.223.0

## 0.222.0

### Patch Changes

- 6a13c64: Review-batch DATEI UNKLAR: PII header guard, email header filtering, form-draft blob validation, MFA HMAC codec dedup, job-runner boot timeout cleanup, wizard e2e chip coverage.
- 3c2fe7a: Fix `RowActionsKebab`'s dropdown menu staying open (and its Radix overlay lock, `aria-hidden` on the app root plus `body.style.pointerEvents: none`, never releasing) after a confirm-guarded row action finished. The menu is now controlled and closes explicitly in `onSelect`, since the unconditional `preventDefault()` there was blocking Radix's own auto-close.
- Updated dependencies [6a13c64]
  - @cosmicdrift/kumiko-renderer@0.222.0
  - @cosmicdrift/kumiko-headless@0.222.0
  - @cosmicdrift/kumiko-dispatcher-live@0.222.0

## 0.221.0

### Minor Changes

- da516d2: StatusBarChart gains a `dense` prop: fixed-size flat-fill bars without gradients/tick marks, sized to fit a table cell instead of stretching to `w-full`.

### Patch Changes

- da688fe: DataTableCell now threads the app locale (LocaleProvider) into format:"unit"/number/decimal/bigInt/money/date cell rendering instead of falling back to the runtime's default locale — list and detail views agree again for the same value.
- Updated dependencies [1656ff9]
  - @cosmicdrift/kumiko-headless@0.221.0
  - @cosmicdrift/kumiko-renderer@0.221.0
  - @cosmicdrift/kumiko-dispatcher-live@0.221.0

## 0.220.1

### Patch Changes

- Updated dependencies [45abad1]
  - @cosmicdrift/kumiko-renderer@0.220.1
  - @cosmicdrift/kumiko-dispatcher-live@0.220.1
  - @cosmicdrift/kumiko-headless@0.220.1

## 0.220.0

### Minor Changes

- c2ea385: FormScreenShell / EditLayout.width default to full width (same chrome as lists). Override with layout.width or maxWidth when a screen needs a narrow column.

### Patch Changes

- Updated dependencies [98304cf]
- Updated dependencies [c2ea385]
  - @cosmicdrift/kumiko-renderer@0.220.0
  - @cosmicdrift/kumiko-headless@0.220.0
  - @cosmicdrift/kumiko-dispatcher-live@0.220.0

## 0.219.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.219.0
- @cosmicdrift/kumiko-headless@0.219.0
- @cosmicdrift/kumiko-renderer@0.219.0

## 0.218.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.218.0
- @cosmicdrift/kumiko-renderer@0.218.0
- @cosmicdrift/kumiko-dispatcher-live@0.218.0

## 0.217.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.217.0
- @cosmicdrift/kumiko-renderer@0.217.0
- @cosmicdrift/kumiko-dispatcher-live@0.217.0

## 0.216.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.216.0
- @cosmicdrift/kumiko-renderer@0.216.0
- @cosmicdrift/kumiko-dispatcher-live@0.216.0

## 0.215.7

### Patch Changes

- Updated dependencies [93220e2]
  - @cosmicdrift/kumiko-renderer@0.215.7
  - @cosmicdrift/kumiko-dispatcher-live@0.215.7
  - @cosmicdrift/kumiko-headless@0.215.7

## 0.215.6

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.215.6
- @cosmicdrift/kumiko-headless@0.215.6
- @cosmicdrift/kumiko-renderer@0.215.6

## 0.215.5

### Patch Changes

- @cosmicdrift/kumiko-headless@0.215.5
- @cosmicdrift/kumiko-renderer@0.215.5
- @cosmicdrift/kumiko-dispatcher-live@0.215.5

## 0.215.4

### Patch Changes

- @cosmicdrift/kumiko-headless@0.215.4
- @cosmicdrift/kumiko-renderer@0.215.4
- @cosmicdrift/kumiko-dispatcher-live@0.215.4

## 0.215.3

### Patch Changes

- @cosmicdrift/kumiko-renderer@0.215.3
- @cosmicdrift/kumiko-headless@0.215.3
- @cosmicdrift/kumiko-dispatcher-live@0.215.3

## 0.215.2

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.215.2
- @cosmicdrift/kumiko-headless@0.215.2
- @cosmicdrift/kumiko-renderer@0.215.2

## 0.215.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.215.1
- @cosmicdrift/kumiko-headless@0.215.1
- @cosmicdrift/kumiko-renderer@0.215.1

## 0.215.0

### Minor Changes

- 67805ac: `FieldFormatRegistry` gains an `enumOption` format key (`{ format: "enumOption", keyPrefix: "..." }`) that resolves an enum value to its translated label through the standard option-key convention (`<feature>:entity:<entity>:field:<field>:option:<value>`), client-side.

  `applyFormatSpec` takes an optional `translate` parameter; `FieldRendererOutput` (`projectionDetail` fields) and `DataTableCell` (`entityList`/`projectionList`/`relatedList` columns) now pass `useTranslation()` through. An untranslated key falls back to the raw enum value, mirroring `buildOptionLabels`'s convention for `entityList` select columns.

  This closes the last gap that forced server-side enum translation via hand-rolled locale dictionaries (fw#2315, solon#203): a query handler no longer needs to know the request's locale to make an enum value readable.

### Patch Changes

- Updated dependencies [67805ac]
  - @cosmicdrift/kumiko-headless@0.215.0
  - @cosmicdrift/kumiko-renderer@0.215.0
  - @cosmicdrift/kumiko-dispatcher-live@0.215.0

## 0.214.0

### Patch Changes

- Updated dependencies [4e72848]
  - @cosmicdrift/kumiko-headless@0.214.0
  - @cosmicdrift/kumiko-renderer@0.214.0
  - @cosmicdrift/kumiko-dispatcher-live@0.214.0

## 0.213.0

### Minor Changes

- 7ffd0f6: The browser's active UI language now reaches the server. `createLiveDispatcher` reads `document.documentElement.lang` and sends it as an `X-Locale` header on every request; `createKumikoApp`/`createPublicSurface` keep that attribute in sync with the app's `LocaleResolver` via a new `DocumentLangSync` component, so this works in every app with zero app-side wiring.

  The server resolves the header (falling back to `Accept-Language`, then the app's boot-configured default locale, then `"en"`) into a new, always-present `ctx.locale` on `HandlerContext` — the same Request → Boot-Default precedence `ctx.tz` already uses.

  Every magic-link mail in the auth-email-password feature (signup, password-reset, email-verification, invite, account-unlock) now renders in the requester's active locale instead of a hardcoded boot-time default, and each flow's `appUrl` can now be a `(locale: string) => string` function so apps with language-prefixed paths can point the link at the right locale.

### Patch Changes

- Updated dependencies [7ffd0f6]
  - @cosmicdrift/kumiko-dispatcher-live@0.213.0
  - @cosmicdrift/kumiko-headless@0.213.0
  - @cosmicdrift/kumiko-renderer@0.213.0

## 0.212.0

### Patch Changes

- Updated dependencies [35b0005]
  - @cosmicdrift/kumiko-renderer@0.212.0
  - @cosmicdrift/kumiko-headless@0.212.0
  - @cosmicdrift/kumiko-dispatcher-live@0.212.0

## 0.211.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.211.0
- @cosmicdrift/kumiko-renderer@0.211.0
- @cosmicdrift/kumiko-dispatcher-live@0.211.0

## 0.210.0

### Minor Changes

- 8b4467d: `projectionDetail`'s `hideActions: true` (0.209.0) hid RenderEdit's entire footer, including the screen's own declared `actions` — a screen that set `hideActions` to lose its Cancel button silently lost its header actions along with it (e.g. `RowActionNavigate` buttons opening related records).

  `projectionDetail` has no write path, so there's nothing for a Cancel button to discard: RenderEdit's `onCancel` is no longer wired up for this screen type at all, regardless of `listScreenId`. Back-navigation continues to work via the breadcrumb, which already resolved `listScreenId` independently. Declared `actions` now always render.

  **If you're on 0.209.0 and this affects you:**

  - Every existing `projectionDetail` screen with `listScreenId` set now renders without a Cancel button by default — that button used to show unless you opted out.
  - `hideActions` is removed from `ProjectionDetailScreenDefinition` entirely (it only ever shipped in 0.209.0, with the bundled sessions feature as its only consumer). Delete it from any screen definition that still sets it — it no longer exists on the type. `RenderEdit`'s own `hideActions` prop (for hosts driving their own action bar directly) is unrelated and unchanged.

### Patch Changes

- Updated dependencies [8b4467d]
  - @cosmicdrift/kumiko-renderer@0.210.0
  - @cosmicdrift/kumiko-headless@0.210.0
  - @cosmicdrift/kumiko-dispatcher-live@0.210.0

## 0.209.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.209.1
- @cosmicdrift/kumiko-renderer@0.209.1
- @cosmicdrift/kumiko-dispatcher-live@0.209.1

## 0.209.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.209.0
- @cosmicdrift/kumiko-renderer@0.209.0
- @cosmicdrift/kumiko-dispatcher-live@0.209.0

## 0.208.3

### Patch Changes

- @cosmicdrift/kumiko-headless@0.208.3
- @cosmicdrift/kumiko-renderer@0.208.3
- @cosmicdrift/kumiko-dispatcher-live@0.208.3

## 0.208.2

### Patch Changes

- Updated dependencies [257e425]
  - @cosmicdrift/kumiko-renderer@0.208.2
  - @cosmicdrift/kumiko-dispatcher-live@0.208.2
  - @cosmicdrift/kumiko-headless@0.208.2

## 0.208.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.208.1
- @cosmicdrift/kumiko-renderer@0.208.1
- @cosmicdrift/kumiko-dispatcher-live@0.208.1

## 0.208.0

### Minor Changes

- 025c5b9: Framework UI copy is English-only. German and Spanish live in `@cosmicdrift/kumiko-locale-de` / `-es`. Apps that want those languages mount `localeDe()` + `localeDeClient()` (or the es equivalents). Without a locale package, framework screens and auth/GDPR mails render in English.

### Patch Changes

- eff2d71: `LanguageSwitcher` now resolves its `aria-label` and `title` from the `kumiko.nav.language` translation key instead of hardcoding the German string "Sprache", so the trigger's accessible name follows the active locale; this only works because `createKumikoApp` mounts `kumikoDefaultTranslations` as the last fallback into `LocaleProvider`, which the switcher relies on to resolve the key.
- Updated dependencies [eff2d71]
- Updated dependencies [025c5b9]
  - @cosmicdrift/kumiko-renderer@0.208.0
  - @cosmicdrift/kumiko-headless@0.208.0
  - @cosmicdrift/kumiko-dispatcher-live@0.208.0

## 0.207.0

### Minor Changes

- dec6fd7: Spanish (`es`) is now a first-class locale across the framework's own UI. Every translation table ships a third locale: the renderer defaults (save/cancel/delete, empty states, pagination, validation messages), the complete email-password login and MFA flows, and every bundled feature's screens, nav entries and field labels. Previously a Spanish-speaking user resolved to `es` through `navigator.language` and then fell through to the hardcoded `en` fallback, so the entire product read English no matter what the language switcher offered.

  The per-file `LocalizedString` type now requires `es` alongside `de` and `en`, so a table cannot ship half-translated: the compiler rejects a missing locale rather than letting the bundle builder emit `undefined`. `LanguageSwitcher` no longer hardcodes the German string "Sprache" as its `aria-label` and `title`; it resolves `kumiko.nav.language` instead, so screen readers announce the control in the active language. The `kumiko new app` scaffold emits all three locales, so newly generated apps start out multilingual.

  Apps are not forced to follow. The boot validator's completeness gate still requires only `de` and `en`, so an app that translates its own features into those two keeps booting unchanged, and any locale an app registers through `r.translations` continues to merge in without needing an entry in a framework list.

### Patch Changes

- Updated dependencies [dec6fd7]
  - @cosmicdrift/kumiko-renderer@0.207.0
  - @cosmicdrift/kumiko-dispatcher-live@0.207.0
  - @cosmicdrift/kumiko-headless@0.207.0

## 0.206.0

### Minor Changes

- d60cb15: A row click on an `entityList` now defaults to the entity's declared detail screen (`detailFor`, fw#2163) when one exists — no `rowClick: true` rowAction needed. Precedence: an explicit `rowClick: true` navigate action still wins first, then the `detailFor` screen, then the app-wide `onRowClick` option (`createKumikoApp`), then the previous entityEdit-search fallback. Apps that never declare `detailFor` see no change. `projectionList` is unaffected (it has no resolvable entity).

  Also fixes `resolveTarget`'s `{ entity, id }` navigation target (used by this default and by `relatedList` row clicks): it produced a fully-qualified `screenId` instead of the short form the router expects, so a resolved detail-screen navigation silently landed on the app's fallback screen instead. Screen short ids are boot-validated unique app-wide, so the short form alone is unambiguous.

  `projectionList`'s "at most one `rowClick: true` rowAction" boot check (previously `entityList`-only) now also runs for `projectionList` screens.

### Patch Changes

- 43855ad: `EmbeddedListInput`'s desktop table is now horizontally scrollable when it has more columns than its container is wide, with a visible edge shadow while there's more to scroll. Previously the table wrapper clipped overflowing columns outright (`overflow-hidden`) — the browser could still nudge the hidden scroll position when a descendant received focus, so tabbing through a row could silently shift the table left (fw#2159, follow-up to #2092: reachability of the table as a whole, not just cell-content clipping within a column). A fresh table (or one crossing the mobile/desktop breakpoint) always mounts scrolled fully left.
- Updated dependencies [d60cb15]
  - @cosmicdrift/kumiko-renderer@0.206.0
  - @cosmicdrift/kumiko-headless@0.206.0
  - @cosmicdrift/kumiko-dispatcher-live@0.206.0

## 0.205.0

### Patch Changes

- 0aeb168: DataTable list columns of type `number`/`decimal`/`bigInt` now render locale-formatted via `Intl.NumberFormat`, matching how `timestamp`/`date`/`money` cells already behave. Previously they fell through to a raw `String(value)`, showing e.g. `245.5` with a dot even on a German-locale app while every other numeric column type used the locale's separator.
- Updated dependencies [0aeb168]
  - @cosmicdrift/kumiko-headless@0.205.0
  - @cosmicdrift/kumiko-dispatcher-live@0.205.0
  - @cosmicdrift/kumiko-renderer@0.205.0

## 0.204.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.204.1
- @cosmicdrift/kumiko-headless@0.204.1
- @cosmicdrift/kumiko-renderer@0.204.1

## 0.204.0

### Patch Changes

- Updated dependencies [0d53fbd]
  - @cosmicdrift/kumiko-headless@0.204.0
  - @cosmicdrift/kumiko-renderer@0.204.0
  - @cosmicdrift/kumiko-dispatcher-live@0.204.0

## 0.203.0

### Minor Changes

- 29e46a9: Screens can now declare `detailFor: "<entity>"` on `ScreenDefinition` to mark themselves as the detail view for that entity. A new boot-validator rule (`validateDetailForScreens`) rejects two screens declaring the same `detailFor` entity, and rejects a `detailFor` naming an entity no feature registers — apps that end up with either of those (e.g. after a rename) now fail at boot instead of silently misbehaving. Navigation targets can now be an `ObjectTarget` (`{ entity, id, workspaceId? }`) in addition to the existing `ScreenTarget` (`{ screenId, entityId?, workspaceId? }`) — `NavTarget` (exported from `@cosmicdrift/kumiko-renderer`) is now the union of both. The new `resolveTarget(features, target)` turns an `ObjectTarget` into a `ScreenTarget` by finding the screen whose `detailFor` matches, and throws if none exists. `useBrowserNavApi` resolves `ObjectTarget`s before building any path; callers that want `navigate`/`replace`/`hrefFor` to accept `ObjectTarget`s must pass the new `features` option (the app's `FeatureSchema[]`). Existing `ScreenTarget`-only call sites are unaffected. `formatPath` is now typed to accept `ScreenTarget` only — it never handled an `ObjectTarget`, so this is a type-only tightening.

  `projectionList` screens now wire search/sort/pagination state into their bound query the same way `entityList` screens do. `screen.searchable`, `screen.sortable` and `screen.paginated` are derived by `buildAppSchema` from the query handler's Zod schema (presence of `search`, `sort`, and `cursor`/`offset` params respectively) instead of being author-set — a hand-authored `sortable` or `paginated` on a `projectionList` screen now **fails boot** (`"sortable is derived from the query's Zod schema, don't set it"`), and `defaultSort` is now required as soon as search or sort is active. `searchable: true`/`false` set explicitly on the screen still wins over the derived default, and is still boot-validated against the schema as before. On the renderer side, `ProjectionListBody` now drives the URL-backed search box, sort headers and (pages-mode) pager into the query payload through the extracted `buildListQueryPayload` helper (also exported, and now shared with `EntityListBody` instead of each having its own inline payload construction) — previously a `projectionList` screen's query always received `{}` and ignored `searchable`/`defaultSort` at render time. Apps whose query handler accepts `sort`/`cursor`/`offset` params will start receiving those params on every request; handlers that don't inspect extra payload keys are unaffected.

### Patch Changes

- Updated dependencies [29e46a9]
- Updated dependencies [437d3fb]
  - @cosmicdrift/kumiko-renderer@0.203.0
  - @cosmicdrift/kumiko-headless@0.203.0
  - @cosmicdrift/kumiko-dispatcher-live@0.203.0

## 0.202.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.202.0
- @cosmicdrift/kumiko-renderer@0.202.0
- @cosmicdrift/kumiko-dispatcher-live@0.202.0

## 0.201.0

### Patch Changes

- eb660d4: `Drawer` now goes full-screen below the 768px narrow-viewport breakpoint instead of rendering a cramped floating panel with a fixed resize width, and drops its resize handle on that layout.
- Updated dependencies [4783532]
- Updated dependencies [eb660d4]
  - @cosmicdrift/kumiko-headless@0.201.0
  - @cosmicdrift/kumiko-renderer@0.201.0
  - @cosmicdrift/kumiko-dispatcher-live@0.201.0

## 0.200.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.200.1
- @cosmicdrift/kumiko-headless@0.200.1
- @cosmicdrift/kumiko-renderer@0.200.1

## 0.200.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.200.0
- @cosmicdrift/kumiko-headless@0.200.0
- @cosmicdrift/kumiko-renderer@0.200.0

## 0.199.2

### Patch Changes

- d8be81f: Fix `EmbeddedListInput` desktop table columns clipping date and money values (e.g. a trailing digit or the currency sign cut off). `columnWidthClass` gave `date`/`number`/`decimal`/`money`/`timestamp` a fixed width too narrow for the calendar button and money's stepper padding; each now gets a `min-w` floor sized for its own control instead. Timestamp columns are noticeably wider as a result (176px → 304px); number/decimal are unchanged.
  - @cosmicdrift/kumiko-dispatcher-live@0.199.2
  - @cosmicdrift/kumiko-headless@0.199.2
  - @cosmicdrift/kumiko-renderer@0.199.2

## 0.199.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.199.1
- @cosmicdrift/kumiko-renderer@0.199.1
- @cosmicdrift/kumiko-dispatcher-live@0.199.1

## 0.199.0

### Minor Changes

- 3252009: `synthesizeActionFormEntity` and `synthesizeActionFormScreen` are now public API, so apps can render an `actionForm` screen through `RenderEdit` in their own layout (e.g. embedded in a drawer) instead of duplicating the shim.

### Patch Changes

- a363820: A nav entry's `icon` key that isn't registered in `NAV_ICONS` (typo, or a dynamically/provider-resolved key the type system can't check) used to fall back to the dot indicator with no diagnostic at all — indistinguishable from an entry that never set an icon. `NavLeadingIcon` now emits a `console.warn` naming the nav entry's qualified name and the unknown key when this happens, while the dot fallback itself is unchanged.
- Updated dependencies [df2db70]
- Updated dependencies [3252009]
  - @cosmicdrift/kumiko-renderer@0.199.0
  - @cosmicdrift/kumiko-headless@0.199.0
  - @cosmicdrift/kumiko-dispatcher-live@0.199.0

## 0.198.0

### Minor Changes

- 89ebe92: `NavDefinition.icon`, `ContentCollectionDefinition.nav.icon`, `ScreenNavSugar.icon` and `ConfigMask.icon` were all `icon?: string` — any typo (`icon: "seting"`) compiled fine and silently fell back to a dot in the sidebar. New `NavIconKey` union (`@cosmicdrift/kumiko-types/nav-icon`, re-exported from `@cosmicdrift/kumiko-framework/{engine,ui-types}`) types all four against the closed set of keys the web renderer actually registers, so an unregistered icon key is now a compile error at the `r.nav()`/`r.screen({ nav })`/config-mask call site instead of a missing icon at runtime.

  `packages/renderer-web`'s `NAV_ICONS` map is checked against the same union via `as const satisfies Record<NavIconKey, …>`, so the type and the map can no longer drift — adding a key requires updating both in the same change. This also surfaced a real pre-existing gap: `tenant-settings` declared `icon: "languages"`, which had never been a registered key (silently rendered as a dot); `languages` (lucide `Languages`) is now registered.

  This is a breaking type change for any app that passes an icon key outside the vocabulary in `packages/types/src/nav-icon.ts` — such a call site will fail to compile after this bump.

### Patch Changes

- 9b2c94a: `createKumikoApp`'s boot diagnostic (#2025) flagged every `type: "custom"` screen without a registered `clientFeatures` component as a missing client plugin — including screens that are dormant by design (registered without a self-owned `r.nav()`, meant to be navved by the consuming app itself, e.g. `user-data-rights`'s privacy center, `auth-mfa`'s enable screen, `personal-access-tokens`'s token screen). Added an optional `dormant?: boolean` field to `CustomScreenDefinition`; the diagnostic now skips screens flagged `dormant: true` instead of false-positiving on every app that hasn't wired the client plugin yet. Screens a feature self-navs (e.g. compliance-profiles' profile-picker) are unaffected and still trigger the diagnostic when their client plugin is missing — that stays a real bug (infra#503).
- b925dea: Fixes two rendering bugs surfaced in code review: `formatDatePlaceholder` now clamps a locale's year/month/day placeholder letters to their first code point before repeating them, so a missing i18n key falling back to its raw (multi-character) key string no longer produces a garbled date placeholder. Separately, `embedded-list-input`'s desktop table constrains a per-cell validation message's width instead of letting one long message force the whole table into horizontal scroll.
- Updated dependencies [f2ebb71]
- Updated dependencies [b925dea]
  - @cosmicdrift/kumiko-headless@0.198.0
  - @cosmicdrift/kumiko-renderer@0.198.0
  - @cosmicdrift/kumiko-dispatcher-live@0.198.0

## 0.197.1

### Patch Changes

- e8f87fe: Two form-rendering rhythm fixes, both measured in a live DOM:

  - `RenderEdit`'s field grid claimed a full grid row for every field, including fields hidden via `visible: false` (whose `RenderField` renders `null`). A form with several hidden fields in a row left visible empty gaps in the grid. `GridCellForField` now bails out before rendering the `GridCell` when the field isn't visible.
  - `DefaultForm`'s bare branch (`BareFormProvider`, used by `AuthCard` and any consumer embedding a form without its own card) stacked `<section>`s with no divider between them, so a section boundary looked like a layout gap rather than structure. It now carries the same `[&>section:not(:first-child)]:border-t` rule as the carded branch. Flat-field forms (e.g. the auth screens, which render `Field`/`Banner`/`Button` directly with no `<section>`) are unaffected — verified across all `AuthCard` consumers in this repo.

- d35b183: `Pager` (used by every `DataTable` with `pagination="pages"`) rendered its status line ("X – Y of Z") and its Previous/Next/Page aria-labels as hardcoded English literals instead of going through `t(...)`. Non-English apps now saw untranslated pagination text and screen readers announced it in English regardless of locale. All four now resolve through the renderer's translation layer (`kumiko.pager.status`, `kumiko.pager.previousPage`, `kumiko.pager.nextPage`, `kumiko.pager.page`), with the existing English text kept as the framework default so consumers without overrides are unaffected.
- Updated dependencies [e8f87fe]
- Updated dependencies [d35b183]
  - @cosmicdrift/kumiko-renderer@0.197.1
  - @cosmicdrift/kumiko-headless@0.197.1
  - @cosmicdrift/kumiko-dispatcher-live@0.197.1

## 0.197.0

### Minor Changes

- dbcca27: Drawer/form polish, four targeted changes to the `entityEdit` drawer experience:

  - `Drawer`'s default width grows from `max(520px, 25vw)` to `max(600px, 37.5vw)` (capped at `85vw`) so a two-column field row (e.g. street/number, zip/city) has room to breathe: `600px` on a narrow viewport (~1280px) without the drawer dominating it, growing to `~720px` on a typical `1920px` window instead of staying pinned at the floor.
  - The `Section` primitive's vertical padding inside a form (`entityEdit`, `configEdit`) drops from `py-6` to `py-4`, so the gap between two sections (padding + border-t + padding) reads as roughly double a field row's `gap-4`, not triple it. The border-t divider itself is unchanged.
  - `SheetFooter`'s background changes from `bg-muted/30` to `bg-background`, matching the panel body above it. The `border-t` divider alone now marks the footer boundary.
  - `Drawer` gets a new optional `showCloseButton` prop (default `true`, passed through to the underlying `SheetContent`) so a caller with its own footer close/cancel action can turn off the redundant header X.

### Patch Changes

- Updated dependencies [5eb959a]
- Updated dependencies [28adff7]
  - @cosmicdrift/kumiko-headless@0.197.0
  - @cosmicdrift/kumiko-renderer@0.197.0
  - @cosmicdrift/kumiko-dispatcher-live@0.197.0

## 0.196.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.196.1
- @cosmicdrift/kumiko-headless@0.196.1
- @cosmicdrift/kumiko-renderer@0.196.1

## 0.196.0

### Patch Changes

- Updated dependencies [c4161d8]
- Updated dependencies [12ba677]
  - @cosmicdrift/kumiko-renderer@0.196.0
  - @cosmicdrift/kumiko-dispatcher-live@0.196.0
  - @cosmicdrift/kumiko-headless@0.196.0

## 0.195.0

### Patch Changes

- 6757567: Drawer clips its content to the rounded corners so the footer background no longer bleeds into them.
- 49538eb: - `formatMoney` (currency formatting used internally by `MoneyInput`) is now re-exported from the package barrel, so consumers no longer have to hand-roll their own currency formatter to get correct locale-aware symbol placement and decimals.
  - `resizeImageBeforeUpload` now only swaps in the re-encoded image if it's actually smaller than the original — a palette-optimized PNG or an already small in-spec photo could previously come back larger after a full RGBA canvas round-trip (2-5x for PNGs), since the re-encode was always taken regardless of size. EXIF/GPS stripping is now best-effort: an original kept as-is keeps its metadata too.
- 49538eb: Several bug fixes:

  - **Breaking (docs only):** `WorkspaceSwitcher` now documents that it requires an ancestor `SidebarProvider` — it renders `SidebarMenuButton`, which calls `useSidebar()` internally and throws at runtime when rendered outside one. No behavior changed; a consumer rendering the switcher outside a sidebar was already crashing, this makes the requirement explicit instead of a surprise error.
  - `UploadZone` no longer calls `crypto.randomUUID()` for its row keys — that API only exists in a secure context, so a plain-HTTP LAN preview left it `undefined` and threw. Row ids now come from a per-instance counter instead (they only need to be stable React keys, not globally unique).
  - `EmbeddedListInput` swaps its desktop/mobile layout via a new `useIsNarrowViewport` hook (`useSyncExternalStore`-based) instead of the vendored `useIsMobile`, which only set its value in a `useEffect` — the mobile card layout previously mounted after the desktop table already built and discarded itself on every mount.
  - `Drawer`'s resize handle now calls `preventDefault()` and locks `document.body`'s text selection on `PointerDown` (releasing it on `PointerUp`), matching `SidebarPanel`'s resize handle — a fast drag over the handle previously selected the drawer's text content instead of only resizing.
  - `TiptapEditor`'s toolbar (bold/italic/heading/list buttons) now derives its active state via `useEditorState` instead of reading `editor.isActive(...)` directly in the render body — `@tiptap/react` v3 defaults `shouldRerenderOnTransaction` to `false`, so moving the cursor into already-bold text (without typing) previously left the toolbar frozen on the last state.

- Updated dependencies [49538eb]
- Updated dependencies [49538eb]
- Updated dependencies [49538eb]
  - @cosmicdrift/kumiko-renderer@0.195.0
  - @cosmicdrift/kumiko-headless@0.195.0
  - @cosmicdrift/kumiko-dispatcher-live@0.195.0

## 0.194.0

### Minor Changes

- 43d39b8: `Drawer` gets a new optional `backdrop` prop (`{ blurPx?, dimPercent? }`) to control the overlay behind the panel. **Breaking:** the backdrop is no longer blurred by default (`blurPx` defaults to `0`, `dimPercent` to `20`) — a drawer exists so the content behind it stays readable, and the previous fixed `2px` blur worked against that. Consumers that want the old look can pass `backdrop={{ blurPx: 2 }}`.

  Also: the panel's default width grows from a fixed `420px` to `max(520px, 25vw)` (capped at `85vw`), so two-column forms fit without cramping. `resize.maxWidthPx` now defaults to `1000` (was `800`) to match; `resize.defaultWidthPx` still overrides the viewport-based default when set.

- 04f7a96: `ImageFieldDef` accepts `capture?: "environment" | "user"`, forwarded to the file input's `capture` attribute so a phone opens the camera instead of the file picker. Omitted by default, so existing image fields are unchanged.

  Not added to `ImagesFieldDef`: multi-image fields still have no widget (they render an "unsupported" banner), and a flag no renderer reads is the dead-flag state `thumbnails` was just removed for.

- 2b1b089: `Drawer`'s resize props are now grouped under one optional `resize` object instead of four separate props. **Breaking:** `resizable`/`defaultWidthPx`/`minWidthPx`/`maxWidthPx` are gone — pass `resize={{ defaultWidthPx, minWidthPx, maxWidthPx }}` (all fields optional) to opt in, or omit `resize` entirely for the old `resizable={false}` default. No app in this workspace passed these props, so no consumer migration was needed here.

  Also fixed in this release:

  - `DefaultForm`'s `stickyActions` footer: dead `env(safe-area-inset-bottom)` inline style (never had an effect without `viewport-fit=cover` in any Kumiko HTML template) is replaced with `max-sm:pb-4`. If a template later adds `viewport-fit=cover`, restore the `max()` form.
  - `drawer.test.tsx` now covers the resize behavior added earlier: keyboard resize direction per `side`, clamping at `minWidthPx`/`maxWidthPx`, the maximize toggle, and that `side="top"`/`"bottom"` drawers never render a resize handle.
  - `Form`'s sticky-actions test now also asserts the content container's `max-sm:pb-24` padding class, not just the footer's `max-sm:fixed`.

- 52b0ba6: `WorkspaceSwitcher` is now a dropdown instead of a row of tab buttons — a row overflowed the sidebar width with 3+ workspaces (or even 2 longer names), truncating and hiding the last entry entirely.

  Consumer apps with their own tests/e2e against the old tab-row markup need to update:

  - Click `workspace-switcher-trigger` first to open the dropdown before selecting a `workspace-tab-*` entry.
  - `aria-selected` on the active tab is now `aria-checked` on the active `DropdownMenuCheckboxItem`.

  Also fixes the trigger showing an empty label when `activeId` points at a workspace that isn't in the visible list (stale URL param after a role change) — it now falls back to a "Select workspace" placeholder instead of a blank button.

### Patch Changes

- 52b0ba6: Several input/widget bug fixes:

  - `MoneyInput` selects the input text on focus via `useLayoutEffect` instead of `useEffect` — fixes a race where a fast click-then-type could land the cursor mid-value instead of selecting it first.
  - `EmbeddedListInput` totals now format with the resolved UI locale (`useLocale()`) instead of always the default locale.
  - `UploadZone` now filters dropped files through `accept` the same way the file-picker dialog already did — a drag&drop drop previously bypassed the filter entirely and any file type reached `onUpload`. A non-`Error` upload failure now shows a translated fallback message instead of the raw internal token; new `kumiko.widget.upload.error`/`kumiko.widget.upload.rejected-type` i18n keys.
  - `AiTextField` now propagates `hideLabel` to its underlying `Field`, matching the other form widgets.
  - `ProgressBar` clamps a `NaN` `value` (e.g. `done / total` with `total: 0`) to 0 instead of rendering `width: "NaN%"` and an invalid `aria-valuenow`.
  - `InfinityList` dedupes appended rows against already-loaded ones — a live-merge that re-sorts a row to the front of page 1 could otherwise have an offset-based cursor re-serve that same row on a later page, landing it twice under duplicate React keys.
  - `Drawer`'s initial width now clamps `resize.defaultWidthPx` on the very first render instead of only once the user starts dragging (fw#1965).

- Updated dependencies [52b0ba6]
- Updated dependencies [04f7a96]
- Updated dependencies [52b0ba6]
  - @cosmicdrift/kumiko-renderer@0.194.0
  - @cosmicdrift/kumiko-headless@0.194.0
  - @cosmicdrift/kumiko-dispatcher-live@0.194.0

## 0.193.1

### Patch Changes

- dd4ce95: `UploadZone` and `FileUploadInput` downscale images to a 2560px max edge before upload (bandwidth), which also strips EXIF/GPS as a side effect of the canvas re-encode. SVG and GIF pass through unchanged (vector/animation would be destroyed); browsers without `OffscreenCanvas` fall back to uploading the original file unchanged.
  - @cosmicdrift/kumiko-dispatcher-live@0.193.1
  - @cosmicdrift/kumiko-headless@0.193.1
  - @cosmicdrift/kumiko-renderer@0.193.1

## 0.193.0

### Minor Changes

- 181003b: Image fields declare named derived versions: `createImageField({ variants: { profile: { fit: "cover", size: { width: 512, height: 512 }, format: "webp" } } })`. The specs are boot-validated, and `GET /api/files/:id/variant/:name` serves them behind the same tenant + access guard as the download — a request carries only a NAME, never a spec, so no caller can drive an arbitrary render. The edit-form preview loads the first declared variant instead of the original.

  BREAKING: `ImageFieldDef.thumbnails` / `ImagesFieldDef.thumbnails` are removed. The flag was never read by anything; `variants` is what it pointed at.

### Patch Changes

- eb4da66: Fixed `defaultCellRender` formatting money table cells incorrectly for currencies with a decimal precision other than 2. It previously preferred `amountMinor` (scaled by a flat `MINOR_UNIT_SCALE=100`) over deriving minor units from `amount`, which disagreed with `currencyDecimals(currency)` — e.g. JPY (0 decimals) rendered 100x too high, BHD (3 decimals) 10x too low. Minor units are now always derived from `amount` and `currencyDecimals(currency)`, consistent with `render-field.tsx`'s `moneyMinorValue`.

  Also: `DefaultSection` now supports the renderer's new `hidden` prop (keeps wizard steps mounted instead of unmounting them), and `DefaultInput` now forwards the renderer's new `step` prop for number inputs.

- Updated dependencies [eb4da66]
- Updated dependencies [181003b]
- Updated dependencies [17d437d]
- Updated dependencies [eb4da66]
  - @cosmicdrift/kumiko-headless@0.193.0
  - @cosmicdrift/kumiko-renderer@0.193.0
  - @cosmicdrift/kumiko-dispatcher-live@0.193.0

## 0.192.0

### Patch Changes

- 323b683: `ProgressBar` now wraps its track in its own element, so the track's `h-2` height is never affected by padding or stretch a parent applies to its direct children. Previously the padding RenderEdit's wizard chrome applies to every direct child of the form body collided with `box-sizing: border-box` on the track itself, expanding it to ~36px instead of 8px — #1963 only fixed the fill bar's width resolving against that wrong height, not the height itself.
  - @cosmicdrift/kumiko-headless@0.192.0
  - @cosmicdrift/kumiko-renderer@0.192.0
  - @cosmicdrift/kumiko-dispatcher-live@0.192.0

## 0.191.0

### Minor Changes

- b156334: The wizard chrome (`RenderEdit` with `layout.mode: "wizard"`) now renders a step overview above the form instead of just "Step X of Y": numbered chips for every section, the current one highlighted, done ones showing a checkmark. Added the `StepBar` primitive (`CorePrimitives.StepBar`, optional like `Progress`) and its default web implementation (`@cosmicdrift/kumiko-renderer-web`'s `StepBar` widget). On narrow viewports the chip row hides in favor of the previous compact "Step X of Y · &lt;title&gt;" label — both the chrome and the widget stay backward compatible when a custom `PrimitivesRegistry` doesn't supply `StepBar`.

### Patch Changes

- Updated dependencies [b156334]
  - @cosmicdrift/kumiko-renderer@0.191.0
  - @cosmicdrift/kumiko-dispatcher-live@0.191.0
  - @cosmicdrift/kumiko-headless@0.191.0

## 0.190.0

### Minor Changes

- 5e6a75b: Drawer: floats with margin and fully rounded corners, lighter backdrop so the page behind stays readable, card-style footer, maximize toggle and drag-to-resize width.

### Patch Changes

- 7af2994: `ProgressBar`'s fill bar no longer relies on `height: 100%` resolving against the wrapper's height, which silently rendered 0px tall whenever the surrounding layout stretched the wrapper instead of letting its own `h-2` apply. The wrapper is now `relative` and the fill is absolutely positioned with `inset-y-0`, so it always spans the wrapper's own box regardless of how the wrapper's height was determined.
  - @cosmicdrift/kumiko-dispatcher-live@0.190.0
  - @cosmicdrift/kumiko-headless@0.190.0
  - @cosmicdrift/kumiko-renderer@0.190.0

## 0.189.0

### Patch Changes

- 5137ce5: The auto-wired `entityEdit` path now has operable widgets for `multiSelect` (combobox), `decimal`/`bigInt` (number input), `tz` (IANA zone picker), and `longText` (always a textarea). `jsonb`, `embedded` (non-list), `files`, and `images` still render read-only — they stay unsupported on this path — but a statically `required: true` field of one of those types now throws a descriptive boot-time error instead of silently rendering an unfillable form.
- cac0d04: `Form`'s new `stickyActions` prop pins the actions footer to the viewport bottom on narrow screens (`<640px`) instead of normal document flow, so a virtual keyboard shrinking the viewport can no longer push it out of reach. `RenderEdit` sets it automatically for wizard-mode screens. The default HTML shell's viewport meta also gains `interactive-widget=resizes-content`, so a real mobile keyboard shrinks the layout viewport (which the fixed footer anchors to) instead of only the visual viewport.
- Updated dependencies [321b375]
- Updated dependencies [d0f03f9]
- Updated dependencies [5137ce5]
- Updated dependencies [833c4f7]
- Updated dependencies [cac0d04]
- Updated dependencies [8226c65]
  - @cosmicdrift/kumiko-renderer@0.189.0
  - @cosmicdrift/kumiko-headless@0.189.0
  - @cosmicdrift/kumiko-dispatcher-live@0.189.0

## 0.188.0

### Minor Changes

- 0920a90: Fix: two parallel create sessions on the same wizard screen no longer collapse onto the same `draftKey` and silently overwrite each other (#1908). `RenderEdit` now mints a client-side `draftId` (UUID) on the first step change in create-mode and persists it via the new `DraftStorage` context (`@cosmicdrift/kumiko-renderer-web` supplies a `sessionStorage`-backed default, `createBrowserDraftStorage`). If no `draftId` survived (new tab, cleared storage), `RenderEdit` falls back to `form-draft:query:list` and either auto-adopts a single open draft or shows a picker for multiple. Edit-mode `draftKey` (`${screenId}:${entityId}`) is unchanged.
- fbe3723: Fix #1887: `RenderEdit` gains a controlled mode for callers that embed it
  directly (e.g. Solon), without going through an Extension section:

  - `onChange?: (state: { values, changes, dirty, valid }) => void` fires on
    every values-snapshot change. `changes` is the delta against the initial
    values (same semantics as `payloadMode: "changes"`), so a caller never
    overwrites unseen fields. `valid` is a dry-run `schema.safeParse`, so it
    never paints field errors into the UI.
  - `onControlsReady?: (controls: { patch, validate, getValues }) => void`
    fires once after mount and hands the caller `patch(partial)` to set
    values from outside without a remount, `validate()` to check without a
    write (reports field errors on the field itself, not a summary banner),
    and `getValues()`.

  Both props are optional and additive — without them, existing `RenderEdit`
  behavior is unchanged.

- d1db0ae: `RenderEdit` renders wizard-mode screens (`layout.mode: "wizard"`) one section per step, with a progress indicator, Back/Next/Finish buttons, and per-step field validation instead of rendering all sections at once.

### Patch Changes

- f570e09: Widen the money column in embedded lists to fit the amount plus the stepper buttons.
- b79e547: Fix #1923: money fields now round-trip correctly on the auto-wired
  entityEdit path. Create previously sent a bare number against the server's
  `{amount, currency}` schema, update rendered the rehydrated read value as
  `NaN`, and a naive fix would have been 100x off for zero-decimal currencies
  like JPY (minor vs. major units). `RenderField`'s money case now converts
  between `MoneyInput`'s minor-unit widget contract and the major-unit
  `{amount, currency}` payload/read shape via a shared `currencyDecimals`
  (moved to `kumiko-headless`), and `EditFieldViewModel` carries the field's
  resolved currency so the conversion has one source of truth.

  Money fields declared on a `configEdit`/`actionForm` screen (not entityEdit)
  still submit correctly: `ConfigEditBody`'s `customSubmit` unwraps the
  `{amount, currency}` payload back to a bare number before dispatching
  `config:write:set`, matching `ConfigKeyType`'s scalar-only contract.

- Updated dependencies [0920a90]
- Updated dependencies [a2d768f]
- Updated dependencies [2de7583]
- Updated dependencies [b79e547]
- Updated dependencies [fbe3723]
- Updated dependencies [04d2f7b]
- Updated dependencies [aa39a95]
- Updated dependencies [d1db0ae]
- Updated dependencies [a9b8343]
  - @cosmicdrift/kumiko-renderer@0.188.0
  - @cosmicdrift/kumiko-headless@0.188.0
  - @cosmicdrift/kumiko-dispatcher-live@0.188.0

## 0.187.0

### Minor Changes

- 3e36735: Fix #1861: `usePrimitives().DataTable` gains three composition hooks for
  apps that build the table directly (not via `RenderList`):

  - `ColumnRendererProps` gains an optional `onChange`, wired from a new
    `DataTableProps.onCellChange(rowId, field, value)` — a component
    column-renderer can now mutate a cell instead of only displaying it.
  - `ListColumnViewModel.highlighted` marks one column at runtime (e.g. the
    selected base-year column in a multi-year grid); `DataTable` renders its
    header and cells with a distinct background and `data-highlighted="true"`.
  - `DataTableProps.getRowTestId` / `getCellTestId` override the previously
    hardcoded `row-${id}` / `cell-${id}-${field}` test-id pattern.

### Patch Changes

- 1445686: DateField's placeholder now shows the locale's date format pattern (e.g. "TT.MM.JJJJ" in de, "MM/DD/YYYY" in en-US, "DD/MM/YYYY" in en-GB) instead of a hardcoded example date ("31.12.2026"), which read as an already-filled-in value and caused editors to skip the field. Fixes #1865.
- 7b7f62c: Fix `EmbeddedListInput` desktop table columns collapsing below their declared width (e.g. a typed digit clipped in a number cell) instead of triggering the existing horizontal scroll. `w-full` on the vendored `Table`'s `<table>` let the (already-active) auto table-layout algorithm squeeze columns below their `columnWidthClass` width to fit the container; the table now keeps `min-w-max` so columns retain that width and the wrapper scrolls instead. Fixes solon#107.
- Updated dependencies [3e36735]
- Updated dependencies [1445686]
  - @cosmicdrift/kumiko-renderer@0.187.0
  - @cosmicdrift/kumiko-headless@0.187.0
  - @cosmicdrift/kumiko-dispatcher-live@0.187.0

## 0.186.3

### Patch Changes

- 587f09d: Fix #1870: `FieldProps` and all `*Field` widgets (`SelectField`, `TextField`, `DateField`,
  `BooleanField`, `TextareaField`, `RangeField`, `FileField`, `NumberField`) gain a `hideLabel`
  prop that visually collapses the label to `sr-only` while keeping it associated via `htmlFor`.
  For table/grid columns where the header already carries the label.
- Updated dependencies [587f09d]
  - @cosmicdrift/kumiko-renderer@0.186.3
  - @cosmicdrift/kumiko-dispatcher-live@0.186.3
  - @cosmicdrift/kumiko-headless@0.186.3

## 0.186.2

### Patch Changes

- e4d0c30: Fix #1854: `EmbeddedListInput` mounted both the desktop table and the mobile card
  layout at once, toggling visibility with `hidden`/`md:hidden`. Both mounts rendered
  the same `data-cell-id`/`id` for every cell, so two live inputs (each with its own
  draft state) shared one DOM id — automation could hit the hidden instance, and a
  filled-in cell could appear empty while a derived total read the correct value.
  Only the layout matching the current viewport (via `useIsMobile`) is mounted now.
  - @cosmicdrift/kumiko-dispatcher-live@0.186.2
  - @cosmicdrift/kumiko-headless@0.186.2
  - @cosmicdrift/kumiko-renderer@0.186.2

## 0.186.1

### Patch Changes

- ad5933d: DataTable money cells prefer `amountMinor` from rehydrateMoney so major-unit `amount` is not passed to formatMoney (which expects cents).
- eb94d51: Fix #1834: `embedded` (non-list), `jsonb` and `multiSelect` fields without a dedicated
  widget no longer fall back to an editable text input — that fallback ran the value
  through `stringValue()` and saving the form overwrote the real data with the mangled
  string (`"[object Object]"`, `"a,b"`). They now render a read-only `Banner` instead.

  `BannerProps` gained an optional `id` so `<Field>`'s `<label htmlFor>` has a real target
  when it wraps a Banner instead of an input.

  `required: true` on one of these fields is currently a dead end (no widget to satisfy
  it) — the actual list/object editor is tracked separately in #1835.

- Updated dependencies [eb94d51]
- Updated dependencies [3790863]
  - @cosmicdrift/kumiko-renderer@0.186.1
  - @cosmicdrift/kumiko-headless@0.186.1
  - @cosmicdrift/kumiko-dispatcher-live@0.186.1

## 0.186.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.186.0
- @cosmicdrift/kumiko-renderer@0.186.0
- @cosmicdrift/kumiko-dispatcher-live@0.186.0

## 0.185.0

### Minor Changes

- 0a059a0: `createEmbeddedListField()` now has an editable widget, so line-item forms (invoices, bookings, orders) can be declared instead of hand-built as a custom screen. The field type gains `select`/`reference` cell types, `minItems`/`maxItems` bounds, derived cells (`multiply`/`sum`/`subtract`), and column totals; the new `EmbeddedListInput` renders it as a controlled table/card with add/remove/duplicate/reorder, keyboard navigation, and paste-from-spreadsheet support (fw#1838).
- 6380447: `InfinityList` now subscribes to SSE events for the entity parsed from its `query` prop (same `<feature>:query:<entity>:<verb>` convention as `useQuery`'s `live` option) and refetches only the first page on any create/update/delete/restore event, merging the fresh rows in by `rowId` instead of collapsing the already-accumulated pages — a full reload would jump the scroll position. New `live` prop, default `true`. `entityFromQueryType` is now exported from `@cosmicdrift/kumiko-renderer` so `InfinityList` can reuse it instead of duplicating the parsing logic.

### Patch Changes

- 43e0291: Embedded-list widget follow-ups from #1838 review (fw#1839):

  - Keyboard focus after Tab/Enter-to-add-row now lands on the actual focusable control (date/timestamp/money/select/reference cells), not the non-focusable wrapper `div`; Enter on the last cell now also appends+focuses a new row, mirroring Tab.
  - Embedded-list money cells and the totals row use the entity's `defaultCurrency` instead of a hardcoded `"EUR"`.
  - Reference sub-fields inside an embedded field get the same boot-time target-entity/labelField/list-query-handler checks as top-level reference fields.
  - New declarative `totalsMatch` on `EmbeddedFieldDef` validates (client and server, via the same Zod schema) that the sum of a list subfield equals a sibling top-level money field, with boot-time checks that both fields exist and are money-typed.
  - New `"timestamp"` embedded-list cell type, end to end (types, schema validation, view-model, renderer primitives, `TimestampInput` in the web renderer).
  - Derived embedded-list cells (`field.derived`) are now re-validated server-side against a local mirror of the client's `computeDerivedCellValue`; an absent derived cell is never flagged as a mismatch against 0.

- 80b5247: nav-tree: register `upload` in the `NAV_ICONS` registry (lucide-react `Upload`). App authors can now reference `icon: "upload"` in `r.nav` declarations without falling back to the blank dot.
- Updated dependencies [0a059a0]
- Updated dependencies [43e0291]
- Updated dependencies [6380447]
  - @cosmicdrift/kumiko-headless@0.185.0
  - @cosmicdrift/kumiko-renderer@0.185.0
  - @cosmicdrift/kumiko-dispatcher-live@0.185.0

## 0.184.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.184.0
- @cosmicdrift/kumiko-headless@0.184.0
- @cosmicdrift/kumiko-renderer@0.184.0

## 0.183.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.183.2
- @cosmicdrift/kumiko-renderer@0.183.2
- @cosmicdrift/kumiko-dispatcher-live@0.183.2

## 0.183.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.183.1
- @cosmicdrift/kumiko-headless@0.183.1
- @cosmicdrift/kumiko-renderer@0.183.1

## 0.183.0

### Minor Changes

- 14853d9: `renderer-web` gets `RichContentEditor`, the `contentFormat: "rich"` WYSIWYG editor (bold, italic, headings, lists, autolinking) — built on tiptap, dynamic-imported so an app that never mounts a "rich" collection never pays for it, and falling back to the plain textarea while the chunk loads. tiptap is a `dependencies` entry on `renderer-web` only, same as radix/cmdk/lucide — no tiptap type crosses the editor's public `{ value, onChange, variables, readOnly }` contract. `template-resolver`'s client now registers `RichContentEditor` under `contentEditors.rich`, so `rich` collections (e.g. mail-html templates) get the WYSIWYG without any app-side wiring.

### Patch Changes

- Updated dependencies [08c5c8c]
  - @cosmicdrift/kumiko-renderer@0.183.0
  - @cosmicdrift/kumiko-headless@0.183.0
  - @cosmicdrift/kumiko-dispatcher-live@0.183.0

## 0.182.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.182.1
- @cosmicdrift/kumiko-renderer@0.182.1
- @cosmicdrift/kumiko-dispatcher-live@0.182.1

## 0.182.0

### Minor Changes

- 8a3b0a9: `r.contentCollection()` accepts a new `contentFormat: "plain" | "rich"` field. `ClientFeatureDefinition` gets a sixth registry, `contentEditors` — a `contentFormat → EditorComponent` map merged with the same last-wins semantics as `columnRenderers`. `createKumikoApp` mounts a `ContentEditorsProvider`; `useContentEditor(contentFormat)` resolves the registered component or falls back to a plain textarea, so a missing editor is never an empty panel. `template-resolver`'s content-collection editor now renders through this registry instead of a hardcoded textarea.
- 9c62bc8: `ContentCollectionDefinition` accepts a new `variableSchema` field — fixed variable names the app declares for a collection (e.g. an `ai-prompt` collection's `{customerName}`, `{orderId}`). The renderer gets `VariableChips`, an editor-agnostic chip bar that inserts `{{name}}` at the caret on click, and `renderer-web` gets `PlainContentEditor`, which pairs it with the existing textarea fallback. `template-resolver`'s client now registers `PlainContentEditor` under `contentEditors.plain` and passes the collection's variable names through, so AI-prompt and mail-html collections with `contentFormat: "plain"` get the chip bar without any app-side wiring.

### Patch Changes

- Updated dependencies [8a3b0a9]
- Updated dependencies [9c62bc8]
  - @cosmicdrift/kumiko-renderer@0.182.0
  - @cosmicdrift/kumiko-headless@0.182.0
  - @cosmicdrift/kumiko-dispatcher-live@0.182.0

## 0.181.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.181.0
- @cosmicdrift/kumiko-renderer@0.181.0
- @cosmicdrift/kumiko-dispatcher-live@0.181.0

## 0.180.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.180.0
- @cosmicdrift/kumiko-renderer@0.180.0
- @cosmicdrift/kumiko-dispatcher-live@0.180.0

## 0.179.0

### Minor Changes

- 996cf53: `SidebarPanel`: zweite Sidebar-Spalte fuer Screens, die eine Liste neben der Navigation brauchen statt im Content — das shadcn-Muster `sidebar-09` (Mail-Client) neben dem `sidebar-07`, das die Shell sonst faehrt.

  Ein Screen konnte das bisher nicht bauen: er rendert per Definition im `SidebarInset`, also unter dem ShellHeader, und kommt von dort nicht an eine Spalte, die vom oberen bis zum unteren Fensterrand laeuft. Der Slot dreht die Richtung um — die Shell haelt den Platz, der Screen fuellt ihn per Portal und bleibt sonst ein normaler Screen.

  - Verdrahtet in `WorkspaceShell` **und** `DefaultAppShell`.
  - Rendert nur, wenn ein Screen den Slot fuellt — kein leerer Streifen auf allen anderen Screens.
  - Ohne Slot (Public-Surface, Tests, aeltere Shell) landen die Kinder an Ort und Stelle statt zu verschwinden.
  - Breite ziehbar (Default 340px, 260–640), mit optionalem `storageKey` ueber Reloads hinweg.

  Ausserdem in `NavTree`: im eingeklappten Zustand wird das Label jetzt ausgeblendet statt nur gekuerzt. `SidebarMenuButton` verlaesst sich auf `truncate`, was nur traegt, wenn ein Icon danebensteht — bei einem Eintrag ohne Icon blieb ein Buchstabenrest in der Rail stehen. Fehlt ein Icon, tritt dort jetzt der Anfangsbuchstabe an die Stelle des Punkts, der eingeklappt nichts aussagt. `icon: "plus"` war importiert, aber nie registriert, und fiel still auf den Fallback zurueck.

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.179.0
- @cosmicdrift/kumiko-headless@0.179.0
- @cosmicdrift/kumiko-renderer@0.179.0

## 0.178.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.178.1
- @cosmicdrift/kumiko-renderer@0.178.1
- @cosmicdrift/kumiko-dispatcher-live@0.178.1

## 0.178.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.178.0
- @cosmicdrift/kumiko-renderer@0.178.0
- @cosmicdrift/kumiko-dispatcher-live@0.178.0

## 0.177.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.177.0
- @cosmicdrift/kumiko-renderer@0.177.0
- @cosmicdrift/kumiko-dispatcher-live@0.177.0

## 0.176.2

### Patch Changes

- 63b6acf: PR-review fix batch (low-severity findings):

  - `FIELD_ICONS`/`NAV_ICONS` lookups now check `Object.hasOwn` — a `icon: "constructor"`/`"toString"` key no longer resolves through the prototype chain into a render crash.
  - `subjectRef` narrowed to `?: true` (no observed `false` usage) — matches the sibling `lookupable?: true` idiom.
  - `sse-broker`'s access-invalidation listener Set now documents its callback-reference dedup contract.
  - `date-parse.ts`'s `toIso` passes `calendarName: "never"` so a future non-ISO `PlainDate` can't leak a `[u-ca=...]` suffix onto the wire.
  - `runRunner` (gen-feature-screenshots) wipes each scenario's output dir before a fresh Playwright run — a renamed/removed scenario no longer leaves a stale preview behind.
  - `screenshots.ts`'s `axis()` throws instead of silently registering zero tests when an env filter matches nothing.
  - `run-prod-app`'s `extraRoutes` now mount before seeds/seed-migrations (previously after `entrypoint.start()`), matching the dev-server's ordering — a seed that dispatches through the Hono matcher no longer blocks a later `extraRoutes` route registration.
  - `job-runs-screen`'s job selector now resets payload/error/success state on job change, instead of validating stale payload text against the newly selected job's schema.
  - `render-field`'s create-then-refetch clears the stale search term first and logs (instead of swallowing) a refetch failure.
  - `purge-subject.ts`'s per-entity SELECT is now paged (batch 500, like `reindexEntity`) instead of pulling a whole tenant table into memory.
  - `login.write.ts`'s `gateResolveAuthUser`/`gateVerifyPassword` now share a narrowed `AuthenticatableUserRow` type — removes a redundant, differently-timed second `passwordHash` miss path.
  - `dispatch-shared.ts`'s `tenant:config:timezone` literal is now a named constant, with a new integration test booting the real `createTenantFeature()` to catch drift (previously only a standalone probe feature exercised it).
  - `NotifyOptions.recipientId`'s JSDoc now states it's ignored on the `to` path.
  - Test fixes: `access-roles`/`boot-validator` tests silence `console.warn` instead of letting it print during the run; `tz-resolution.integration.test.ts`'s third case sets its own tenant-config precondition instead of relying on test order; `jobs-catalog.integration.test.ts` now uses `setupTestStack` + real HTTP like its sibling suite instead of hand-rolled fetch helpers; a `styleguide`/`renderer` test-only `as unknown as` cast replaced with a typed optional + `delete`.

- Updated dependencies [63b6acf]
  - @cosmicdrift/kumiko-renderer@0.176.2
  - @cosmicdrift/kumiko-headless@0.176.2
  - @cosmicdrift/kumiko-dispatcher-live@0.176.2

## 0.176.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.176.1
- @cosmicdrift/kumiko-headless@0.176.1
- @cosmicdrift/kumiko-renderer@0.176.1

## 0.176.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.176.0
- @cosmicdrift/kumiko-renderer@0.176.0
- @cosmicdrift/kumiko-dispatcher-live@0.176.0

## 0.175.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.175.0
- @cosmicdrift/kumiko-headless@0.175.0
- @cosmicdrift/kumiko-renderer@0.175.0

## 0.174.1

### Patch Changes

- de0da71: PR-review fix batch (careful-tier findings, batch 4):

  - `enrichWithReferences` (eagerload) computes each ref entity's PII/encrypted-field sets and KMS handle once per reference field instead of once per referenced row.
  - `event-store-executor-write`'s `runPreSave` now strips `id`/`version` from a preSave hook's return value before it's persisted — a hook that echoes them back could otherwise override the framework-minted `aggregateId`.
  - `subscription-tier-sync`'s webhook route no longer turns an already-committed write into `isSuccess: false` when the follow-up tier sync fails — Stripe/PayPal would otherwise retry an event whose primary effect already landed. The sync failure is now logged instead.
  - `revoke-all-for-user` hard-fails (instead of silently defaulting to `eventVersion: 1`) when `SESSION_REVOKED_EVENT_QN` isn't registered; the surrounding write transaction rolls the session-revoke back too.
  - `schema-builder`'s defaulted-select preprocessing now also maps `null` to the field default, matching the no-default branch's own "" → null normalization.
  - `watch-supervisor` no longer routes a projection-write failure (marking an account "watching") through the sync-error/backoff path — the watch itself is healthy.
  - `styleguide`'s inbox-messages query handler validates `cursor`/`limit` instead of accepting unbounded/negative values.
  - `backfill-changelogs --days` now rejects a non-numeric value instead of producing `Invalid time value`.
  - `seed-items` (showcase) probes via `{ limit: 1, totalCount: true }` instead of comparing `rows.length` against a page size that a future max-limit clamp could invalidate.
  - `gen-feature-screenshots`: sample screenshots keep their own preview label separate from the URL path segment, the SAMPLES_OUT default no longer escapes an explicit `SCREENSHOT_DIR`, and the summary log line now counts sample PNGs too.
  - `PII_USER_REFERENCE_NAME_HINTS` gained `createdby`/`updatedby`/`assigneeuserid`/`memberid` — the boot-validator's GDPR-hook-coverage guard previously missed those common FK-naming shapes.
  - `engine`'s public barrel now re-exports `userCanCreateFieldRow`/`normalizeAccessEntry` (already public in `ownership.ts`, just missing from the index).
  - Small dedup/doc fixes: `screenAccessAllows` (renderer/render-field), `fillClasses` (renderer-web layout shells), `fieldIconFor` (renderer-web primitives), `entity-table-meta`'s deprecated-alias error message, `schema-cli`'s `storeTable()` hint, the `guard-types-class-free` mutable-state regex (no longer flags readonly object/array literals), and an `InfiniteSentinel` LocaleProvider-requirement doc note.

- f5da76a: PR-review fix batch (careful-tier findings):

  - `stock-cap-guard`'s `checkStockCap` no longer lets a caller-supplied `where.tenantId` override the real tenant scope (spread order fix).
  - `defineCreateWithTenantDefaults` now validates `localeField` against the entity at define-time, matching the existing `currencyFields` check.
  - `resolveMfaTokenSecrets` treats an empty-string override the same as `undefined` — falls back to derivation instead of signing MFA tokens with an empty HMAC key.
  - `buildUpdateSchema` (schema-builder): a `""` submission for a `select` field with a default now maps to that default, not `null` — matches the insert path's "a field with a default is never unset" invariant, on both optional and required selects.
  - `kumiko upgrade`'s enterprise-package changelog discovery is detected by `changes.json` presence, not an `"ai-"` name-prefix heuristic that silently dropped differently-named or renamed packages.
  - **Deletion-request magic link** (`user-data-rights`): the verify token now goes in the URL fragment (`#token=`) instead of a query param, so it never lands in proxy/access logs — same convention as the export-download link.
  - `InfinityList` (renderer-web) discards a response whose request was superseded by a newer one (request-sequence guard) — a slow response for an old search term can no longer overwrite a faster response for a newer one.
  - `END_LABEL_MIN_ROWS` (renderer-web `DataTable`/`InfiniteSentinel`) aligned to the framework's default `pageSize` (50, was 20) so the "end of list" marker's default-case threshold matches reality; per-screen custom `pageSize` still isn't threaded down to this component (follow-up).

- Updated dependencies [de0da71]
- Updated dependencies [50b7d0c]
  - @cosmicdrift/kumiko-renderer@0.174.1
  - @cosmicdrift/kumiko-headless@0.174.1
  - @cosmicdrift/kumiko-dispatcher-live@0.174.1

## 0.174.0

### Patch Changes

- f4dc0d9: `parseIso`/`parseTypedDate` now reject years above 9999, matching the existing lower-bound guard. `Temporal.PlainDate.toString()` switches to the signed extended ISO format (`+010000-04-25`) above that range, which broke the DateField wire contract of always emitting a plain `yyyy-mm-dd` string. Values with a 5+ digit year now parse to `undefined` instead of producing a malformed ISO string.
  - @cosmicdrift/kumiko-headless@0.174.0
  - @cosmicdrift/kumiko-renderer@0.174.0
  - @cosmicdrift/kumiko-dispatcher-live@0.174.0

## 0.173.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.173.1
- @cosmicdrift/kumiko-renderer@0.173.1
- @cosmicdrift/kumiko-dispatcher-live@0.173.1

## 0.173.0

### Patch Changes

- Updated dependencies [20dfb78]
  - @cosmicdrift/kumiko-renderer@0.173.0
  - @cosmicdrift/kumiko-headless@0.173.0
  - @cosmicdrift/kumiko-dispatcher-live@0.173.0

## 0.172.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.172.0
- @cosmicdrift/kumiko-renderer@0.172.0
- @cosmicdrift/kumiko-dispatcher-live@0.172.0

## 0.171.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.171.2
- @cosmicdrift/kumiko-renderer@0.171.2
- @cosmicdrift/kumiko-dispatcher-live@0.171.2

## 0.171.1

### Patch Changes

- ed45fb2: `InfiniteSentinel` only shows its "— End of list —" marker once a list has at least one full page of rows (default 20). A short list (a single page) now ends with no marker — the list visibly ends itself, the marker was just noise there (#1699).
- Updated dependencies [ed45fb2]
  - @cosmicdrift/kumiko-renderer@0.171.1
  - @cosmicdrift/kumiko-headless@0.171.1
  - @cosmicdrift/kumiko-dispatcher-live@0.171.1

## 0.171.0

### Minor Changes

- 32123ff: `entityEdit`/`configEdit`/`actionForm`/`projectionDetail` screens can now set `layout.width` ("sm" | "3xl" | "4xl" | "full") to opt out of the hardcoded 3xl-centered form shell — useful for dense multi-column masks that previously left dead space on both sides (#1676). Unset stays "3xl" (unchanged default).
- 9cc21ed: `entityEdit` screens now support two declarative form-affordances that previously required custom JSX:

  - `EditFieldsSection.description` — an optional help text (i18n key or raw string) under a block heading, rendered through the same `subtitle` slot as `FormProps.subtitle`.
  - `EditFieldSpec.icon` — an optional prefix icon on `text`/`number` fields, resolved against a small `FIELD_ICONS` registry in `kumiko-renderer-web` (mail, lock, hash, search, user, phone, calendar, link, tag, building, globe, key, map-pin). Unknown keys fall back to no icon.

  Closes #1677.

- 3f926d4: Reference-field comboboxes now offer a "+ Create" footer that opens the referenced entity's create screen in a modal, selects the newly created record, and refreshes the option list — no more leaving the current form to create a missing referenced record first (#1681).

  Adds a new `Modal` core primitive (bare content shell for hosting self-contained forms in an overlay) and `AppFeaturesProvider`/`useAppFeatures` for cross-feature schema access.

### Patch Changes

- f2d69c7: `InfiniteSentinel`'s "— End of list —" marker now goes through `t("kumiko.list.end-of-list")` instead of a hardcoded English string, so it translates correctly in non-English apps (#1675).
- Updated dependencies [7ed113b]
- Updated dependencies [d125a49]
- Updated dependencies [32123ff]
- Updated dependencies [9cc21ed]
- Updated dependencies [f2d69c7]
- Updated dependencies [3f926d4]
  - @cosmicdrift/kumiko-renderer@0.171.0
  - @cosmicdrift/kumiko-headless@0.171.0
  - @cosmicdrift/kumiko-dispatcher-live@0.171.0

## 0.170.0

### Patch Changes

- Updated dependencies [d87e9b0]
  - @cosmicdrift/kumiko-headless@0.170.0
  - @cosmicdrift/kumiko-renderer@0.170.0
  - @cosmicdrift/kumiko-dispatcher-live@0.170.0

## 0.169.0

### Minor Changes

- b136040: `WorkspaceShell` gains a `fill?: boolean` prop, mirroring `DefaultAppShell`'s existing viewport-fit mode: `true` pins the shell to `h-svh` and scrolls the content area instead of the whole page. Apps that mount long tables/lists through `WorkspaceShell` (solon, publicstatus, money-horse) can opt in per-screen the same way they already can with `DefaultAppShell`.

### Patch Changes

- @cosmicdrift/kumiko-headless@0.169.0
- @cosmicdrift/kumiko-renderer@0.169.0
- @cosmicdrift/kumiko-dispatcher-live@0.169.0

## 0.168.0

### Patch Changes

- 547dd7d: `date-parse.ts` (internal, not re-exported from the package's public entrypoints) now works with `Temporal.PlainDate` instead of native `Date`. Adds `temporal-polyfill` as a runtime dependency. `DateField`'s public props (`value`/`onChange`/`min`/`max`) are unchanged ISO strings — the conversion is fully contained inside `date-parse.ts` and `date-field.tsx` (kumiko-framework#1656).
  - @cosmicdrift/kumiko-headless@0.168.0
  - @cosmicdrift/kumiko-renderer@0.168.0
  - @cosmicdrift/kumiko-dispatcher-live@0.168.0

## 0.167.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.167.1
- @cosmicdrift/kumiko-renderer@0.167.1
- @cosmicdrift/kumiko-dispatcher-live@0.167.1

## 0.167.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.167.0
- @cosmicdrift/kumiko-renderer@0.167.0
- @cosmicdrift/kumiko-dispatcher-live@0.167.0

## 0.166.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.166.0
- @cosmicdrift/kumiko-renderer@0.166.0
- @cosmicdrift/kumiko-dispatcher-live@0.166.0

## 0.165.4

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.165.4
- @cosmicdrift/kumiko-headless@0.165.4
- @cosmicdrift/kumiko-renderer@0.165.4

## 0.165.3

### Patch Changes

- @cosmicdrift/kumiko-headless@0.165.3
- @cosmicdrift/kumiko-renderer@0.165.3
- @cosmicdrift/kumiko-dispatcher-live@0.165.3

## 0.165.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.165.2
- @cosmicdrift/kumiko-renderer@0.165.2
- @cosmicdrift/kumiko-dispatcher-live@0.165.2

## 0.165.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.165.1
- @cosmicdrift/kumiko-renderer@0.165.1
- @cosmicdrift/kumiko-dispatcher-live@0.165.1

## 2.0.0

### Patch Changes

- Updated dependencies [eb856c6]
  - @cosmicdrift/kumiko-headless@2.0.0
  - @cosmicdrift/kumiko-dispatcher-live@2.0.0
  - @cosmicdrift/kumiko-renderer@2.0.0

## 1.0.0

### Patch Changes

- @cosmicdrift/kumiko-headless@1.0.0
- @cosmicdrift/kumiko-renderer@1.0.0
- @cosmicdrift/kumiko-dispatcher-live@1.0.0

## 0.165.0

### Patch Changes

- Updated dependencies [cf56745]
  - @cosmicdrift/kumiko-dispatcher-live@0.165.0
  - @cosmicdrift/kumiko-headless@0.165.0
  - @cosmicdrift/kumiko-renderer@0.165.0

## 0.164.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.164.0
- @cosmicdrift/kumiko-renderer@0.164.0
- @cosmicdrift/kumiko-dispatcher-live@0.164.0

## 0.163.3

### Patch Changes

- @cosmicdrift/kumiko-headless@0.163.3
- @cosmicdrift/kumiko-renderer@0.163.3
- @cosmicdrift/kumiko-dispatcher-live@0.163.3

## 0.163.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.163.2
- @cosmicdrift/kumiko-renderer@0.163.2
- @cosmicdrift/kumiko-dispatcher-live@0.163.2

## 0.163.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.163.1
- @cosmicdrift/kumiko-headless@0.163.1
- @cosmicdrift/kumiko-renderer@0.163.1

## 0.163.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.163.0
- @cosmicdrift/kumiko-renderer@0.163.0
- @cosmicdrift/kumiko-dispatcher-live@0.163.0

## 0.162.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.162.0
- @cosmicdrift/kumiko-renderer@0.162.0
- @cosmicdrift/kumiko-dispatcher-live@0.162.0

## 0.161.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.161.0
- @cosmicdrift/kumiko-renderer@0.161.0
- @cosmicdrift/kumiko-dispatcher-live@0.161.0

## 0.160.0

### Patch Changes

- Updated dependencies [d3e815c]
  - @cosmicdrift/kumiko-headless@0.160.0
  - @cosmicdrift/kumiko-dispatcher-live@0.160.0
  - @cosmicdrift/kumiko-renderer@0.160.0

## 0.159.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.159.1
- @cosmicdrift/kumiko-renderer@0.159.1
- @cosmicdrift/kumiko-dispatcher-live@0.159.1

## 1.0.0

### Patch Changes

- @cosmicdrift/kumiko-headless@1.0.0
- @cosmicdrift/kumiko-renderer@1.0.0
- @cosmicdrift/kumiko-dispatcher-live@1.0.0

## 0.158.2

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.158.2
- @cosmicdrift/kumiko-headless@0.158.2
- @cosmicdrift/kumiko-renderer@0.158.2

## 0.158.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.158.1
- @cosmicdrift/kumiko-renderer@0.158.1
- @cosmicdrift/kumiko-dispatcher-live@0.158.1

## 0.158.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.158.0
- @cosmicdrift/kumiko-headless@0.158.0
- @cosmicdrift/kumiko-renderer@0.158.0

## 0.157.3

### Patch Changes

- a403e28: `createKumikoApp`'s fallback landing-route selection (`firstOpenScreenQn`) now also requires the candidate screen be reachable via `r.nav`, not just free of a role restriction. Previously a dormant `type: "custom"` screen a feature registers only for manual app-side placement (e.g. `auth-mfa`'s enable screen) could win the fallback by declaration order alone, landing apps without an explicit `screenQn` on a screen nobody wired a client component for (#1258). Apps that rely on the implicit fallback and have no open, nav-placed screen now get a clear boot-time error instead of a silent broken render.
  - @cosmicdrift/kumiko-dispatcher-live@0.157.3
  - @cosmicdrift/kumiko-headless@0.157.3
  - @cosmicdrift/kumiko-renderer@0.157.3

## 0.157.2

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.157.2
- @cosmicdrift/kumiko-headless@0.157.2
- @cosmicdrift/kumiko-renderer@0.157.2

## 0.157.1

### Patch Changes

- c4b9a88: Fix `KumikoScreen` rendering role-gated screens for users without a matching role (#1203). `access.roles` was only enforced for nav/workspace visibility (`filterByAccess` in `workspace-shell.tsx`) — the actual screen-render path had no independent check, so any authenticated user reaching a role-gated screen via a direct URL, bookmark, or the app's `screenQn` fallback saw the screen's chrome regardless of role. Data stayed safe (query/write handlers are still server-side role-checked), this was a chrome leak, not a data leak.

  `KumikoScreen` now gates on `screen.access` using the same roles the shells already pass for nav filtering, threaded down via a new `UserRolesProvider`/`useUserRoles` (exported from `@cosmicdrift/kumiko-renderer`). `WorkspaceShell` and `DefaultAppShell` wrap their children with it using `user?.roles`. Consistent with `filterByAccess`'s existing default-deny: no provider mounted, or `roles` not passed, denies role-gated screens — apps with role-gated screens must wire `user` into their shell (the same prop they already pass for nav) or those screens render an "access denied" placeholder instead of their content.

- Updated dependencies [c4b9a88]
  - @cosmicdrift/kumiko-renderer@0.157.1
  - @cosmicdrift/kumiko-dispatcher-live@0.157.1
  - @cosmicdrift/kumiko-headless@0.157.1

## 0.157.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.157.0
- @cosmicdrift/kumiko-renderer@0.157.0
- @cosmicdrift/kumiko-dispatcher-live@0.157.0

## 0.156.3

### Patch Changes

- @cosmicdrift/kumiko-headless@0.156.3
- @cosmicdrift/kumiko-renderer@0.156.3
- @cosmicdrift/kumiko-dispatcher-live@0.156.3

## 0.156.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.156.2
- @cosmicdrift/kumiko-renderer@0.156.2
- @cosmicdrift/kumiko-dispatcher-live@0.156.2

## 0.156.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.156.1
- @cosmicdrift/kumiko-headless@0.156.1
- @cosmicdrift/kumiko-renderer@0.156.1

## 0.156.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.156.0
- @cosmicdrift/kumiko-renderer@0.156.0
- @cosmicdrift/kumiko-dispatcher-live@0.156.0

## 0.155.1

### Patch Changes

- Updated dependencies [69ac999]
  - @cosmicdrift/kumiko-renderer@0.155.1
  - @cosmicdrift/kumiko-headless@0.155.1
  - @cosmicdrift/kumiko-dispatcher-live@0.155.1

## 0.155.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.155.0
- @cosmicdrift/kumiko-renderer@0.155.0
- @cosmicdrift/kumiko-dispatcher-live@0.155.0

## 0.154.2

### Patch Changes

- 005f6ed: Nav entries without their own `access` now inherit the access rule from
  their referenced screen (`buildNavRegistrySliceForApp`). Previously a nav
  entry with no explicit `access` was always visible once its workspace
  granted access, even when the target screen's own `access` was narrower —
  a role could see the entry, click it, and get a 403 instead of the entry
  being hidden. An explicit `access` on the nav entry still wins over the
  screen's. Fixes #1099.
  - @cosmicdrift/kumiko-headless@0.154.2
  - @cosmicdrift/kumiko-renderer@0.154.2
  - @cosmicdrift/kumiko-dispatcher-live@0.154.2

## 0.154.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.154.1
- @cosmicdrift/kumiko-headless@0.154.1
- @cosmicdrift/kumiko-renderer@0.154.1

## 0.154.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.154.0
- @cosmicdrift/kumiko-renderer@0.154.0
- @cosmicdrift/kumiko-dispatcher-live@0.154.0

## 0.153.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.153.0
- @cosmicdrift/kumiko-headless@0.153.0
- @cosmicdrift/kumiko-renderer@0.153.0

## 0.152.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.152.0
- @cosmicdrift/kumiko-renderer@0.152.0
- @cosmicdrift/kumiko-dispatcher-live@0.152.0

## 0.151.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.151.1
- @cosmicdrift/kumiko-renderer@0.151.1
- @cosmicdrift/kumiko-dispatcher-live@0.151.1

## 0.151.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.151.0
- @cosmicdrift/kumiko-renderer@0.151.0
- @cosmicdrift/kumiko-dispatcher-live@0.151.0

## 0.150.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.150.0
- @cosmicdrift/kumiko-renderer@0.150.0
- @cosmicdrift/kumiko-dispatcher-live@0.150.0

## 0.149.2

### Patch Changes

- f0a73c0: WorkspaceShell accepts `navBadges` (same NavTree slot as DefaultAppShell) so multi-workspace apps can show runtime badges (e.g. unread inbox counts).
  - @cosmicdrift/kumiko-dispatcher-live@0.149.2
  - @cosmicdrift/kumiko-headless@0.149.2
  - @cosmicdrift/kumiko-renderer@0.149.2

## 0.149.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.149.1
- @cosmicdrift/kumiko-renderer@0.149.1
- @cosmicdrift/kumiko-dispatcher-live@0.149.1

## 0.149.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.149.0
- @cosmicdrift/kumiko-headless@0.149.0
- @cosmicdrift/kumiko-renderer@0.149.0

## 0.148.0

### Patch Changes

- cb5612d: Nav-/Screen-Labels rendern nicht mehr als roher i18n-Key, wenn ein Feature `r.translations({ keys })`
  verwendet, aber keine App-seitige `web/i18n.ts`-Duplikation mitbringt (z.B. `cap-counter`, `admin-shell`,
  `jobs`, `audit`). `buildAppSchema` projiziert `feature.translations` jetzt verbatim in `FeatureSchema`,
  `createKumikoApp` pivotiert dieses Bundle client-seitig und reiht es zwischen `clientFeatures.translations`
  (App-Override gewinnt weiterhin) und `kumikoDefaultTranslations` ein.

  Beide Pakete müssen zusammen aktualisiert werden — die Server-Projektion allein liefert kein Bundle,
  und ohne die neue `FeatureSchema.translations`-Projektion hat der Renderer nichts zu konsumieren.

  `createPublicSurface` (schema-loser Mount für anonyme Seiten) bekommt nie ein `AppSchema` und ist von
  diesem Fix nicht betroffen — anonyme Screens brauchen weiterhin explizite `clientFeatures.translations`.

  - @cosmicdrift/kumiko-headless@0.148.0
  - @cosmicdrift/kumiko-renderer@0.148.0
  - @cosmicdrift/kumiko-dispatcher-live@0.148.0

## 0.147.3

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.147.3
- @cosmicdrift/kumiko-headless@0.147.3
- @cosmicdrift/kumiko-renderer@0.147.3

## 0.147.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.147.2
- @cosmicdrift/kumiko-renderer@0.147.2
- @cosmicdrift/kumiko-dispatcher-live@0.147.2

## 0.147.1

### Patch Changes

- Updated dependencies [63cfcc9]
  - @cosmicdrift/kumiko-renderer@0.147.1
  - @cosmicdrift/kumiko-dispatcher-live@0.147.1
  - @cosmicdrift/kumiko-headless@0.147.1

## 0.147.0

### Minor Changes

- a46b306: AI-Text primitive: `AiTextField`/`AiTextArea` (renderer-web) — drop-in replacements for `TextField`/`TextareaField` with ghost-text completion (Tab to accept, Esc to discard), and correct/translate/rewrite toolbar actions with a before/after diff preview. Built on `useAiTextAction`/`useCompletion` (renderer) — request/response hooks with debounce, abort, and cap-exceeded/unavailable state. Both degrade gracefully to a plain text field when the server's `ai-text` feature (kumiko-enterprise) isn't mounted — no enterprise import in this public package.
- c93de1a: `Section` primitive: new optional `variant="destructive"` marks a section as a warning/danger area (border-only, e.g. account deletion, restrict processing) — closes the styling gap left after `privacy-center-screen.tsx` migrated off its hand-rolled `border-destructive/40` class onto the shared `Section` primitive.

### Patch Changes

- Updated dependencies [a46b306]
- Updated dependencies [c93de1a]
  - @cosmicdrift/kumiko-renderer@0.147.0
  - @cosmicdrift/kumiko-headless@0.147.0
  - @cosmicdrift/kumiko-dispatcher-live@0.147.0

## 0.146.4

### Patch Changes

- Updated dependencies [d85f5ae]
  - @cosmicdrift/kumiko-headless@0.146.4
  - @cosmicdrift/kumiko-dispatcher-live@0.146.4
  - @cosmicdrift/kumiko-renderer@0.146.4

## 0.146.3

### Patch Changes

- Updated dependencies [58a6145]
  - @cosmicdrift/kumiko-headless@0.146.3
  - @cosmicdrift/kumiko-dispatcher-live@0.146.3
  - @cosmicdrift/kumiko-renderer@0.146.3

## 0.146.2

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.146.2
- @cosmicdrift/kumiko-headless@0.146.2
- @cosmicdrift/kumiko-renderer@0.146.2

## 0.146.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.146.1
- @cosmicdrift/kumiko-renderer@0.146.1
- @cosmicdrift/kumiko-dispatcher-live@0.146.1

## 0.146.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.146.0
- @cosmicdrift/kumiko-renderer@0.146.0
- @cosmicdrift/kumiko-dispatcher-live@0.146.0

## 0.145.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.145.1
- @cosmicdrift/kumiko-headless@0.145.1
- @cosmicdrift/kumiko-renderer@0.145.1

## 0.145.0

### Minor Changes

- 1c60495: ResultTable + ComparisonTable: optionales `card`-Prop. Rendert den Tabellen-Look 1:1 wie die CRUD-Liste (DataTable) — gerundeter `border`-Container auf `bg-card` + `bg-muted`-Header-Band, sauber geclippt. Default bleibt bare, damit bestehende Consumer + bespoke Share-Decks unverändert bleiben. (0.143.0/0.144.0 hatten das Prop durch einen Commit-Fehler nicht.)

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.145.0
- @cosmicdrift/kumiko-headless@0.145.0
- @cosmicdrift/kumiko-renderer@0.145.0

## 0.144.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.144.0
- @cosmicdrift/kumiko-renderer@0.144.0
- @cosmicdrift/kumiko-dispatcher-live@0.144.0

## 0.143.1

### Patch Changes

- b8d890d: Republish: die 0.143.0-Registry-Version enthielt das `card`-Prop (ResultTable/ComparisonTable) durch eine parallele Versions-Kollision nicht. 0.143.1 publiziert den tatsächlichen main-Stand mit `card`.
  - @cosmicdrift/kumiko-dispatcher-live@0.143.1
  - @cosmicdrift/kumiko-headless@0.143.1
  - @cosmicdrift/kumiko-renderer@0.143.1

## 0.143.0

### Minor Changes

- 37bac07: ResultTable + ComparisonTable: optionales `card`-Prop. Rendert den Tabellen-Look 1:1 wie die CRUD-Liste (DataTable) — gerundeter `border`-Container auf `bg-card` + `bg-muted`-Header-Band, sauber geclippt. Default bleibt bare (nur die Tabelle), damit bestehende Consumer + bespoke Layouts (Share-Decks) unverändert bleiben.

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.143.0
- @cosmicdrift/kumiko-headless@0.143.0
- @cosmicdrift/kumiko-renderer@0.143.0

## 0.142.0

### Minor Changes

- 2de19b3: ResultTable + ComparisonTable: optionales `className`-Prop (auf das `<table>` gemergt), damit Consumer table-spezifisches Styling ergänzen können — z.B. bespoke Share-Deck-Layouts (`deck-table`) oder Original-Klassen (`min-w-*`, `[&_th]:text-xs`) beim Umstieg von hand-getailwindeten Tabellen auf das Widget.

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.142.0
- @cosmicdrift/kumiko-headless@0.142.0
- @cosmicdrift/kumiko-renderer@0.142.0

## 0.141.0

### Minor Changes

- 8de61e7: `Button`: `fullWidth?: boolean` → `width?: "full" | "auto"` (default `"auto"`). Bounded Value-Prop statt Boolean-Flag — `width="full"` streckt CTA-Buttons auf Container-Breite, andere Breiten bleiben Layout-Sache des Containers. Ersetzt das erst in 0.140 eingeführte `fullWidth` (noch kein externer Consumer).

### Patch Changes

- Updated dependencies [8de61e7]
  - @cosmicdrift/kumiko-renderer@0.141.0
  - @cosmicdrift/kumiko-dispatcher-live@0.141.0
  - @cosmicdrift/kumiko-headless@0.141.0

## 0.140.0

### Minor Changes

- 742f15c: `Button` bekommt `ariaLabel?` (zugänglicher Name für icon-only-Buttons) und `fullWidth?` (streckt CTA-Buttons in Karten/Panels auf volle Breite). Schließt die letzten Button-Lücken aus kumiko-framework#935 — damit werden icon-only-Remove-Buttons und full-width Pricing-/CTA-Buttons ohne rohes `<button>` migrierbar.

### Patch Changes

- Updated dependencies [742f15c]
  - @cosmicdrift/kumiko-renderer@0.140.0
  - @cosmicdrift/kumiko-dispatcher-live@0.140.0
  - @cosmicdrift/kumiko-headless@0.140.0

## 0.139.0

### Minor Changes

- 56ff9cb: Form-Kit / Primitives: `Button` bekommt eine `size`-Achse (`"sm" | "md" | "icon"`, default `"md"`) für kompakte Inline-/Icon-Buttons; neuer `Input`-`kind:"range"` (Slider, min/max/step) plus `RangeField`-Widget; `FileField`-Widget über den bestehenden `kind:"file"|"image"` (FileRef-basiert). Schließt die drei Core-Primitive-Lücken aus kumiko-framework#935.

### Patch Changes

- Updated dependencies [56ff9cb]
  - @cosmicdrift/kumiko-renderer@0.139.0
  - @cosmicdrift/kumiko-dispatcher-live@0.139.0
  - @cosmicdrift/kumiko-headless@0.139.0

## 0.138.0

### Minor Changes

- 455bddd: Form-Kit: weitere Feld-Widgets `SelectField`, `DateField`, `TextField`, `BooleanField`, `TextareaField` (dünne Wrapper über die bestehenden `usePrimitives()` Input-`kind`s, wie `NumberField`), ein `footer`-Slot auf `ResultPanel` (Action-Button am Karten-Fuß) und `ComparisonTable` — eine transponierte Vergleichstabelle (Zeile = Kennzahl, Spalte = Variante) mit Best-Highlight je Zeile, für Szenario-/Angebotsvergleiche wo `ResultTable` (Zeile = Datensatz) nicht passt.

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.138.0
- @cosmicdrift/kumiko-headless@0.138.0
- @cosmicdrift/kumiko-renderer@0.138.0

## 0.137.0

### Minor Changes

- fdd7c40: Dashboard-`stat`-Panel: optionales `icon`/`accentColor` — statische (Author-Zeit) Panel-Eigenschaften, keine Query-Felder. `icon` löst über dieselbe `extensionSectionComponents`-Registry auf wie `custom`-Panels; `accentColor` ist ein roher CSS-Farbwert-Passthrough. Rückwärtskompatibel, ohne die Felder ändert sich nichts.

### Patch Changes

- @cosmicdrift/kumiko-headless@0.137.0
- @cosmicdrift/kumiko-renderer@0.137.0
- @cosmicdrift/kumiko-dispatcher-live@0.137.0

## 0.136.1

### Patch Changes

- 74ed322: Form-Kit: `MoneyField`/`PercentField` rendern kein €/%-Einheit-Badge mehr — die Einheit gehört ins Label (`t("…Summe (€)")`), sonst steht sie in Consumer-Apps doppelt. `unit`/`labelAppendix` aus `NumberField` entfernt; die drei Feld-Widgets rendern jetzt identisch, `MoneyField`/`PercentField` bleiben als semantische Call-Site-Aliase (Andockpunkt für spätere geld-/prozent-spezifische Formatierung).
  - @cosmicdrift/kumiko-dispatcher-live@0.136.1
  - @cosmicdrift/kumiko-headless@0.136.1
  - @cosmicdrift/kumiko-renderer@0.136.1

## 0.136.0

### Minor Changes

- f5a7f51: Dashboard-`stat`-Panel: optionales `deltaField`/`deltaDirectionField`/`deltaToneField` — rendert einen Delta-Chip (z.B. "↓ 23 %") neben dem Label, wenn der Query-Handler beide Pflichtfelder (Wert + Richtung) liefert. Rückwärtskompatibel, ohne die Felder ändert sich nichts.

### Patch Changes

- @cosmicdrift/kumiko-headless@0.136.0
- @cosmicdrift/kumiko-renderer@0.136.0
- @cosmicdrift/kumiko-dispatcher-live@0.136.0

## 0.135.0

### Minor Changes

- 3579d24: Form-Kit-Widgets: `useDraft`, `NumberField`/`MoneyField`/`PercentField`, `ResultPanel`/`ResultTable` und ein `emphasize`-Flag für `DetailList`. Bausteine für das Rechner-Muster der Consumer-Apps (Zahlenfelder → pure Funktion → Live-Ergebnispanel), das bislang nur als `type:"custom"`-JSX mit dupliziertem Field/Input-Boilerplate und handgebauten `<dl>`/`<table>` existierte. Siehe kumiko-framework#925.

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.135.0
- @cosmicdrift/kumiko-headless@0.135.0
- @cosmicdrift/kumiko-renderer@0.135.0

## 0.134.0

### Minor Changes

- 9eab762: Dashboard-Screen-Typ: vier neue Panel-Kinds — `stat-group` (betitelte Sektion aus mehreren Stat-Panels), `feed` (nicht-tabellarische Kurzliste), `progress-list` (Label/Wert + Fortschrittsbalken) und `custom` (eingehängte App-Komponente über dieselbe extensionSectionComponents-Registry wie entityEdit-Sections und List-Header-Slots, bleibt an ihrer Array-Position). Plus ein screen-weiter `filter` (Combobox-Picker), dessen Wert in jede Panel-Query gemerged wird — nutzt den bestehenden `useQuery`-payloadKey-Refetch, kein neuer Mechanismus. `ExtensionSectionProps` bekommt ein neues optionales `filterParams`-Feld für den `custom`-Mount-Ort.

### Patch Changes

- Updated dependencies [9eab762]
  - @cosmicdrift/kumiko-renderer@0.134.0
  - @cosmicdrift/kumiko-headless@0.134.0
  - @cosmicdrift/kumiko-dispatcher-live@0.134.0

## 0.133.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.133.0
- @cosmicdrift/kumiko-renderer@0.133.0
- @cosmicdrift/kumiko-dispatcher-live@0.133.0

## 0.132.0

### Minor Changes

- 2d40746: Toast-`variant` nutzt jetzt `StatusTone` (`ok`/`warn`/`bad`/`critical`/`muted`, dieselbe Farbfamilie wie `StatusBadge`) statt `default`/`destructive`. Breaking: `variant: "destructive"` → `variant: "bad"`, Default ist jetzt `muted`.

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.132.0
- @cosmicdrift/kumiko-headless@0.132.0
- @cosmicdrift/kumiko-renderer@0.132.0

## 0.131.0

### Minor Changes

- 99008c9: App-Mounting 2.0 Säule B: neuer deklarativer Screen-Typ `dashboard` (stat/chart/list-Panels mit eigenen Queries; Boot-Validator + required-surface-keys; WebDashboardBody via DashboardBodyProvider). projectionList-Row-/Toolbar-Actions unterstützen jetzt `kind: "writeHandler"` (entityList-Dispatch-Pfad inkl. WriteFailedError).
- d814026: App-Mounting 2.0 Säule A: Mid-Level-Widget-Kit in renderer-web (StatCard, MiniStat, SectionCard, StatusBadge, ProgressBar, CollapsibleSection, DetailList, ModeSwitch, StatusBarChart, TimeseriesChart, EmptyState/LoadingState/ErrorState, QueryTable) + Status-Farb-Tokens (--color-status-\*). Neue Hooks useMutation + useDisclosure. Neues Core-Primitive Link (default/button/muted), Button-Variant "link", Text-Variant "muted"; auth-email-password nutzt sie (authButtonClass/authMutedLinkClass entfernt).

### Patch Changes

- Updated dependencies [99008c9]
- Updated dependencies [d814026]
  - @cosmicdrift/kumiko-renderer@0.131.0
  - @cosmicdrift/kumiko-headless@0.131.0
  - @cosmicdrift/kumiko-dispatcher-live@0.131.0

## 0.130.2

### Patch Changes

- 98ed535: Content-Tree + Config-Nav Sysadmin-Shell polish:

  - text-content: Leaf-Knoten tragen jetzt ein `file`-Icon statt eines Dots; der Editor läuft auf der Page-Shell (`Form`-Primitive mit Card statt des entfernten `FormPanelShell`).
  - Sidebar-Nav bekommt ein Suchfeld, das den Baum live filtert (Treffer + ihre Ancestors bleiben, zugeklappte Ordner öffnen für die Suche).
  - Ordner-Knoten zeigen `folder-open` wenn ausgeklappt.
  - NAV_ICONS um `server`, `mail`, `lock`, `hash`, `download`, `folder-open` ergänzt — SMTP-/Config-Nav-Kinder (z.B. „Email-Versand") rendern damit ein Icon statt blank.
  - Verschachtelte Provider-Ordner (Content-Tree) rendern ihre Kinder in einem `<ul>` (valides HTML + Einrück-Stufe pro Tiefe) statt `<li>`-in-`<li>`.
  - Platform-Overview: `user:query:user:list` in der Allowlist (behebt den Overview-Crash).

- Updated dependencies [98ed535]
  - @cosmicdrift/kumiko-renderer@0.130.2
  - @cosmicdrift/kumiko-dispatcher-live@0.130.2
  - @cosmicdrift/kumiko-headless@0.130.2

## 0.130.1

### Patch Changes

- Updated dependencies
  - @cosmicdrift/kumiko-renderer@0.130.1
  - @cosmicdrift/kumiko-dispatcher-live@0.130.1
  - @cosmicdrift/kumiko-headless@0.130.1

## 0.130.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.130.0
- @cosmicdrift/kumiko-headless@0.130.0
- @cosmicdrift/kumiko-renderer@0.130.0

## 0.129.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.129.0
- @cosmicdrift/kumiko-renderer@0.129.0
- @cosmicdrift/kumiko-dispatcher-live@0.129.0

## 0.128.0

### Patch Changes

- Updated dependencies [d340977]
  - @cosmicdrift/kumiko-headless@0.128.0
  - @cosmicdrift/kumiko-dispatcher-live@0.128.0
  - @cosmicdrift/kumiko-renderer@0.128.0

## 0.127.0

### Patch Changes

- f5d37a1: Harden admin operator UI: stricter boot i18n/entityList validation, job run logger wiring, audit/job filters, shell breadcrumbs, and bundled entityList/i18n standards.
  - @cosmicdrift/kumiko-headless@0.127.0
  - @cosmicdrift/kumiko-renderer@0.127.0
  - @cosmicdrift/kumiko-dispatcher-live@0.127.0

## 0.126.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.126.0
- @cosmicdrift/kumiko-renderer@0.126.0
- @cosmicdrift/kumiko-dispatcher-live@0.126.0

## 0.125.2

### Patch Changes

- Updated dependencies [a6f3f48]
  - @cosmicdrift/kumiko-renderer@0.125.2
  - @cosmicdrift/kumiko-dispatcher-live@0.125.2
  - @cosmicdrift/kumiko-headless@0.125.2

## 0.125.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.125.1
- @cosmicdrift/kumiko-headless@0.125.1
- @cosmicdrift/kumiko-renderer@0.125.1

## 0.125.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.125.0
- @cosmicdrift/kumiko-headless@0.125.0
- @cosmicdrift/kumiko-renderer@0.125.0

## 0.124.0

### Minor Changes

- 50d7423: renderer: `ModalShell` shared overlay primitive, `LightboxProps` + `DefaultLightbox` for full-size image dialogs, and Apex landing click-to-enlarge via vanilla JS/CSS (no React dependency in static pages).

### Patch Changes

- Updated dependencies [50d7423]
  - @cosmicdrift/kumiko-renderer@0.124.0
  - @cosmicdrift/kumiko-dispatcher-live@0.124.0
  - @cosmicdrift/kumiko-headless@0.124.0

## 0.123.3

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.123.3
- @cosmicdrift/kumiko-headless@0.123.3
- @cosmicdrift/kumiko-renderer@0.123.3

## 0.123.2

### Patch Changes

- 581a3b6: Consistency: user-profile's ProfileScreen adopts the shared `FormScreenShell` (centered `max-w-3xl` like all other settings screens, was left-aligned `max-w-5xl`). DataTable now sits on `bg-card` instead of a transparent surface — on themes with a colored page background (e.g. cream) lists previously didn't match the white cards; now they do.
  - @cosmicdrift/kumiko-dispatcher-live@0.123.2
  - @cosmicdrift/kumiko-headless@0.123.2
  - @cosmicdrift/kumiko-renderer@0.123.2

## 0.123.1

### Patch Changes

- cf63778: managed-pages: add a `./managed-pages/web` client export (`managedPagesClient()`) so apps can register the feature's admin-screen translations into the browser i18n store. Previously the server-side `r.translations` bundle never reached the client, so configEdit/entityEdit labels (branding, page CMS) rendered as raw i18n keys in the admin UI. The client bundle is pivoted from the same `MANAGED_PAGES_I18N` source (no key duplication).

  renderer-web: extract a shared `FormScreenShell` primitive — the canonical centered `max-w-3xl` form/settings column that `DefaultForm` (configEdit/entityEdit) already used. Exporting it lets custom settings screens share the exact same width + centering instead of each author re-inventing the wrapper. `user-data-rights`' privacy-center screen adopts it.

  - @cosmicdrift/kumiko-dispatcher-live@0.123.1
  - @cosmicdrift/kumiko-headless@0.123.1
  - @cosmicdrift/kumiko-renderer@0.123.1

## 0.123.0

### Patch Changes

- Updated dependencies [b0e70a7]
  - @cosmicdrift/kumiko-headless@0.123.0
  - @cosmicdrift/kumiko-dispatcher-live@0.123.0
  - @cosmicdrift/kumiko-renderer@0.123.0

## 0.122.5

### Patch Changes

- 837e3b3: managed-pages: ship de/en translations for its admin screens (branding settings + page CMS) via `r.translations`, so field labels, section headers and screen titles no longer render as raw i18n keys. Any app mounting `managed-pages` now boots with a complete, translated admin surface. Also adds `tag` and `key` to the nav-icon allowlist (`NAV_ICONS`) so nav entries using those keys render a Lucide icon instead of the grey dot fallback.
  - @cosmicdrift/kumiko-dispatcher-live@0.122.5
  - @cosmicdrift/kumiko-headless@0.122.5
  - @cosmicdrift/kumiko-renderer@0.122.5

## 0.122.4

### Patch Changes

- @cosmicdrift/kumiko-headless@0.122.4
- @cosmicdrift/kumiko-renderer@0.122.4
- @cosmicdrift/kumiko-dispatcher-live@0.122.4

## 0.122.3

### Patch Changes

- @cosmicdrift/kumiko-headless@0.122.3
- @cosmicdrift/kumiko-renderer@0.122.3
- @cosmicdrift/kumiko-dispatcher-live@0.122.3

## 0.122.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.122.2
- @cosmicdrift/kumiko-renderer@0.122.2
- @cosmicdrift/kumiko-dispatcher-live@0.122.2

## 0.122.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.122.1
- @cosmicdrift/kumiko-renderer@0.122.1
- @cosmicdrift/kumiko-dispatcher-live@0.122.1

## 0.122.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.122.0
- @cosmicdrift/kumiko-renderer@0.122.0
- @cosmicdrift/kumiko-dispatcher-live@0.122.0

## 0.121.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.121.1
- @cosmicdrift/kumiko-renderer@0.121.1
- @cosmicdrift/kumiko-dispatcher-live@0.121.1

## 0.121.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.121.0
- @cosmicdrift/kumiko-renderer@0.121.0
- @cosmicdrift/kumiko-dispatcher-live@0.121.0

## 0.120.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.120.0
- @cosmicdrift/kumiko-renderer@0.120.0
- @cosmicdrift/kumiko-dispatcher-live@0.120.0

## 0.119.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.119.0
- @cosmicdrift/kumiko-renderer@0.119.0
- @cosmicdrift/kumiko-dispatcher-live@0.119.0

## 0.118.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.118.0
- @cosmicdrift/kumiko-renderer@0.118.0
- @cosmicdrift/kumiko-dispatcher-live@0.118.0

## 0.117.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.117.0
- @cosmicdrift/kumiko-renderer@0.117.0
- @cosmicdrift/kumiko-dispatcher-live@0.117.0

## 0.116.1

### Patch Changes

- c823f78: `DefaultForm` centers its content (`max-w-3xl mx-auto`) instead of pinning it to the left. On wide screens the auto-UI form no longer sits in the left half with an empty right side.
  - @cosmicdrift/kumiko-dispatcher-live@0.116.1
  - @cosmicdrift/kumiko-headless@0.116.1
  - @cosmicdrift/kumiko-renderer@0.116.1

## 0.116.0

### Minor Changes

- b82bf74: `WorkspaceShell` now renders on the same modern shell as `DefaultAppShell`: a collapsible icon-rail sidebar (brand + workspace switcher + nav + footer) and a `SidebarInset` with a shared `ShellHeader` (panel toggle + active-screen breadcrumb + right-aligned actions). The separate topbar is gone — `topbarActions` now render in the header's right slot, the brand moves into the sidebar. Props are unchanged, so existing `WorkspaceShell` apps pick up the header, breadcrumb and rail automatically. `ShellHeader` is extracted so both shells share one header definition.

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.116.0
- @cosmicdrift/kumiko-headless@0.116.0
- @cosmicdrift/kumiko-renderer@0.116.0

## 0.115.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.115.1
- @cosmicdrift/kumiko-renderer@0.115.1
- @cosmicdrift/kumiko-dispatcher-live@0.115.1

## 0.115.0

### Minor Changes

- a1a13ab: Card chrome (padding, radius, shadow) is now driven by `--card-padding` / `--card-radius` / `--card-shadow` CSS tokens. Framework ships defaults that reproduce the current look exactly (`p-6` / `rounded-xl` / `shadow-sm`); an app overrides any subset in its own `styles.css` to re-theme every card at once — no component changes. Unset tokens fall back to the framework default.

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.115.0
- @cosmicdrift/kumiko-headless@0.115.0
- @cosmicdrift/kumiko-renderer@0.115.0

## 0.114.0

### Minor Changes

- 5b29c10: Consolidate card chrome into a single `cardSurface()` cva (Form/Section/Card no longer diverge), export `Card` + `CardProps`, and add thin `Stack` / `PageSection` layout primitives. Apps can now import a card instead of hand-rolling `<div>` chrome. Note: standalone sections render `rounded-xl` (was `rounded-lg`) for consistency.

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.114.0
- @cosmicdrift/kumiko-headless@0.114.0
- @cosmicdrift/kumiko-renderer@0.114.0

## 0.113.1

### Patch Changes

- Updated dependencies [25b7e6e]
  - @cosmicdrift/kumiko-renderer@0.113.1
  - @cosmicdrift/kumiko-dispatcher-live@0.113.1
  - @cosmicdrift/kumiko-headless@0.113.1

## 0.113.0

### Patch Changes

- Updated dependencies [ba5053b]
  - @cosmicdrift/kumiko-renderer@0.113.0
  - @cosmicdrift/kumiko-headless@0.113.0
  - @cosmicdrift/kumiko-dispatcher-live@0.113.0

## 0.112.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.112.1
- @cosmicdrift/kumiko-renderer@0.112.1
- @cosmicdrift/kumiko-dispatcher-live@0.112.1

## 0.112.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.112.0
- @cosmicdrift/kumiko-renderer@0.112.0
- @cosmicdrift/kumiko-dispatcher-live@0.112.0

## 0.111.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.111.0
- @cosmicdrift/kumiko-renderer@0.111.0
- @cosmicdrift/kumiko-dispatcher-live@0.111.0

## 0.110.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.110.0
- @cosmicdrift/kumiko-renderer@0.110.0
- @cosmicdrift/kumiko-dispatcher-live@0.110.0

## 0.109.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.109.0
- @cosmicdrift/kumiko-headless@0.109.0
- @cosmicdrift/kumiko-renderer@0.109.0

## 0.108.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.108.0
- @cosmicdrift/kumiko-headless@0.108.0
- @cosmicdrift/kumiko-renderer@0.108.0

## 0.107.0

### Patch Changes

- Updated dependencies [5ed5ad3]
  - @cosmicdrift/kumiko-dispatcher-live@0.107.0
  - @cosmicdrift/kumiko-headless@0.107.0
  - @cosmicdrift/kumiko-renderer@0.107.0

## 0.106.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.106.0
- @cosmicdrift/kumiko-renderer@0.106.0
- @cosmicdrift/kumiko-dispatcher-live@0.106.0

## 0.105.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.105.2
- @cosmicdrift/kumiko-renderer@0.105.2
- @cosmicdrift/kumiko-dispatcher-live@0.105.2

## 0.105.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.105.1
- @cosmicdrift/kumiko-headless@0.105.1
- @cosmicdrift/kumiko-renderer@0.105.1

## 0.105.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.105.0
- @cosmicdrift/kumiko-renderer@0.105.0
- @cosmicdrift/kumiko-dispatcher-live@0.105.0

## 0.104.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.104.0
- @cosmicdrift/kumiko-renderer@0.104.0
- @cosmicdrift/kumiko-dispatcher-live@0.104.0

## 0.103.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.103.0
- @cosmicdrift/kumiko-renderer@0.103.0
- @cosmicdrift/kumiko-dispatcher-live@0.103.0

## 0.102.2

### Patch Changes

- Updated dependencies [cfc5895]
  - @cosmicdrift/kumiko-headless@0.102.2
  - @cosmicdrift/kumiko-dispatcher-live@0.102.2
  - @cosmicdrift/kumiko-renderer@0.102.2

## 0.102.1

### Patch Changes

- Updated dependencies [e0b88c7]
  - @cosmicdrift/kumiko-headless@0.102.1
  - @cosmicdrift/kumiko-dispatcher-live@0.102.1
  - @cosmicdrift/kumiko-renderer@0.102.1

## 0.102.0

### Patch Changes

- Updated dependencies [4659e52]
  - @cosmicdrift/kumiko-headless@0.102.0
  - @cosmicdrift/kumiko-dispatcher-live@0.102.0
  - @cosmicdrift/kumiko-renderer@0.102.0

## 0.101.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.101.0
- @cosmicdrift/kumiko-headless@0.101.0
- @cosmicdrift/kumiko-renderer@0.101.0

## 0.100.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.100.0
- @cosmicdrift/kumiko-renderer@0.100.0
- @cosmicdrift/kumiko-dispatcher-live@0.100.0

## 0.99.0

### Patch Changes

- Updated dependencies [8146e5b]
  - @cosmicdrift/kumiko-headless@0.99.0
  - @cosmicdrift/kumiko-renderer@0.99.0
  - @cosmicdrift/kumiko-dispatcher-live@0.99.0

## 0.98.0

### Patch Changes

- Updated dependencies [4c39e11]
  - @cosmicdrift/kumiko-renderer@0.98.0
  - @cosmicdrift/kumiko-dispatcher-live@0.98.0
  - @cosmicdrift/kumiko-headless@0.98.0

## 0.97.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.97.1
- @cosmicdrift/kumiko-renderer@0.97.1
- @cosmicdrift/kumiko-dispatcher-live@0.97.1

## 0.97.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.97.0
- @cosmicdrift/kumiko-renderer@0.97.0
- @cosmicdrift/kumiko-dispatcher-live@0.97.0

## 0.96.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.96.0
- @cosmicdrift/kumiko-headless@0.96.0
- @cosmicdrift/kumiko-renderer@0.96.0

## 0.95.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.95.0
- @cosmicdrift/kumiko-renderer@0.95.0
- @cosmicdrift/kumiko-dispatcher-live@0.95.0

## 0.94.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.94.0
- @cosmicdrift/kumiko-renderer@0.94.0
- @cosmicdrift/kumiko-dispatcher-live@0.94.0

## 0.93.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.93.0
- @cosmicdrift/kumiko-renderer@0.93.0
- @cosmicdrift/kumiko-dispatcher-live@0.93.0

## 0.92.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.92.0
- @cosmicdrift/kumiko-headless@0.92.0
- @cosmicdrift/kumiko-renderer@0.92.0

## 0.91.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.91.0
- @cosmicdrift/kumiko-headless@0.91.0
- @cosmicdrift/kumiko-renderer@0.91.0

## 0.90.3

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.90.3
- @cosmicdrift/kumiko-headless@0.90.3
- @cosmicdrift/kumiko-renderer@0.90.3

## 0.90.2

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.90.2
- @cosmicdrift/kumiko-headless@0.90.2
- @cosmicdrift/kumiko-renderer@0.90.2

## 0.90.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.90.1
- @cosmicdrift/kumiko-headless@0.90.1
- @cosmicdrift/kumiko-renderer@0.90.1

## 0.90.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.90.0
- @cosmicdrift/kumiko-headless@0.90.0
- @cosmicdrift/kumiko-renderer@0.90.0

## 0.89.0

### Patch Changes

- Updated dependencies [4722d4e]
  - @cosmicdrift/kumiko-renderer@0.89.0
  - @cosmicdrift/kumiko-headless@0.89.0
  - @cosmicdrift/kumiko-dispatcher-live@0.89.0

## 0.88.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.88.0
- @cosmicdrift/kumiko-headless@0.88.0
- @cosmicdrift/kumiko-renderer@0.88.0

## 0.87.3

### Patch Changes

- @cosmicdrift/kumiko-headless@0.87.3
- @cosmicdrift/kumiko-renderer@0.87.3
- @cosmicdrift/kumiko-dispatcher-live@0.87.3

## 0.87.2

### Patch Changes

- b04ca86: Fix tenant privilege escalation via membership roles. `hasAccess` checks session roles flat with no notion of origin, so a platform-global role (`SystemAdmin`/`system`) landing in a tenant membership merged into the session and unlocked the SystemAdmin-gated, cross-tenant handler surface — a Tenant-Admin could invite `SystemAdmin` and the invitee gained platform-wide, cross-tenant access.

  Reject reserved/global roles (`system`, `SystemAdmin`, `all`, `anonymous`) at every tenant-membership write chokepoint: `seedTenantMembership` (covers the three invite-accept branches plus seeding), `add-member`, `update-member-roles`, and early in `invite-create`. The bootstrap path was already correct (SystemAdmin lives in global `users.roles`, never in a membership); this makes the invite path consistent.

  Also centralize the `tenantIdOverride` SystemAdmin gate into a new `crossTenantOverrideDenied` helper (exported from `@cosmicdrift/kumiko-framework/engine`), replacing the inline check duplicated across managed-pages, compliance-profiles, text-content and template-resolver so a future override handler can't skip it.

- Updated dependencies [b04ca86]
  - @cosmicdrift/kumiko-dispatcher-live@0.87.2
  - @cosmicdrift/kumiko-headless@0.87.2
  - @cosmicdrift/kumiko-renderer@0.87.2

## 0.87.1

### Patch Changes

- cb2abcd: Session bootstrap only mounts behind SessionAuthGate so public SPA gates (e.g. `/rechner`) no longer call `/api/auth/tenants`. Skip refresh when no `kumiko_csrf` cookie is present.
- Updated dependencies [cb2abcd]
  - @cosmicdrift/kumiko-renderer@0.87.1
  - @cosmicdrift/kumiko-headless@0.87.1
  - @cosmicdrift/kumiko-dispatcher-live@0.87.1

## 0.87.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.87.0
- @cosmicdrift/kumiko-renderer@0.87.0
- @cosmicdrift/kumiko-dispatcher-live@0.87.0

## 0.86.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.86.0
- @cosmicdrift/kumiko-renderer@0.86.0
- @cosmicdrift/kumiko-dispatcher-live@0.86.0

## 0.85.0

### Patch Changes

- Updated dependencies [2cdfe9d]
  - @cosmicdrift/kumiko-headless@0.85.0
  - @cosmicdrift/kumiko-dispatcher-live@0.85.0
  - @cosmicdrift/kumiko-renderer@0.85.0

## 0.84.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.84.0
- @cosmicdrift/kumiko-renderer@0.84.0
- @cosmicdrift/kumiko-dispatcher-live@0.84.0

## 0.83.0

### Patch Changes

- Updated dependencies [c2b7154]
  - @cosmicdrift/kumiko-renderer@0.83.0
  - @cosmicdrift/kumiko-headless@0.83.0
  - @cosmicdrift/kumiko-dispatcher-live@0.83.0

## 0.82.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.82.0
- @cosmicdrift/kumiko-headless@0.82.0
- @cosmicdrift/kumiko-renderer@0.82.0

## 0.81.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.81.1
- @cosmicdrift/kumiko-headless@0.81.1
- @cosmicdrift/kumiko-renderer@0.81.1

## 0.81.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.81.0
- @cosmicdrift/kumiko-headless@0.81.0
- @cosmicdrift/kumiko-renderer@0.81.0

## 0.80.0

### Minor Changes

- 407ed37: Add a single `Card` primitive (slot- + options-based) and route all card chrome through it.

  `usePrimitives().Card` takes `slots` (`header`/`title`/`subtitle`/`headerActions`/`footer`) and `options` (`padded`/`radius`/`footerBordered`). `DefaultForm` and `DefaultSection` now render through `DefaultCard`, so every consumer gets one consistent chrome (border, radius, shadow, footer row) without re-migrating. `AuthCard` and the `user-data-rights` / `user-profile` self-service screens use it; action buttons live in the card footer. testIds are preserved.

### Patch Changes

- Updated dependencies [407ed37]
  - @cosmicdrift/kumiko-renderer@0.80.0
  - @cosmicdrift/kumiko-dispatcher-live@0.80.0
  - @cosmicdrift/kumiko-headless@0.80.0

## 0.79.3

### Patch Changes

- cd34ef3: fix(user-data-rights): logged-in export download no longer returns 403 csrf_token_mismatch

  The privacy-center download was a plain `<a href>` to the `by-job` httpRoute, which
  re-dispatched an internal `POST /api/query` carrying only the auth cookie (no
  `X-CSRF-Token` header) — so the CSRF double-submit check rejected it with 403. The
  download now goes through the dispatcher via a new `postWithDownload` helper
  (`@cosmicdrift/kumiko-renderer-web`), which carries the CSRF token like every other
  authenticated request and navigates to the returned signed URL. The `by-job`
  httpRoute and its header-forwarding are removed; `download-by-job` reads the audit
  IP from the server-trusted request context instead of a client-supplied payload.

  - @cosmicdrift/kumiko-headless@0.79.3
  - @cosmicdrift/kumiko-renderer@0.79.3
  - @cosmicdrift/kumiko-dispatcher-live@0.79.3

## 0.79.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.79.2
- @cosmicdrift/kumiko-renderer@0.79.2
- @cosmicdrift/kumiko-dispatcher-live@0.79.2

## 0.79.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.79.1
- @cosmicdrift/kumiko-headless@0.79.1
- @cosmicdrift/kumiko-renderer@0.79.1

## 0.79.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.79.0
- @cosmicdrift/kumiko-headless@0.79.0
- @cosmicdrift/kumiko-renderer@0.79.0

## 0.78.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.78.0
- @cosmicdrift/kumiko-headless@0.78.0
- @cosmicdrift/kumiko-renderer@0.78.0

## 0.77.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.77.1
- @cosmicdrift/kumiko-renderer@0.77.1
- @cosmicdrift/kumiko-dispatcher-live@0.77.1

## 0.77.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.77.0
- @cosmicdrift/kumiko-headless@0.77.0
- @cosmicdrift/kumiko-renderer@0.77.0

## 0.76.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.76.1
- @cosmicdrift/kumiko-renderer@0.76.1
- @cosmicdrift/kumiko-dispatcher-live@0.76.1

## 0.76.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.76.0
- @cosmicdrift/kumiko-renderer@0.76.0
- @cosmicdrift/kumiko-dispatcher-live@0.76.0

## 0.75.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.75.0
- @cosmicdrift/kumiko-headless@0.75.0
- @cosmicdrift/kumiko-renderer@0.75.0

## 0.74.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.74.0
- @cosmicdrift/kumiko-headless@0.74.0
- @cosmicdrift/kumiko-renderer@0.74.0

## 0.73.0

### Minor Changes

- 8aae416: Cross-tenant SystemAdmin admin screens for users + tenants, plus two admin-UI polish fixes

  The bundled `user` and `tenant` features now ship SystemAdmin-gated `entityList` + `entityEdit` screens (`user-list`/`user-edit`, `tenant-list`/`tenant-edit`). Because both features run with `systemScope()`, the lists return every user/tenant across all tenants — the platform-operator roster — with no custom queries. The screens are inert until an app navs them, so existing apps are unaffected; an app gets a full list/detail/edit surface (plus create for users) by adding a single nav entry pointing at the screen. This is the cross-feature gap the boot-validator forbids apps from filling themselves: the screens have to live in the feature that owns the entity.

  The `tenant` feature gained entity-convention handlers (`tenant:query:tenant:{list,detail}`, `tenant:write:tenant:update`) alongside its legacy `tenant:query:list` / `tenant:write:update` ones, so the screens resolve a live data path without renaming anything existing. There is no hard delete (tenants are disabled via `isEnabled`, users go through the GDPR status/forget flow), and the user `roles` field is intentionally not editable from the form (it is a raw-JSON privilege column). A generic `kumiko.actions.edit` default translation backs the list row-action.

  Admin-UI polish: the `DataTable` action column no longer draws a permanent left divider (the sticky background already separates it during horizontal scroll), and `SidebarBrand` only renders its `ChevronsUpDown` affordance when the new optional `collapsible` prop is set — without a wrapping dropdown the chevron suggested a menu that never opened.

### Patch Changes

- Updated dependencies [8aae416]
  - @cosmicdrift/kumiko-renderer@0.73.0
  - @cosmicdrift/kumiko-dispatcher-live@0.73.0
  - @cosmicdrift/kumiko-headless@0.73.0

## 0.72.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.72.0
- @cosmicdrift/kumiko-renderer@0.72.0
- @cosmicdrift/kumiko-dispatcher-live@0.72.0

## 0.71.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.71.0
- @cosmicdrift/kumiko-renderer@0.71.0
- @cosmicdrift/kumiko-dispatcher-live@0.71.0

## 0.70.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.70.0
- @cosmicdrift/kumiko-renderer@0.70.0
- @cosmicdrift/kumiko-dispatcher-live@0.70.0

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

- Updated dependencies [18b5cc5]
  - @cosmicdrift/kumiko-renderer@0.69.0
  - @cosmicdrift/kumiko-dispatcher-live@0.69.0
  - @cosmicdrift/kumiko-headless@0.69.0

## 0.68.0

### Minor Changes

- d9a62f9: feat(auth): UserMenu sidebar variant — full NavUser footer row across all apps

  The app shell's `sidebarFooter` slot wants the sidebar-07 NavUser row (avatar +
  name + email + chevron), but the bundled `UserMenu` only rendered a compact topbar
  pill, and `SidebarUser` is display-only (no logout/profile actions). Apps were stuck
  choosing between the polished row OR the actions.

  `UserMenu` now takes `variant?: "pill" | "sidebar"` (default `"pill"`, unchanged).
  `variant="sidebar"` renders the full NavUser row as the dropdown trigger — same look
  as `SidebarUser`, but clickable with the existing logout/profile menu. Drop it into
  `sidebarFooter` and every Kumiko app gets the consistent account row.

  renderer-web now also exports `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`
  and `SidebarProvider` so apps can compose custom sidebar content.

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.68.0
- @cosmicdrift/kumiko-headless@0.68.0
- @cosmicdrift/kumiko-renderer@0.68.0

## 0.67.1

### Patch Changes

- f5a8a83: fix(renderer-web): robust one-card forms, bare auth forms, missing nav icons

  The 0.66 shadcn "new-york" refresh broke three compositions:

  - **Flat-field forms** (custom screens like the money-horse credit calculator pass
    bare `<Field>` children, no `<Section>`) drew a divider line between _every_ field
    and rendered edge-to-edge. The form body now scopes dividers to consecutive
    `<section>` children only and pads flat children — sectioned auto-UI edit forms are
    unchanged.
  - **Auth screens** render `<Form>` inside `<AuthCard>`; the self-carding form produced
    a card-in-card. `AuthCard` now wraps its children in the new exported
    `BareFormProvider`, so `DefaultForm` renders a bare stacked `<form>` when embedded.
  - **NAV_ICONS** was missing `layers` and `building`, so those nav entries fell back to
    the dot. Both lucide icons are now registered.
  - @cosmicdrift/kumiko-dispatcher-live@0.67.1
  - @cosmicdrift/kumiko-headless@0.67.1
  - @cosmicdrift/kumiko-renderer@0.67.1

## 0.67.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.67.0
- @cosmicdrift/kumiko-renderer@0.67.0
- @cosmicdrift/kumiko-dispatcher-live@0.67.0

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

- 32aa721: Fold the VisualTree navigation into the single shadcn NavTree — one nav, not
  two. Dynamic, runtime-extendable nav nodes now live in the same sidebar as the
  static `r.nav` entries: a node declared with `r.nav({ provider: true })` pulls
  its children lazily from a client-registered nav-provider and refreshes them
  live on entity events (SSE) — the capability the old `navigation: "tree"`
  VisualTree workspace used to provide, now available everywhere.

  **Breaking — `ClientFeatureDefinition` (renderer-web):** the `treeProvider`,
  `treeEntities` and `treeActions` fields are removed. Provide dynamic nav
  children via `navProviders` / `navEntities` (keyed on the nav QN) and editor
  components via `resolvers`, attached to an `r.nav({ provider: true })` node.

  **Breaking — VisualTree removed:** the `VisualTree` / `TreeNodeRenderer`
  components and the tree-providers context are deleted. `WorkspaceShell` always
  renders `NavTree`; a target persisted in the URL (`?t=feat:action&a_*=…`)
  renders the `EditorPanel` in the content area instead of the routed screen.
  `WorkspaceDefinition.navigation` is now a **no-op** (kept for now, deferred
  removal) — `navigation: "tree"` no longer switches the sidebar component.

  **`textContentClient` / `legalPagesClient` (bundled-features):** both now take
  an optional `{ navId }`. The consuming app owns the nav node (label, icon,
  access — same convention as `managed-pages`) by registering
  `r.nav({ id, provider: true })` in its own feature and passing that node's QN
  as `navId`; the bundled-feature supplies the children + editor. **Without
  `navId` no sidebar node is created** — apps that mount these features
  server-side only (legal routes) no longer get a stray, provider-less nav node.

  Migration for an app that used a `navigation: "tree"` workspace (e.g. an admin
  content/legal editor): register `r.nav({ provider: true })` nodes in your own
  feature with the access you want, add their QNs to the workspace's nav members,
  drop `navigation: "tree"`, and pass each node's QN as `navId` to
  `textContentClient({ navId })` / `legalPagesClient({ navId })`.

- 15b06c1: Refresh the auto-UI default to a polished shadcn "new-york" standard:

  - **Tokens** (`styles.css`): the default palette moves from the Linear-style
    blue-grey + purple to neutral zinc with a near-black primary and visibly
    stronger borders, in both light and dark. App-level `@theme` token overrides
    are unaffected — apps keep their brand colors and only inherit the polish.
  - **Forms are one card**: `DefaultForm` renders the whole edit form as a single
    `bg-card` panel — title as the card header, sections as `border-t`-divided
    inner regions (no longer separate floating cards), and the action buttons in
    the card footer at the bottom (shadcn Shipping/Invoice/Profile pattern). Form
    bodies are centered at `max-w-3xl`. Standalone `Section` use (outside a form)
    keeps its own card surface, switched via a form context.
  - **Lists are cards**: `DefaultDataTable` wraps the table in a `rounded-lg border`
    surface with a `bg-muted` header bar and `outline` status badges (dashboard-01).
  - **Cleaner headers**: the form action bar and list toolbar drop the `bg-muted/30`
    tint for a flat `bg-background` + border-b.

  **Shell/Nav now use real (vendored) shadcn (`sidebar-07` block).** Instead of a
  hand-rolled mini-shadcn, `DefaultAppShell` is built on shadcn's `SidebarProvider`

  - `Sidebar collapsible="icon"` + `SidebarInset`: a `SidebarBrand` team-switcher
    header, a `SidebarUser` profile footer, a header carrying a sidebar trigger and a
    breadcrumb of the active screen, a collapsible-icon rail, and a working mobile
    sidebar sheet (previously the sidebar was simply hidden on mobile). `NavTree` renders
    through shadcn's `SidebarMenu`/`SidebarMenuButton`/`SidebarGroup` — schema sections
    are static labels, items-with-children collapse. Navigation logic (role-gating,
    grouping, icons, active state) is unchanged. The
    vendored shadcn source lives in `src/ui/` (Tailwind-v4-native `new-york-v4` registry)
    and is regenerated via `scripts/sync-shadcn.ts`, never edited by hand. Adds `radix-ui`
    as a dependency (the unified Radix package shadcn v4 imports from). A new
    `--color-sidebar*` token family (8 members) drives the sidebar surface.

  **Tables, forms and inputs now use vendored shadcn too.** `DataTable` renders through
  shadcn's `Table`/`TableHeader`/`TableRow`/`TableCell` with status columns as `Badge`s
  (Kumiko's sort/paging/row-actions/infinite-scroll logic is unchanged). `Button` maps to
  shadcn's `Button` (primary→default, secondary→outline, danger→destructive), text inputs
  to `Input`/`Textarea`, boolean fields to a Radix `Checkbox`, and field labels to `Label`.
  Error styling now comes for free from `aria-invalid`. Boolean fields render
  `button[role="checkbox"]` instead of a native `input[type="checkbox"]`.

  Purely visual — no API or prop changes. Apps that supplied their own
  `primitives` overrides are untouched. A new `styleguide` sample app + a 3-theme
  screenshot runner back this; its gallery now also includes real-world reference
  blocks (login, invoice, shipping address, profile, dividends, savings targets,
  holdings filter) composed purely from the shadcn tokens. The docs gain a
  "Design system → Styleguide" page showing every block in light / dark / brand.

### Patch Changes

- Updated dependencies [77ed9c1]
- Updated dependencies [7eacfcb]
- Updated dependencies [15b06c1]
  - @cosmicdrift/kumiko-headless@0.66.0
  - @cosmicdrift/kumiko-renderer@0.66.0
  - @cosmicdrift/kumiko-dispatcher-live@0.66.0

## 0.65.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.65.0
- @cosmicdrift/kumiko-renderer@0.65.0
- @cosmicdrift/kumiko-dispatcher-live@0.65.0

## 0.64.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.64.0
- @cosmicdrift/kumiko-renderer@0.64.0
- @cosmicdrift/kumiko-dispatcher-live@0.64.0

## 0.63.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.63.0
- @cosmicdrift/kumiko-headless@0.63.0
- @cosmicdrift/kumiko-renderer@0.63.0

## 0.62.0

### Patch Changes

- Updated dependencies [ee56d33]
  - @cosmicdrift/kumiko-headless@0.62.0
  - @cosmicdrift/kumiko-dispatcher-live@0.62.0
  - @cosmicdrift/kumiko-renderer@0.62.0

## 0.61.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.61.0
- @cosmicdrift/kumiko-headless@0.61.0
- @cosmicdrift/kumiko-renderer@0.61.0

## 0.60.4

### Patch Changes

- @cosmicdrift/kumiko-headless@0.60.4
- @cosmicdrift/kumiko-renderer@0.60.4
- @cosmicdrift/kumiko-dispatcher-live@0.60.4

## 0.60.3

### Patch Changes

- @cosmicdrift/kumiko-headless@0.60.3
- @cosmicdrift/kumiko-renderer@0.60.3
- @cosmicdrift/kumiko-dispatcher-live@0.60.3

## 0.60.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.60.2
- @cosmicdrift/kumiko-renderer@0.60.2
- @cosmicdrift/kumiko-dispatcher-live@0.60.2

## 0.60.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.60.1
- @cosmicdrift/kumiko-renderer@0.60.1
- @cosmicdrift/kumiko-dispatcher-live@0.60.1

## 0.60.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.60.0
- @cosmicdrift/kumiko-renderer@0.60.0
- @cosmicdrift/kumiko-dispatcher-live@0.60.0

## 0.59.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.59.2
- @cosmicdrift/kumiko-renderer@0.59.2
- @cosmicdrift/kumiko-dispatcher-live@0.59.2

## 0.59.1

### Patch Changes

- Updated dependencies [731d87f]
  - @cosmicdrift/kumiko-renderer@0.59.1
  - @cosmicdrift/kumiko-headless@0.59.1
  - @cosmicdrift/kumiko-dispatcher-live@0.59.1

## 0.59.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.59.0
- @cosmicdrift/kumiko-headless@0.59.0
- @cosmicdrift/kumiko-renderer@0.59.0

## 0.58.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.58.0
- @cosmicdrift/kumiko-renderer@0.58.0
- @cosmicdrift/kumiko-dispatcher-live@0.58.0

## 0.57.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.57.2
- @cosmicdrift/kumiko-renderer@0.57.2
- @cosmicdrift/kumiko-dispatcher-live@0.57.2

## 0.57.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.57.1
- @cosmicdrift/kumiko-renderer@0.57.1
- @cosmicdrift/kumiko-dispatcher-live@0.57.1

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

- Updated dependencies [4c32f16]
  - @cosmicdrift/kumiko-renderer@0.57.0
  - @cosmicdrift/kumiko-headless@0.57.0
  - @cosmicdrift/kumiko-dispatcher-live@0.57.0

## 0.56.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.56.1
- @cosmicdrift/kumiko-headless@0.56.1
- @cosmicdrift/kumiko-renderer@0.56.1

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
