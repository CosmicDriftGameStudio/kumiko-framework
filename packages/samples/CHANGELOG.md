# @cosmicdrift/kumiko-samples

## 0.425.1

No changes in this release.

## 0.425.0

### Patch Changes

- 34cf35e: Display fixes found on app screenshots: phone cards, tabs, nav labels, result tables, month values and file links.
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Active tab stays visible when the tab bar grows
  detail: When tab counts load later and the tab bar gets wider, the active tab is scrolled back into view on every size change, not only when the tab changes.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: A column hidden on phones no longer becomes the card badge
  detail: `cardColumnRoles` skips `hideOnNarrow` select columns in the status fallback, as it already did for `cardBadge` columns.
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: fix
  title: Shorter nav labels, translated content folders and layout presets
  detail: The all-tenants audit log nav label is shorter in every locale so it fits the sidebar. The template-resolver content tree labels its folders and its root through `template-resolver.folder.<segment>` and `template-resolver.nav.content`; a `TreeNode` can carry a `labelKey` that the nav tree translates, falling back to the raw label; the sidebar search matches the translated label. The branding layout preset select shows translated option labels. All texts ship in English, German, Spanish, French and Italian.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Result tables keep the data table cell padding
  detail: `ResultTable` and `ComparisonTable` without `card` pad their cells with `px-2` like `DataTable`, so neighbouring columns no longer run together.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Month format for year-month text
  detail: The new cell format `{ format: "month" }` shows a `YYYY-MM` value as month and year in the user's locale ("June 2026"). An entityList text field declared with `format: "month"` uses it by default; other values stay as they are. The list-table-options recipe shows it.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: File links in lists read as downloads
  detail: A file cell in a list shows a download icon before the file name and is labelled "Download: <name>" (`kumiko.field.file-list.downloadNamed`, in all locale packages).
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot warning for a file column a phone cannot reach
  detail: Boot warns with `list/hidden-file-column` when an entityList hides a file column on narrow screens (`hideOnNarrow`) and its rows open nothing that shows the file: no rowClick action, no `detailFor` screen and no entityEdit screen for the entity with that field in its layout. A single reference column counts too when its target entity has exactly one file field, since its cell links that file; an edit screen does not make it reachable, because its form shows the reference picker. The relatedList sections of projectionDetail and entityEdit screens are checked as well, where only the section `rowClick` or a rowClick action opens a row. An app-wide `createKumikoApp({ onRowClick })` is client code the boot cannot see. It is a warning, so existing apps keep booting.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Phone card layout: title first, date ranges, no empty lines
  detail: On the phone card the title keeps its line and a long status badge wraps below it. Exactly two unlabelled dates on one line above the title (`cardAbove`) read as a range with a dash. Empty file lists no longer leave a blank meta line. With a row menu (and no leading image, checkbox or expand toggle) the menu sits beside the title line without making it taller, the status badge stays at the right edge, and the lines above and below the title use the full card width.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Progress lists name an entry above its bar, translated notification region
  detail: `ProgressList` shows name and value first and the bar right below, with more space between two entries than inside one, so a reader from the top pairs each name with its own bar. The toast region is labelled through `kumiko.toast.viewport-label` (Radix fills in the hotkey) instead of the fixed English "Notifications (F8)", in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: A reference to a record with one file links that file
  detail: A list cell of a single reference (`createReferenceField` or a column with `refEntity`) whose target entity has exactly one `file` field and no `files` field shows the reference label as a download link to that file, with the PDF view in a drawer like the file column of the documents list. The file link takes the place of the link to the referenced record. The file id comes from the rows of the reference lookup query, so tenant and field read access apply: an unreadable file field, an unreadable target or an empty file keep the plain label. The name shown is the reference label, never the stored file name. A target with several file fields, a `files` field, a multi reference or an author renderer stays text, and so do reference columns of dashboard list panels. The documents recipe shows it with an offer that references a filed document.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: The comma between phone card values stays at the value before it
  detail: In plain phone cards (`plainPhoneCards`, related lists) two `narrowInline` values on one line are joined by a comma that now sits in the same item as the front value, and the space after it is the line's column gap. An app stylesheet that widens that gap no longer leaves the comma standing alone with space on both sides ("980,00 €  ,  29.10.2026" becomes "980,00 €, 29.10.2026"). The front value takes its line height from that item, so an app rule on the line's direct children (`[data-testid^="card-vals-"] > div`) still reaches both values. A date range above the title keeps its dash flush between the dates.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Related lists sort money, located times and empty values like the standalone list
  detail: A relatedList sorts its loaded rows in the client. A money column (`{ amount, currency }`) now orders by its amount, like the server's column sort, which ignores the currency; before, every money value compared equal and the rows kept the server's id order. A `locatedTimestamp` column orders by its instant, and timestamps within one second order by their fraction whatever its digit count. Empty values sit where the standalone list puts them: last ascending, first descending, or where the field's `sortNulls` says. Rows with the same value follow the id, the standalone list's second key. `sortByAccessor` takes optional `nullsFirst` and `tieBreaker`; without them it behaves as before.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Related lists let their query sort, so the first page holds the right rows
  detail: buildAppSchema derives `serverSortFields` on every relatedList section and entityList `expandableRow` from the bound query: nothing without a `sort` param, the enum literals of a hand-written query, the fields the SQL sort of an `<entity>:list` query orders by for every caller (no locatedTimestamp, no encrypted field, no field or reference label with its own `access.read`, a reference only with `sortable: true` and a label), plus `insertedAt` where the query can order by it. An open `sort: z.string()` is trusted for the sortable columns, except a reference of the section's `entity` without such a label sort. A value written by the app is overwritten. The section sends `sort`/`sortDirection` for a `defaultSort` or header click on such a column and reloads, so a section with more rows than `pageSize` shows the smallest or largest values instead of sorting only the loaded page. Text columns sorted this way follow the database collation, like the standalone list, instead of the client's locale collation (numeric, case-insensitive): "W 10" now sorts before "W 2". Without a sort it asks for `insertedAt` ascending, so child rows with random (v4) ids come in creation order across commands; rows written in one transaction share `insertedAt` and keep id order among themselves. A column the query cannot order keeps the client sort over the loaded rows; a reference column the query cannot order by its label offers no sort at all, since the client only has its uuid. Apps that marked such a reference `sortable` in the section lose that header sort until the entity field gets `sortable: true` and a `labelField`.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: pageRows orders empty values and instants like the SQL list
  detail: `pageRows` puts missing values last ascending and first descending, like the server list (`nullsSortFirst`), and compares ISO instant strings by time whatever their fraction digit count (`instantSortKey`, now exported from `ui-types` and shared with the relatedList client sort). Lists that page through `pageRows` and sort descending by a nullable column now show the empty rows first: publicstatus sysadmin users (`globalRoles`, `locale`) and tenants (`customDomain`), and the bundled tenant-caps and readiness-run lists.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Sorting and filtering by a companion column respect the field's read access
  detail: Money, located timestamps and lookupable text store companion columns (`<name>Currency`, `<name>Utc`, `<name>Tz`, `<name>Bidx`) that have no field entry of their own. A list `sort` or `filter` on such a column skipped the field-level read check, so a caller who could not read the field could learn its order, or which rows share a value, through it. These columns now carry the read rule of their field: the sort drops to id order, the filter matches nothing, as for the field itself.
  -->
- 34cf35e: The `currency` cell format takes an ISO 4217 code and formats the amount with Intl in the UI locale.
  
  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Currency cells format with Intl and an ISO currency code
  detail: `{ format: "currency", currency: "EUR" }` renders an integer amount in the currency's minor unit (`4250` or `"4250"` for 42.50 EUR) through `Intl.NumberFormat` with the currency's decimals, grouping and symbol position of the UI locale, for example `1.234,50 €` in German and `€1,234.50` in English. An optional `locale` overrides the UI locale. The old `symbol` option is gone: it only appended the symbol to the raw value without grouping or decimals. A missing or malformed currency code or a non-numeric value renders the raw value.
  migration: Replace `renderer: { format: "currency", symbol: "€" }` with `renderer: { format: "currency", currency: "EUR" }` (ISO 4217 code). The value is an integer in the currency's minor unit: multiply a major-unit amount by 10^decimals of its currency (×100 for EUR, ×1 for JPY, ×1000 for KWD).
  affects: "currency"
  -->
- 34cf35e: The ui-walkthrough, workspaces and showcase samples define their entities with `createEntity` and field factories.
  
  <!-- kumiko-changes
  feature: samples
  type: improvement
  title: Sample entities use createEntity instead of a cast literal
  detail: `taskEntity` (ui-walkthrough), `orderEntity` (workspaces) and `itemEntity` (showcase) were object literals cast with `as unknown as EntityDefinition` and the internal `allowPlaintext` flag. They now use `createEntity` with `createTextField({ personal: false, reason })` and the other field factories from `@cosmicdrift/kumiko-framework/engine`, so the type checker sees the text-field stance. Their text fields take the factory default `maxLength: 200`.
  -->
- 34cf35e: Sample tests no longer create entity and event tables by hand.
  
  <!-- kumiko-changes
  feature: samples
  type: improvement
  title: Sample tests rely on setupTestStack for their tables
  detail: `setupTestStack` creates the `r.entity` tables of the features it gets and the events table, so the sample integration tests drop their `unsafeCreateEntityTable` and `createEventsTable` calls and the generated `agents/examples/*.md` no longer show them. A lint rule in the framework repo rejects both imports in `samples/**/__tests__`, except in the recipes that build their database without the test stack. The framework AGENTS.md names those recipes instead of listing the helpers.
  -->
- 34cf35e: Update events store only the old values of the changed keys, delete and forget events only plaintext columns, and the executor writes many rows with one append.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Lean update, delete and forget events and executor createMany/updateMany
  detail: The `<entity>.updated` event now carries `previous` with the old values of exactly the keys in `changes` (owner-transition rekeys included) instead of the whole pre-update row. `<entity>.deleted` and `<entity>.forgotten` carry `previous` without personal, encrypted and sensitive fields, in plaintext and without a KMS call, so the erasure event no longer holds a copy of the erased values and a delete without a KMS no longer writes personal fields in plaintext to the log. A delete of a row whose subject key is already erased now succeeds without an erasure purpose; restoring that row stays refused. Restore still carries the whole row, and the update and delete WriteResults still return the whole row. The search index reads the live row on update, the access invalidation of `tenant-membership.updated` reads the user id from the changes or the membership row, and the derived webhook contract of `updated` no longer has `id` inside `previous`; the `deleted` webhook no longer passes tenant-key ciphertext of non-personal tenant-owned fields. `EventStoreExecutor` has `createMany` and `updateMany`: every row runs the checks of create and update, all events go into the log with one statement and one optimistic check per stream, and the batch commits or fails as a whole. Append and projection of a single create or update share one savepoint. `createAccessInvalidationEventConsumer` takes the registry as second argument. A forgotten file reference now lowers the tenant storage usage.
  migration: Code that reads `payload.previous` of an `updated` event for a key the event did not change reads the projection row instead. Code that reads a personal, encrypted or sensitive field from `payload.previous` of a `deleted` or `forgotten` event reads it from the `created` and `updated` events or the projection row before the delete; events written before this release still carry the whole row. Webhook receivers of `<entity>.updated` take the id from the top level. Hand-built `EventStoreExecutor` objects add `createMany` and `updateMany`. A loop of `executor.create` or `executor.update` over many rows in one handler can switch to `createMany` or `updateMany`.
  affects: payload.previous, payload["previous"], createAccessInvalidationEventConsumer, EventStoreExecutor
  -->
- 34cf35e: Entities declare named update verbs, and the executor reads an entity's history and its rows as of an instant.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Named entity verbs, executor history and listAsOf
  detail: An entity declares named update events in `verbs`, optionally with a transition (`{ archived: { transition: { field: "status", from: ["open"], to: "archived" } } }`). `executor.update(payload, user, db, { verb })` appends `<entity>.<verb>` with the `{ changes, previous }` payload of `updated`; a verb with a transition sets its field and fails with `invalid_transition` (422) when the current state is not in `from`. The implicit projection, rebuild, entity upcasters, job triggers, projection apply keys, derived webhook contracts and the audit filter treat a declared verb like `updated`. Boot rejects lifecycle names, names with dots, transitions on non-select fields, unknown options and pairs that `entity.transitions` does not allow. `EventStoreExecutor` has `history({ id })`, which returns the lifecycle and verb events of one entity as `{ version, at, by, verb, changes }`, upcast and decrypted, without fields the caller may not read, and `listAsOf({ asOf })`, which folds the entity's events up to an instant into rows and refuses entities with parentRef, readGate or a row read ownership.
  migration: Hand-built `EventStoreExecutor` objects add `history` and `listAsOf`. A status change written as its own `r.defineEvent` plus an `extendEntityProjection` or `setFields` apply can become a verb in the entity's `verbs` and an `executor.update(..., { verb })`; the projection apply and the hand-written transition check go away. Code that reads `kumiko_events` to show an entity's changes or to fold it to a past instant switches to `executor.history` or `executor.listAsOf`.
  affects: EventStoreExecutor, parseAutoVerb
  -->

## 0.424.1

No changes in this release.

## 0.424.0

No changes in this release.

## 0.423.0

No changes in this release.

## 0.422.0

No changes in this release.

## 0.421.0

No changes in this release.

## 0.420.0

No changes in this release.

## 0.419.0

No changes in this release.

## 0.418.0

No changes in this release.

## 0.417.0

No changes in this release.

## 0.416.0

No changes in this release.

## 0.415.0

No changes in this release.

## 0.414.0

### Patch Changes

- 9d88ba0: Narrow list cards show the "to do" hint sentence above the title.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: List cards lead with the hint sentence
  detail: `cardColumnRoles` returns a new role `lead`: the first text column with a `hint` that is neither title, status nor `hideOnNarrow`. It no longer counts as a meta column. Below 768 px the card shows the lead above the heading with the table's hint cell (sentence, detail line, "Why?"), only when the value is not empty; `rowToneField` still tints the card. The card order is now lead, title with status, up to three values, then the row action. Recipe: `samples/recipes/record-detail-layout`.
  -->
- 9d88ba0: The `pwa` option takes a `basePath`, so an app mounted below the origin root can be installed.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: pwa option: basePath for apps served under a path prefix
  detail: `PwaOptions` gets `basePath` (default `/`, must start and end with `/`, same-origin, no empty, `.` or `..` segment, no `?` or `#`, otherwise the boot fails). The manifest is answered at `${basePath}manifest.webmanifest` and the worker at `${basePath}sw.js` (a worker only controls its own directory), `start_url`, `scope` and `id` are the base path, the shell precache and the offline fallback use `${basePath}`, and the head tags point at the prefixed paths; `/assets/*` stays at the root and cache-first, and so do the API paths (`/api`, `/sse`, `/auth`), so the ingress must route those to the app too. Each base path gets its own cache name prefix, so apps on one origin do not delete each other's precache. The web client registers the worker with the directory of the URL in `<meta name="kumiko-pwa-sw">` as scope instead of a fixed `/`. With the default base path nothing changes. `PWA_MANIFEST_PATH` and `PWA_SERVICE_WORKER_PATH` are no longer exported. Recipe: `samples/recipes/pwa-shell`.
  -->
- 2ac9914: Web apps can be installed as a PWA and keep their shell offline through one `pwa` option on `runProdApp` and the dev server.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: pwa option: web manifest, own service worker, one-time install hint
  detail: `runProdApp`, `runDevApp` and `createKumikoServer` take `pwa: { name, shortName, themeColor, backgroundColor, icons: [{ src, sizes, type?, purpose? }] }` (type `PwaOptions` from `@cosmicdrift/kumiko-server-runtime/pwa`); pass it to both servers. Icon `src` must be a same-origin path, otherwise the boot fails; in production `pwa` needs `staticDir`. The server answers `GET /manifest.webmanifest` (`application/manifest+json`) and a generated `GET /sw.js` (`no-cache`), both ahead of app routes and files, and adds manifest link, theme-color, Apple home-screen tags, apple-touch-icon and `<meta name="kumiko-pwa-sw">` to every HTML shell. The worker precaches `/`, manifest, icons and the build's bundles under a cache name derived from build id, bundles and options, serves `/assets/*` cache-first, other shell files network-first, navigations network-first with the cached shell only when offline, and never handles `/api/`, `/sse/`, `/auth/`, SSE, non-GET or cross-origin requests; activate drops older `kumiko-pwa-` caches. The web client registers the worker only when the meta is present and shows a dismissible one-time install hint (iOS: Share then Add to Home Screen; elsewhere the deferred `beforeinstallprompt`), never when running standalone. New i18n keys `kumiko.pwa.install-hint`, `kumiko.pwa.install-hint-ios`, `kumiko.pwa.install`, `kumiko.pwa.dismiss` in en, de, es, fr, it. Without `pwa` nothing changes and existing service workers stay registered. `/manifest.json` remains the build's asset map. Recipe: `samples/recipes/pwa-shell`.
  -->
- 9d88ba0: `projectionDetail` and `entityEdit` screens can ask for the focused shell with `focus: true`.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Declarative focus for record screens
  detail: `focus?: boolean` on `projectionDetail` and `entityEdit` (default off). A focused screen calls `useShellFocusMode()` for the renderer: the focus rail replaces the full sidebar and the app header actions leave the shell header. Below 768 px the shell header is hidden and the screen gets a `MobileTopBar` with the record title (screen title as fallback), a back arrow to the parent list screen (same resolution as the breadcrumb, browser history without a parent) and the page-header overflow items as menu. Recipe: `samples/recipes/record-detail-layout`.
  -->

## 0.413.1

### Patch Changes

- b2d9939: The use-all-bundled sample app serves a public contact page that uses the real helpdesk browser client, with end-to-end tests for the real submit and the honeypot.
  
  <!-- kumiko-changes
  feature: helpdesk
  type: improvement
  title: helpdesk sample: complete same-origin contact page
  detail: `samples/apps/use-all-bundled/public/helpdesk-contact.html` (with `.js` and `.css`) loads `/helpdesk/client.js`, builds the form from `load()` (kinds, optional phone), submits with proof of work and a hidden honeypot field and shows the sent, rate-limited and failed states. Two Playwright specs cover a real submit that reaches the SystemAdmin inbox and a honeypot submit that stores nothing.
  -->
- d2db585: The helpdesk recipe shows the browser client as a same-origin script and lists `notes-history` among the required features.
  
  <!-- kumiko-changes
  feature: helpdesk
  type: fix
  title: helpdesk recipe: client script same-origin, notes-history listed as required
  detail: The recipe comment embedded `/helpdesk/client.js` from another origin, but the client posts to the relative paths `/api/query` and `/api/write` without cookies, so the page has to share the app's origin or forward `/api` to the app on its own origin. The recipe and its README now say so and list `notes-history` with `config`, `delivery`, `user-data-rights` and `files` as required features.
  -->

## 0.413.0

No changes in this release.

## 0.412.0

### Patch Changes

- 5d9b870: New `kumiko api-docs` command writes developer docs for the HTTP API from the registry and the PAT scopes: `openapi.json` plus `overview.md`, `tokens.md` and one reference page per scope in en, de, es, fr and it. `--check` fails on gaps and on drift.
  
  <!-- kumiko-changes
  feature: agent-tools
  type: improvement
  title: kumiko api-docs generates HTTP API docs from the registry and the PAT scopes
  detail: `kumiko api-docs [--out <dir>] [--locales en,de] [--check]` reads `kumiko.config.ts` and writes `<out>/openapi.json` (OpenAPI 3.1 with only the handlers some PAT scope reaches, one request wrapper per handler with a `type` discriminator), `<out>/<locale>/overview.md` (endpoints, body, envelopes, error codes with HTTP status, versions, lists, batches, safe retries), `<out>/<locale>/tokens.md` (create path from the app's nav labels, scope table, expiry, rate limit, errors, revoke, security, optional plan note) and `<out>/<locale>/reference/<scope>.md` (per handler: title, description, required grant, field table, curl example, recorded response), plus `<out>/index.json` with order, source versions and language independent anchor ids per heading. Output is plain GFM with only `title` and `description` in the frontmatter, so Astro and Starlight render it as is, and it is byte identical for the same input. New `AppConfig.apiDocs` options: `appName`, `baseUrl` (required), `locales`, `planNote`, `uiOnlyWrites` (pattern plus reason), `texts` (paragraph overrides per locale) and `examplesDir`. `--check` writes nothing and exits 1 when a handler in a scope has no description or no description translation (new gap kind `handlerWithoutDescriptionTranslation`, key `handlerDescriptionKey(qn)`), when a write that a screen triggers lies in no scope and is not listed in `uiOnlyWrites`, when a `uiOnlyWrites` entry matches nothing, or when the committed output differs. Known gap: the screen write check only looks at features with at least one handler in a scope. New exports: `frameworkErrorHttpStatus`, `FrameworkErrorCode`, `patAuthRejectHttpStatus`, `PAT_RATE_LIMITED_CODE`, `qnMatches`, `patAllows`, `handlerDescriptionKey`, `patScopesFromFeature`, `PAT_MAX_EXPIRES_IN_DAYS`, and `ApiExampleFileSchema` from `@cosmicdrift/kumiko-types/api-example`.
  -->
  
  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: recordApiExample records real API responses for the generated docs
  detail: `recordApiExample(http, { name, dir, endpoint, body, token })` from `@cosmicdrift/kumiko-testing/api-examples` sends the request with the token as Bearer and returns status and body. With `KUMIKO_RECORD_API_EXAMPLES=1` it also writes `<dir>/<name>.json` with ids, timestamps, tokens, request ids and cursors replaced by stable placeholders and values under password, secret and mfaCode keys redacted. `kumiko api-docs` uses a recording for the example request and the example response of the matching handler. The recipe `samples/recipes/api-docs` shows the whole flow.
  -->
- f155fcb: The security section of the generated token guide warns against tokens in apps, web pages and logs and says to revoke a leaked token at once.
  
  <!-- kumiko-changes
  feature: agent-tools
  type: improvement
  title: api-docs token guide covers client code, logs and leaks
  detail: The security list in `tokens.md` now says never to keep a token in an app or web page or in a log, and to revoke a token at once if it may have leaked, in all five locales. Regenerate with `kumiko api-docs`; `--check` reports the changed `tokens.md` until then.
  -->
- 84dd88f: Derived entity webhook contracts need an opt-in. An entity releases `<entity>.created/.updated/.deleted` only with `webhookEvents: true`.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: entity webhook events need `webhookEvents: true` on the entity
  detail: `<entity>.created`, `.updated` and `.deleted` get a derived webhook contract only for entities that set `webhookEvents: true`, so bundle system entities such as `config-value` or `tenant-secret` can never be released through a token scope. Without the flag the entity has no contract and a scope that lists its events fails at boot, with a message naming the entity and the option. Add `webhookEvents: true` to every entity whose events a scope lists; the field exclusions still apply.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: r.defineWebhookEvent takes an optional wireName
  detail: `wireName` is the event name receivers see in the delivered webhook, for example `incident.created` for the contract `publicstatus:incident-created`. It defaults to the unqualified `name`, must not be empty, and is `entity.verb` for derived entity contracts. `WebhookEventContract` and `WebhookEventDef` carry it.
  -->
  
  <!-- kumiko-changes
  feature: agent-tools
  type: improvement
  title: api-docs names events by wireName and skips system-only handlers
  detail: `events.md` headings and anchors, the OpenAPI `webhooks` keys and their `summary` use the wire name; the contract QN stays as `x-kumiko-qn` in OpenAPI and as the anchor `qn` in `index.json`. Write and query handlers whose `access.roles` are only `["system"]` are no longer documented, even when a scope pattern such as `app:write:monitor:*` matches them, and the `uiWriteOutsideScopes` check ignores them.
  -->
- f6a8fa7: Webhook events get public contracts. `r.defineWebhookEvent` declares one, entity events get a derived contract without personal fields, `PatScopeDef.events` releases them per token scope, and `kumiko api-docs` writes `events.md` and an OpenAPI `webhooks` section.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: r.defineWebhookEvent declares a public webhook event contract
  detail: `r.defineWebhookEvent({ name, description, payload, version })` registers a contract under `<feature>:<name>`, separate from `r.defineEvent`, so an internal event is never released by accident. `registry.getWebhookEventContract(qn)` also returns the contract derived for an entity event (`ticket.created`, `ticket.updated`, `ticket.deleted`): every payload carries the entity `id`, created adds the releasable fields, updated adds `changes` and `previous`, deleted adds `previous`; `toEntityWebhookPayload(contract, event)` maps a stored entity event (aggregate id plus payload) to that shape and drops everything the contract does not release; personal fields, the CRUD `excludedFields`, money and located timestamp fields and encrypted, write-only or sensitive text fields are left out. `registry.getWebhookEventContracts()` lists the declared ones sorted by name. `parseWebhookPayload(contract, payload)` validates a payload and strips unknown keys. New exports: `WebhookEventContract`, `WebhookEventHandle`, `parseWebhookPayload`, `toEntityWebhookPayload`.
  -->
  
  <!-- kumiko-changes
  feature: personal-access-tokens
  type: improvement
  title: token scopes list the webhook events they release
  detail: `PatScopeDef.events` takes exact event names (no globs). Holding the scope at read or write level is enough to subscribe, `expandScopeEvents(config, granted)` returns the union. Boot fails when a scope lists an event without a public contract, for example an internal `r.defineEvent`. Revoking a token now has a title and a field label in every bundle locale.
  -->
  
  <!-- kumiko-changes
  feature: agent-tools
  type: improvement
  title: kumiko api-docs documents webhook events
  detail: When a scope lists events, the output gains `<locale>/events.md` (delivery text from `apiDocs.webhookDelivery`, versioning rules, one section per event with fields and a recorded example), an OpenAPI 3.1 `webhooks` section keyed by event name and an `events` page in `index.json`. New problems `webhookDeliveryTextMissing` and `webhookEventWithoutDescriptionTranslation`. Field descriptions come from `.describe()` on declared payloads and from the entity field translations on derived ones. `ApiDocsInput.webhookExamples` is optional; `kumiko api-docs` reads `<examplesDir>/webhooks/*.json`.
  -->
  
  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: recordWebhookExample records validated webhook payloads for the generated docs
  detail: `recordWebhookExample({ name, dir, contract, payload })` from `@cosmicdrift/kumiko-testing/api-examples` validates the payload with `parseWebhookPayload` and throws with the issues when it breaks the contract. With `KUMIKO_RECORD_API_EXAMPLES=1` it writes `<dir>/webhooks/<name>.json` with ids, timestamps and secrets normalized. It always returns the parsed payload. `WebhookExampleFileSchema` is exported from `@cosmicdrift/kumiko-types/api-example`.
  -->

## 0.411.0

### Patch Changes

- 7985ab1: StepList gets selection with prerequisites, Banner a compact one-line form with icon and an ok variant, FloatingPanel a fixed placement, and the new bundled feature presence shows who else is on a record.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: StepList selection with prerequisites, compact Banner, fixed FloatingPanel
  detail: `StepList` takes an optional `selection` (`selectedIds`, `onSelectionChange`, `actions`). It adds a checkbox per step, a "Select all" row with a count ("2 selected, 1 waiting for input") and, while something is selected, footer actions labelled with the count whose `onClick` receives the effective selection in list order. A step's `dependsOn` lists prerequisites: selecting the step selects them too (marked "Also selected: needed for …"), and unselecting a prerequisite drops the steps that need it. `selectable` per step is `{ kind: "selectable" }`, `{ kind: "missing-input", reason }` (checkbox disabled, "Input missing" tag) or `{ kind: "none" }` (no checkbox), so an app can keep risky steps out of bulk actions. A step whose open prerequisite cannot be selected is disabled with "Review “…” on its own first". Without `selection` the list renders as before. `Banner` takes `density: "compact"` (one line, title inline), `icon` (a nav icon key) and the variant `"ok"` for a finished state. `FloatingPanel` takes `placement: { mode: "fixed", rightPx, bottomPx, widthPx, heightPx }` (anchored, no drag, no resize, nothing persisted), `bodyLayout: "fill"` (children pad and scroll themselves) and `surface: "ai"`. New exports: `StepSelectability`, `StepSelectionAction`, `StepListSelection`, `FloatingPanelPlacement`, plus `usePresence`, `usePresenceList`, `PresenceNotice`, `PresenceAvatars`; `Avatar` takes `size: "xs"` and `shape: "round"`.
  -->
  
  <!-- kumiko-changes
  feature: presence
  type: improvement
  title: New bundled feature presence: who else is on this record right now
  detail: `createPresenceFeature({ entities, roles?, ttlSeconds? })` lets a browser announce that the user is viewing or editing one row of an allow-listed entity (`presence:write:heartbeat` every 15 seconds, `presence:write:leave` on close) and answers with the other people on it; `presence:query:list` returns them for up to 100 rows of a list. It only informs and never locks. State is ephemeral in a Redis hash per session tenant, entity and row (in memory without Redis), holds user ids only and expires after `ttlSeconds` (default 45) without a heartbeat; display names are resolved per response. A caller sees presence only for rows they can read; other rows answer 404. Defaults to TenantAdmin and TenantMember, entities default to none, the handlers are hidden from the AI agent. A Redis or SSE outage logs a warning and answers with an empty room. On a change the other people on the row get an addressed live signal through the new handler service `ctx.services.userLiveSignals`, which pushes SSE frames to named users of the caller's own tenant. The renderer hooks `usePresence` and `usePresenceList` and the widgets `PresenceNotice` and `PresenceAvatars` stay silent when the feature is not mounted.
  -->

## 0.410.0

### Patch Changes

- f51a369: Public handlers admit signed-in visitors whatever their roles (`anySignedIn`), the contact website client types ship under `contact/client`, the report form names the app and Telegram is documented as optional.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: anySignedIn: public handlers admit every signed-in caller
  detail: A role rule that includes `anonymous` may add `anySignedIn: true` (`{ roles: ["anonymous"], anySignedIn: true }`). A signed-in caller then passes whatever roles the session carries, because the browser sends the session cookie to a public endpoint and an app-specific role (for example "Hausmeister") used to turn away a visitor who is welcome anonymously. `hasAccess` and `isUiAccessGranted` honour the flag, nav entries with such a rule stay visible to every viewer, and feature-ast reads and writes it. The boot validator rejects `anySignedIn` on a rule without `anonymous` (use `openToAll` for "every signed-in user") and any value other than `true` (rule `handler/any-signed-in-invalid`). The public handlers of bundled features now set it: waitlist submit, contact challenge and submit, user-data-rights deletion by email and token and download by token, managed-pages published pages and branding, file-derivatives public variants, compliance-profiles sub-processors, tenant-inactivity keep-account, auth-email-password login options and self-registration status, template-resolver by tenant and slug, seo config and subscription-paddle checkout config. Anonymous-only auth flows (signup, reset password, verify email, invite info, account unlock, MFA preauth) are unchanged.
  -->
  
  <!-- kumiko-changes
  feature: contact
  type: improvement
  title: contact/client subpath, app name in the report hint, Telegram documented as optional
  detail: `@cosmicdrift/kumiko-bundled-features/contact/client` exports `CONTACT_CLIENT_SOURCE` and the website client types `ContactWebsiteClient`, `ContactWebsiteWindow`, `ContactWebsiteSubmitFields`, `ContactWebsiteSubmitResult`, `ContactWebsiteFormOptions` and `ContactWebsiteKind`. The report form hint reads "Goes straight to the {appName} team" with the `appName` option (de, en, es, fr, it). With the default `telegram: false` the feature lists `channel-telegram` as an optional dependency only; the feature manifest, the recipe and the docs no longer show the Telegram config key or `contact:write:send-test` for that default. A signed-in visitor with any role can submit the website form and fetch the challenge.
  -->
  
  <!-- kumiko-changes
  feature: waitlist
  type: fix
  title: Signed-in visitors can join the waitlist whatever their roles
  detail: `waitlist:write:submit` used to answer 403 when the browser sent the session cookie of a user without one of the listed roles. It now admits every signed-in caller through `anySignedIn`.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: actionForm summary params
  detail: `summary.params` (`Record<string, string>`) of an actionForm screen interpolates fixed values, such as an app name a feature option sets, into the summary title and subtitle. They are merged with the formatted drawer prefill and win on a name clash.
  -->

## 0.409.0

No changes in this release.

## 0.408.0

No changes in this release.

## 0.407.0

No changes in this release.

## 0.406.0

No changes in this release.

## 0.405.0

No changes in this release.

## 0.404.1

No changes in this release.

## 0.404.0

No changes in this release.

## 0.403.0

No changes in this release.

## 0.402.0

No changes in this release.

## 0.401.0

No changes in this release.

## 0.400.0

No changes in this release.

## 0.399.0

No changes in this release.

## 0.398.0

No changes in this release.

## 0.397.0

No changes in this release.

## 0.396.0

No changes in this release.

## 0.395.0

No changes in this release.

## 0.394.0

No changes in this release.

## 0.393.0

No changes in this release.

## 0.392.2

No changes in this release.

## 0.392.1

No changes in this release.

## 0.392.0

No changes in this release.

## 0.391.1

No changes in this release.

## 0.391.0

No changes in this release.

## 0.390.1

No changes in this release.

## 0.390.0

### Patch Changes

- 54cda5b: Integration tests seed event-sourced rows through the event store and reset event-sourced tables together with the events table.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Tests seed and reset event-sourced tables through the event store
  detail: Seeds of user, membership, tenant and other entity rows use seedRowViaEventStore instead of seedRow, so their created events exist. Setup and teardown hooks in the integration tests clear event-sourced tables through resetTestTables instead of raw DELETE statements, and clear the events table in the same call, so a test no longer starts with events whose projection rows are gone. Nothing changes for apps; the packages are only republished.
  -->

## 0.389.0

No changes in this release.

## 0.388.0

No changes in this release.

## 0.387.0

No changes in this release.

## 0.386.0

No changes in this release.

## 0.385.0

No changes in this release.

## 0.384.0

No changes in this release.

## 0.383.1

No changes in this release.

## 0.383.0

No changes in this release.

## 0.382.0

No changes in this release.

## 0.381.0

No changes in this release.

## 0.380.0

No changes in this release.

## 0.379.0

### Patch Changes

- ece210b: Samples pass the registry to createTemplateResolverApi.
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Samples follow the createTemplateResolverApi(db, registry) signature
  detail: Recipes and sample apps build the template resolver API with the registry as second argument.
  -->

## 0.378.0

No changes in this release.

## 0.377.0

No changes in this release.

## 0.376.0

No changes in this release.

## 0.375.0

No changes in this release.

## 0.374.0

No changes in this release.

## 0.373.0

No changes in this release.

## 0.372.0

No changes in this release.

## 0.371.1

No changes in this release.

## 0.371.0

No changes in this release.

## 0.370.0

No changes in this release.

## 0.369.0

No changes in this release.

## 0.368.0

No changes in this release.

## 0.367.0

No changes in this release.

## 0.366.0

No changes in this release.

## 0.365.1

No changes in this release.

## 0.365.0

### Patch Changes

- b6b75fa: pdf-audit-export rejects oversized periods; sample docs and licence fixes
  
  <!-- kumiko-changes
  feature: samples
  type: fix
  title: pdf-audit-export rejects oversized periods; sample docs and licence fixes
  detail: The audit export fails with 422 audit_period_too_large above 100 rows instead of silently truncating. The samples LICENSE names the right Licensed Work.
  -->

## 0.364.0

No changes in this release.

## 0.363.0

## 0.362.0

## 0.361.0

## 0.360.0

## 0.359.0

## 0.358.0

## 0.357.0

## 0.356.0

## 0.355.0

## 0.354.1

## 0.354.0

## 0.353.0

## 0.352.0

## 0.351.0

## 0.350.0

## 0.349.0

## 0.348.1

## 0.348.0

## 0.347.0

## 0.346.0

## 0.345.0

## 0.344.0

## 0.343.0

## 0.342.0

## 0.341.0

## 0.340.0

## 0.339.0

### Patch Changes

- 2ae49bc: The workspace link of `@cosmicdrift/kumiko-samples` now shows the published layout. `packages/samples/{samples,packages}` hold checked-in relative symlinks to the repo sources, so a consumer that resolves `@cosmicdrift/kumiko-samples/package.json` in a workspace finds `samples/recipes`, `samples/apps` and `packages/bundled-features` next to it. `prepack` swaps the symlinks for the filtered real copies and `postpack` restores them. The published tarball is unchanged.

  <!-- kumiko-changes
  feature: samples
  type: improvement
  title: Workspace link of kumiko-samples shows the published layout through checked-in symlinks
  detail: |
    `scripts/stage-samples-package.ts` declares the shipped layout once. `stage` replaces the symlinks with filtered copies for packing, `clean` removes the copies and restores the symlinks. `verify-samples-package.sh` now expects the symlinks, not an empty folder, after packing.
  -->

## 0.338.0

### Minor Changes

- b036209: New package with the sample recipes, sample apps and bundled-features sources

  `@cosmicdrift/kumiko-samples` ships the sample recipes, sample apps and bundled-features sources in the repository layout. Tools such as the few-shot corpus build can run against a pinned version of it and get the same entry ids and source paths as in the monorepo.

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: New package @cosmicdrift/kumiko-samples with the corpus sources
  -->
