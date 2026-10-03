# @cosmicdrift/kumiko-locale-de

## 0.342.0

### Patch Changes

- Updated dependencies [0978e85]
- Updated dependencies [e7f2d36]
- Updated dependencies [0978e85]
- Updated dependencies [0978e85]
  - @cosmicdrift/kumiko-framework@0.342.0

## 0.341.0

### Minor Changes

- 4b01c83: Add waitlist bundled feature: public signup intake with admin invite and reject, GDPR export and erasure

  <!-- kumiko-changes
  feature: waitlist
  type: improvement
  title: Add waitlist bundled feature: public signup intake with admin invite and reject, GDPR export and erasure
  -->

### Patch Changes

- 37c0974: Add errors.rate_limit_unavailable (de, formal)

  <!-- kumiko-changes
  feature: locale-de
  type: fix
  title: Add errors.rate_limit_unavailable (de, formal)
  -->

- Updated dependencies [610201f]
- Updated dependencies [82309a5]
- Updated dependencies [c2c7862]
- Updated dependencies [610201f]
- Updated dependencies [37c0974]
- Updated dependencies [e7dbdb6]
- Updated dependencies [1feae69]
- Updated dependencies [c5e6814]
- Updated dependencies [8443f22]
- Updated dependencies [1f0a63b]
  - @cosmicdrift/kumiko-framework@0.341.0

## 0.340.0

### Patch Changes

- Updated dependencies [483bb16]
  - @cosmicdrift/kumiko-framework@0.340.0

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

### Patch Changes

- 0e065d2: A missing or unchecked checkout consent now fails with `422 consent_required` instead of a schema `400`. `start-plan-checkout` and `create-checkout-session` accept an absent `consent` and `false` flags and reject them in the consent gate, so clients can show the localized `billing-foundation.errors.consentRequired` message.

  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: Missing or unchecked checkout consent returns 422 consent_required
  detail: |
    The consent payload is optional in the `start-plan-checkout` and `create-checkout-session` input schemas and its two flags are plain booleans. `prepareConsent` throws `UnprocessableError("consent_required")` with `billing-foundation.errors.consentRequired` when consumer protection is on and the consent is missing or either flag is not true.
  migration: |
    Clients that treated the previous `400` validation error for a missing consent as the signal must check for `422` with `reason: "consent_required"`.
  -->

- 80ecf93: The billing consent and cancel-contract dialogs now address the user informally ("du" in German, "tú" in Spanish), like the rest of `BillingPlansPanel`. The German contract confirmation mail, the receipt mail for a termination or withdrawal and the public cancellation pages use "du" as well.

  <!-- kumiko-changes
  feature: locale-de
  type: fix
  title: Billing consent and cancel dialogs use "du"
  detail: |
    `billing-foundation.consent.*`, `billing-foundation.cancel.*`, `billing-foundation.errors.consentTextOutdated` and `billing-foundation.errors.termsUnavailable` switch from "Sie" to "du", matching the `billing-foundation.plans.*` keys. The formal bundle (`address: "formal"`) keeps the "Sie" wording through `localeDeFormalOverrides`.
  -->

  <!-- kumiko-changes
  feature: locale-es
  type: fix
  title: Billing consent and cancel dialogs use "tú"
  detail: |
    `billing-foundation.consent.*`, `billing-foundation.cancel.*`, `billing-foundation.errors.consentTextOutdated` and `billing-foundation.errors.termsUnavailable` switch from "usted" to "tú", matching the `billing-foundation.plans.*` keys.
  -->

  <!-- kumiko-changes
  feature: billing-foundation
  type: fix
  title: Contract confirmation, termination receipt and cancellation pages use "du"
  detail: |
    The German contract confirmation mail, the termination and withdrawal receipt mail, the public cancellation pages and the subscription and payment submit messages address the customer with "du". The recorded consent statements are first-person and unchanged, so `consentTextVersion` stays the same.
  -->

- Updated dependencies [5b6e5f7]
- Updated dependencies [c1e6186]
- Updated dependencies [fcbf184]
- Updated dependencies [e3adda3]
- Updated dependencies [1954386]
- Updated dependencies [b040ca7]
- Updated dependencies [252f749]
  - @cosmicdrift/kumiko-framework@0.339.0

## 0.338.0

### Patch Changes

- 6016fa6: German and Spanish strings for the billing consent and cancel-contract dialogs of `BillingPlansPanel`, in the formal address, matching the wording of the cancellation pages.

  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: German strings for the billing consent and cancel-contract dialogs
  detail: |
    Adds the `billing-foundation.consent.*`, `billing-foundation.cancel.*`, `billing-foundation.errors.consentTextOutdated` and `billing-foundation.errors.termsUnavailable` keys in formal German.
  -->

  <!-- kumiko-changes
  feature: locale-es
  type: improvement
  title: Spanish strings for the billing consent and cancel-contract dialogs
  detail: |
    Adds the `billing-foundation.consent.*`, `billing-foundation.cancel.*`, `billing-foundation.errors.consentTextOutdated` and `billing-foundation.errors.termsUnavailable` keys in formal Spanish.
  -->

- Updated dependencies [c710f1e]
- Updated dependencies [3613e5a]
- Updated dependencies [3451156]
- Updated dependencies [4a13a0e]
- Updated dependencies [57467b5]
- Updated dependencies [e8e5e2f]
- Updated dependencies [bac056f]
- Updated dependencies [f4f3d4a]
- Updated dependencies [87938e0]
- Updated dependencies [51b4867]
- Updated dependencies [d1bba78]
  - @cosmicdrift/kumiko-framework@0.338.0

## 0.337.1

### Patch Changes

- Updated dependencies [b1b01b8]
- Updated dependencies [6c1c1d4]
  - @cosmicdrift/kumiko-framework@0.337.1

## 0.337.0

### Patch Changes

- 00313ba: Adds the German copy for `jobs.errors.invalidPayload`, shown when a manual job trigger gets a broken or non-object JSON payload.

  <!-- kumiko-changes
  feature: locale-de
  type: fix
  title: German copy for the jobs invalid-payload error
  -->

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
- Updated dependencies [e889f3f]
  - @cosmicdrift/kumiko-framework@0.337.0

## 0.336.1

### Patch Changes

- Updated dependencies [ad3999e]
  - @cosmicdrift/kumiko-framework@0.336.1

## 0.336.0

### Patch Changes

- Updated dependencies [e91de78]
- Updated dependencies [e19453a]
- Updated dependencies [83378b1]
- Updated dependencies [c95f017]
- Updated dependencies [58154f0]
- Updated dependencies [b83c348]
- Updated dependencies [4618e1d]
  - @cosmicdrift/kumiko-framework@0.336.0

## 0.335.0

### Patch Changes

- 07ddc7e: `InviteAcceptScreen` no longer redirects to a tenant URL when the accept route answers with an MFA challenge or setup requirement (no session cookie was minted); it sends the user to `loginHref` instead. `SessionBootstrapErrorScreen` accepts an optional `onSignOut` and the auth gate wires it, so a permanent bootstrap failure no longer traps the user behind "Try again" (new i18n key `auth.sessionBootstrap.signOut`). Cap bookings back off with a small random delay between version-conflict retries.

  <!-- kumiko-changes
  feature: auth-email-password
  type: fix
  title: Invite accept handles MFA responses, bootstrap error screen offers Sign out
  -->

- 1e9cc86: `tenant-caps:list` now rejects a malformed pagination cursor and unsupported or repeated filters with a validation error instead of returning a wrong page or silently ignoring the filter, and loads per-tenant usage in parallel. The `cap-counter` operator list is no longer searchable, because search resolved against the caller's own tenant instead of all tenants.

  <!-- kumiko-changes
  feature: cap-overview
  type: fix
  title: tenant-caps:list validates cursor and filters, parallel usage reads; cap-counter list not searchable
  -->

- 099f406: The cap usage bar labels an unlimited cap as "<used> · unlimited" through the new `cap-overview.unlimited` key instead of a bare number. The German and Spanish catalogs ship the translation.

  <!-- kumiko-changes
  feature: cap-overview
  type: fix
  title: Unlimited caps show a labelled usage count
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

- 8a49831: Ended session leads back to the login screen

  When the server ends a session (revoked, expired), the app now shows the login screen with a short hint instead of a raw error banner. After signing in again the user lands on the same screen as before.

  <!-- kumiko-changes
  feature: auth-email-password
  type: fix
  title: Ended session leads back to the login screen
  -->

- 3d37d50: Saving member roles keeps roles the editor cannot grant

  Admin, TenantAdmin and SystemAdmin saves keep DataProtectionOfficer, TenantOwner, undeclared and higher-tier app roles; the system user still replaces the list. The roles column translates TenantOwner and DataProtectionOfficer. New exports: canActorAssignRole, mergeAssignedRoles, assignableAppRolesOf. Apps translate their roles via tenant:entity:**action-form**:field:roles:option:<Role> (and role:option: for the invite).

  <!-- kumiko-changes
  feature: tenant
  type: fix
  title: Saving member roles keeps roles the editor cannot grant
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
- Updated dependencies [567a4bd]
- Updated dependencies [f5ff653]
- Updated dependencies [5bca19c]
- Updated dependencies [85dead2]
- Updated dependencies [9acf185]
- Updated dependencies [d7d5bd7]
- Updated dependencies [57f0e78]
- Updated dependencies [5e9cc10]
- Updated dependencies [a86aa83]
- Updated dependencies [a39d8a6]
- Updated dependencies [9061d9e]
- Updated dependencies [e550021]
- Updated dependencies [4e617da]
- Updated dependencies [3d37d50]
- Updated dependencies [7cdc623]
  - @cosmicdrift/kumiko-framework@0.335.0

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

### Patch Changes

- bc0172a: Generated config screens (configEdit, secretsEdit, extension-selector dashboard) render as a settings list: section header on top, one row per key with label, description, origin and reset on the left and the control on the right, hairlines between rows and an accent line on values set at the current level. `EditLayout.variant: "settings-list"` enables the layout, `RenderEditProps.dirtyFooter` shows the unsaved count with Discard and Save changes, `validateOnChange` shows field errors while typing. Number bounds on config keys are validated on the client and read "Must be 1000 or less" / "Must be at least 1". Rows split into two columns by container width, so they stack next to a sidebar on tablets.

  `DashboardScreenDefinition.showUpdatedAt` (default true) hides the "As of" timestamp; the selector dashboard sets it to false. `DashboardScreenPanel.chromeless` embeds a panel's screen without card frame and without its own screen padding, aligned to the page grid; the selector dashboard uses it. Features can name the config section via `<feature>.settings.section`; tenant-settings uses it and the platform screen is titled "Tenant defaults" to match the navigation.

  Consumer tests on secretsEdit need updating: the `required-marker-<field>` test id is gone (a missing required secret now shows as the `secret-not-set-<field>` status), a stored secret gets `secret-saved-<field>`, and `secrets-edit-submit` stays disabled until at least one secret is entered.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Settings list layout for generated config and secrets screens
  -->

- Updated dependencies [6633f59]
- Updated dependencies [6633f59]
- Updated dependencies [bc0172a]
  - @cosmicdrift/kumiko-framework@0.334.0

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

- 2d7f76f: Apps declare assignable membership roles via `r.useExtension(EXT_ASSIGNABLE_ROLE, "<Role>", { assignableFrom? })` (the feature must `r.requires("tenant")`). `assignableFrom` defaults to "Admin"; set it higher to raise the bar. The role-elevation guard and the members/invite screens pick the declarations up; undeclared roles stay rejected. "Member" is now ranked with "User" and labelled.

  <!-- kumiko-changes
  feature: tenant
  type: improvement
  title: Apps declare assignable membership roles via EXT_ASSIGNABLE_ROLE
  -->

- Updated dependencies [2d7f76f]
- Updated dependencies [90420cb]
  - @cosmicdrift/kumiko-framework@0.333.0

## 0.332.0

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

- Updated dependencies [991ed87]
- Updated dependencies [dcf135e]
- Updated dependencies [3917e63]
- Updated dependencies [b81f794]
- Updated dependencies [541d24b]
- Updated dependencies [e82b023]
- Updated dependencies [dcf135e]
- Updated dependencies [dcf135e]
  - @cosmicdrift/kumiko-framework@0.332.0

## 0.331.0

### Minor Changes

- 16797a4: entityList rows can expand into a related list

  `expandableRow` on an entityList declares a related list under each row, with the same fields as a projectionDetail `relatedList` section (query, `parentFilter` or `parentParam`, columns, row and toolbar actions, emptyState). The parent id is the row's `id`. An arrow button at the start of the row opens and closes the area, carries `aria-expanded`, and works by keyboard. Several rows can be open at once. A successful write from the area reloads both the related list and the parent list, so counters on the parent row update. The boot validator and the role projection check the area like a relatedList section. `DataTableProps` gains `expandedRowIds`, `onToggleRowExpanded` and `renderExpandedRow` for custom DataTable primitives.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: entityList rows can expand into a related list with its own row actions (expandableRow)
  -->

### Patch Changes

- Updated dependencies [16797a4]
- Updated dependencies [6b95958]
- Updated dependencies [3ea4ffc]
- Updated dependencies [e4ea9f0]
  - @cosmicdrift/kumiko-framework@0.331.0

## 0.330.2

### Patch Changes

- Updated dependencies [32a6102]
  - @cosmicdrift/kumiko-framework@0.330.2

## 0.330.1

### Patch Changes

- Updated dependencies [63a63d6]
- Updated dependencies [39c2fbd]
- Updated dependencies [03ad4bc]
  - @cosmicdrift/kumiko-framework@0.330.1

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

- 7a886f1: German and Spanish cover every registered key, enforced by a parity test

  The new i18n-parity test in `use-all-bundled` harvests the English copy from the real registrations (feature translations, client plugins, renderer defaults, mail templates) and fails with `key -> locale` when `locale-de` or `locale-es` lacks a key or an en-catalog drifts. This added the missing German and Spanish copy for billing plans, the privacy-center status field and many more keys, and removed 110 translation keys no feature registers any more. German uses "Ereignisprotokoll" for the audit log everywhere. `userDataRights.privacyCenter.restriction.dialogTitle` and `.deletion.dialogTitle` are registered in English by the feature.

  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: German strings cover every registered key and call the audit log "Ereignisprotokoll" everywhere
  -->

  <!-- kumiko-changes
  feature: locale-es
  type: improvement
  title: Spanish strings cover every registered key
  -->

  <!-- kumiko-changes
  feature: user-data-rights
  type: fix
  title: The privacy-center restriction and deletion dialog titles are registered in English by the feature
  -->

  <!-- kumiko-changes
  feature: locale-de
  type: breaking
  title: locale-de and locale-es drop 110 keys that no framework feature registers any more (old custom-screen keys such as audit.log.*, jobs.runs.*, userDataRights.privacyCenter.title)
  migration: |
    The framework no longer renders these keys, so framework screens are unaffected. If app code or an app test calls t() with one of them, register that key in the app's own translations or switch to the key the framework screen uses now (for example the screen title key screen:<screen-id>.title, as in screen:audit-log.title).
  -->

  <!-- kumiko-changes
  feature: locale-es
  type: breaking
  title: locale-es drops the same keys that no framework feature registers any more
  migration: |
    Same as locale-de: register any removed key your app still calls in the app's own translations, or switch to the key the framework screen uses now.
  -->

### Patch Changes

- 1e18129: Bundled screens use translated subtitles; PAT status and MFA strings are translated in de and es

  <!-- kumiko-changes
  feature: admin-shell
  type: improvement
  title: Bundled screen subtitles (admin-shell, jobs, auth-mfa, tier-engine, user-profile) are i18n keys with de and es translations
  migration: |
    Additive. Apps that override these screen descriptions keep working; apps that asserted the old English description text in tests now see the translated subtitle.
  -->
  <!-- kumiko-changes
  feature: personal-access-tokens
  type: fix
  title: The token list status column shows translated labels instead of raw status values
  -->

- Updated dependencies [dc5981b]
- Updated dependencies [7a886f1]
- Updated dependencies [89e32ce]
- Updated dependencies [f19fb5c]
- Updated dependencies [1e18129]
  - @cosmicdrift/kumiko-framework@0.330.0

## 0.329.0

### Patch Changes

- Updated dependencies [9bbdb64]
  - @cosmicdrift/kumiko-framework@0.329.0

## 0.328.1

### Patch Changes

- Updated dependencies [863e8e4]
  - @cosmicdrift/kumiko-framework@0.328.1

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

- Updated dependencies [424f49a]
- Updated dependencies [eae8d2b]
- Updated dependencies [9cc1787]
- Updated dependencies [2a4350b]
- Updated dependencies [c3fbe54]
- Updated dependencies [822928f]
  - @cosmicdrift/kumiko-framework@0.328.0

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

## 0.326.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.326.1

## 0.326.0

### Minor Changes

- 6af6be2: A feature that declares `r.extensionSelector(extension, configKey)` now gets one tenant settings screen in the generated Settings-Hub: the selector as a select of the mounted plugin ids, and below it the config and secrets of the selected plugin. The panels follow the saved selection live.

  New query `config:query:config-value:selected-extensions` returns the caller's selected plugin id per extension point.

  BREAKING: an extension-selector key now renders as a select of the mounted plugin ids, and `config:write:set` rejects every other value except `""` with 422 `config.errors.unknownExtensionPlugin`. The owner's tenant screen `<owner>-tenant` is now a dashboard; its configEdit moved to `<owner>-tenant-selection`. Plugin features under a masked selector lose their tenant nav entry: their `<plugin>-tenant` screen stays as a nav-less embedded panel (a direct deep link still resolves), and their secrets move from the global `secrets` screen into `<plugin>-tenant-secrets` panels.

  <!-- kumiko-changes
  feature: config
  type: breaking
  title: Extension-selector settings render as one tenant screen
  detail: |
    BREAKING: an extension-selector key now renders as a select of the mounted plugin ids, and
    `config:write:set` rejects every value except a mounted plugin id or "" with 422
    `config.errors.unknownExtensionPlugin`.

    The owner's tenant screen `<owner>-tenant` is now a dashboard; its former configEdit moved
    to `<owner>-tenant-selection`. Plugin features under a masked selector lose their tenant nav
    entry: their `<plugin>-tenant` screen stays as a nav-less embedded panel (a direct deep link
    still resolves), and their secrets move from the global `secrets` screen into
    `<plugin>-tenant-secrets` panels. A plugin feature registered under more than one selector
    registration keeps the previous behaviour.

    Generated hub screens need the new key `config.settings.extensionSelectorHint` (shipped in
    the config and secrets bundles, en/de/es).
  migration: |
    Links, tests or screenshots that open `<plugin>-tenant` through the nav or expect a configEdit
    at `<owner>-tenant` should open `<owner>-tenant` (now the dashboard) and look for the plugin
    panels there. Tenant rows or scripts that write a selector value naming no mounted plugin must
    write a mounted plugin id or "" instead. No new translation keys are required from apps.
  -->

### Patch Changes

- Updated dependencies [6af6be2]
  - @cosmicdrift/kumiko-framework@0.326.0

## 0.325.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.325.2

## 0.325.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.325.1

## 0.325.0

### Patch Changes

- Updated dependencies [100732a]
  - @cosmicdrift/kumiko-framework@0.325.0

## 0.324.0

### Patch Changes

- Updated dependencies [efa4114]
- Updated dependencies [3c0095d]
  - @cosmicdrift/kumiko-framework@0.324.0

## 0.323.0

### Patch Changes

- Updated dependencies [d7bba26]
- Updated dependencies [72727cd]
- Updated dependencies [1343b18]
  - @cosmicdrift/kumiko-framework@0.323.0

## 0.322.0

### Patch Changes

- Updated dependencies [d0c631a]
- Updated dependencies [9e7bedc]
  - @cosmicdrift/kumiko-framework@0.322.0

## 0.321.0

### Patch Changes

- Updated dependencies [959b3fb]
- Updated dependencies [fa27809]
- Updated dependencies [fa27809]
- Updated dependencies [8246f13]
- Updated dependencies [b74db24]
- Updated dependencies [5616ad9]
- Updated dependencies [fa27809]
  - @cosmicdrift/kumiko-framework@0.321.0

## 0.320.0

### Patch Changes

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

- Updated dependencies [0ab9874]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [3a99ac1]
- Updated dependencies [fe36eeb]
- Updated dependencies [02cc7b3]
- Updated dependencies [c498565]
- Updated dependencies [9907bc6]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
  - @cosmicdrift/kumiko-framework@0.320.0

## 0.319.0

### Patch Changes

- 53c5206: German strings for the new billing-plans cancel-scheduled banner and reactivate label

  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: German strings for the new billing-plans cancel-scheduled banner and reactivate label
  detail: |
    Adds German i18n strings for the cancel-scheduled info banner and the
    "Reactivate subscription" button label introduced by billing-foundation's
    cancel/reactivate change.
  -->

  - @cosmicdrift/kumiko-framework@0.319.0

## 0.318.0

### Minor Changes

- 4c5152f: billing-foundation's checkout gate no longer blocks forever on a stale `incomplete` subscription

  `modified_at`/`inserted_at` now track every subscription-projection upsert (using the appended event's own `createdAt`, not `now()`, so a rebuild stays deterministic). `getSubscriptionForTenant` exposes this as `SubscriptionView.lastChangedAt`. `isSubscriptionBlockingCheckout` treats an `incomplete` subscription older than 24h (Stripe's own auto-expiry window) as terminal, so a tenant whose checkout was abandoned can start a fresh one instead of getting stuck behind `ConflictError('subscriptionExists')` forever. A young `incomplete` subscription for a plan tier now shows `BillingPlanActions.paymentPending` on the billing-plans query, and the panel shows a "still completing" hint instead of a CTA for it. `createBillingFoundationFeature` gained an optional `now` clock option (defaults to real time), threaded through the checkout/plan-catalog handlers so tests can control staleness.

  Known limit: two checkouts started in parallel before the provider's first webhook arrives can still create two subscriptions, since the gate only sees subscriptions already projected.

  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: billing-foundation's checkout gate no longer blocks forever on a stale incomplete subscription
  detail: |
    A stale `incomplete` subscription (older than 24h) no longer counts as an active subscription for the checkout gate, so a tenant whose Stripe checkout was abandoned can start a fresh one. `SubscriptionView.lastChangedAt` (required) and `BillingPlanActions.paymentPending` are new; a consumer with an exhaustive switch over `BillingPlanAction` needs a `paymentPending` case. Known limit: two checkouts started in parallel before the provider's first webhook arrives can still create two subscriptions, since the gate only sees subscriptions already projected.
  -->

- 4fac08d: Formal or informal address per surface: FormalityProvider, `createPublicSurface({ formality })` and a `de-x-formal` bundle in locale-de

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Formal or informal address per surface
  detail: |
    `FormalityProvider` (and `createPublicSurface({ formality: "formal" })`) makes `t()` look up `<locale>-x-formal` across all plugin bundles before the plain locale, so public pages can say "Sie" while the app keeps "du". `formalLocaleTag(locale)` builds the tag. locale-de now ships `de-x-formal` overrides for its framework strings. Only bundle lookups are affected: an app resolver that already knows a key answers first, and an app that overrides a framework key in plain "de" needs a matching "de-x-formal" entry for formal surfaces.
  -->

- 4c5152f: subscription-stripe's switch-plan returns a 422 instead of a bare 500 when two plan tiers share one Stripe product

  `createStripePlanSwitchSession`'s pre-check (two allowed prices at the same product+interval) and a matching Stripe Customer-Portal `StripeInvalidRequestError` (from `configurations.create()` or `sessions.create()`) both now throw `UnprocessableError('plan_tiers_share_product')` with i18nKey `billing-foundation.errors.planTiersShareProduct`, so the caller gets an actionable 422 instead of an opaque 500. Every other Stripe error keeps its existing mapping; the portal-configuration cache is still evicted on a `sessions.create()` failure.

  Each plan tier needs its own Stripe product: the Customer Portal configuration allows only one price per product and interval, so tiers that share a product cannot be switched between.

  <!-- kumiko-changes
  feature: subscription-stripe
  type: fix
  title: switch-plan returns a 422 instead of a 500 when two plan tiers share one Stripe product
  -->

### Patch Changes

- Updated dependencies [5d3b3e8]
- Updated dependencies [4fac08d]
  - @cosmicdrift/kumiko-framework@0.318.0

## 0.317.0

### Patch Changes

- Updated dependencies [fd40653]
- Updated dependencies [b13c820]
- Updated dependencies [94ce380]
  - @cosmicdrift/kumiko-framework@0.317.0

## 0.316.0

### Patch Changes

- Updated dependencies [aa32979]
  - @cosmicdrift/kumiko-framework@0.316.0

## 0.315.0

### Patch Changes

- Updated dependencies [0f2643d]
  - @cosmicdrift/kumiko-framework@0.315.0

## 0.314.0

### Patch Changes

- Updated dependencies [483666f]
- Updated dependencies [22d89ec]
- Updated dependencies [483666f]
- Updated dependencies [3434a94]
- Updated dependencies [3434a94]
  - @cosmicdrift/kumiko-framework@0.314.0

## 0.313.0

### Patch Changes

- f0c1ef1: Untranslated member status/roles, screen subtitles and audit aggregate columns now go through i18n

  <!-- kumiko-changes
  feature: tenant
  type: fix
  title: Team member status and roles now translate instead of showing the raw enum value
  detail: |
    member-status-cell and member-roles-cell rendered the raw status/role
    enum values (e.g. "active", "TenantAdmin") straight into the table —
    non-English admin UIs showed English words next to translated column
    labels. Both cells now resolve through useTranslation against the
    existing tenant.members.filter.status.option.<status> and
    tenant:entity:__action-form__:field:roles:option:<role> keys, falling
    back to the raw value for any status/role not covered by those keys.
  -->

  <!-- kumiko-changes
  feature: user-data-rights
  type: fix
  title: Privacy-center screen subtitle is now translatable
  detail: |
    The Privacy screen's description was hardcoded English prose baked
    into feature.ts instead of an i18n key, so it never localized. It's
    now userDataRights.privacyCenter.subtitle, registered in i18n.ts with
    de/es translations.
  -->

  <!-- kumiko-changes
  feature: audit
  type: fix
  title: Audit-log-detail screen subtitle is translatable; aggregate columns get de/es copy
  detail: |
    The audit-log-detail screen's description was hardcoded English prose;
    it's now the audit.log.detail.subtitle key with de/es translations.
    Separately, audit.log.col.aggregateType/aggregateId (the actual column
    keys the audit-log-detail screen renders) had no de/es copy at all —
    only the dead, unused audit.log.col.aggregate key did. Added
    aggregateType/aggregateId to de/es, removed the dead aggregate key, and
    fixed the German filter label typo "Aggregate-Typ" -> "Aggregattyp".
  -->

  <!-- kumiko-changes
  feature: agent-tools
  type: fix
  title: Agent manifest now resolves a screen's i18n-key description to English prose
  detail: |
    buildAgentManifest passed screen.description straight through even when
    a feature registered it as an i18n key (e.g. "audit.log.detail.subtitle")
    rather than literal text, so agents saw the raw key instead of prose.
    It now resolves through the registry's translations the same way
    labelsForSuffix already does for entity/field labels, falling back to
    the literal string when the description isn't a registered key.
  -->

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

- Updated dependencies [a14fd1f]
- Updated dependencies [42c5298]
- Updated dependencies [93d7b77]
- Updated dependencies [4dea3ec]
- Updated dependencies [b99240c]
- Updated dependencies [e7dc624]
  - @cosmicdrift/kumiko-framework@0.313.0

## 0.312.0

### Patch Changes

- Updated dependencies [f662b79]
- Updated dependencies [f662b79]
- Updated dependencies [f662b79]
  - @cosmicdrift/kumiko-framework@0.312.0

## 0.311.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.311.0

## 0.310.0

### Patch Changes

- Updated dependencies [4f36c3f]
  - @cosmicdrift/kumiko-framework@0.310.0

## 0.309.0

### Patch Changes

- Updated dependencies [75925be]
- Updated dependencies [cb0adcf]
- Updated dependencies [11b6f67]
- Updated dependencies [ac9bdae]
- Updated dependencies [8f109b5]
- Updated dependencies [711de11]
  - @cosmicdrift/kumiko-framework@0.309.0

## 0.308.0

### Patch Changes

- Updated dependencies [49e07f5]
- Updated dependencies [ad701ed]
- Updated dependencies [6e5ed00]
- Updated dependencies [3ae4b82]
- Updated dependencies [9816d20]
- Updated dependencies [6b8b0ed]
- Updated dependencies [685ecc9]
  - @cosmicdrift/kumiko-framework@0.308.0

## 0.307.0

### Patch Changes

- Updated dependencies [c5c5ddb]
- Updated dependencies [e682776]
- Updated dependencies [cc23d3d]
- Updated dependencies [4179f26]
- Updated dependencies [aae3f5d]
  - @cosmicdrift/kumiko-framework@0.307.0

## 0.306.0

### Patch Changes

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
- Updated dependencies [659c575]
  - @cosmicdrift/kumiko-framework@0.306.0

## 0.305.0

### Patch Changes

- Updated dependencies [90c5398]
- Updated dependencies [9de2cde]
- Updated dependencies [05b87d7]
- Updated dependencies [0ee6000]
- Updated dependencies [0567906]
- Updated dependencies [d98d172]
- Updated dependencies [d42d76a]
  - @cosmicdrift/kumiko-framework@0.305.0

## 0.304.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.304.0

## 0.303.0

### Patch Changes

- Updated dependencies [3d28528]
  - @cosmicdrift/kumiko-framework@0.303.0

## 0.302.0

### Patch Changes

- Updated dependencies [deede20]
  - @cosmicdrift/kumiko-framework@0.302.0

## 0.301.0

### Patch Changes

- Updated dependencies [bae6958]
  - @cosmicdrift/kumiko-framework@0.301.0

## 0.300.0

### Patch Changes

- Updated dependencies [2414932]
  - @cosmicdrift/kumiko-framework@0.300.0

## 0.299.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.299.0

## 0.298.0

### Patch Changes

- Updated dependencies [4ae8163]
- Updated dependencies [6735981]
  - @cosmicdrift/kumiko-framework@0.298.0

## 0.297.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.297.0

## 0.296.0

### Patch Changes

- Updated dependencies [cb6e8a4]
- Updated dependencies [bfa7536]
- Updated dependencies [42b0562]
- Updated dependencies [f042685]
- Updated dependencies [d8cdd8a]
- Updated dependencies [3c34575]
  - @cosmicdrift/kumiko-framework@0.296.0

## 0.295.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.295.0

## 0.294.1

### Patch Changes

- Updated dependencies [7f6fbc6]
  - @cosmicdrift/kumiko-framework@0.294.1

## 0.294.0

### Patch Changes

- Updated dependencies [ea10c90]
  - @cosmicdrift/kumiko-framework@0.294.0

## 0.293.0

### Patch Changes

- Updated dependencies [7fb8a62]
  - @cosmicdrift/kumiko-framework@0.293.0

## 0.292.0

### Patch Changes

- 787c572: Audit log shows actor display names instead of raw UUIDs (fw#3103)

  The `Actor` column of `audit:screen:audit-log` and the `createdBy` field of its detail screen rendered the raw `createdBy` UUID. The framework primitive for this already existed — `ListColumnSpec.refEntity` / `refLabelField`, used by `sessions` and `delivery` — the audit feature just did not declare it. Both now carry `refEntity: "user:user"`, `refLabelField: "displayName"`, which also makes the `createdBy → user:user` relation machine-readable in the app schema instead of implicit.

  `audit:query:list` and `audit:query:details` are unchanged and still return the plain id.

  A system write (`SYSTEM_USER_ID`, the null UUID) has no `read_users` row, so the bulk reference lookup can never resolve it. `SYSTEM_REFERENCE_LABELS` gained a `user:user` entry with the new `kumiko.reference.system-user` key, so every screen referencing `user:user` — not just the audit log — renders "System" for it. An actor that resolves to no row at all (deleted user) keeps the existing generic fallback: the raw id, no throw.

  `SYSTEM_USER_ID` moved from `framework/engine/system-user` to `kumiko-types/identifiers`, next to `SYSTEM_TENANT_ID`, so the client-side reference-label map can read it without importing a runtime module. `engine/system-user` re-exports it — every existing import keeps working.

  <!-- kumiko-changes
  feature: audit
  type: improvement
  title: Audit log shows actor display names instead of raw UUIDs (fw#3103)
  migration: The audit feature now declares `r.requires("tenant", "user")`. An app that mounts `createAuditFeature()` without the `user` feature fails at boot with `Feature "audit" requires feature "user" which is not registered` — mount `createUserFeature()`. Apps using `securityBaselineFeatures()` already had to mount it.
  -->

- Updated dependencies [787c572]
- Updated dependencies [fbe8ffa]
- Updated dependencies [7b5ac24]
- Updated dependencies [6d53c10]
  - @cosmicdrift/kumiko-framework@0.292.0

## 0.291.0

### Patch Changes

- Updated dependencies [0fa2da2]
- Updated dependencies [ef54b65]
- Updated dependencies [d47adef]
- Updated dependencies [ca8d3e3]
- Updated dependencies [53e20f4]
- Updated dependencies [67a4227]
- Updated dependencies [0621367]
- Updated dependencies [0fd6bb5]
- Updated dependencies [229298b]
- Updated dependencies [32a1ce3]
  - @cosmicdrift/kumiko-framework@0.291.0

## 0.290.0

### Patch Changes

- Updated dependencies [878d8b2]
- Updated dependencies [9da6b5f]
- Updated dependencies [fe23245]
  - @cosmicdrift/kumiko-framework@0.290.0

## 0.289.0

### Patch Changes

- Updated dependencies [78f9c42]
- Updated dependencies [efac5bb]
- Updated dependencies [20853fa]
- Updated dependencies [1e5a8e0]
- Updated dependencies [f01015e]
- Updated dependencies [a84d3cb]
- Updated dependencies [dea8ea0]
- Updated dependencies [2e868a7]
- Updated dependencies [253ade3]
  - @cosmicdrift/kumiko-framework@0.289.0

## 0.288.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.288.0

## 0.287.0

### Patch Changes

- Updated dependencies [3489874]
- Updated dependencies [76f2631]
  - @cosmicdrift/kumiko-framework@0.287.0

## 0.286.0

### Patch Changes

- Updated dependencies [1f7ab5d]
  - @cosmicdrift/kumiko-framework@0.286.0

## 0.285.2

### Patch Changes

- Updated dependencies [9c28242]
  - @cosmicdrift/kumiko-framework@0.285.2

## 0.285.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.285.1

## 0.285.0

### Patch Changes

- Updated dependencies [8ee38b3]
  - @cosmicdrift/kumiko-framework@0.285.0

## 0.284.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.284.0

## 0.283.0

### Patch Changes

- Updated dependencies [45f7641]
  - @cosmicdrift/kumiko-framework@0.283.0

## 0.282.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.282.0

## 0.281.0

### Patch Changes

- Updated dependencies [8de23a7]
- Updated dependencies [7ae9256]
- Updated dependencies [7bf2e5e]
- Updated dependencies [f1dc700]
  - @cosmicdrift/kumiko-framework@0.281.0

## 0.280.0

### Patch Changes

- Updated dependencies [fae19a6]
  - @cosmicdrift/kumiko-framework@0.280.0

## 0.279.0

### Patch Changes

- Updated dependencies [e55f357]
  - @cosmicdrift/kumiko-framework@0.279.0

## 0.278.0

### Patch Changes

- Updated dependencies [3e1eb25]
- Updated dependencies [17dcac1]
  - @cosmicdrift/kumiko-framework@0.278.0

## 0.277.0

### Patch Changes

- Updated dependencies [411e80b]
  - @cosmicdrift/kumiko-framework@0.277.0

## 0.276.0

### Patch Changes

- Updated dependencies [e2312ee]
  - @cosmicdrift/kumiko-framework@0.276.0

## 0.275.0

### Patch Changes

- Updated dependencies [2cb61dd]
- Updated dependencies [9d9a462]
  - @cosmicdrift/kumiko-framework@0.275.0

## 0.274.0

### Patch Changes

- Updated dependencies [47070b6]
- Updated dependencies [282072a]
  - @cosmicdrift/kumiko-framework@0.274.0

## 0.273.0

### Patch Changes

- Updated dependencies [e9d3944]
- Updated dependencies [01c9133]
  - @cosmicdrift/kumiko-framework@0.273.0

## 0.272.0

### Patch Changes

- Updated dependencies [147fb82]
- Updated dependencies [6c55fa2]
- Updated dependencies [94812d3]
- Updated dependencies [7bf4309]
  - @cosmicdrift/kumiko-framework@0.272.0

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
- Updated dependencies [c704c75]
- Updated dependencies [60ed7ed]
- Updated dependencies [c704c75]
- Updated dependencies [5f8be0d]
  - @cosmicdrift/kumiko-framework@0.271.0

## 0.270.0

### Patch Changes

- Updated dependencies [dba0a60]
  - @cosmicdrift/kumiko-framework@0.270.0

## 0.269.2

### Patch Changes

- Updated dependencies [3d58c23]
  - @cosmicdrift/kumiko-framework@0.269.2

## 0.269.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.269.1

## 0.269.0

### Patch Changes

- Updated dependencies [ec9aaca]
- Updated dependencies [8412e09]
  - @cosmicdrift/kumiko-framework@0.269.0

## 0.268.0

### Patch Changes

- Updated dependencies [b16457a]
  - @cosmicdrift/kumiko-framework@0.268.0

## 0.267.0

### Patch Changes

- Updated dependencies [e87ab51]
  - @cosmicdrift/kumiko-framework@0.267.0

## 0.266.0

### Patch Changes

- Updated dependencies [4d36b68]
  - @cosmicdrift/kumiko-framework@0.266.0

## 0.265.0

### Patch Changes

- Updated dependencies [371a263]
  - @cosmicdrift/kumiko-framework@0.265.0

## 0.264.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.264.1

## 0.264.0

### Patch Changes

- Updated dependencies [d0184f7]
  - @cosmicdrift/kumiko-framework@0.264.0

## 0.263.0

### Patch Changes

- Updated dependencies [cd255ca]
- Updated dependencies [f6732fa]
  - @cosmicdrift/kumiko-framework@0.263.0

## 0.262.0

### Patch Changes

- Updated dependencies [6fbede9]
  - @cosmicdrift/kumiko-framework@0.262.0

## 0.261.0

### Patch Changes

- Updated dependencies [5139a3f]
  - @cosmicdrift/kumiko-framework@0.261.0

## 0.260.0

### Minor Changes

- dd95eae: `localeDe()` and `localeDeClient()` now accept an optional `{ address: "informal" | "formal" }` option. The bundle still uses informal "du" by default, so existing consumers are unaffected. Apps that use formal "Sie" in their own copy (e.g. property-management apps) can pass `{ address: "formal" }` to get a "Sie" rendering of the ~98 framework texts that address the user directly, so the bundled framework copy no longer clashes with the app's own tone.

### Patch Changes

- Updated dependencies [71b9c4b]
  - @cosmicdrift/kumiko-framework@0.260.0

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
  - @cosmicdrift/kumiko-framework@0.259.0

## 0.258.1

### Patch Changes

- Updated dependencies [3c6c428]
  - @cosmicdrift/kumiko-framework@0.258.1

## 0.258.0

### Patch Changes

- Updated dependencies [f2e57b4]
- Updated dependencies [c1b53a3]
- Updated dependencies [27166cb]
  - @cosmicdrift/kumiko-framework@0.258.0

## 0.257.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.257.0

## 0.256.0

### Patch Changes

- Updated dependencies [586d707]
  - @cosmicdrift/kumiko-framework@0.256.0

## 0.255.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.255.2

## 0.255.1

### Patch Changes

- Updated dependencies [5b04527]
  - @cosmicdrift/kumiko-framework@0.255.1

## 0.255.0

### Patch Changes

- Updated dependencies [88530a2]
- Updated dependencies [0374846]
- Updated dependencies [1212eeb]
- Updated dependencies [7003472]
  - @cosmicdrift/kumiko-framework@0.255.0

## 0.254.0

### Patch Changes

- Updated dependencies [9b74bc9]
  - @cosmicdrift/kumiko-framework@0.254.0

## 0.253.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.253.0

## 0.252.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.252.1

## 0.252.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.252.0

## 0.251.0

### Patch Changes

- Updated dependencies [55691fd]
- Updated dependencies [28ad1f3]
  - @cosmicdrift/kumiko-framework@0.251.0

## 0.250.0

### Patch Changes

- Updated dependencies [86e18dd]
- Updated dependencies [a4a25ee]
- Updated dependencies [e349f03]
- Updated dependencies [0be08d9]
- Updated dependencies [d9f9337]
- Updated dependencies [5c1c606]
  - @cosmicdrift/kumiko-framework@0.250.0

## 0.249.0

### Patch Changes

- Updated dependencies [812795d]
  - @cosmicdrift/kumiko-framework@0.249.0

## 0.248.0

### Patch Changes

- Updated dependencies [109ff0d]
  - @cosmicdrift/kumiko-framework@0.248.0

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
- Updated dependencies [f9f5608]
  - @cosmicdrift/kumiko-framework@0.247.0

## 0.246.0

### Patch Changes

- Updated dependencies [b4d5b20]
- Updated dependencies [f2c9178]
  - @cosmicdrift/kumiko-framework@0.246.0

## 0.245.0

### Patch Changes

- Updated dependencies [3359dae]
  - @cosmicdrift/kumiko-framework@0.245.0

## 0.244.0

### Patch Changes

- Updated dependencies [2cb949e]
- Updated dependencies [dc4e6a2]
  - @cosmicdrift/kumiko-framework@0.244.0

## 0.243.4

### Patch Changes

- @cosmicdrift/kumiko-framework@0.243.4

## 0.243.3

### Patch Changes

- @cosmicdrift/kumiko-framework@0.243.3

## 0.243.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.243.2

## 0.243.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.243.1

## 0.243.0

### Patch Changes

- Updated dependencies [349d763]
  - @cosmicdrift/kumiko-framework@0.243.0

## 0.242.0

### Patch Changes

- Updated dependencies [efd5891]
  - @cosmicdrift/kumiko-framework@0.242.0

## 0.241.0

### Patch Changes

- Updated dependencies [8289b69]
  - @cosmicdrift/kumiko-framework@0.241.0

## 0.240.0

### Patch Changes

- Updated dependencies [db53bbc]
  - @cosmicdrift/kumiko-framework@0.240.0

## 0.239.0

### Patch Changes

- Updated dependencies [2fbab3d]
  - @cosmicdrift/kumiko-framework@0.239.0

## 0.238.0

### Minor Changes

- 8206493: `ListColumnSpec` gains optional `refEntity`/`refLabelField` fields so `projectionList`/`relatedList` columns can declare a reference lookup — those screens have no `EntityDefinition` to carry a real `reference` field type, so a declared reference column previously rendered the raw id. `computeListViewModel` now checks this metadata before the entity-fields lookup and marks the column as `type: "reference"`; the existing renderer-side bulk lookup (`useReferenceLookup`) picks it up automatically.

  `delivery-log`'s `tenantId` column and `sessions-list`'s `userId` column now declare this metadata and resolve to the tenant/user display name instead of the GUID. `useReferenceLookup` also gained a generic fallback (`SYSTEM_REFERENCE_LABELS`, keyed by `refFeature:refEntity`) for reference ids that have no backing row — currently covering `SYSTEM_TENANT_ID`, which renders as the new `kumiko.reference.system-tenant` ("System") label instead of the all-zero GUID.

  `EditFieldSpec` gains the same `refEntity`/`refLabelField` metadata for `projectionDetail` fields, resolved by `computeEditViewModel` with the same before-the-fieldDef-lookup precedence; `session-detail`'s `userId` field now declares it (matching `sessions-list`) and its read-only display (`ReadOnlyReferenceValue`) also consults `SYSTEM_REFERENCE_LABELS`.

### Patch Changes

- Updated dependencies [8206493]
  - @cosmicdrift/kumiko-framework@0.238.0

## 0.237.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.237.2

## 0.237.1

### Patch Changes

- Updated dependencies [da3aed4]
  - @cosmicdrift/kumiko-framework@0.237.1

## 0.237.0

### Patch Changes

- Updated dependencies [0f399c2]
- Updated dependencies [1dca3bc]
- Updated dependencies [9b2eae0]
  - @cosmicdrift/kumiko-framework@0.237.0

## 0.236.1

### Patch Changes

- Updated dependencies [825acb8]
  - @cosmicdrift/kumiko-framework@0.236.1

## 0.236.0

### Patch Changes

- Updated dependencies [ccad32d]
- Updated dependencies [69529cd]
- Updated dependencies [e668a62]
  - @cosmicdrift/kumiko-framework@0.236.0

## 0.235.4

### Patch Changes

- Updated dependencies [c5a5dd4]
- Updated dependencies [41ef079]
  - @cosmicdrift/kumiko-framework@0.235.4

## 0.235.3

### Patch Changes

- Updated dependencies [fa9a541]
  - @cosmicdrift/kumiko-framework@0.235.3

## 0.235.2

### Patch Changes

- Updated dependencies [1ce74b3]
  - @cosmicdrift/kumiko-framework@0.235.2

## 0.235.1

### Patch Changes

- Updated dependencies [4c83a80]
  - @cosmicdrift/kumiko-framework@0.235.1

## 0.235.0

### Minor Changes

- 38d7ffc: The self-populating settings hub now also derives a screen from `r.secret(...)` declarations, alongside masked config keys.

  - New `secretsEdit` screen, grouped by declaring feature, shown under the tenant-audience nav with label/hint taken from the declaration.
  - The screen only appears when the `secrets` feature is mounted, and mirrors the access rule of `secrets:write:set`.
  - Inputs always start empty — the redacted preview is shown next to the field but never loaded into it; deleting a secret goes through `secrets:write:delete`.

  Consumer note: new screen type `SecretsEditScreenDefinition` added to the `ScreenDefinition` union — consumers that switch exhaustively on `screen.type` need to handle it.

### Patch Changes

- Updated dependencies [9dc8d1c]
- Updated dependencies [38d7ffc]
- Updated dependencies [5882fb3]
  - @cosmicdrift/kumiko-framework@0.235.0

## 0.234.0

### Patch Changes

- Updated dependencies [40a8143]
  - @cosmicdrift/kumiko-framework@0.234.0

## 0.233.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.233.0

## 0.232.0

### Patch Changes

- Updated dependencies [aeac06f]
- Updated dependencies [05bdf93]
- Updated dependencies [03a8df0]
  - @cosmicdrift/kumiko-framework@0.232.0

## 0.231.0

### Patch Changes

- Updated dependencies [404d143]
- Updated dependencies [5d4c21e]
- Updated dependencies [4f4bc49]
  - @cosmicdrift/kumiko-framework@0.231.0

## 0.230.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.230.0

## 0.229.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.229.1

## 0.229.0

### Patch Changes

- Updated dependencies [ebadd51]
  - @cosmicdrift/kumiko-framework@0.229.0

## 0.228.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.228.0

## 0.227.0

### Patch Changes

- Updated dependencies [5f157b6]
  - @cosmicdrift/kumiko-framework@0.227.0

## 0.226.0

### Patch Changes

- Updated dependencies [211ff70]
- Updated dependencies [db616cb]
- Updated dependencies [bcac6f3]
- Updated dependencies [c4ed490]
  - @cosmicdrift/kumiko-framework@0.226.0

## 0.225.0

### Patch Changes

- aa1a1a7: German/Spanish translations for the new `cap-overview` feature's strings, and the regenerated feature manifest (`create-kumiko-app`) that lists it as an available choice.
- Updated dependencies [aa1a1a7]
- Updated dependencies [d63b2e8]
  - @cosmicdrift/kumiko-framework@0.225.0

## 0.224.2

### Patch Changes

- Updated dependencies [415ff22]
  - @cosmicdrift/kumiko-framework@0.224.2

## 0.224.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.224.1

## 0.224.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.224.0

## 0.223.0

### Minor Changes

- c4d07f5: `createMultiSelectField` can now render as a checkbox grid instead of the combobox dropdown. Set `display: "checkboxes"` on the field to get one checkbox per option plus a select-all/deselect-all toggle; omitting `display` keeps the existing combobox behavior unchanged.

  Two more options come on top, both only meaningful with `display: "checkboxes"`:

  - `columns` (1–4) sets the grid's column count at the widest breakpoint; narrow viewports always collapse to a single column.
  - `maxRows` caps how many grid rows stay visible before the grid becomes vertically scrollable; omitted, the grid grows with its content.

  Setting `columns` or `maxRows` without `display: "checkboxes"`, or an invalid `maxRows` (not a positive integer), fails at boot.

### Patch Changes

- Updated dependencies [c4d07f5]
  - @cosmicdrift/kumiko-framework@0.223.0

## 0.222.0

### Patch Changes

- Updated dependencies [6a13c64]
- Updated dependencies [8edfaa0]
- Updated dependencies [b00604c]
- Updated dependencies [d3ec5e0]
- Updated dependencies [afceecd]
  - @cosmicdrift/kumiko-framework@0.222.0

## 0.221.0

### Patch Changes

- Updated dependencies [1656ff9]
- Updated dependencies [fab31bf]
  - @cosmicdrift/kumiko-framework@0.221.0

## 0.220.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.220.1

## 0.220.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.220.0

## 0.219.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.219.0

## 0.218.0

### Patch Changes

- Updated dependencies [bfae2fb]
  - @cosmicdrift/kumiko-framework@0.218.0

## 0.217.0

### Patch Changes

- Updated dependencies [02aadf9]
  - @cosmicdrift/kumiko-framework@0.217.0

## 0.216.0

### Patch Changes

- Updated dependencies [89654bc]
  - @cosmicdrift/kumiko-framework@0.216.0

## 0.215.7

### Patch Changes

- 93220e2: Panel-ready for offlot: translate projectionList facets, Members status-filter es/de, cap-list gauge icon, SystemAdmin cross-tenant delivery log (incl. SYSTEM_TENANT_ID).
  - @cosmicdrift/kumiko-framework@0.215.7

## 0.215.6

### Patch Changes

- @cosmicdrift/kumiko-framework@0.215.6

## 0.215.5

### Patch Changes

- Updated dependencies [16454c2]
  - @cosmicdrift/kumiko-framework@0.215.5

## 0.215.4

### Patch Changes

- Updated dependencies [e2a55b2]
  - @cosmicdrift/kumiko-framework@0.215.4

## 0.215.3

### Patch Changes

- be16c6b: Normalize the tenant-concept terminology: German UI copy now consistently says "Mandant" (was a mix of "Mandant"/"Tenant"/"Organisation" across bundles), Spanish consistently says "Organización" (was a mix of "Organización"/loanword "tenant"). English source copy for `config.settings.tenant` reverted to "Tenant" to match the chosen term.
- 2a74871: Fix `<NotesSection>` (notes-history bundle) rendering each entry as one unbroken line with the raw author id and raw ISO timestamp glued to the note text. Body and meta now render as two visually separated lines and the timestamp uses the shared `formatWhen` formatter.

  `note-entry` also gains an `authorName` field (`personal: { of: "authorId" }`, same crypto-shredding subject as `body`), stamped once at `add-note` write time — a self-lookup of the writer's own `read_users` row via `ctx.db.raw` (tenant-agnostic, same pattern as `user-data-rights/handlers/cancel-deletion.write.ts`), decrypting `displayName` with `decryptStoredPii`. Append-only history keeps the name as it was when the note was written, never re-resolved later against a mutable roster. A client-supplied `authorName` in the payload is ignored, same guard as `authorId`. If the self-lookup or decrypt fails, or the user has no `displayName`, `authorName` stays `null` and the write still succeeds — the note text is the point, the name is best-effort. The display already prefers `authorName` and falls back to a translated placeholder for `null` (pre-field history, shredded authors, and any lookup failure).

- Updated dependencies [469ec58]
  - @cosmicdrift/kumiko-framework@0.215.3

## 0.215.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.215.2

## 0.215.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.215.1

## 0.215.0

### Patch Changes

- Updated dependencies [5cf7f9d]
- Updated dependencies [2bcf3c9]
  - @cosmicdrift/kumiko-framework@0.215.0

## 0.214.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.214.0

## 0.213.0

### Patch Changes

- fd90843: SignupCompleteScreen now shows a confirmation with a continue button after successful account activation, instead of silently redirecting.
- Updated dependencies [7ffd0f6]
- Updated dependencies [774ca7d]
  - @cosmicdrift/kumiko-framework@0.213.0

## 0.212.0

### Patch Changes

- 120e585: Audit log actor column and detail view now show a translated "System" label when an event's `createdBy` is the literal `"system"` string written by system-authored events (e.g. delivery attempts), instead of rendering an empty cell.
- Updated dependencies [35b0005]
- Updated dependencies [d006e42]
- Updated dependencies [28fc80a]
  - @cosmicdrift/kumiko-framework@0.212.0

## 0.211.0

### Patch Changes

- Updated dependencies [f38784b]
  - @cosmicdrift/kumiko-framework@0.211.0

## 0.210.0

### Patch Changes

- Updated dependencies [f2e6862]
- Updated dependencies [8b4467d]
- Updated dependencies [1ba89fb]
- Updated dependencies [d85987c]
- Updated dependencies [db14e69]
  - @cosmicdrift/kumiko-framework@0.210.0

## 0.209.1

### Patch Changes

- Updated dependencies [f387a20]
- Updated dependencies [2c05054]
  - @cosmicdrift/kumiko-framework@0.209.1

## 0.209.0

### Patch Changes

- Updated dependencies [f707d1b]
- Updated dependencies [49662ef]
- Updated dependencies [12df48b]
- Updated dependencies [f86cf43]
- Updated dependencies [b9fdc41]
- Updated dependencies [92a5361]
  - @cosmicdrift/kumiko-framework@0.209.0

## 0.208.3

### Patch Changes

- Updated dependencies [e595330]
- Updated dependencies [8087d17]
  - @cosmicdrift/kumiko-framework@0.208.3

## 0.208.2

### Patch Changes

- @cosmicdrift/kumiko-framework@0.208.2

## 0.208.1

### Patch Changes

- Updated dependencies [f538bc0]
  - @cosmicdrift/kumiko-framework@0.208.1

## 0.208.0

### Minor Changes

- 025c5b9: Framework UI copy is English-only. German and Spanish live in `@cosmicdrift/kumiko-locale-de` / `-es`. Apps that want those languages mount `localeDe()` + `localeDeClient()` (or the es equivalents). Without a locale package, framework screens and auth/GDPR mails render in English.

### Patch Changes

- Updated dependencies [025c5b9]
  - @cosmicdrift/kumiko-framework@0.208.0
