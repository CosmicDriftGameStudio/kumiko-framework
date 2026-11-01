# @cosmicdrift/kumiko-types

## 0.410.0

### Minor Changes

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

### Minor Changes

- 1eecc1d: actionForm `successItems` shows one hint per entry of a success-payload array, each with its own link; Banner gains a `hint` variant.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: actionForm successItems, Banner variant hint
  detail: An actionForm can declare successItems { field, link? }. After a successful submit every entry of that payload array with a string label is shown as its own hint (Banner variant "hint", muted background) with the link on the right; the link resolves like a success link, but idFrom and params read from the entry. While at least one hint is shown it replaces the generic confirmation text. Boot rejects successItems together with redirect and an unknown link target; the role projection drops a link into a screen the role cannot reach and keeps the hints.
  -->
- 4161aa8: Write handlers can declare `agent: { risk: "low", effect: "proposal" }` when they only change a suggestion a person still approves; the agent tool descriptor carries the effect.
  
  <!-- kumiko-changes
  feature: agent-tools
  type: improvement
  title: Agent write handlers can be marked as proposal changes
  detail: AgentHandlerHints takes effect "proposal" for a write whose result is itself a suggestion that a person approves later (for example a plan step the clerk still checks). resolveAgentExposure, the agent manifest handler entry and the write ToolDispatchDescriptor carry the effect, so an agent runtime can skip its own approval step for these calls. Boot rejects effect "proposal" unless the handler declares risk "low" explicitly (the write default is mid), and rejects any effect on a query handler.
  -->
- a8e08cf: The contact feature keeps its writes (reply, mark-done, send-test, forward-request, submit, report) away from the AI agent; the agent only reads requests, replies and delivery status.
  
  New bundled feature `contact`: a public contact form backend with spam protection, SystemAdmin replies and optional Telegram forwarding.
  
  <!-- kumiko-changes
  feature: contact
  type: improvement
  title: New bundled feature contact: public contact form with spam protection, admin replies and Telegram forwarding
  detail: `createContactFeature({ appName, telegram? })` adds a public contact form backend: the anonymous `contact:write:submit` stores a question, contact request or problem report (honeypot, single-use proof-of-work challenge from `contact:query:challenge`, minimum submit time, per-IP and per-email rate limits; spam gets the same 200 body and nothing is stored), notifies every SystemAdmin by mail and, with option `telegram: true` (default off), in a Telegram chat (adds `channel-telegram` to `requires`, the `telegramChat` config key and `contact:write:send-test`). The notification carries no personal data on any channel: only the kind, the app name and a link into the inbox, never name, address, phone, subject or message, because mail and Telegram cannot be shredded. A website sender gets a fixed acknowledgement that repeats nothing they typed (the form is no mail relay); a signed-in admin report gets a copy. The per-email limit counts only submits that passed the spam checks, `contact:write:report` is limited to 10 per hour and user, and the stored `page` loses its query string and fragment. Phone is off by default (`fields.phone`). Logged-in users file reports with `contact:write:report`; SystemAdmins answer with `contact:write:reply` (mail with Reply-To, optional in-app notice for logged-in reporters), mark requests done, and read `contact:query:request-detail`, `contact:query:replies` and `contact:query:request-delivery` (one row per channel with recipient, time and status email|telegram|reply-email|reply-in-app: pending|delivered|failed|skipped|read). Open means no answer yet: only status `open` counts. The browser client is served at `GET /contact/client.js` (`window.KumikoContact`). Requests are crypto-shredding-ready PII with EXT_USER_DATA export and erasure and a 365 day retention. The feature requires `config`, `delivery`, `user-data-rights` and `files` (a file provider must be mounted).
  migration: Run `kumiko schema generate`: it adds the `contact-request` and `contact-reply` tables. Apps mounting contact also need the delivery and channel-in-app migrations (`idempotency_key` columns) and a mounted file provider.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Read-only email and phone text fields render as mailto and tel links
  detail: A read-only text field with `format: "email"` renders its value as a `mailto:` link and `format: "phone"` as a `tel:` link through the Link primitive. The `tel:` href keeps digits and a leading `+` only; empty values and phone values without a digit stay plain text. `isSafeHref` now also accepts `tel:`, which the Link primitive and the markdown renderer share.
  -->
  
  <!-- kumiko-changes
  feature: secrets
  type: improvement
  title: configEdit screens with scope system may map secretKeys
  detail: `secrets:write:set`, `secrets:write:delete` and `secrets:query:list` accept `scope: "system"`. The target is always the system tenant, chosen on the server, and only a SystemAdmin may use it (everyone else gets 403). The configEdit body sends the scope for system-scope screens; the boot validator now only rejects secretKeys on user-scope screens. The secrets access rule must include `SystemAdmin` for such a screen to work, for example `createSecretsFeature({ roles: ["TenantAdmin", "SystemAdmin"] })`. Values never go to the client.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: configEdit actions: handler buttons between the form fields
  detail: `ConfigEditScreenDefinition.actions` takes `{ id, handler, label, description?, buttonLabel, afterField, successMessage? }`. The button renders as its own row directly after `afterField`, calls the write handler with `{}` and never saves the form; it is disabled with the hint `kumiko.configEdit.action.saveFirst` (de, en, es, fr, it) while the form has unsaved changes. Success and failure go through the action notifier, with a banner as fallback. The boot validator checks that the handler is a registered write handler, that `afterField` is a layout field and that ids are unique.
  -->
  
  <!-- kumiko-changes
  feature: channel-in-app
  type: improvement
  title: In-app read state by idempotency key
  detail: Channels receive the notify `idempotencyKey` as `ChannelContext.idempotencyKey`. The in-app channel stores it in the new nullable column `in_app_messages.idempotency_key` (indexed) and the SystemAdmin query `channel-in-app:query:readStateByKeys` (`{ keys }`, 1 to 50) returns `{ key, readAt }` rows without any content, tenant-scoped. Queued delivery jobs carry the key as `notifyIdempotencyKey` in their payload.
  migration: Run `kumiko schema generate`: it adds the `idempotency_key` column and its index to `in_app_messages`. Notes sent before the migration have no key.
  -->
  
  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: Delivery attempts remember the notify idempotencyKey; new attempts-by-keys query
  detail: `store_delivery_attempts` gets a nullable text column `idempotency_key` plus the non-unique index `(tenant_id, idempotency_key)`. Every attempt a `ctx.notify` call logs carries the call's `idempotencyKey` (the first event of an attempt stores it; later sent/failed events keep the row's value). The new SystemAdmin query `delivery:query:attempts-by-keys` (`{ keys: string[] }`, 1 to 50) returns channel, status, error code, time and recipient id of those attempts across tenants, never an address. Attempts logged before this version keep `idempotency_key = null`.
  migration: Run `kumiko schema generate`. It adds the nullable column `idempotency_key` to `store_delivery_attempts` and the index `store_delivery_attempts_tenant_id_idempotency_key_idx`. No backfill is needed; do not write the column with SQL. Every app that mounts delivery needs this migration when it bumps.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: projectionDetail: formatted header subtitle parts and email/phone fields
  detail: A `header.subtitle` part `{ field, format }` formats the value with a `FormatSpec` before it is shown. A projectionDetail layout field `{ field, format: "email" | "phone" }` renders its read-only value as a `mailto:` or `tel:` link, like an entity text field with that format.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: actionForm summary box on screen forms; detail subtitle and notes use the active locale
  detail: An actionForm screen with `summary` now renders the context box under the title also when it is a full screen, not only in a drawer. Header subtitle parts with a `format` and the notes section format dates with the active locale (`formatWhen(value, locale?)`; without a locale the old default stays).
  -->
  
  <!-- kumiko-changes
  feature: admin-shell
  type: improvement
  title: createAdminShellFeature extraPlatformPanels
  detail: `createAdminShellFeature({ extraPlatformPanels })` appends dashboard panels to the platform "Overview" dashboard, so a feature can put a tile (for example the open contact requests) there instead of mounting a dashboard of its own.
  -->
  
  <!-- kumiko-changes
  feature: contact
  type: improvement
  title: contact option reportCancelTarget
  detail: `createContactFeature({ reportCancelTarget })` sets the screen the Cancel button of the report form navigates to; without it the form shows no Cancel button.
  -->
  
  <!-- kumiko-changes
  feature: contact
  type: improvement
  title: contact option detailLinks; every signed-in user may report a problem
  detail: `createContactFeature({ detailLinks: { user, tenant } })` sets the screens the sender and tenant links in the request detail header open (short id or `<feature>:screen:<id>`); defaults stay `user-edit` and `tenant-edit`, `false` removes a link. `contact:write:report` and the report screen are now open to every signed-in user (`openToAll`), not only TenantAdmin and Member. The detail layout drops the phone row while `fields.phone` is off and hides it for an empty value, and the contact feature now requires `notes-history` (the detail notes section needs it).
  -->
  
  <!-- kumiko-changes
  feature: contact
  type: fix
  title: The contact website client sends without credentials
  detail: `GET /contact/client.js` now sends the challenge and submit requests with `credentials: "omit"`, so a visitor who is signed in on the same domain with any role (including app roles) still submits as an anonymous caller instead of getting 403. Name and email come from the form, never from the session.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Fully qualified screen targets of another feature boot in navigate actions
  detail: The boot validator no longer prefixes the owning feature to a navigate target that is already a `<feature>:screen:<id>` name (entityList toolbarActions, row actions, metric and detail links). Before, such a target failed boot with a doubled name like `contact:screen:publicstatus:screen:x`. Unknown qualified targets are still rejected, and a `tab` is checked against the target screen in the other feature. The renderer resolves such qualified targets like short ids: the link or action is offered when the target screen exists and is accessible, and the URL carries the short screen id.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: "On this page" navigation lists related-list and extension sections
  detail: The section navigation next to a screen form (entityEdit, projectionDetail) now also lists titled `relatedList` and `extension` sections, not only field sections, and scrolls to them. A section whose title equals the screen title is still left out.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Stored write-only secrets show a masked "set" row with Replace
  detail: A write-only field whose value is set (secrets, `writeOnly` entity fields) now renders "•••••••••• set" and a Replace button instead of the empty input. Replace reveals the input (with Remove stored value and the keep-placeholder); after a save the masked row returns. New translation keys `kumiko.field.writeOnly.maskedSet` and `kumiko.field.writeOnly.replace` (de, en, es, fr, it).
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: SystemAdmin may read files of the system tenant from any tenant session
  detail: `GET /files/:id`, `/files/:id/meta` and `/files/:id/download-url` also serve a file owned by SYSTEM_TENANT_ID when the caller has the SystemAdmin role, whatever tenant the session is in; the storage provider is resolved for the file's tenant. The file access guard still decides. Delete, variants and upload stay tenant-equal and files of other tenants stay unreadable.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Saved secrets leave the form state; email and phone links are underlined; lists format times in the active locale
  detail: After a successful configEdit or secrets save, a typed write-only value is replaced by the "set" marker instead of staying as plaintext in the form state. Read-only email and phone values render as underlined links. The delivery time column and the document-designer overview, version list and overrides drawer format times with the active locale.
  -->
  
  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: German strings for the contact feature and the configEdit action rows
  detail: Adds the German copy for the contact feature (screens, panels, fields, delivery status and notification labels), the configEdit action hint `kumiko.configEdit.action.saveFirst` and the masked write-only secret row (`kumiko.field.writeOnly.maskedSet`, `kumiko.field.writeOnly.replace`). Apps that mount contact and this locale package need no further translation work.
  -->
  
  <!-- kumiko-changes
  feature: locale-es
  type: improvement
  title: Spanish strings for the contact feature and the configEdit action rows
  detail: Adds the Spanish copy for the contact feature (screens, panels, fields, delivery status and notification labels), the configEdit action hint `kumiko.configEdit.action.saveFirst` and the masked write-only secret row (`kumiko.field.writeOnly.maskedSet`, `kumiko.field.writeOnly.replace`). Apps that mount contact and this locale package need no further translation work.
  -->
  
  <!-- kumiko-changes
  feature: locale-fr
  type: improvement
  title: French strings for the contact feature and the configEdit action rows
  detail: Adds the French copy for the contact feature (screens, panels, fields, delivery status and notification labels), the configEdit action hint `kumiko.configEdit.action.saveFirst` and the masked write-only secret row (`kumiko.field.writeOnly.maskedSet`, `kumiko.field.writeOnly.replace`). Apps that mount contact and this locale package need no further translation work.
  -->
  
  <!-- kumiko-changes
  feature: locale-it
  type: improvement
  title: Italian strings for the contact feature and the configEdit action rows
  detail: Adds the Italian copy for the contact feature (screens, panels, fields, delivery status and notification labels), the configEdit action hint `kumiko.configEdit.action.saveFirst` and the masked write-only secret row (`kumiko.field.writeOnly.maskedSet`, `kumiko.field.writeOnly.replace`). Apps that mount contact and this locale package need no further translation work.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Template dates use the active app locale
  detail: The modified-at dates in the template list, the origin bar, the version list and the overrides drawer are formatted with the active app locale instead of the browser default.
  -->
  
  <!-- kumiko-changes
  feature: create-kumiko-app
  type: improvement
  title: Feature manifest lists contact and its new options
  detail: `feature-manifest.json` describes the bundled feature `contact` with its config keys and dependencies (`config`, `delivery`, `user-data-rights`, `files`; `channel-telegram` with option `telegram`), so scaffolding and `kumiko check` know it.
  -->
- fb68269: The focus rail keeps the sidebar footer and can show a chosen set of entries with a "More" tile for the rest. HTML mails end at their signature.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Focus rail with user menu and a "More" tile
  detail: A focused screen's icon rail now pins the shell's sidebarFooter (for example the sidebar UserMenu) to its bottom, so profile and logout stay reachable. WorkspaceShell and DefaultAppShell take focusRailNavQns, the top-level nav QNs the rail shows as tiles; the other entries sit behind a "More" tile that opens the full sidebar and is marked active when the current screen lives there. New nav icon keys "warehouse" and "euro". An HTML mail whose quote is folded drops the Gmail separator break and the last paragraph's bottom margin, so the quote toggle sits right under the signature.
  -->
- 61cb538: Entity list queries take `onlyDeleted: true` and return just the soft-deleted rows, the list a trash screen needs next to `<entity>:restore`.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: List payload flag onlyDeleted for trash lists
  detail: The entity list query accepts onlyDeleted: true and returns only is_deleted rows. Tenant, ownership and read scopes, filter, search, totalCount and aggregate apply unchanged, with the same access rule as includeDeleted. onlyDeleted together with includeDeleted is a validation error, as is onlyDeleted on an entity without softDelete. Custom query handlers read it as ctx.onlyDeleted; export payloads drop it like includeDeleted.
  -->
- 86e7f73: Long text fields can be full-text searched (`find: "fuzzy"`), long values are split into pieces in Meilisearch, and the app reindexes affected entities on its first start.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: longText find "fuzzy", chunked Meilisearch documents, buildSearchSnippet
  detail: createLongTextField accepts find: "fuzzy" (no blind-index lookup, "exact" stays text-only); the decrypted value goes into the search document like any other searchable field. The Meilisearch adapter splits string fields over 8,000 characters into pieces cut at whitespace with about 200 characters of overlap, because Meilisearch indexes at most 65,535 word positions per attribute; nothing is cut off. Piece 0 keeps the document id every entity already had, further pieces are `<id>_c<n>` with _entityId and _chunk, the index gets distinctAttribute _entityId (an entity matches once) and the filterable attributes _entityId and _chunk. index/indexBatch delete leftover pieces of an earlier longer version, remove/removeBatch delete all pieces of an entity by filter. Default-configured indexes from before are upgraded on first use. New buildSearchSnippet(text, term, { radius }) from @cosmicdrift/kumiko-framework/search returns before/hit/after around the first hit. Also new: tryWithSessionAdvisoryLock (db) and the es-ops operation type search-reindex.
  migration: None. On the first start after the update the app reindexes the affected entities in the background, no manual step. Set KUMIKO_SKIP_SEARCH_REINDEX=1 to skip it.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: Boot-time search reindex when search fields or the document format change
  detail: runProdApp and runWorkerApp start a background reindex (reindexEntity for every tenant that owns events) for each searchable entity whose search fingerprint, the sorted search fields plus the document format version 2, has no completion marker yet. The marker is a kumiko_es_operations row written only after a run without failing rows, so an aborted or failed run is retried on the next boot. A Postgres advisory lock lets one process run it while the others skip, and boot readiness does not wait for it. It needs a configured SearchAdapter in the process; KUMIKO_SKIP_SEARCH_REINDEX=1 opts out.
  -->

### Patch Changes

- d680b38: A form success link can open a custom screen with URL params from the result, and apps can read the soft-delete retention period.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: successLinks take params read from the success payload
  detail: ActionFormSuccessLink gets params, a map from URL search param to success-payload field. `{ screen: "cockpit", params: { cmd: "duplicateOfId" } }` opens the cockpit with `?cmd=<duplicateOfId>`. The link stays hidden while a mapped field is not a string, like a link whose id field is missing.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Soft-delete retention period is exported
  detail: The engine barrel exports SOFT_DELETE_GRACE_DAYS_KEY, SOFT_DELETE_DEFAULT_GRACE_DAYS (30) and readSoftDeleteGraceDays(ctx.config), which returns the tenant's configured period or the default. A trash screen can show how long deleted rows stay restorable without keeping its own constant.
  -->

## 0.408.0

No changes in this release.

## 0.407.0

No changes in this release.

## 0.406.0

### Minor Changes

- bba71a9: Cron and maintenance jobs can declare that a due run does not wake a sleeping shared app. The tenant destruction sweep uses it.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: wakesSleepingApp false on cron and maintenance triggers
  detail: A job declared with trigger { cron, wakesSleepingApp: false } or { maintenance: true, wakesSleepingApp: false } is scheduled under the BullMQ scheduler id scheduler-nowake-<job> instead of scheduler-<job>, so its delayed jobs are repeat:scheduler-nowake-<job>:<ts> and the waker of sleeping shared apps skips them; the run happens on the next wake. Leaving the flag out keeps waking the app. Any other value, or the flag on an event or manual trigger, stops the registration. On start the runner removes the scheduler the job had under its other id at once, without the orphan grace period, so flipping the flag never leaves the old scheduler firing.
  -->
  
  <!-- kumiko-changes
  feature: tenant-lifecycle
  type: improvement
  title: Destruction sweep no longer wakes a sleeping app
  detail: The run-tenant-destruction cron declares wakesSleepingApp false, so its per-minute schedule does not keep a sleeping shared app awake. A due destruction runs on the next wake, for example the daily maintenance window. Its scheduler id changes to scheduler-nowake-tenant-lifecycle-job-run-tenant-destruction; the old scheduler is removed on the first start.
  -->

## 0.405.0

No changes in this release.

## 0.404.1

No changes in this release.

## 0.404.0

### Minor Changes

- 7123167: New job trigger `{ maintenance: true }`: one daily run in the app's maintenance window (`KUMIKO_MAINTENANCE_WINDOW`, `HH:MM` UTC, default 03:00), so a sleeping app wakes once a day for all its cleanup jobs. The cleanup jobs of the framework and the bundled features use it.
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: JobTrigger gains { maintenance: true }
  detail: A job with trigger { maintenance: true } runs once a day at the maintenance window of the app. Prefer it over a fixed cron for housekeeping; the window can be set per app.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Maintenance trigger and KUMIKO_MAINTENANCE_WINDOW
  detail: The job runner registers maintenance jobs as a daily UTC scheduler at JobRunnerOptions.maintenanceWindow (default 03:00), set from KUMIKO_MAINTENANCE_WINDOW by runProdApp and runWorkerApp; an invalid value aborts the boot. maintenanceWindowFromEnv is exported from the jobs barrel. files sweep-orphaned-uploads (hourly before) and the soft-delete cleanup jobs (03:00 and 03:15 before) now run in the window. A schedule stored with the old time is replaced on the next start.
  -->
  
  <!-- kumiko-changes
  feature: jobs
  type: improvement
  title: Cleanup jobs run once a day in the maintenance window
  detail: jobs (stale-run-sweep, hourly before, and retention-cleanup), user-data-rights (export and forget), data-retention, audit escape-hatch-retention, inbound-mail retention, delivery attempt-log-retention and form-draft cleanup use trigger { maintenance: true } instead of 03:00 to 03:30 and hourly crons. Without KUMIKO_MAINTENANCE_WINDOW they all run at 03:00 UTC. A stuck job run is now marked failed at most a day after it crosses the stale timeout.
  -->
  
  <!-- kumiko-changes
  feature: feature-ast
  type: improvement
  title: Pattern library documents the maintenance trigger
  detail: The job pattern's comment and summary name { maintenance: true }; the parser already reads it as a literal option.
  -->

## 0.403.0

### Minor Changes

- 28ffdc2: Named list filters: an entity defines a work-queue rule once, and a dashboard tile counts and opens the list with exactly that rule.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Entities define named list filters
  detail: createEntity takes namedFilters, a record of { access?, filters(scope) } where filters returns ListFilter conditions (sync or async). The default list query accepts namedFilter and appends the resolved conditions to filters, on the row path and the aggregate path. An unknown name is a validation error on namedFilter, a failed access rule is access_denied. resolveNamedListFilters is exported from the engine entry. The definition is function-valued and never reaches the client schema.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Lists and dashboard stats take named filters
  detail: entityList and projectionList take namedFilters [{ id, label }], shown as a removable chip and kept in the URL as <screenId>.filter; it reaches the list, facet and count queries, and defaultFilters are skipped while it is active. A dashboard stat takes navigate { screen, namedFilter } and becomes a link to the filtered list. The boot validator checks that ids exist, that a projectionList query accepts namedFilter, and that the tile counts with the target list's own query and namedFilter.
  -->

## 0.402.0

### Minor Changes

- 7822446: Follow-ups to the editor round: relative links in document anchors, a nav label for the create title, a pinned save bar, a render cache for managed pages and a single deletion card.
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Document anchors accept relative links
  detail: An anchor href in a document body may be relative (/path, ./, ../, #, ?); never // or a backslash. Other URL attributes (image src and similar) and mail links still accept only explicit schemes or placeholders. The sanitizer, the editor schema, compileDocumentBody and the confirmation mail use the same split.
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Collection nav takes entryLabel for the create title
  detail: A collection's nav takes an optional entryLabel (singular i18n key, new in the nav type and in the required surface keys of all locale packages). The create screen title reads "New {label}", or "New entry" without it.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: The editor panel keeps its save bar pinned
  detail: A FormScreenLayout editor inside the editor panel gets the full panel height, so its save bar stays visible while the content scrolls.
  -->
  
  <!-- kumiko-changes
  feature: managed-pages
  type: improvement
  title: The public render caches a sanitized document body per page version
  detail: The render cache holds up to 500 entries keyed on tenant, slug, language, version and format. Bodies larger than 256 KB are sanitized on every render and not cached.
  -->
  
  <!-- kumiko-changes
  feature: user-data-rights
  type: fix
  title: request-deletion-screen shows one deletion card
  detail: The request form no longer draws its own card inside the screen's card, so the screen shows one deletion card.
  -->

### Patch Changes

- ba148ac: projectionDetail metrics accept a `format`, and the migration replay no longer reads a table name ending in `as` as `CREATE TABLE ... AS`.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: projectionDetail metrics can be formatted
  detail: `metrics[].format` takes a `FormatSpec` such as `{ format: "date" }`. The metric shows the formatted value (an empty result falls back to the raw text); the tone still resolves on the raw value. Without `format` nothing changes.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Migration replay keeps tables whose name ends in "as"
  detail: `CREATE TABLE IF NOT EXISTS "read_themas" (...)` was parsed as `CREATE TABLE read_them AS ...`, so `kumiko-schema validate` reported content drift for `read_them` and `read_themas`. `AS` now needs a column list or whitespace before it.
  -->

## 0.401.0

### Minor Changes

- a11ae25: files: `rebindFileRef` moves a bound file onto another record's file field. readGate: `allLinks` needs every link readable; documents opts in with `linkReadMode`. The documents tab points at `filed-document`.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: rebindFileRef, readGate allLinks with documents linkReadMode, documents tab entity fix
  detail: `rebindFileRef(ctx, { fileRefId, from, to })` from `@cosmicdrift/kumiko-framework/files` moves a file that is already bound (for example to an upload record or an inbound mail) onto another record's file field, for server code where a record takes over that file; pending uploads keep using `bindPendingFileRef`. It finds only files of the caller's tenant ("not-found" otherwise), answers "moved" when the file no longer sits at `from`, "rebound" when it was moved or already sits at `to`, and "version-conflict" when a parallel bind committed first, because the update is checked against the stream version. The target must be a registered file field whose accept and maxSize the file fits. A caller other than the framework system user must be able to read the file and must be able to write both the source record and field (not locked; an entity without update handler leaves the move to the system user) and the target record and field; the source row stays locked until the transaction commits, so a lock set in between is either seen or waits; a system job (`{ db, registry, user: ctx.systemUser }`) skips these checks, but the target record must exist. Rebind first, then save the id into the target field; clearing or deleting the source record afterwards leaves the file alone. An entity `readGate` takes `allLinks` as an alternative to `anyLink`: a row with links is visible only when the viewer can read every live link, and the boot validator rejects a gate that declares both. `createDocumentsFeature({ linkReadMode: "allLinks" })` switches the documents gate to it; the default stays `anyLink`, and the file-owner part is unchanged. `documentsTab()` now references `documents:filed-document`; before, a projection screen using it failed boot after the entity rename. Linking a document to a target entity without an update handler is now allowed for the roles in that entity's `access.write` (plus its row-level write rule); a target with neither stays unlinkable. `documents:write:link` and `documents:write:unlink` have title and field-label translations (de, en), and the documents write handlers carry an explicit `agent.risk` (link, unlink, create, update "mid"; import "high"). `createDocumentsFeature({ categoryLabels })` takes a de/en label per category (an unlabelled one shows its raw value); a key that is not in `categories` throws.
  -->

## 0.400.0

### Minor Changes

- fa62e07: Derived fields can be computed in SQL and sorted, relatedList tabs follow query access and can count from their own query.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: SQL derived fields, query-gated relatedList tabs, count badge
  detail: A derived field with `sql` (coalesce over fields, or a related-table count, countDistinct or first with optional label and conditions incl. activeOn/today/now) is computed inside the list SELECT and may set `sortable: true`, also as entityList defaultSort; JS `derive` fields stay display-only and read the SQL values. Related rows and measured fields respect the viewer's read access, a gated value is NULL. GET /api/schema removes relatedList sections (tabs, entityEdit sections, expandableRow) whose query the caller's roles cannot run, and metrics linking to a removed tab lose their navigate. `count: true` on a relatedList tab shows the tab badge from the section's own query total. A metric only becomes clickable when its entityId target resolves, and groupBy labels now also resolve for entities with a backingTable. `valueType: "money"` is allowed for a SQL derived `related` + `first` on a money field: amount and currency are read together and the row carries the stored money shape (no key when unset), sorting is by minor units. Ownership where-rules of a label target or related table are qualified with the subquery's own alias (a label of a row the viewer cannot read no longer leaks when the target is the outer entity), the related entity and label target must also be readable through a query handler of the viewer's roles, backingTable entities are read from their real table (also for reference labels, reference search and label sort, which returned a 500 before), an entity may derive from itself, and a sortable related derived field needs an index on the join column.
  -->
- d8c43e7: New `documents` bundled feature and an entity `readGate` so a record can be visible only through links to other records and the owner of its file.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Entity readGate and the documents feature
  detail: `createEntity({ readGate: { anyLink, fileOwner, linkExemptRoles } })` hides a row unless the viewer can read at least one linked host (join rows with a parentRef) and the owner of the referenced file; it is applied in list, detail, eager-load and relation reads, fail-closed without the registry, and the framework system user passes. Hand-written list/detail handlers for a gated entity are rejected at boot, live signals for gated entities stay anonymous. `ParentVisibilityOption` gains `canReadEntity` and `resolveTable`. The new `documents` feature (`createDocumentsFeature({ categories, linkTargets, capture?, retention? })`) files documents with category, issue and expiry date, links them to records (link, unlink, for-record and per-type queries, expiry overview), lists them on the `documents:screen:list` projection list through `documents:query:overview` (an `expiry` state per row and an "expiring" filter that returns expired and soon-expiring documents), captures files saved into configured entity fields via a postSave hook, and offers an idempotent SYSTEM-only import for jobs. Updating or deleting a document needs write access to one of its linked hosts (admin roles and the system user are exempt). Reference search and sort on a readGate target now apply the gate, and `parentVisibilityFor` decides `canReadEntity` by the entity's own detail query, the same rule the file route uses, so a `liveEntities` query no longer widens what a file owner shows. A document cannot claim another user's unbound upload. A document never defaults its title to the file name.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Hooks run for handlers that return response data; readOnly related lists
  detail: A write handler wrapped by `withResponseData` (for example `tenant:write:remove-member`) lost its lifecycle result, so postSave/postDelete hooks and projections were skipped. `WriteResult` now carries an optional `lifecycle` that the dispatcher and batch flush use and that is stripped from client responses. `EditRelatedListSection` gains `readOnly: true` for plain tables without an entity; the boot validator rejects it together with rowClick/rowActions and guard R2 skips it. The bin test helpers and `envWithoutGitOverrides` now also strip GIT_COMMON_DIR and the other git location variables.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: An untouched money field is no longer submitted as 0
  detail: Forms seed a money field with its currency only and drop that currency-only value on submit, so a handler can tell a deliberately typed 0 from an untouched field. A currency-only value counts as missing for required checks, and the input shows empty instead of 0.00; config forms keep their plain-number contract.
  migration: A form that left a required money field untouched used to submit 0 and now fails validation; type the amount (also in e2e and DOM tests) or give the field a value through `load` or the record. Handlers that read an absent optional money field as 0 must default it themselves.
  -->
- e742383: Embedded lists work as phone inspection checklists: photos per row, limit checks, conditional fields and touch-friendly cards.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Embedded list as inspection checklist
  detail: Every entity field and every embedded sub-field takes `visibleWhen` and `requiredWhen` (FieldCondition). The executor enforces `requiredWhen` on create and update; it returns `validation_error` with paths like `checkpoints.0.finding`, and on update it only checks fields whose value or condition field changed. A field is required only while it is visible, and hidden values are kept. Embedded sub-fields can be `images` (with `capture`) or `files` (`maxSize`, `accept`, `maxCount`). Uploads send `subField` next to `fieldName`, and `file_refs.fieldName` stays the embedded field, so binding, tenant check, disposal, read access, GDPR forget and retention work as for top-level file fields. The new derived op `inRange` (`from: [value, min, max]`, `inside`, `outside`) writes into a select sub-field. Any derived cell can carry a row-level `when`, and server and client compute through the same `withDerivedCells`. Select sub-fields take `optionTones`; segments show the tone of the selected option, and narrow screens render cards with 44px controls and the read-only label as the card title. Boot validates the condition fields and rejects `required: true` combined with `visibleWhen`/`requiredWhen`. Saving now enforces `access.write` on embedded sub-fields per row (`ownership_denied`, path `field.subField`); before, only the read side honored sub-field access. Saving also checks each newly placed file id against the `accept`/`maxSize` of the sub-field it lands in (`file_violates_bind_target`). Boot also rejects a numeric derived op whose target is not numeric, which can break an app that derived into a text or select cell. Recipe: `samples/recipes/inspection-checklist`.
  -->

### Patch Changes

- 4bf242b: Embedded-list phone cards show only the checkpoint and its controls, and number cells format the same way in display and input.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Slimmer checklist cards and locale numbers in embedded lists
  detail: On narrow screens an embedded list with an `inRange` derived cell no longer shows the min and max sub-fields as their own rows. The card shows them as a hint under the measured value ("Limit 0.05 to 0.2", "At least …", "At most …"; new keys `kumiko.field.embedded-list.limit-range`, `limit-min`, `limit-max`). The result badge sits next to the measured value without a label. The new `embeddedList.cardHiddenCells` on an entityEdit field hides sub-fields that only steer a row (such as the kind of a checkpoint) on phone cards; boot rejects names that are not sub-fields. The desktop table is unchanged. Number and decimal cells now use the locale text input (`NumberInput`) instead of a native `type="number"`, so input and read-only cells share one locale format ("0,31" in de, "0.31" in en). Tests that located these cells by role `spinbutton` must use `textbox`.
  -->

## 0.399.0

### Minor Changes

- 13a9366: The channel-in-app inbox pages with a cursor, reports a total and parses a navigation target per notification.
  
  <!-- kumiko-changes
  feature: channel-in-app
  type: improvement
  title: Inbox cursor, total and navigation target for the shell bell
  detail: `channel-in-app:query:inbox` accepts a `cursor` and answers `{ rows, nextCursor, total }`; each row carries `target` (`{ screenId, entityId? }` or null) parsed from `data.target`. Build the target with `inAppTarget(screenId, entityId?)`; a malformed target is dropped and the notification is still delivered. The SSE frame `channel-in-app:event:delivered` now carries only `{ id, userId, notificationType }`, and a failing push no longer fails the delivery because the row is already stored. The shared contract lives in `@cosmicdrift/kumiko-types/in-app-notification-types`.
  -->

### Patch Changes

- 8cb9276: Anonymous visitors can upload again into file fields that opt in with `anonymousUpload: true`.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Opt-in anonymous uploads per file field
  detail: Since the upload route rejects anonymous callers, `POST /api/files` answered 401 for every anonymous visitor. A file, image, files or images field with `anonymousUpload: true` now accepts a pending upload from an anonymous visitor (entityType and fieldName, no entityId, no actionForm); the app binds the file itself. Everything else stays 401 for anonymous callers.
  -->

## 0.398.0

### Patch Changes

- 1b96c8c: Reference labels resolve by id wherever a stored value is shown: read-only detail fields, the reference combobox, embedded-list reference cells and list reference columns. A record beyond the first 50 (picker) or 200 (list lookup) rows of the target entity shows its label instead of its raw id.
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Reference labels resolve by id beyond the lookup caps
  detail: ReadOnlyReferenceValue, the reference combobox and embedded-list reference cells request the stored ids next to their first options page; list reference columns request the ids on screen in chunks of 200 instead of the first 200 rows of the target. The ids go out as `ids` for directory sources and an id-in filter for entity list handlers, which only narrow the caller's list query, so tenant, ownership and field-read rules keep applying. Author `optionsQuery` handlers on reference fields keep their capped `{ limit, search? }` picker page and are additionally asked for stored values with `{ limit, ids }`; a handler that ignores `ids` keeps the previous capped behaviour. List columns keep labels already known while the ids of a new page load and only claim "Unknown" once the current ids have resolved.
  -->

## 0.397.0

### Minor Changes

- 390025c: `createJsonbField({ emptyValue: "array" })` declares a jsonb field that holds an array: its column default is `'[]'::jsonb` instead of `'{}'::jsonb`, and writes accept an array instead of a plain object.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: jsonb fields can default to an empty array
  detail: A jsonb field that stores a list had the fixed column default `{}`, so a row that never wrote it read an object while every other row read an array, and the generated write schema only accepted plain objects. `emptyValue: "array"` switches the column default to `[]` and the write schema to an array; the default stays `"object"`. The schema migration renders `ALTER COLUMN ... SET DEFAULT '[]'::jsonb`; existing rows that never wrote the field get `[]` with the next rebuild of the projection.
  -->
- 390025c: A sortable field takes `sortNulls: "first" | "last"`, which fixes where rows without a value appear in a list in both sort directions, so a `defaultSort` descending on a nullable timestamp no longer puts every row without a date on top.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: sortNulls places rows without a value in list sorting
  detail: Without the option the list keeps Postgres' order (nulls last ascending, first descending), which a plain index serves. With `sortNulls` the list query adds `NULLS FIRST` or `NULLS LAST` to the order and the keyset cursor follows it, so paging across the rows without a value stays complete. A sort that must stay on an index needs an index with the same NULLS order.
  -->

## 0.396.0

### Minor Changes

- dd12c0d: Entity update, delete, restore and forget now answer not_found for a row the caller cannot read, including a join row whose parentRef host the caller cannot read.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Entity writes on a row the caller cannot read fail with not_found
  detail: update, delete, restore and forget only checked access.write, so on an entity with an owner access.read rule and no access.write any tenant member with handler access could change or delete another member's row, and delete returned the decrypted row. They now apply the same access.read rule and parentRef host-visibility gate as detail and answer not_found, so the row's existence stays hidden. Framework system writes are exempt. A write the caller could not read but that failed the write rule before now reports not_found instead of ownership_denied.
  migration: Writes on rows the caller cannot read now fail with not_found; give such writers read access or run them as system. Custom handlers that call the executor directly get the parentRef gate by passing parentVisibility: { entities: ctx.registry.getAllEntities() }, as the generated handlers do.
  -->

## 0.395.0

### Minor Changes

- 6599341: Content collections have two editor formats, plain and document.
  
  <!-- kumiko-changes
  feature: template-resolver
  type: breaking
  title: Content collections edit in plain or document format; rich and markdown are gone
  detail: ContentEditorFormat is "plain" | "document". RichContentEditor and the old tiptap editor are removed from @cosmicdrift/kumiko-renderer/web; the document editor is DocumentContentEditor from @cosmicdrift/kumiko-bundled-features/template-resolver/web. A collection's storage format comes from its declaration on the server (plain stores plain, document stores html sanitized with sanitizeDocumentHtml for every collection kind) and the collection write no longer takes contentFormat. Saved content with {{name}} as text opens with variable nodes. Every collection gets a create form behind a "+" in its nav (unless it declares its own createAction); the collection write takes createOnly and answers an existing slug with the field error slug_exists. The text block editor and the secrets edit screen use FormScreenLayout, which takes an optional unsavedCount. useDispatchTarget is exported from @cosmicdrift/kumiko-renderer/web.
  migration: Run bun kumiko-upgrade --apply. It rewrites contentFormat "rich" and "markdown" in collection declarations to "document". Replace imports of RichContentEditor with DocumentContentEditor from @cosmicdrift/kumiko-bundled-features/template-resolver/web, and drop contentFormat from collection write payloads.
  codemod: scripts/codemod/content-collection-format.ts
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Server field errors without a field on the form show in the form banner
  detail: An entityEdit save that fails with a field error whose path is not a rendered field (for example a field an extension section writes) now shows the message in the form error banner instead of losing it.
  -->

## 0.394.0

### Minor Changes

- 9638cd4: Per-call upload limit, a handler-side file read check, nested-safe `beforeTransaction`, and a catch-up boot rule.
  
  <!-- kumiko-changes
  feature: files
  type: improvement
  title: createFileRefFromBytes takes a per-call maxSize
  detail: `CreateFileRefInput.maxSize` (bytes) replaces the route default for that call, so server-side generated files such as mail attachments can exceed the 10 MB upload default without raising it for browsers. A file field's own maxSize still applies first. `configuredMaxUploadBytes(registry)` returns the configured route limit in bytes, or undefined.
  -->
  
  <!-- kumiko-changes
  feature: files
  type: improvement
  title: canCallerReadFileRef answers the file read decision in handlers
  detail: `canCallerReadFileRef(ctx, fileRef)` applies the same rule as GET /files/:id: the configured accessGuard, otherwise the default guard with the configured privilegedRoles and the bound record's detail query. `createDefaultGuard` is exported from the files barrel. A handler that lists or links files no longer needs its own copy of the rule.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: beforeTransactionWhenNested skip lets a handler with a beforeTransaction phase run nested
  detail: `beforeTransactionWhenNested: "skip"` on a write handler lets a nested ctx.dispatch.write run it without the phase. `event.prepared` is then `undefined` (typed `TPrepared | undefined`) and the handler does that work inside its own transaction. Top-level commands still run the phase. Without the option a nested call stays rejected. Boot rejects the option without beforeTransaction and together with reserveBeforeTransaction; transaction "perCommand" is already rejected next to beforeTransaction.
  -->
  
  <!-- kumiko-changes
  feature: jobs
  type: fix
  title: catchUp job consumers ignore foreign event types before upcasting, and catchUp with maxPerTenant skip fails at boot
  detail: A catch-up job consumer now filters on the trigger's event types before the stored event is upcast, so a foreign event with a failing upcaster no longer stalls the job cursor. Boot rejects `trigger.catchUp` together with `maxPerTenant` onLimit "skip" (including the number shorthand): a replay must not discard history. Use onLimit "defer".
  -->
  
  <!-- kumiko-changes
  feature: files
  type: improvement
  title: Projection entities are server-side attach targets for files
  detail: An entity declared on a projection (r.projection with entity) is a read-model entity: a files field on it can be the attachTo target of createFileRefFromBytes and uploadFileBytesBeforeTransaction, and the file read check uses the owning feature's `<name>:detail` query for it. The registry gets getReadModelEntity and getReadModelEntityOwner; two projections declaring an entity for the same source fail the boot. POST /files still accepts only r.entity targets, so a client can never attach to a read model. deleteFileRefsBoundToRecord soft-deletes the fileRefs of one record for owners that remove it without an r.entity delete.
  -->
- 9c4e277: Imported mails keep their full text, the original and their attachments. A mail the provider cannot parse no longer blocks a mailbox, a mailbox that stops syncing says so, a disconnected mailbox can come back without duplicates, and a new or reactivated mailbox syncs right away.
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: Imported mails store full text, original and attachments
  detail: ingest-message now takes bodyText (at most 32,000 characters, cut with bodyTextTruncated set; 32,000 keeps a long mail readable while one event, one projection row and the PII-encrypted column stay small, the original keeps everything), rawMime, bodyHtml, attachments (at most 50) and skippedAttachments (at most 200). The original is stored as .eml (or .html for HTML-only mails) and each attachment as a file reference through file storage; apps without a file provider still import the mail, mark contentState unavailable and show the mailbox as interrupted. The event inbound-message-received is now v2 with an upcast that defaults the new fields; bodyText is personal tenant data. The new query inbound-mail-foundation:query:message:content returns text, original reference and attachments of one mail; message:list never carries the body. Retention removes the mail row, its body object and its attachment files. RawInboundMessage gains text, html, attachments and skippedAttachments.
  -->
  
  <!-- kumiko-changes
  feature: inbound-provider-imap
  type: improvement
  title: The IMAP provider reads text, HTML and attachments
  detail: The provider parses full mails. Inline images are skipped, forwarded message/rfc822 mails are unpacked up to depth 3, and the limits are 25 MB per attachment, 50 MB per mail and 50 attachments; everything skipped is reported in skippedAttachments with its reason. The new plugin method fetchContent reloads the content of a mail by provider id.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: A mail that cannot be parsed is quarantined instead of blocking the mailbox
  detail: A mail the provider reports as rejected, or whose ingest fails, is normalized where possible and otherwise stored in the unmanaged table store_mail_quarantine; every message is isolated in the supervisor, so the rest of the batch imports and the sync cursor moves on. An ingest failure only counts against a mail once a later mail of the batch succeeded, and the third counted failure quarantines it as ingest_failed; an outage of the database, KMS or file storage never quarantines good mail and never moves the cursor past an unhandled mail. The account list shows quarantinedCount and lastError, the new handler acknowledge-quarantine confirms the entries, acknowledged entries are purged by retention after 90 days, and the tenant-destroy hook removes them.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: A mailbox that stops syncing shows as interrupted with a reason
  detail: The account events mail-account-connected and mail-account-updated are v2 with lastError (connection_failed, rate_limited, message_quarantined, file_storage_unavailable). Three failed polls in a row set the status degraded, shown as Unterbrochen in German; the next successful poll sets it back to active. New key in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: A disconnected mailbox is reactivated under the same account
  detail: The new handler reactivate-account puts a disconnected mailbox back to active with its stream and sync cursor, so no mail is imported twice. connect-account refuses an address that is already connected (address_already_connected) or disconnected (address_disconnected) and reopens a disconnected OAuth mailbox in place; connect-routes answers 409 with the reason. reconnect-mailbox now also accepts a disconnected account.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: Snippet-only mails get their content reloaded
  detail: Mails imported before this change carry only a snippet. The supervisor asks the provider for their content through fetchContent and stores it with attach-message-content (event inbound-message-content-fetched v1); a mail the server no longer has becomes unavailable and is not asked for again.
  -->
  
  <!-- kumiko-changes
  feature: inbound-provider-imap
  type: fix
  title: IMAP and SMTP hosts given as IP addresses connect over TLS
  detail: imapflow passes servername false for an IP literal, which Bun's TLS rejects, so such mailboxes could not connect. The IMAP client now sets an undefined servername; nodemailer already omits it for SMTP.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: Connected, reconnected and reactivated mailboxes sync immediately
  detail: A per-instance event consumer wakes the supervisor on a new or active-again mailbox, which syncs once right away instead of waiting for the next poll. A sync of one account never runs twice at the same time. A woken sync that finds the credential not stored yet (the OAuth secret is written after the account) sets no status and leaves it to the next tick; stop() waits for running syncs.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: The first sync after an OAuth connect no longer waits for the next poll
  detail: The OAuth callback now dispatches the internal handler mark-credential-stored once the refresh token is saved, so the sync that the account commit triggers earlier than the token is repeated as soon as the credential exists. Originals above 50 MB are not stored; they are listed in skippedAttachments as message/rfc822 with reason too_large while text and attachments are kept. attach-message-content no longer accepts a caller-supplied bodyRef.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: Outgoing mail carries attachments
  detail: sendMailFromAccount takes attachmentFileIds (at most 10 file references of the caller's tenant, at most 18 MB together, duplicates dropped). The bytes are read through file storage and sent over SMTP and stored in the sent folder unchanged; an unknown or foreign file gives mail_send_attachment_invalid, too many bytes mail_send_attachments_too_large, and nothing is sent. The plugin method send now receives the resolved attachments as a fourth argument and returns ProviderSentMail. New keys in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: A hanging mailbox no longer blocks the others
  detail: The supervisor syncs up to 4 accounts at the same time (pollConcurrency), skips an account whose previous sync is still running, and abandons a sync after 10 minutes (accountPollDeadlineMs) as one failed poll; plugin.fetch and plugin.fetchContent receive an AbortSignal, and an abandoned sync stores nothing and moves no cursor. The IMAP client sets connection (20 s) and greeting (16 s) timeouts explicitly.
  -->
  
  <!-- kumiko-changes
  feature: jobs
  type: improvement
  title: r.job event triggers can catch up on stored events
  detail: trigger { on, catchUp: true } gives the job its own event consumer job:<jobQn> that starts at the beginning of the event store, so events from before the job existed run it too, once per event (job id derived from job QN and event id). Every "on" entry must be an r.defineEvent event, otherwise boot fails. The job is no longer fired by the shared job-trigger consumer. JobRunner gains handleCatchUpEvent.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: Sender authentication (SPF, DKIM, DMARC) of imported mails
  detail: inbound-message-received v2 carries senderAuthentication ({ authservId, spf, dkim, dkimDomains, dmarc, fromDomain } or null; verdicts pass, fail, none, unknown; dkimDomains at most 10), stored as JSON text in read_inbound_messages.sender_authentication and returned by message:content and loadInboundMessageContent; isSenderAuthenticated is true only for a dmarc pass. The mail account has a new optional trustedAuthservId (events mail-account-* v2, read_mail_accounts.trusted_authserv_id, input of connect-account, update-account, reactivate-account and the IMAP connect and reconnect forms). Only the first Authentication-Results header from the top whose authserv-id equals it counts; without an id, without such a header or when its header.from domain differs from the From domain the result is null, and a dmarc result without header.from is unknown. Headers below the trusted one are ignored, so a sender cannot inject a pass. Mails imported before, and content refetched later, have null. New keys in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: breaking
  title: Mail account handlers are stricter and the trusted authserv-id has its own handler
  detail: trustedAuthservId is no longer accepted by connect-account, update-account and reactivate-account (strict schemas reject unknown keys); set it with the new set-trusted-authserv-id (SystemAdmin, TenantAdmin, not model-callable). update-account accepts status, lastError, watchState and reason only from the system identity; connect-account is no longer exposed to agents. reactivate-account checks the account owner (unless the OAuth override is set), fails with credential_required when a password account has no stored credential, and reopens an account in place only with that override; disconnect-account deletes the stored secret. Outgoing attachments must pass the file read check of the sender, and SendMailFromAccountContext needs dispatch. New screen "Absenderprüfung" edits the id. The watch supervisor and the IMAP forms use mapWithConcurrency and implicit TLS on port 465 for SMTPS.
  migration: |
    Drop trustedAuthservId from connect-account, update-account and reactivate-account payloads and dispatch set-trusted-authserv-id after connecting. Wrapping or agent setups that called connect-account as a model tool need their own exposed handler. Callers of sendMailFromAccount pass a context that includes dispatch. Personal mailboxes are reactivated by their owner only; after disconnect-account a new credential must be stored before reactivate-account.
  -->
- d24b405: Inbound mail with configurable roles and private personal mailboxes
  
  `createInboundMailFoundationFeature` and `createInboundProviderImapFeature` take `{ userRoles, adminRoles }` (defaults `User` and `TenantAdmin`/`SystemAdmin`); a boot check rejects deviating options. The mail of a personal mailbox (messages, body, attachments, quarantine) is now readable by its owner only, not by admins; admins still see the account metadata and manage shared mailboxes. The owner reactivates a personal IMAP mailbox in the new "My mailboxes" flow. The content-fetched event is version 3 and carries `accountId` and `ownerUserId` (null for older events). `EntityDefinition.attachedFileAccess: "record-only"` keeps the files privileged roles from reading or deleting attached files, and `createDefaultGuard` takes the matching fourth parameter. `SendMailFromAccountContext.dispatch` is query-only. A live list now resyncs on every stream open and an infinity list adopts a refresh that lands during its first load.
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: breaking
  title: Personal mail is private to its owner, roles are configurable
  detail: Admins no longer read messages, bodies, attachments or quarantine of a personal mailbox; list-accounts still shows them the account without counts. The screens and the IMAP handlers are factories (createMailAccountListScreen, createImapConnectScreen and others) taking the resolved roles instead of constants. The content-fetched event is version 3 with accountId and ownerUserId. createDefaultGuard has a fourth parameter recordOnlyEntityTypes; for those entity types the files privilegedRoles no longer read or delete attached files (shared mailboxes included), only the uploader and readers of the record do. The OAuth connect route answers 403 mail_role_required to callers without a mail role.
  migration: |
    Apps that import mailAccountListScreen, mailAccountEditScreen, mailAccountSenderCheckScreen, myMailAccountListScreen, mailQuarantineScreen, imapConnectScreen or imapReconnectScreen call the matching create*Screen factory with resolveInboundMailRoles(). Apps with their own roles pass { userRoles, adminRoles } to createInboundMailFoundationFeature and the same options to createInboundProviderImapFeature. Callers of createDefaultGuard pass a Set of record-only entity types as fourth argument. Code that read personal mail as an admin must run as the owner; the nullable accountId and ownerUserId on content-fetched events need no action.
  -->
- a91f814: Dashboards can embed a projectionDetail as a screen panel, list toolbar actions can be gated with `visibleWhen`, a screen `fallback` can pick its screen by failure reason, and the live-signal entity name now comes from one shared `toKebab`. All additions are optional.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: A projectionDetail can be a dashboard screen panel
  detail: A `screen` panel or its `fallback` may point at a projectionDetail. The id comes from the host dashboard's `record` binding and is passed to the embedded screen as its entityId. Boot fails when the host dashboard has no `record`. Header, fields and Detail query render inline in the tile.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Toolbar actions accept visibleWhen
  detail: Every toolbar action of a projectionList or entityList takes an optional `visibleWhen` ({ query, field, eq }). The button shows only while the live query matches; it stays hidden while the query loads and when it fails. Buttons gating on the same query share one request. Boot checks the query, its output field and that it needs no input. relatedList toolbar actions reject `visibleWhen`.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Screen fallback can depend on the failure reason
  detail: A screen-level `fallback` is either a screen id (unchanged) or a map `{ hidden, forbidden, notFound, error }`. `forbidden` is a 403 and `notFound` a 404 on the gate query; `hidden` is an unmet condition; `error` is any other failure. A reason without an entry shows a default notice (new keys kumiko.screen.forbidden and kumiko.screen.notFound) and `error` shows an error banner with retry. Boot rejects an empty map and checks each entry like a string fallback.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Live signals for entity names with uppercase runs reach the client
  detail: `toKebab` now lives once in `@cosmicdrift/kumiko-types/kebab-case` and is used by the server read-access keys, the qualified-name helpers and the renderer. Before, the renderer and server copies could diverge for names like `aiURLCheck`, so a screen subscribed to a name the server never signalled. Boot now fails when two entities of different features fold to the same key (`billing.period` and `billingPeriod`), instead of merging their read rules.
  -->

### Patch Changes

- eecf6fa: `HandlerContext.triggerName` documents what it holds: the qualified name of the event that fired the job trigger, not the emitting handler.
  
  <!-- kumiko-changes
  feature: jobs
  type: fix
  title: triggerName is documented as the firing event's qualified name
  detail: The JSDoc of `triggerName` said it names the handler that emitted the event; the job runner sets the event's qualified name, which multi-trigger jobs compare against the event QN constants.
  -->

## 0.393.0

No changes in this release.

## 0.392.2

No changes in this release.

## 0.392.1

No changes in this release.

## 0.392.0

### Minor Changes

- 3cfb343: Closes four gaps in plain framework screens. The projectionDetail header badge shows the translated status, the shell title follows the active workspace, cap-overview formats amounts by unit and says "Not included" for a limit of 0, and admin-shell can drop its tenant overview.
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: RecordHeaderSpec takes statusFormat
  detail: header.statusFormat is a FormatSpec for the header badge text, typically enumOption with a keyPrefix. The badge tone still resolves on the raw status value.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: The projectionDetail header badge shows the translated status
  detail: The header badge formats its text with header.statusFormat. Without it, the badge reuses the layout renderer of the status field when that is enumOption or i18nText, so header and body show the same text. Without either, the raw value is shown as before. The tone keeps resolving on the raw value.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: The shell header title follows the active workspace
  detail: When two navs point at the same screen, the breadcrumb now takes the label of the nav the sidebar shows for the active workspace. Before, the first nav in the app won, so the title could differ from the sidebar entry. Without a matching nav in the workspace, the old lookup applies.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: The boot validator checks header.statusFormat
  detail: A projectionDetail screen with header.statusFormat but without header.status fails boot, because there is no badge to format.
  -->
  
  <!-- kumiko-changes
  feature: cap-overview
  type: improvement
  title: Cap amounts follow their unit and a limit of 0 reads "Not included"
  detail: Values with unit "mb" show as MB, GB or TB (base 1024), count and tokens use the locale's digit grouping. A limit of 0 or less shows "Not included" instead of a 0 bar, also when nothing is measured. caps:usage rows and the tenant-caps list cells now carry the unit of the cap. New key cap-overview.notIncluded in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: admin-shell
  type: improvement
  title: includeTenantOverview turns the tenant overview off
  detail: createAdminShellFeature({ includeTenantOverview: false }) registers neither the tenant overview screen nor its nav and leaves it out of the tenant workspace. The default stays true.
  -->
- 3d7f455: The paid system check run gets its own button next to "Start check", the mail probe tests the platform sender when a tenant has no own mail provider, and tenant admins can connect an IMAP mailbox from the mail account list, which can then also send replies from its own address.
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: projectionDetail takes inlineActions
  detail: ProjectionDetailScreenDefinition.inlineActions lists action ids that stay visible buttons next to the primary action in the page header instead of folding into the "More actions" menu. Without it the header behaves as before. The phone header keeps its single icon button.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: The boot check validates inlineActions
  detail: Every id in a projectionDetail inlineActions list must name a declared action (or edit when the screen has an edit target), the same rule as primaryAction; an unknown id fails the boot.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: The detail header keeps inlineActions as buttons
  detail: HeaderActionsBar takes inlineActionIds and renders those actions as buttons after the primary action; only the remaining actions go into the overflow menu, and no menu is shown when none remain.
  -->
  
  <!-- kumiko-changes
  feature: readiness
  type: improvement
  title: The paid run is a button next to Start check
  detail: The system check screen declares run-paid-check as an inline action, so "Test AI extraction" shows as a button beside "Start check" instead of in the "More actions" menu. It stays hidden while the app has no paid probes.
  -->
  
  <!-- kumiko-changes
  feature: channel-email
  type: improvement
  title: channel-email publishes its app transport
  detail: channel-email declares the emailAppTransport extension and registers its app transport under it; findEmailAppTransport(registry) returns that transport, or null when the app has none or does not mount channel-email.
  -->
  
  <!-- kumiko-changes
  feature: mail-foundation
  type: improvement
  title: The mail probe tests the platform sender
  detail: A tenant without its own mail provider now gets the test mail through the channel-email app transport, the sender its tenant-transport notifications fall back to. The probe reports mail-foundation.probe.send-test-mail.platform-accepted on success and mail-foundation.probe.platform-send-rejected when the platform server rejects it; it is skipped only when neither an own provider nor an app transport exists, and mail-foundation.probe.not-configured now reads "No email sending set up". New keys in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: The mail account list links to the IMAP connect form
  detail: mailAccountListScreen gets a "Connect mailbox" toolbar action that opens the screen mail-account-connect-imap. The button shows only when the app mounts inbound-provider-imap, which registers that screen. The Systemcheck fix link for inbound mail now leads to a list where a mailbox can be added.
  -->
  
  <!-- kumiko-changes
  feature: inbound-provider-imap
  type: improvement
  title: IMAP mailboxes can be connected from a form
  detail: The new write handler inbound-provider-imap:write:connect-mailbox (TenantAdmin, SystemAdmin, not exposed to the agent, 10 calls per tenant in 10 minutes) checks the IMAP login before the transaction, then creates a shared mail account and stores host, port, user and password in its credential secret in the same transaction. It always connects with implicit TLS (default port 993); there is no plaintext option, and a secure:false in the payload is ignored. A failed check stores nothing and answers with one of four texts: host not reachable or not allowed, login rejected, TLS failed, no connection. The form screen mail-account-connect-imap has a masked password field and no TLS toggle. New keys in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: Apps can send from a connected mailbox
  detail: The provider contract gets an optional send(ctx, account, message). The new server function sendMailFromAccount(ctx, { accountId, message }) is called from an app's own write handler and sends through the provider of the mailbox, with the mailbox address as From and In-Reply-To and References for replies. It returns WriteResult<{ messageIdHeader }>; failures are typed UnprocessableErrors with the reasons mail_send_not_configured, mail_send_login_rejected, mail_send_server_unreachable, mail_send_rejected and mail_send_invalid_message (i18n keys inboundMail.send.errors.*). A missing, disconnected or someone else's personal mailbox answers not found. There is no fallback to the app sender. New exports: sendMailFromAccount, MAIL_SEND_ERRORS, outboundMailMessageSchema, OutboundMailMessage, OutboundMailSent, MailSendNotConfiguredError, MailSendRejectedError. New keys in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: inbound-provider-imap
  type: improvement
  title: IMAP mailboxes send over their own SMTP server
  detail: The connect form gets an optional field "Outgoing server (SMTP)". Left empty, the IMAP host is used, with smtp. in place of a leading imap.. connect-mailbox now also checks the SMTP login on port 465 (implicit TLS, same user and password, same host guard) and answers a failure with its own text ("Receiving works, but sending does not: ..."). The credential document gains smtpHost and smtpPort (default 465). The provider implements send: it sends over SMTP with From = the mailbox address and display name, then stores the same message in the sent folder (special use \Sent, else Sent, Gesendet or INBOX.Sent); a failed copy is only logged. Accounts stored without smtpHost answer mail_send_not_configured. New keys in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: foundation-shared
  type: improvement
  title: sanitizeMailDisplayName is shared
  detail: The display-name sanitizer from channel-email moved to foundation-shared as sanitizeMailDisplayName, so the IMAP sender uses the same rule. No behavior change.
  -->
- c22ca75: Follow-ups to the system check. ProbeTextKeys is part of the readiness entry, the paid hint names the button, the search probe has its own failure text, and the latest run says why it is empty.
  
  <!-- kumiko-changes
  feature: readiness
  type: improvement
  title: The readiness entry exports ProbeTextKeys
  detail: ProbeTextKeys comes from @cosmicdrift/kumiko-bundled-features/readiness next to ReadinessQueries and ReadinessWrites, so apps can name probe texts without a deep import.
  -->
  
  <!-- kumiko-changes
  feature: readiness
  type: improvement
  title: The paid probe hint names the button
  detail: readiness.probe.paid-not-requested now reads "Only via “Test AI extraction”" (de „Nur über „KI-Auslesen testen““), the label of the button that starts the paid run.
  -->
  
  <!-- kumiko-changes
  feature: readiness
  type: improvement
  title: The search probe fails with its own text
  detail: When the search service throws, the search probe fails with readiness.probe.search.unavailable ("The search service does not answer"). The raw error can name the search host, so it goes only to the server log. New key in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: readiness
  type: improvement
  title: An empty latest run says why it is empty
  detail: The latest results and the run detail show "The check is running. Results appear when it is done." while a run is running and "There is nothing to check for this tenant." when a finished run has no rows the caller may see, and "The run was stopped before it returned results." for an abandoned run. Without a run the old text stays. New keys readiness.screen.latest.running, readiness.screen.latest.nothing-to-check and readiness.screen.latest.abandoned in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: relatedList emptyState takes variants
  detail: EditRelatedListSection.emptyState is a RelatedListEmptyStateSpec. Its optional variants list pairs a FieldCondition on the parent record with a title and description; the first matching variant replaces the default text, the action stays.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: The relatedList empty state follows the parent record
  detail: RelatedListSection evaluates emptyState.variants against the parent record and shows the first matching text. The headless view model translates the variant texts.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: The i18n boot check covers emptyState variants
  detail: Title and description keys of relatedList emptyState variants count as required surface keys, so a missing translation fails the boot check.
  -->
- 05c9bef: Closes gaps in declarative screens. A drawer-hosted actionForm follows its `redirect`, `useQuery({ live: true })` listens on the handler's `liveEntities`, relatedList drawer and writeHandler toolbar actions take `params` from the parent record, a projectionDetail `visibleWhen` can pass the route id to its query, and option tones gain `critical` and `accent`. Custom dashboard panels accept static `params`, and the cap-overview CapCardsPanel uses them to limit its cards via `capKeys`, with a remaining-amount line per card and a link to the full usage screen. The locale packages add the new card strings.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: A drawer-hosted actionForm follows its redirect
  detail: After a successful submit the drawer closes, the host refetches, and a declared redirect then navigates like on the full page, without returnTo. A redirect that points at the screen the drawer sits on (no record id, no tab) does not navigate, so filters and scroll position stay. Behavior change: before, a drawer ignored redirect.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Live queries follow the handler's liveEntities
  detail: useQuery({ live: true }) and InfinityList refetch on signals for the entity in the query name and for every entity the query handler declares in liveEntities, in both the declared and the kebab-case form. The app schema carries them per feature as queryLiveEntities, and a tenant feature toggle strips them with the feature. A query that reads a second entity no longer needs a name under that entity to stay live.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: relatedList drawer and writeHandler toolbar actions take params
  detail: RelatedListToolbarAction kind "drawer" and kind "writeHandler" accept params as a RowFieldExtractor evaluated against the parent record, for example params with map appId to id. A drawer gets the values as prefill, a writeHandler merges them over its static payload with the extracted values winning. Without a parent record the action stays hidden.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: projectionDetail visibleWhen can pass the route id
  detail: A screen-level visibleWhen takes idParam on projectionDetail. The gate then queries with the route id under that key, and boot accepts a visibleWhen query that requires exactly that input. Without idParam the empty-payload rule stays, and idParam on another screen type fails boot. A failing gate query, such as a 403 for a downgraded tenant, shows the fallback or the standard notice instead of the screen.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: Option tones gain critical and accent
  detail: SelectOptionTone is now ok, warn, bad, critical, accent or neutral, for select optionTones, enumOption tones, relatedList rowTone and projectionDetail header.statusTones. critical and accent reuse the StatusBadge colors (status-critical and the primary brand color), neutral stays muted. An informative state such as "Ready" can use accent instead of a custom cell.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: Custom dashboard panels accept static params
  detail: A dashboard panel of kind custom takes params, static values laid over the screen's filterParams for its component. The panel wins when a filter uses the same name. Without params nothing changes.
  -->
  
  <!-- kumiko-changes
  feature: cap-overview
  type: improvement
  title: CapCardsPanel can be limited to specific cap keys via params.capKeys
  detail: A custom dashboard panel with params capKeys as a list of cap ids shows only those cards, in the order of the capsUsage query. Anything other than a list of strings means no limit, and capKeys is not sent to the server. Each limited cap card also shows how much is left (or that nothing is), next to the percent chip, and a limited panel adds a link to the full usage screen.
  -->

## 0.391.1

No changes in this release.

## 0.391.0

### Minor Changes

- c823c6f: Readiness gains live probe runs and a system-check screen. Features register probes with `r.probe`, an admin starts a run, and the screen shows the latest results and the run history. The renderer gains the building blocks the screen needs. The disable-MFA form now confirms success, and the profile can link to account security.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: r.probe registers live readiness probes with a per-probe timeout
  detail: A feature registers a probe with r.probe({ name, scope, cost, area, label, timeoutMs?, targets?, run }). scope "system" probes run only for SystemAdmins, "tenant" probes also for TenantAdmins of that tenant; cost "paid" probes run only when the caller asks for them. targets splits one probe into one result per target, such as one per mailbox. runWithTimeout from the api barrel is the shared timeout runner the readiness checks and probe runs use. A probe's context holds db, registry, obs, tz and services plus the run fields; the run job's dispatch, event emitter and escape-hatch powers stay with the job. The readiness status query still makes no network call.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: The boot validator checks enumOption tones
  detail: A list column with renderer { format: "enumOption", tones } fails boot when a tone is not one of the select-option tones.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: i18nText format, enumOption tones, linkScreenField, live projectionDetail and metric tiles
  detail: FormatSpec gains { format: "i18nText" } for values that are a server-built { i18nKey, i18nParams } or a plain i18n key. enumOption takes tones per option value. ListColumnSpec takes linkScreenField, the row field holding the screen QN the cell links to. ProjectionDetailScreenDefinition takes live and metricsStyle ("band" or "tiles"); MetricSpec takes tone and icon.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Translated text cells, toned status pills, screen links in rows and live detail screens
  detail: An i18nText cell renders the text in the user's language. An enumOption column with tones draws the translated label as a status pill. A column with linkScreenField links the cell to the screen the row names, but only when the user may open that screen. A projectionDetail with live: true refetches the record and its relatedList sections on entity events. With metricsStyle "tiles" its metrics render as the dashboard KPI tiles (StatCard), the icon chip colored by the metric's tone; like on dashboards a value of 0 keeps the neutral tone.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: No repeated screen title on detail screens, header actions as high as the header controls, embedded table description first
  detail: A projectionDetail without a record title no longer repeats the screen title above its sections when the shell header already shows it. Screen actions in the shell header are now as high as the header's own controls (h-8) instead of the toolbar height. An embedded table (one that does not fill the screen height) shows its description above its toolbar, right under the section title.
  -->
  
  <!-- kumiko-changes
  feature: readiness
  type: improvement
  title: Probe runs and the system-check screen
  detail: The new readiness:write:run-probes starts a run as a worker job; includePaid also runs paid probes. A run only writes its own probe-run events, the probes read through adapters and fixtures and never write domain data. New queries return the latest run with its summary, the run history with the starter's name, and one run with its results. Probe texts arrive as { i18nKey, i18nParams }, and failed rows carry the QN of the screen that fixes the problem; the boot validator checks that QN against the feature screens and the generated settings screens. A probe that reports itself skipped shows no duration. createReadinessFeature({ nav: { order?, parent?, workspaces? } }) adds the system-check screen to the nav (workspace apps list the workspaces, a parent's membership does not carry over): start buttons (the paid one only when paid probes exist), the latest results with a fix link on failed rows, and the history that opens each run. Standard probes cover database, cache, search, mail sending, file storage, inbound mailboxes and the PDF service.
  migration: New table read_readiness_probe_runs. Apps that mount readiness run `kumiko schema generate` and apply the migration before deploying. Without a nav option the screen stays dormant; pass createReadinessFeature({ nav: {} }) or a parent nav QN to show it.
  -->
  
  <!-- kumiko-changes
  feature: audit
  type: improvement
  title: The audit log leaves readiness probe runs to SystemAdmins
  detail: A probe run's events carry system-probe and personal-mailbox results. audit:query:list and audit:query:details now leave the probe-run stream out for every caller below SystemAdmin, also when the caller filters by that aggregate type.
  -->
  
  <!-- kumiko-changes
  feature: mail-foundation
  type: improvement
  title: Mail-sending probe
  detail: mail-foundation registers a probe that sends a short test mail through the tenant's mail transport to the user who started the check. The address is not stored in the result. A failed row names the reason (server not found, settings incomplete, mail not accepted) and links to the email sending settings; the raw error stays in the server log.
  -->
  
  <!-- kumiko-changes
  feature: file-foundation
  type: improvement
  title: File-storage probe
  detail: file-foundation registers a probe that writes, reads and deletes a probe object in the configured storage provider.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: Inbound-mailbox probes
  detail: inbound-mail-foundation registers a probe with one result per configured mailbox. A personal mailbox is probed only when its owner starts the run, and only its owner sees the result.
  -->
  
  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: improvement
  title: PDF-service probe
  detail: renderer-puppeteer-client registers a probe that calls the PDF service health check. probePuppeteerService and PuppeteerStatus are exported for it.
  -->
  
  <!-- kumiko-changes
  feature: auth-mfa
  type: fix
  title: The disable-MFA form confirms success
  detail: After a successful disable the auth-mfa-disable screen shows "Two-factor authentication is now turned off." and clears the spent code. Before, the form looked unchanged. New key mfa.disable.done in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: user-profile
  type: improvement
  title: The profile can link to account security
  detail: createUserProfileFeature({ linkAccountSecurity: true }) adds a header action that opens the account-security screen, which offers MFA enable or disable by the user's status. It requires the account-security feature; the default stays off. New key profile.mfa.open in all locale packages.
  -->
- 6629d51: In an actionForm, a row with `default: true` in an `optionsQuery` result seeds an empty select field like a prefill.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: actionForm optionsQuery selects seed the row marked default
  detail: A row of an optionsQuery result can carry default: true. In an actionForm the first such row fills an empty field as a baseline value, like a prefill, so the form stays unchanged and leaving it asks nothing; set submitPrefilled to submit the suggestion unchanged. When a sibling field changes the payload and the old value drops out of the new rows, the new default replaces it as a normal change. configEdit never pre-selects, and a set value is never replaced.
  -->

## 0.390.1

### Patch Changes

- 8297c01: `schema apply` in the production image heals the framework tables in the runtime's row-level security mode, plus follow-ups from the 0.390 bump: rebuild timestamp drift, scoped live check in `kumiko check`, codemod and upgrade fixes, zod and mailparser security ranges.
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: schema apply in the production image uses the runtime's row-level security mode
  detail: The app image ships only kumiko/migrations, not kumiko/schema.ts. Without the schema file `schema apply` ran with row-level security "off", so kumiko_events, kumiko_snapshots and kumiko_archived_streams were not healed and the boot of an app in "on" mode (the default) failed with "framework tables without it". Without a schema file apply now uses the same default as runProdApp. RunSchemaCliOptions takes an optional rowLevelSecurity, which wins over the schema file; the scaffolded bin/kumiko.ts passes appConfig.rowLevelSecurity, like bin/main.ts does for runProdApp. Apps that do not set rowLevelSecurity need no change. An app that sets rowLevelSecurity "off" and keeps a hand-written bin/kumiko.ts must pass rowLevelSecurity: "off" to runSchemaCli, otherwise apply enables row-level security on the framework tables and the app's "off" boot check fails.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Projection rebuilds no longer report drift on timestamptz columns
  detail: Event payloads keep the microseconds of an instant, the live write stores milliseconds. A rebuild bound the payload's ISO string unchanged and wrote a different value, which the shadow diff reported as column drift. ISO instant strings bound to a timestamptz column are now truncated to milliseconds like Temporal.Instant values.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: The live row-level security check of `kumiko check` covers only the app's own tables
  detail: `schema validate` (the boot step of `kumiko check`) checks the live database when DATABASE_URL is set. On a dev database several apps share it failed on the other apps' tables. It now checks the tables kumiko/schema.ts declares plus the framework tables; tables no feature declares any more are still reported by the boot check, which runs against the app's own database. An unreachable database still fails the check.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: kumiko-upgrade runs the codemods of its own feature-ast install
  detail: The kumiko-upgrade bins of kumiko-cli and kumiko-dev-server now look for the codemod scripts from their own package first, so a feature-ast copy hoisted above the app (for example in a workspace parent) can no longer supply codemods of another version. runUpgradeCli takes an optional codemodResolveFrom for that; without it the search still starts at the repo root.
  -->
  
  <!-- kumiko-changes
  feature: feature-ast
  type: fix
  title: Codemods skip gitignored files, ctx-namespaces finds structural helpers across files
  detail: collectSourceFiles, used by the codemods, leaves out files the repository's .gitignore excludes, such as generated output and local worktrees. The ctx-namespaces codemod loads all files of a tsconfig project before rewriting, so a helper with a structural `{ query }` context type is migrated even when its handler caller sits in a file processed later.
  -->
  
  <!-- kumiko-changes
  feature: inbound-provider-imap
  type: fix
  title: mailparser moved to a version without known nodemailer advisories
  detail: mailparser moves to ^3.12.4, which pins nodemailer 10.2.1, so apps no longer get nodemailer 10.0.13 through it.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: zod range moved to ^4.6.7
  detail: All framework packages and the scaffold template require zod ^4.6.7, which fixes GHSA-MRHX-C7XC-M3W5.
  -->

## 0.390.0

### Minor Changes

- 5d7dfe1: HandlerContext drops the boot wiring: services, lifecycle and tenants replace the flat members, and hooks receive the HandlerContext.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: HandlerContext without wiring, hooks receive the HandlerContext
  codemod: scripts/codemod/ctx-namespaces.ts
  detail: HandlerContext has 19 members and no longer carries the AppContext wiring. ctx.services holds redis, cacheSync, jobRunner, searchAdapter, entityCache, secrets, kms, files, derivatives, configResolver, configEncryption, rateLimit, effectiveFeatures and masterKeyProvider; every key of an app's extraContext that the framework does not know now lives in ctx.services.extensions (it used to sit flat on the context through a spread, invisible to tsc). ctx.lifecycle holds afterCommit and afterRollback (replacing scheduleAfterCommit and scheduleAfterRollback), signal and runPreSave. ctx.tenants holds config (replacing configFor) and writeTarget (replacing forTenant). ctx.obs gains meter, and the flat log, tracer, _tenantId, systemUser and triggeredBy are gone; read ctx.user.tenantId and ctx.obs.log. JobContext no longer extends the shared wiring fields; it gets services and lifecycle.signal and keeps systemUser, triggeredBy and its job fields. All hooks (preSave, postSave, postSaveBatch, preDelete, postDelete, postDeleteBatch, preQuery, postQuery) and the system hook definitions receive the HandlerContext instead of the AppContext, and the batch hooks run on a real handler context built per flush. AppContext stays the flat boot wiring and declares services as never, so a handler or job context can no longer be passed to a function that takes an AppContext. The context of beforeTransaction no longer exposes ctx.systemDb.outsideTransaction, which was a hole next to the denied ctx.db.outsideTransaction. The member-resolution and pre-transaction contexts also drop the notify factories from ctx.services, and member resolution drops _fileProviderResolver, so neither can rebuild the denied notify or file storage. Helpers that took a structural context with an optional flat member read undefined once a handler context stopped carrying it; their shapes now make that a type error: requireSecretsContext, FileProviderContext (createFileProviderForTenant) and MailTransportContext (createTransportForTenant) take a required secrets key (handlers pass { secrets: ctx.services.secrets, user: ctx.user }), and CreateFileRefContext/UploadFileBytesContext read services.files, so a handler or job context passes straight in. bridgeStub accepts a services option.
  migration: |
    Run kumiko-upgrade --apply; it runs the ctx-namespaces codemod. It rewrites ctx.redis, cacheSync, jobRunner, searchAdapter, entityCache, secrets, kms, files, derivatives, configResolver, effectiveFeatures and the other service members to ctx.services.*, scheduleAfterCommit and scheduleAfterRollback to ctx.lifecycle.afterCommit and afterRollback, signal to ctx.lifecycle.signal, configFor and forTenant to ctx.tenants.config and writeTarget, and hook parameters annotated AppContext to HandlerContext, including context.log to context.obs.log in the hook body. Keys of your extraContext that you read through a cast move to ctx.services.extensions. Listed for manual review: ctx.systemUser, ctx.triggeredBy and ctx._tenantId on a HandlerContext (read ctx.user), a handler or job context passed to a function that takes an AppContext (narrow that parameter to the members it reads), spread literals next to moved members, and a handler or job context passed to a parameter whose structural type reads a moved member (it would read undefined without a type error). Hand-built test contexts take services, lifecycle and tenants from bridgeStub({ services }).
  -->
- a01d30a: HandlerContext and JobContext group their members into namespaces: db.outsideTransaction, events, dispatch, auth and obs.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: HandlerContext and JobContext use namespaces instead of flat members
  codemod: scripts/codemod/ctx-namespaces.ts
  detail: The roughly 40 flat members of HandlerContext are grouped by purpose, with no deprecated aliases. ctx.db.outsideTransaction replaces ctx.dbOutsideTransaction and ctx.outsideTransaction (the property is non-enumerable and sits on the same db object, so TenantDb identity stays intact; it is undefined in the member-resolution and before-transaction phases and in platform-metering tenant mode). ctx.events holds append, unsafeAppend, tryAppend, fetchForWriting, load, archive, restore, isArchived, snapshot and loadWithSnapshot. ctx.dispatch holds query, queryAs, write, writeAs, queryAsMember and queryProjection. ctx.auth holds resolveClaims and resolveActiveMembership. ctx.obs holds log, tracer, metrics and metricsFor, and ctx.obs.log is now always a Logger. JobContext gets the subsets events.append, dispatch.write/writeAs/queryAs/queryAsMember and obs.log/metricsFor. reserveBeforeTransaction and beforeTransaction receive the new ReservationContext and BeforeTransactionContext types, so the surfaces they deny no longer exist on the type. The deprecated _configAccessorFactory alias is removed; use configAccessorFactory. The cap-counter resolvers and the template-resolver PrepareContext now take ReservationContext instead of HandlerContext (type-level break for callers passing a full HandlerContext-typed value to a narrower position, and for wrappers declaring the old type). attachOutsideTransaction(db, outsideDb) from @cosmicdrift/kumiko-framework/engine gives hand-built contexts a db.outsideTransaction; it mutates the passed db with a non-enumerable property (Object.defineProperty) and returns the same object. bridgeStub now accepts log and dispatch options. AppContext stays flat, and the context handed to postSave, preDelete, postDelete and postQuery hooks still reads context.log; a separate hook context follows in a later release.
  migration: |
    Run kumiko-upgrade --apply; it runs the ctx-namespaces codemod. It rewrites ctx.dbOutsideTransaction and ctx.outsideTransaction to ctx.db.outsideTransaction, ctx.appendEvent/unsafeAppendEvent/tryAppendEvent/fetchForWriting/loadAggregate/archiveStream/restoreStream/isStreamArchived/snapshotAggregate/loadAggregateWithSnapshot to ctx.events.append/unsafeAppend/tryAppend/fetchForWriting/load/archive/restore/isArchived/snapshot/loadWithSnapshot, ctx.query/queryAs/write/writeAs/queryAsMember/queryProjection to ctx.dispatch.*, ctx.resolveAuthClaims/resolveActiveMembership to ctx.auth.resolveClaims/resolveActiveMembership, and ctx.log/tracer/metrics/metricsFor to ctx.obs.*. Object literals typed as HandlerContext or JobContext (test mocks) are nested the same way. Sites the codemod cannot resolve are listed for manual review: spread literals, untyped receivers, and AppContext reads such as context.log in hooks, which stay as they are. Manual pattern { db: someDb, dbOutsideTransaction: x } becomes db: attachOutsideTransaction(someDb, x). Spread calls such as ...bridgeStub() next to moved members are reworked by hand; pass log/dispatch as bridgeStub options. Rename _configAccessorFactory to configAccessorFactory where you set it on an AppContext.
  -->
- be576a7: Jobs append their own events with `ctx.events.append`.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Jobs append their own events with ctx.events.append
  detail: Jobs no longer need escapeHatch or unsafeRaw plus the low-level event-store API to append their own feature's events. The same ownership and schema rules apply as in write handlers, and the append runs in its own transaction together with the inline projections.
  migration: |
    JobContext has a new required field events.append. Code that builds a JobContext object by hand (boot seeds, test fixtures) and does not spread bridgeStub() adds an events.append that throws when the code under test never appends. Jobs that appended their own feature's events through escapeHatch or unsafeRaw switch to ctx.events.append({ type, aggregateId, aggregateType, payload }).
  -->
- 5ee91c6: Jobs see whether they can still defer with `ctx.canDefer`.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Jobs see whether they can still defer (ctx.canDefer)
  detail: ctx.canDefer is false when the run is inline or the maxDefers budget is used up, so a handler can write its terminal state instead of deferring into an UnrecoverableError. Behaviour of ctx.defer and the maxDefers failure is unchanged.
  migration: |
    JobContext has a new required field canDefer. Code that builds a JobContext object by hand (boot seeds, test fixtures) adds `canDefer: false` unless the context really supports ctx.defer. Contexts built by the job runner or cast with `as unknown as JobContext` need no change.
  -->

## 0.389.0

### Minor Changes

- 1b3a297: Bun.SQL is the only Postgres driver and the postgres-js fork is gone.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Bun.SQL replaces postgres-js as the only Postgres driver
  detail: createDbConnection opens a Bun.SQL pool and needs Bun 1.4.4 or newer, the first release that drops a cached statement plan after DDL on the same connection. The handle gains listenClient for LISTEN/NOTIFY. Server errors carry the code ERR_POSTGRES_SERVER_ERROR with the SQLSTATE in errno and the constraint name in constraint; connection failures carry ERR_POSTGRES_CONNECTION_CLOSED, ERR_POSTGRES_CONNECTION_REFUSED, ERR_POSTGRES_CONNECTION_TIMEOUT or ERR_POSTGRES_CONNECTION_FAILED. extractPgError, isUniqueViolation, isTableAlreadyExists, constraintOf and the newly exported isUndefinedTable read that shape. The onNotice option is removed, because Bun.SQL has no notice hook and drops server notices. The ssl option takes Bun's tls value (a boolean, "disable", "prefer", "require", "verify-ca", "verify-full" or a TLS options object); ssl true and a TLS object without rejectUnauthorized still verify the server certificate, as they did with postgres-js. DB_PROVIDER is refused at boot for every non-empty value, "postgres" included.
  migration: Read SQLSTATE and constraint only through extractPgError or the is* helpers from @cosmicdrift/kumiko-framework/db; a direct err.code === "23505" check or an err.constraint_name read no longer matches. Replace checks for CONNECTION_CLOSED, CONNECTION_ENDED, CONNECTION_DESTROYED or CONNECT_TIMEOUT with the ERR_POSTGRES_CONNECTION_* codes. Drop onNotice from createDbConnection calls. Remove DB_PROVIDER from every environment. Run on Bun 1.4.4 or newer in engines, CI and images. Code that imports postgres itself must declare its own dependency or move to Bun.SQL, since the framework no longer installs it. Manual migration, there is no codemod.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: breaking
  title: DbConnection, DbTx and PgClient are Bun.SQL types and postgres is no longer a peer dependency
  detail: DbConnection is SQL | RawDbClient, DbTx is TransactionSQL | RawDbClient and PgClient is SQL from the bun module, so the package type-checks against bun-types instead of postgres. The postgres peer dependency is removed.
  migration: Remove postgres from your dependencies unless your own code imports it. Annotations that named postgres.Sql or postgres.TransactionSql for framework handles become SQL and TransactionSQL from "bun", or the DbConnection and DbTx aliases. Manual migration, there is no codemod.
  -->
  
  <!-- kumiko-changes
  feature: testing
  type: breaking
  title: captureClosedConnectionError returns a Bun.SQL error
  detail: The helper opens Bun.SQL pools, so the captured error has the code ERR_POSTGRES_CONNECTION_CLOSED instead of the postgres-js CONNECTION_CLOSED. The client of createTestDb is the connection handle's listenClient, the same Bun.SQL pool as before.
  migration: Tests that compared the captured error's code with CONNECTION_CLOSED compare with ERR_POSTGRES_CONNECTION_CLOSED or call isClosedConnectionError. Manual migration, there is no codemod.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: fix
  title: The renderer-web stylesheet fallback checks tailwindcss in node_modules
  detail: canResolveTailwindStylesheet looks for tailwindcss in the node_modules directories above the stylesheet, as Tailwind does, instead of asking Bun.resolveSync. On Bun 1.4.4 the resolver auto-installs tailwindcss next to a renderer copy in Bun's install cache, so a build without a node_modules tree took the fallback and then failed in Tailwind with "Can't resolve 'tailwindcss'". Such a build skips the fallback stylesheet again.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: Scaffolded apps pin Bun 1.4.4
  detail: The deploy Dockerfile template, the managed public CI workflow and the scaffolded bun-types range move from Bun 1.4.0 to 1.4.4, the minimum the Bun.SQL driver needs. The managed CI workflow updates on the next sync; the deploy Dockerfile is only written at scaffold time.
  migration: Raise BUN_VERSION in an existing deploy Dockerfile to 1.4.4 and bun-types to ^1.4.4 by hand.
  -->
- c16fa0c: `bundledLists` sets one DataTable `table` block for every list screen and relatedList section of the bundled features.
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: bundledLists sets one table block for every bundled list
  detail: composeFeatures takes bundledLists with a table block and an optional pinFirstColumn flag. The block is mixed into every entityList, projectionList and relatedList section of the bundled features, the foundation features user and tenant as well as the features an app mounts from @cosmicdrift/kumiko-bundled-features, before the boot validator runs. A key the screen sets itself wins, export is left out on relatedList sections, and pinFirstColumn pins the first visible column left where no column is pinned yet. grouping and totals are rejected in the shared block. App screens stay untouched. Features opt in with the new registrar method r.adoptsBundledLists(), which every bundled feature with lists calls and which feature packages such as Enterprise can call for their own lists; app features never do. No migration for apps. The option lives in AppConfig.bundledLists for the managed kumiko/schema.ts and in the run options of runProdApp, runDevApp and runWorkerApp, so kumiko check and the running app see the same screens.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: validateBundledListsOptions and the BundledListsOptions type
  detail: BundledListsOptions is exported from the types package and the engine barrel. validateBundledListsOptions rejects unknown keys, grouping, totals and pinFirstColumn without table.pinning with a message that names the key, and checks the remaining keys like a screen's own table block.
  -->
  
  <!-- kumiko-changes
  feature: managed-pages
  type: improvement
  title: MANAGED_PAGES_FEATURE names the feature
  detail: The barrel exports the MANAGED_PAGES_FEATURE constant so other code can refer to the feature name without a string literal.
  -->
  
  <!-- kumiko-changes
  feature: user-data-rights
  type: improvement
  title: USER_DATA_RIGHTS_FEATURE is exported from the barrel
  detail: The feature name constant that lived in web/constants.ts is now part of the public barrel.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: r.adoptsBundledLists() marks features that take the bundledLists block
  detail: The registrar method r.adoptsBundledLists() marks a feature whose list screens take the app-wide bundledLists block; the flag appears as FeatureDefinition.adoptsBundledLists and in feature-manifest.json, and the feature-ast parser knows the call as an opaque singleton pattern.
  -->
- ac00e8a: List screens get a `table` block: remembered filter, search and sort per user, a reset-all button, a column picker with reordering, and a comfortable or compact row density.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: table block on entityList, projectionList and relatedList
  detail: The new optional table block (rememberState, resetAll, columnPicker, density with default and userChoice) is validated at boot; unknown keys, hidden columns without columnPicker and invalid density values are rejected. Columns accept hidden: true. Remembered state lives in sessionStorage per tenant and user and is cleared on logout or identity change.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: DataTable view menu, remembered list state and compact density
  detail: Lists with a table block show a view menu (columns, density, reset view) and a reset-all button. Remembered query parameters are copied into the URL once; links with explicit parameters win. Compact density uses 32px rows with 4px cell padding. New keys kumiko.list.reset-all and kumiko.list.view.* in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: auth-email-password
  type: improvement
  title: CurrentUser carries tenantId, logout clears remembered list state
  detail: The session CurrentUser has an optional tenantId used to scope remembered list state; logout removes all kumiko.list.* storage entries.
  -->
- 7ca1a98: The list `table` block gets `pinning`, `resizing` and `keyboardNavigation`, and columns get `pinned`, `width` and `minWidth`. This release carries the types, the boot validation, the remembered view state and the texts.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: table.pinning, table.resizing and table.keyboardNavigation, column pinned, width and minWidth
  detail: The boot validator rejects pinned without table.pinning, a pinned value other than left or right, width or minWidth without table.resizing, values that are not finite numbers above 0, and a minWidth above the width.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: remembered column pins and widths in the list view state
  detail: useListTable passes pins, widths, minWidths and keyboardNavigation to the DataTable view options. Pins and widths live in the list-state store next to columns and density; a saved pin set replaces the schema pins, so a user can release a pinned column. New keys kumiko.list.view.pinning, kumiko.list.view.pin-left, kumiko.list.view.pin-right and kumiko.list.column.resize in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: DataTable resize grip, pinned focus ring and bounded widths
  detail: Column widths stay between minWidth and 2000 px, also when read back from the session. The resize grip shows on header hover and focus and carries aria-valuenow, aria-valuemin and aria-valuemax. Pinned and actions cells repeat the keyboard focus ring, and a pressed pin button is highlighted.
  -->
- 95b16ff: Lists group on the server with `table.grouping`, show a footer row with `table.totals` and filter number fields with a from/to range facet.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Money list aggregates answer one value per currency
  detail: A sum, avg, min or max measure over a money field in a list aggregate now answers [{ currency, value }] with value in minor units, one entry per currency in the matching rows, and never adds amounts of different currencies. Before, it answered one plain number over all currencies.
  migration: code reading measures of a money field from a list aggregate answer (executor.aggregate, answerListAggregate or the list query with aggregate) reads an array of { currency, value } instead of a number; take the entry of the wanted currency, value stays in minor units
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: table.grouping, table.totals and range facets validated at boot
  detail: The table block takes grouping ({ field, label?, labels?, collapsedWhen?, userChoice?, fields? }) and totals ([{ field, kind }]). The boot validator checks the fields against the entity or the columns, rejects measures a field type cannot carry and requires the list query to accept aggregate (entityListSchema does; hand-written queries answer it with answerListAggregate). facets.<field>.display "range" needs a filterable number, decimal, money or bigInt field.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Server-side groups, totals row and number range facet in the DataTable
  detail: With table.grouping the groups load via one aggregate query; each open group near the viewport loads its rows with the list query plus a group filter, page by page with "Load more", at most four groups at once, a collapsed group sends no query. Headers show the server count and measures, the global pager gives way in both pagination modes, and the view menu offers "Group by" with userChoice. table.totals renders a live footer row over the filters and search. A range facet shows from/to inputs, keeps <screenId>.f.<field>.min/.max in the URL and sends gte/lte filters, money in minor units. Infinite lists now also start over when a facet changes. New keys kumiko.list.group.*, kumiko.list.measure.*, kumiko.list.totals.label, kumiko.list.range.* and kumiko.list.notice.* in all locale packages.
  -->
- 1b8c7ba: Lists get `bulkActions`: row checkboxes, a selection bar and a run that calls a writeHandler row action once per selected row.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: bulkActions on entityList, projectionList and relatedList
  detail: Each entry is { id, rowAction, confirm? } and points at a writeHandler entry of the same screen's rowActions. The boot validator rejects unknown keys, a non-kebab or duplicate id, an unknown rowAction and a rowAction of kind clientAction, navigate or drawer.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: DataTable row selection and bulk run
  detail: With bulkActions the table gets a checkbox column, a header checkbox for the loaded rows (at most 100), a checkbox per card and a bar with "n selected" and the actions. A run sends one /api/write per row, at most 4 at a time; rows hidden by the row action's visible are skipped. Cancel stops new writes. A banner shows succeeded, failed, skipped and not run; failed and not-run rows stay selected and the list reloads. With table.keyboardNavigation, Space toggles the focused row. New keys kumiko.list.bulk.* in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: entityList writeHandler row actions keep display
  detail: entityList built its writeHandler row actions inline and dropped display; it now uses the same builder as projection and related lists.
  -->
- 7b3c3c0: Lists with `table.export` get an Export button that downloads the filtered list as an XLSX file.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: XLSX export for entityList and projectionList via table.export
  detail: The new table.export block ({ xlsx: true, maxRows? }) is validated at boot and is only accepted on entityList and projectionList. POST /api/export/xlsx runs the list query again with the caller's session, pages through the whole filtered list and answers 413 above maxRows (default 10000, hard cap 100000). Encrypted, sensitive, write-only and unreadable fields and virtual columns are left out of the sheet. Reference columns export the label of the target (joined with commas for multiple references), not the id. Timestamp cells use the browser time zone sent with the request, else the profile zone, else UTC. Personal access tokens are rejected. A projectionList query must honor offset or return nextCursor. Adds the write-excel-file dependency.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Export button in the DataTable toolbar
  detail: Lists with table.export show an Export button next to the view menu. It exports the current search, sort and facets with the visible columns in their order and shows a hint when the list exceeds the row limit. New keys kumiko.list.export, kumiko.list.export-busy, kumiko.list.export-too-many and kumiko.list.export-failed in all locale packages.
  -->
- 641f268: FeatureRegistrar types moved to @cosmicdrift/kumiko-types/feature-registrar
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: FeatureRegistrar types moved to @cosmicdrift/kumiko-types/feature-registrar
  migration: |
    Import FeatureRegistrar, HookDefinition, EntityObjectDefinition and RequiresApi from @cosmicdrift/kumiko-types/feature-registrar or from the engine barrel of @cosmicdrift/kumiko-framework; @cosmicdrift/kumiko-types/feature no longer exports them.
  -->
- ffbb25e: Lists put every primary toolbar action into the page header, and file lists can open the first PDF preview by default.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: All primary toolbar actions move into the list page header
  detail: Previously at most one primary toolbar action was promoted, and only when the list had no create button. Now every primary action without a confirm dialog sits in the page header, left of the create button (which stays rightmost), in declaration order. Promoted actions no longer appear in the list toolbar. On phones they become entries of the header overflow menu when a create button is present, so the create button keeps its place.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: renderer { format: "file", previewOpenByDefault: true } opens the first PDF preview
  detail: FileValueList takes a previewOpenByDefault prop, set declaratively through the file renderer spec, so the inline preview of the first file starts open. The preview is only mounted for PDFs. Without the option the toggle behaves as before.
  -->
- ad0c891: Related lists and expandable rows group through `table.grouping` on the server path; the client-side `groupBy` is gone.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: relatedList groupBy replaced by table.grouping
  detail: The groupBy key on a relatedList section and an entityList expandableRow is removed together with the RelatedListGroupBy type. Both group through table.grouping ({ field, label?, labels?, collapsedWhen? }): groups, counts and header measures come from one aggregate query over all matching rows instead of the loaded page, and each open group loads its own rows. An expandableRow takes only table.grouping with a fixed field; userChoice, fields and every other table option stay boot errors there. The boot validator reports a leftover groupBy with a pointer to table.grouping. ExpandableRowGrouping is the new type of an expandableRow's grouping.
  migration: move groupBy { field, collapsedWhen, label, labels } to table: { grouping: { field, collapsedWhen, label, labels } }; the bound query must accept aggregate (entityListSchema does, a hand-written query answers it with answerListAggregate). dateField and the {lastDate} placeholder have no replacement on an expandableRow, where totals stay off; on a relatedList a max measure in table.totals shows the latest date. Every group now gets a header: a group without label or labels entry shows its value instead of rendering headerless.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: DataTable rowGrouping removed
  detail: The client-side rowGrouping prop and the DataTableRowGrouping type are removed from the DataTable contract; grouping runs only through serverGroups. A custom DataTable primitive drops its rowGrouping handling.
  migration: delete rowGrouping from custom DataTable primitives and their callers; group lists through table.grouping on the screen
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Totals row keeps its leading cells pinned
  detail: With pinned columns, the empty totals cells under the checkbox and expand columns stick to the left like the cells above them, and the cell under the actions column sticks to the right with the same background.
  -->
- 947470b: `ctx.loadAggregate(id, { atVersion })` reads only the event at that stream version, upcast and scoped to the tenant like the full load. The workflow runner uses it to follow a trigger or awaited event reference, so a resume no longer loads the whole stream of the referenced aggregate.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: ctx.loadAggregate can read a single event by version
  detail: The new atVersion option returns the event at that version of the stream (or nothing), with upcasting and the tenant filter. It cannot be combined with asOf. Workflow resume uses it for event references.
  -->
- a407a3c: `BootOptionName` shrinks to the options a stack actually requires: `mail`, `kmsMode`, `fileStorage`, `billing`, `featureToggles` and `rateLimit`.
  
  <!-- kumiko-changes
  feature: server-runtime
  type: breaking
  title: BootOptionName drops demoMode, seeds and signals
  detail: No stack declared them in bootRequires, so their boot checks never ran. A name returns together with its check and a test once a stack needs it.
  migration: no known callers; remove "demoMode", "seeds" and "signals" from bootRequires options
  -->
- 8628ea3: Removes the unused `ProviderPluginContext` type and its `providerPluginContextFromHandler` / `providerPluginContextFromJob` helpers.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Unused ProviderPluginContext helpers removed
  detail: ProviderPluginContext, providerPluginContextFromHandler and providerPluginContextFromJob are gone. No plugin type or resolver used them, and the type exposed db handles without an audit user. Provider contexts stay the narrow FileProviderContext, MailTransportContext and InboundMailContext.
  migration: no known callers; use FileProviderContext, MailTransportContext or InboundMailContext
  -->
- 2602c62: A config key's `validate` function can read the cascade of any registered key through `ctx.readCascade(qualifiedKey)`, for example to check the operator default before accepting a tenant value.
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: Config validators can read a key's cascade
  detail: ConfigValidateContext gains readCascade(qualifiedKey), which returns the full cascade of any registered key from the writing tenant and user. Unknown keys throw.
  -->
  
  <!-- kumiko-changes
  feature: config
  type: improvement
  title: config:write:set passes readCascade to validators
  detail: The set handler binds readCascade to the config resolver, the tenant-scoped db and the secrets reader, so validators see the same cascade as the value queries.
  -->
- 8449190: Handlers get `ctx.scheduleAfterRollback(fn)`, the counterpart of `scheduleAfterCommit` for compensating work outside the transaction.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: ctx.scheduleAfterRollback for outside-transaction compensation
  detail: ctx.scheduleAfterRollback(fn) runs fn when the handler transaction does not commit, or when the enclosing savepoint of a nested ctx.write rolls back (after the outer transaction ends). It never runs on commit, errors are logged and do not change the write result, and it is absent outside a transaction scope (perCommand, post-commit, beforeTransaction, member resolution). A failed COMMIT also triggers it, so callbacks must be idempotent and outcome-safe, for example releasing a reservation row that may already be gone.
  -->
- 76c95ae: TenantDb gets `upsert(table, values, { conflictTarget, update? })`, a tenant-safe INSERT ... ON CONFLICT DO UPDATE.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Tenant-safe upsert on ctx.db
  detail: ctx.db.upsert(table, values, { conflictTarget, update? }) requires tenantId in conflictTarget and the target to match a declared unique index or primary key. The update only touches the row of the inserted tenant, update may not set tenantId, and the default update leaves conflict, primary-key and tenant columns alone. Event-fed tables are rejected. Replaces unsafeRaw plus upsertOnConflict for tenant-scoped upserts.
  -->

### Patch Changes

- ed98312: Settle and consume racing on a swept cap reservation book their units again, schema status and baseline use one connection, package lookups no longer auto-install from the registry, and fresh scaffolds build with `bun run build`.
  
  <!-- kumiko-changes
  feature: cap-counter
  type: fix
  title: Settle and consume racing on a swept reservation book their units
  detail: After the sweep deleted a reservation's row, a consume could commit its released tombstone between the two reads of a parallel settle or consume. That call took the released tombstone for a settled one, so settle reported success without booking its amount and a second consume was rejected with cap_reservation_settled. Only a settled tombstone counts as settled now; a released one runs into the insert conflict and the retry books against it.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: schema status and baseline use one connection, bun-types is a peer dependency
  detail: kumiko schema status and baseline open a pool of one connection instead of the default size, because Bun.SQL dials every pool connection on the first query. bun-types is now a peer dependency (^1.4.4) of framework, types, server-runtime and dev-server instead of a regular dependency, so install it next to the framework.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: Package lookups no longer auto-install from the registry
  detail: The new @cosmicdrift/kumiko-server-runtime/resolve-installed-package export looks up node_modules before asking Bun.resolveSync, which installs missing packages from the registry since Bun 1.4.4. The prod build, the dev-server stylesheet lookup and the handbuch commands use it.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: Scaffolded docker-compose raises Postgres max_connections to 300
  detail: Bun.SQL dials its whole pool eagerly, so the default limit of 100 is too tight for an app plus its tests. Existing apps can add command postgres -c max_connections=300 to the postgres service.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: Fresh scaffolds build with bun run build
  detail: create-kumiko-app now writes public/index.html with the /styles.css and /client.js placeholders. Without it kumiko-build stopped with a missing-template error, so the scaffolded Dockerfile could not build either.
  -->

## 0.388.0

### Minor Changes

- e1c01e4: The entity list query takes an optional `aggregate` payload and answers with groups and measures instead of rows, so a table can show group headers and sums over all matching rows rather than one page.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Groups and sums on the entity list query
  detail: Pass aggregate with an optional groupBy field and up to 20 measures (sum, avg, count, min, max per field) to a list query. The answer is groups with key, count, one value per measure in request order and, for a reference groupBy, the label of the referenced row. Screen filters, search, ownership and field read access apply exactly as for rows; a field the caller may not read yields null or no groups, and encrypted, personal or secret fields and unsuitable field types are rejected with a validation error. At most 200 groups are returned, with truncated set beyond that. Custom query handlers use executor.aggregate or answerListAggregate.
  -->
- ee0aaf9: Write handlers can book rateLimit tokens per payload element with `rateLimitCost`.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: rateLimitCost for write handlers
  detail: A write handler can declare `rateLimitCost: (payload) => number`. The result is booked on every declared `rateLimit` bucket instead of the options' static `cost`; values below 1 count as 1 and non-finite values fail the request. The bucket is charged after schema validation, so an invalid payload costs nothing, and a rejected request consumes no tokens. Boot fails when `rateLimitCost` is set without an active `rateLimit`, or on an anonymous or ip-limited handler, because the cost books after the parse and such a handler would lose its pre-parse protection.
  migration: Optional. Bulk handlers should add `rateLimitCost: (p) => p.files.length` so a request with many items is not counted as one.
  -->

### Patch Changes

- 4ce85cd: Bumps the pinned postgres.js fork to 3.4.9-kumiko.2. A connection that dies while a query is still buffered now reconnects right away instead of hanging until `connect_timeout`.
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Reconnect after an outage no longer waits out connect_timeout
  detail: The postgres.js fork left the write buffer of a dead socket in place, so the first query after a database outage queued its startup message behind stale bytes and failed with CONNECT_TIMEOUT after 30 seconds. The fork now resets the buffer when the socket closes, and the next query opens a fresh connection immediately.
  -->
- 32cf2fe: Review fixes: a version conflict reuses the version the event store already reports.
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Version conflicts skip the extra stream-version lookup
  detail: The CRUD executor reports the current version carried by the event store conflict and queries the stream again only when the conflict carries none.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: distinctOn documents that system reference rows compete for newest
  detail: The tenant-scoped read set includes system reference rows, so they take part in the newest-row pick; the docs name the tenantId filter that restricts it to own rows, and tests pin both behaviours. Tests also cover the createDbConnection ssl and onNotice options, the version-conflict race over HTTP, and the advisory-lock waiter probe is scoped to its own lock.
  -->
- da784a9: Review fixes: the upgrade check lists the codemod an improvement runs on apply, the package-merge codemod no longer leaves a target in both dependencies and devDependencies, the notification template meta type carries senderName and replyTo, and comments are corrected or rewrapped.
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Upgrade check names the codemod an improvement runs on apply
  detail: kumiko-upgrade without --apply now prints the codemod of each improvement entry, the same way it prints the migration of breaking entries.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Package-merge codemod keeps one entry per target package
  detail: When the merge target is already listed in dependencies, the old devDependencies entry is dropped; when the old entry is in dependencies and the target only in devDependencies, the target moves to dependencies so the runtime entry wins.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: NotificationTemplateMeta declares senderName and replyTo
  detail: The type now matches the mail template meta schema of the template resolver, which accepts senderName and replyTo.
  -->

## 0.387.0

### Patch Changes

- e4ea6e1: Source comments in types, server-runtime, dev-server, guards, testing, cli, create-kumiko-app and renderer-mail-html are English and no longer carry issue numbers or planning labels.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: English source comments without issue references in the smaller packages
  detail: Comments in types, server-runtime, dev-server, guards, testing, cli, create-kumiko-app and renderer-mail-html are translated to English, and issue numbers and planning labels are removed while the reason they stood for stays. Pure paraphrases of the code are dropped. No code changes; the comment-language baseline is lowered accordingly.
  -->
- c25b54f: Suspect `as` casts in framework, types, bundled-features and renderer replaced by type guards, Zod checks at input boundaries and typing at the source.
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Fewer unchecked casts, runtime checks at boundaries
  detail: bridgeStub needs no casts, the db dialect types drop any (TableColumns is SchemaTable, SelectQuery is unknown). Malformed input now fails at the boundary instead of later, for example a step that returns a non-WriteResult as the pipeline result, a non-numeric Redis counter in the login rate limiter, or r.useExtension, r.referenceData, r.job, r.notification, r.metric, r.secret, r.secretNamespace, r.claimKey and r.relation called without their required argument. Snapshot.generatedAt is optional, so snapshots written without it still load. The cast baseline is rewritten so new suspect casts in a file fail the As-Casts Audit.
  -->

## 0.386.0

### Minor Changes

- f0a9e8f: Handlers and jobs can read across tenants without taking the raw runner.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: ctx.crossTenantReads for handlers with the crossTenantReads grant
  detail: A handler whose `escapeHatch` lists `grants: ["crossTenantReads"]` (or `unsafeRaw`, which implies it) gets `ctx.crossTenantReads` with `selectMany`, `fetchOne` and `count`, unfiltered by tenant and including the events table. Every call is audited as `cross-tenant-read`; `ctx.db.unsafeRaw()` stays denied for the read-only grant, and neither a member-resolution read nor an agent tool call (`dispatchToolCall`, including handlers it reaches through nested `ctx.query`/`ctx.write`) ever receives the surface, so cross-tenant rows cannot reach an LLM context. Jobs use the same grant. The internal `runAsDirectCallEntry` (`/internal/request-context`) now also marks its scope as an agent tool call. Without the grant nothing changes.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: RawDbClient is typed instead of any
  detail: `RawDbClient.unsafe` and `begin` have real signatures, so `db.unsafe(...)` on a `DbConnection` no longer collapses to `any`. A hand-built fake runner needs `unsafe(sql, params?)` returning rows and a `begin` that takes a callback.
  -->

## 0.385.0

### Minor Changes

- 9950dd0: selectMany can read the newest row per key with `distinctOn`, the renderer view-model inputs accept a narrower entity, and two new ratchets cap oversized files and legit casts.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: selectMany distinctOn for newest-row-per-key reads
  detail: SelectOptions.distinctOn takes field names and emits SELECT DISTINCT ON over them, keeping the first row per key by orderBy, so newest-row-per-key reads no longer need unsafeRaw. orderBy has to start with the distinctOn fields in the same order, otherwise selectMany throws; without orderBy it defaults to them ascending. Tenant scoping applies as for every selectMany. Error classification and driver detection drop the branches for the removed Bun.SQL driver (ERR_POSTGRES_* codes, SQLSTATE in errno, millisecond timeouts), which postgres-js never produces.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: SelectOptions.distinctOn and split screen types
  detail: SelectOptions gains the optional distinctOn field. The screen type definitions are split into several files below 2000 lines; the import paths of the exported types are unchanged.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: View-model inputs take only the entity parts they read
  detail: ComputeEditViewModelInput.entity and ComputeListViewModelInput.entity are typed as the Pick of EntityDefinition they actually read, so synthesized entities need no cast. Passing a full EntityDefinition keeps working. Renderer console output goes through one dev-console module.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: File Size guard and per-package ratchet for legit casts
  detail: The File Size guard freezes production files above 2000 lines in `.kumiko-file-size-baseline.json` and fails when a file grows or a new one crosses the limit. The As-Casts Audit additionally caps legit-bridge and legit-boundary casts per package in `.kumiko-cast-legit-baseline.json`. Without the baseline files both only warn.
  migration: Optional. Freeze both with `kumiko-guards guards --write-baseline --guard="File Size"` and `--guard="As-Casts Audit"`.
  -->
  
  <!-- kumiko-changes
  feature: auth-email-password
  type: improvement
  title: Denser common-password list, comments name postgres-js as the only driver
  detail: The common-password list is wrapped densely and split on whitespace; a test pins its 2086 entries. Comments across the bundled features that referred to the removed Bun.SQL driver now name postgres-js. No behavior change.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: Database wait ignores Bun.SQL error codes
  detail: The transient connection error list no longer contains the ERR_POSTGRES_* codes of the removed Bun.SQL driver; postgres-js never raises them.
  -->

## 0.384.0

### Minor Changes

- c28119a: The Unsafe-Append-Event guard is removed because the event store enforces the same rules at runtime.
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Unsafe-Append-Event guard removed
  detail: The event store rejects unregistered event types and validates every payload against its schema at runtime, for appendEvent and unsafeAppendEvent alike, so the static guard is redundant.
  migration: Delete `.kumiko-unsafe-append-event-baseline.json`.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Access-Denied-Test guard replaced by a contract test helper
  detail: Roles are checked centrally before the payload is parsed. The new `expectRoleRestrictedHandlersDenyForeignRole` test helper proves this over HTTP for every role-restricted write and query handler, so the guard that searched for a matching test per handler is removed.
  migration: In an app integration test with setupTestStack and the app features, call `expectRoleRestrictedHandlersDenyForeignRole(stack)` and remove the "Access-Denied-Test Guard" entry from `.kumiko-security-baseline.json`.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: i18n-Keys guard no longer checks locales
  detail: The guard only reports keys that are used without a definition. Locale completeness moved to the boot validator, which sees the real registered translations of every feature.
  migration: Delete `src/i18n-guard-locales.ts` if it exists.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Boot fails when a feature leaves a locale out of some of its translation keys
  detail: Within one feature, every translation key must carry every locale that any key of the same feature carries. A missing locale or an empty string fails boot with one error listing all gaps. Features with a single locale across all keys are unaffected, as are locale packages. A plural object counts as present.
  migration: Add the missing locale to each listed key, or move that locale out of the feature into a locale package.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: PII-Annotations guard removed
  detail: Entity text and longText fields now have to declare their personal stance by type and at boot, so the static guard that searched for unannotated fields is redundant.
  migration: Delete `.kumiko-pii-annotations-baseline.json`.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Entity text fields must declare a personal stance
  detail: FieldsMap requires the personal stance of text and longText fields by type, and boot throws for such a field without one. The name heuristic for PII-typical names stays a warning and only applies to other field types.
  migration: Move raw `{ type: "text" }` and `{ type: "longText" }` entity fields to createTextField / createLongTextField with `personal` ("self", "tenant", "ref", `{ of }`, or false with a `reason`). tsc shows each place.
  -->
- 26cd745: Event-consumer admin screens, readable audit log, device column for sessions, and a privacy center that keeps its deletion section.
  
  <!-- kumiko-changes
  feature: jobs
  type: improvement
  title: Event consumers screen with restart, skip, pause and resume
  detail: SystemAdmins get the screens event-consumers and event-consumer-detail. A stopped consumer offers Restart as the primary action; Skip event (with a confirm dialog), Pause and Resume sit in the overflow menu. The write handlers no longer return the raw error text: unknown consumer, wrong status and nothing to skip have their own codes and messages, anything else is logged on the server and answers a generic message. The shared instance reads "Shared".
  -->
  
  <!-- kumiko-changes
  feature: audit
  type: improvement
  title: Audit log shows a label for every event type and hides technical entries
  detail: Events that are not entity lifecycle events get a readable label (for example "Custom field value set") or are classified technical (delivery attempts, counters, tenant-destruction stages) and hidden by default behind "Show technical entries". New event types of bundled features need an entry in the audit classification; a test over all registered events fails without one. Apps that add their own event types are unaffected, they keep the entity and action wording or the raw type.
  -->
  
  <!-- kumiko-changes
  feature: sessions
  type: improvement
  title: Session lists show the device
  detail: The new subpath @cosmicdrift/kumiko-bundled-features/sessions/web exports sessionsClient(). Apps must add sessionsClient() to their client features to get the device column (browser and OS parsed from the user agent) and the translated "This session" cell; without it the screens fall back to the raw columns. The IP display is unchanged.
  -->
  
  <!-- kumiko-changes
  feature: user-data-rights
  type: fix
  title: Privacy center keeps the deletion section and speaks to the user
  detail: The deletion section only held a conditional field and the request-deletion and cancel-deletion actions, so the renderer dropped it as empty. It now stays whenever it has a visible action. The subtitle is written for the person on the page and names Art. 20, 18 and (when deletion is configured) 17.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Consumer admin functions accept a transaction, notIn where operator
  detail: restartConsumer, skipPoisonEvent, disableConsumer, enableConsumer and the progress readers accept a DbRunner (pool or open transaction); skipPoisonEvent uses its own transaction on a pool and a savepoint inside a handler transaction. skipPoisonEvent takes { requireStatus } and checks it under its row lock; the consumer-skip handler requires "dead". Rejected transitions throw ConsumerTransitionError with rejection "unknown-consumer" or "wrong-status". Where clauses support { notIn: [...] }. Existing callers passing a DbConnection compile unchanged.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: A section with a visible action is not hidden when all its fields are
  detail: Edit and detail sections (entityEdit, projectionDetail, in every app) whose fields are all hidden by visibility conditions now stay on screen while at least one of their actions is visible. Before, such a section vanished together with its action buttons; apps that relied on that to hide a section must hide the action with its own visible condition.
  -->
- 26cd745: Number and decimal formats take minimumFractionDigits and maximumFractionDigits.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Fraction digits for number and decimal formats
  detail: { format: "number" | "decimal", maximumFractionDigits: 4 } renders 0.0004 as 0.0004 (de: 0,0004) instead of 0; minimumFractionDigits pads. Integers 0 to 20 with min not above max; anything else is ignored and the Intl default (3 digits) applies, so existing formats render unchanged.
  -->

## 0.383.1

No changes in this release.

## 0.383.0

### Minor Changes

- 72ac4b1: Error classes that CI guards used to find after the fact are now rejected by types, the boot validator or runtime checks, and the redundant guards are gone.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Placeholder reasons are rejected at boot and at runtime
  detail: An empty, whitespace-only or placeholder reason ("todo", "tbd", "fixme", "legacy", "temp", "wip", "n/a", "none", "xxx", a "todo:" / "fixme:" / "tbd:" prefix, or the migrate-cross-tenant codemod marker) now fails boot for `openToAll.reason` and `escapeHatch.reason`, and throws at call time for `ctx.systemDb.unsafeRaw(reason)`, `acknowledgeCrossTenant(reason)`, `unsafeAllTenants: { reason }` on read steps and `declareEscapeHatch({ reason })`, which is no longer a no-op. The Escape-Hatch-Declared and Open-To-All-Reason guards that checked this statically are removed.
  migration: Replace every placeholder reason with the real justification (why this access is needed and on whose right). Reasons held in imported constants were never judged by the guards and surface now, at boot or on first use.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: loadAllEventsByType and LOAD_ALL_EVENTS_ROW_LIMIT are removed
  detail: loadAllEventsByType buffered every event of an aggregate type in memory and had no production caller. It is removed together with LOAD_ALL_EVENTS_ROW_LIMIT and the Loadall-Events guard.
  migration: Use `await Array.fromAsync(streamAllEventsByType(db, aggregateType))`, or iterate the stream with `for await` to stay memory-bounded. The stream is ordered by event id; loadAllEventsByType ordered by (createdAt, id).
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: metricField is removed from the screen type exports
  detail: metricField is removed from the engine types and ui-types exports because MetricSpec is always an object now.
  migration: Replace `metricField(metric)` with `metric.field`.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: breaking
  title: MetricSpec requires the object form with a label
  detail: The plain string shorthand for projectionDetail `metrics` is removed and `label` (an i18n key) is required, so a metric can no longer render as a bare column name. `metricField()` is removed from the screen exports because it is trivial now; read `metric.field`. The `metrics` entry without label check in the Screen-Conventions guard is dropped, the type enforces it.
  migration: Replace `metrics: ["balance"]` with `metrics: [{ field: "balance", label: "<i18n key>" }]`, reusing the key you had in `fieldLabels` for that column. Replace `metricField(metric)` with `metric.field`.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: breaking
  title: EditFieldsSection is either fields or groups
  detail: EditFieldsSection is now a union of a section with `fields` and a section with `groups`; the groups branch has no `fields` key, so a raw `section.fields` read on a section does not compile and `fields: []` next to `groups` is no longer needed. The boot validator rejects a section that declares both, including `fields: []`. FieldsOrGroupsSection now has optional `fields` and `groups`. Read a section's fields through `sectionFieldSpecs`, which the Section-Fields-Raw guard used to enforce.
  migration: Remove `fields: []` from every section that declares `groups`. Code that reads `section.fields` or `section.groups` of a fields section uses `sectionFieldSpecs(section)` or narrows with `"groups" in section`.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: projectionDetail metrics render their own label
  detail: The metrics band reads the label from each metric entry instead of falling back to `fieldLabels` or the column name.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Nine guards are removed because types and boot checks replace them
  detail: Removed guards and their replacement. Text-Field Personal-Stance: the field factories require `personal`. API-Object-Form: the registrar only has the object form. Table-DDL (warning only), Pre-ES-Patterns and No-Broker-Subscribe (the broker is not exported). Open-To-All-Reason and Escape-Hatch-Declared: boot and runtime reason validation. Loadall-Events: the function is removed. Section-Fields-Raw: EditFieldsSection is a union. Screen-Conventions loses rule R1 (metrics without label), the type enforces it.
  migration: Delete `.kumiko-text-field-stance-baseline.json` and `.kumiko-section-fields-raw-baseline.json`. In `.kumiko-security-baseline.json` the "Escape-Hatch-Declared Guard" and "Open-To-All-Reason Guard" entries in `hardFail` can be removed (they are ignored now). Remove leftover `kumiko-lint-ignore section-fields-raw` markers.
  -->
- 9ef4b39: Support-friendly error UI, client error reporting, a wider leave guard and an IBAN text format: errors show a copyable reference, browser errors reach the server, global navigation asks before dropping unsaved input and `format: "iban"` validates IBANs.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Error reference with copy button in toasts, banners and fallbacks
  detail: A server error that carries a request id now shows "Error ID: <id>" with a copy button in toasts, action error banners, the write-form error section, query error banners and list empty states. The root and screen error fallbacks show a per-error id the same way; the root fallback is styled with inline styles so it stays readable without CSS. New exports ErrorReference, ErrorNotice and errorNoticeOf; New keys kumiko.error.reference, kumiko.error.copyReference and kumiko.error.referenceCopied in all locale packages.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: HeaderActionsBar onError receives an ErrorNotice instead of a string
  detail: The onError prop of HeaderActionsBar is now (notice: ErrorNotice | null) => void, where ErrorNotice is { message, requestId? }, so the error reference can be shown next to the message.
  migration: change the handler to read notice.message (and notice.requestId); a handler that stores the string only needs `notice?.message ?? null`
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: createKumikoApp reports browser errors to POST /api/client-errors
  detail: New option reportClientErrors (default true) sends error-boundary errors (kind render) and window error and unhandledrejection events (kind unhandled) to /api/client-errors with the same errorId the fallback shows, at most 5 reports per page load, identical messages once, path without query and hash, CSRF header when a token is present. A custom onError runs in addition and receives { errorId, screen? } as third argument. Set reportClientErrors: false to opt out.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Global navigation with search params asks before dropping unsaved input
  detail: navigateWithReturnTo, navigateToReturn, the metric tab navigation, closing the editor panel and the target resolver now go through the leave guard, and a requestLeave nested in a confirmed leave no longer asks twice. List filters and sorting stay unguarded because they do not unmount a form. The mail designer registers its draft as unsaved input, so link and browser navigation ask before discarding it.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Text field format "iban"
  detail: createTextField({ format: "iban" }) validates the value server-side (spaces ignored, case-insensitive, country and check digits shape plus mod-97) and reports invalid_format with format iban, which the form maps to errors.validation.invalid_format.iban (texts in en, de, es, fr, it). The value is stored as typed.
  -->
- 9ef4b39: Production logging and shutdown hardening: one process logger with redaction and request context, a client-error endpoint, a required trusted-proxy setting, fatal-error handlers, a graceful server stop, fail-open rate limits during a Redis outage and masked delivery-log addresses.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Process logger, request context fields and redaction
  detail: runProdApp and runWorkerApp install a pino process logger (JSON in production) that every createFallbackLogger without an explicit logger resolves lazily, with a component field. Log lines carry requestId, correlationId, tenantId, userId, feature and handler from the request context; jobs carry tenantId and userId too. Keys such as password, token, secret, apiKey, authorization, cookie, set-cookie, x-api-key, sessionToken, privateKey, credentials, otp, iban and email are redacted to [redacted] up to depth 2. New scrubLogText masks e-mail addresses, JWTs, bearer tokens and Postgres key details in server-fault, job-failure and client-error logs.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: Production logs are plain JSON without the [runProdApp] prefix
  detail: Behavior change for log parsers and alert rules: runProdApp and runWorkerApp now write one JSON object per line from the process logger, without the former "[runProdApp]" text prefix. Match on the component field instead of the prefix.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: POST /api/client-errors collects browser error reports
  detail: Anonymous endpoint with a strict body (errorId, kind, message, stack, screen, path, buildVersion), an 8 KB cap (413), 400 without echo, a per-IP limit of 10 per minute (429, in memory per process when Redis is absent) and 204 on success. The report is logged as a scrubbed warning; the query and hash of the path are cut. With a session the report carries tenantId and userId.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: breaking
  title: runProdApp requires trustedProxyHops in production
  detail: In production runProdApp refuses to boot when neither the trustedProxyHops option, the auth option nor KUMIKO_TRUSTED_PROXY_HOPS is set. An explicit 0 is allowed. create-kumiko-app templates write KUMIKO_TRUSTED_PROXY_HOPS=0 into .env.example.
  migration: set KUMIKO_TRUSTED_PROXY_HOPS=<hops> (0 when the app is exposed directly) or pass trustedProxyHops
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: Fatal-error handlers and graceful server stop
  detail: New installFatalErrorHandlers logs uncaughtException and unhandledRejection, stops the app and exits 1 (hard exit after 10 s). runProdApp and runWorkerApp install it. The HTTP server stop is awaited against a 10 s grace period and then forced before the database closes.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Global IP and http-route limits fail open when Redis is down
  detail: Behavior change: previously a Redis error answered 503 on these two limits. The l1-global-ip and http-route limits let the request through on a Redis error instead of answering 503, count it in kumiko_rate_limit_fail_open_total{label} and log a warning at most every 30 s. The l2-auth-endpoints and login/MFA limits stay fail-closed. A Redis client that is not ready fails fast instead of waiting for the command timeout. Redis connection loss and recovery are logged once per state change.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: globalIpRateLimit and httpRouteRateLimit option onFailClosed is now onFailOpen
  detail: The option is renamed because both limits now let the request through on a Redis error; the callback receives the error and is throttled to one warning per 30 s. Both limits also accept a meter for kumiko_rate_limit_fail_open_total.
  migration: rename onFailClosed to onFailOpen in globalIpRateLimit and httpRouteRateLimit options; the callback no longer implies a 503, the request continues
  -->
  
  <!-- kumiko-changes
  feature: auth-email-password
  type: improvement
  title: Warning when the login limiter falls back to memory in production
  detail: The in-memory login and MFA rate limiter logs one warning per process in production, because its limits are per replica.
  -->
  
  <!-- kumiko-changes
  feature: delivery
  type: fix
  title: delivery-log projection masks the recipient address
  detail: The inline projection now masks the address with the same helper as the write path, also on rebuild, so legacy events with a full address no longer reach the attempt log. Already masked addresses and connection-name channels stay unchanged. Swallowed errors in the snapshot save, queue-depth poll and channel pre-resolve now log a scrubbed warning.
  -->
- 9ef4b39: Database load and pagination hardening plus a job-defer API: server-side statement (60 s) and idle-in-transaction (300 s) timeouts, concurrent session lookups, page-only tenant decryption, keyset scans in reindex, purge and escape-hatch retention, and `ctx.defer(ms)` for jobs.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Prod and worker pools cap statements at 60 s and idle transactions at 300 s
  detail: Behavior change, not an API break. runProdApp and runWorkerApp now open their Postgres pools with statement_timeout 60 s and idle_in_transaction_session_timeout 300 s (handlers that await external calls inside a transaction are not killed early, leaked transactions still end), so one runaway query or a transaction left open no longer holds a connection indefinitely. lock_timeout stays off. Opt out per limit by setting the variable to 0, or change it, with DATABASE_STATEMENT_TIMEOUT_MS, DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS and DATABASE_LOCK_TIMEOUT_MS (for example DATABASE_STATEMENT_TIMEOUT_MS=0); createDbConnection takes statementTimeoutMs, idleInTransactionSessionTimeoutMs and lockTimeoutMs. Migrations, projection and multi-stream rebuilds, search reindex, PII backfills and the CREATE INDEX CONCURRENTLY helpers run without the statement cap (withoutStatementTimeout). A custom long-running statement on the app pool now needs the same helper or a higher limit.
  -->
  
  <!-- kumiko-changes
  feature: sessions
  type: improvement
  title: sessionChecker looks up the user and the membership concurrently
  detail: The session check starts the user lookup together with the session read and the membership lookup together with the last-seen refresh. Results and the fail-open behavior are unchanged; a failed lookup that is not needed no longer raises an unhandled rejection.
  -->
  
  <!-- kumiko-changes
  feature: cap-overview
  type: improvement
  title: Tenant caps list decrypts only the visible page
  detail: Without a search and with a sort other than name, the list loads light tenant rows, pages them, and fetches and decrypts names for the current page only. The default name sort and any search still decrypt every tenant, because tenant names are stored encrypted and cannot be sorted or filtered in SQL. Order, total and rows are unchanged.
  -->
  
  <!-- kumiko-changes
  feature: tenant
  type: improvement
  title: Tenant directory search stops decrypting once the limit is reached
  detail: Tenant names are encrypted and not in the search index, so the directory search decrypts in small batches and stops after limit matches; the 1000-row scan cap stays. With more matches than the limit, the first matches in key order are returned (sorted by label), not the best alphabetical ones. The missing-profile list drops tenants that already have a profile before decrypting.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Reindex and subject purge scan by keyset instead of OFFSET
  detail: reindexEntity and the subject purge page with WHERE id > last ORDER BY id LIMIT n, so rows deleted or changed while the scan runs no longer make it skip later rows.
  -->
  
  <!-- kumiko-changes
  feature: audit
  type: improvement
  title: Escape-hatch retention loads only needed columns, in keyset pages
  detail: The retention run groups tenants only over events older than the shortest cutoff, selects id, aggregateId, createdAt and payload, and prunes per 2000-row keyset page instead of loading every row with its full payload.
  -->
  
  <!-- kumiko-changes
  feature: jobs
  type: breaking
  title: Job handlers can return ctx.defer(ms)
  detail: A handler that returns ctx.defer(ms) moves the queue job to delayed and runs again after ms, like the maxPerTenant defer. It consumes no retry attempt and records no failure, failure log or failed run; the run row of the deferred pass is removed and a tenantVisibleRun record goes back to queued. maxDefers on the job (default 100, shared counter with maxPerTenant defers) bounds the loop; exceeding it fails the run for good (no retry) with a clear message. Inline runs (boot gates) throw. New run-logger hook onJobDeferred, passed through the entrypoint jobs options. JobHandlerFn may now return a JobDeferral. JobContext has a required defer member.
  migration: add defer to every hand-built JobContext object (tests, seeds), e.g. defer: (delayMs) => ({ kind: "job-deferral", delayMs })
  -->

## 0.382.0

No changes in this release.

## 0.381.0

No changes in this release.

## 0.380.0

### Minor Changes

- 07ccdc9: The compile-time write lock on event-fed tables is fail-closed: a write compiles only for a Writable table or a runner that carries the executor capability, so type-erased tables are rejected instead of accepted.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Writes compile only for Writable tables or capable runners
  detail: The negative ExecutorOnly brand is replaced by positive brands. table(), defineUnmanagedTable and deriveEntityTableMeta with source "unmanaged" return Writable tables; buildEntityTable and r.projection tables do not. insertOne, updateMany, deleteMany, the upsert and counter helpers and the TenantDb and db.global() write methods accept a Writable table, or any table when the runner is an ExecutorManagedRunner or ExecutorManagedTenantDb. Widening a table to SchemaTable or EntityTableMeta drops the brand, so erased tables no longer compile. Projection apply functions receive tx as ExecutorManagedRunner. The runtime lock is unchanged.
  migration: Apply functions that annotate `tx` as `DbRunner`, inline or standalone, type it as `ExecutorManagedRunner` (or drop the annotation / annotate the function with SingleStreamApplyFn/MultiStreamApplyFn). Own write helpers take `WritableTable` for direct-write tables, or `ExecutorManagedRunner` / `ExecutorManagedTenantDb` when they write event-fed tables from an apply, rebuild or tenant-destroy context, instead of `SchemaTable`/`EntityTableMeta`. Tables annotated as `SchemaTable` lose the `Writable` brand; drop the annotation or add `& Writable`. Tenant-destroy hooks keep using the db they receive. Affects kumiko-enterprise, solon, money-horse, kumiko-studio, publicstatus.
  -->

## 0.379.0

### Minor Changes

- ba1a10e: File uploads in an actionForm, dropzone display for files fields
  
  <!-- kumiko-changes
  feature: files
  type: improvement
  title: File uploads in an actionForm, dropzone display for files fields
  detail: A files or images field of an actionForm screen uploads through POST /files with actionForm=<screen QN> and fieldName; the file is stored pending under the screen and the route checks the caller's access to the screen and its handler before writing bytes. New helpers resolveActionFormFileField and listActionFormFileFields (framework/files), bindPendingFileRef takes bindTo (the target entity file field, checked against its accept and maxSize) and registry, and ACTION_FORM_PSEUDO_ENTITY moves to framework/ui-types. New display "list" or "dropzone" on FilesFieldDef and ImagesFieldDef; the dropzone works in entityEdit and actionForm and maps server error codes to translated texts. Pending actionForm uploads are removed on user forget and by the forget-subject file purge. New i18n keys kumiko.widget.upload.too-large|invalid-type|max-count|remove, kumiko.field.dropzone.* and errors.file.violatesBindTarget (de, es, fr, it included).
  migration: Custom upload screens such as solon document-upload can become an actionForm with a files field and display "dropzone". The form's handler must bind every file it keeps: load it with loadPendingFileRef (entityName = the screen QN) and move it onto a record with bindPendingFileRef({ bindTo, registry: ctx.registry }); unbound uploads are treated as the uploader's personal data and removed on forget.
  -->
- aa886cc: Fixes for the gaps the attack tests found: form drafts are encrypted per owner, SSE entity signals follow the read access of the connection, late Stripe events no longer roll a subscription back, unknown e-mail addresses count towards the login lockout, and cause details no longer leak when NODE_ENV is missing.
  
  <!-- kumiko-changes
  feature: form-draft
  type: breaking
  title: Form draft content is encrypted per owner
  detail: The jsonb field draft carries personal: { of: "ownerId" }, so its content is stored as ciphertext in events and in read_form_drafts; the delete event no longer keeps the plaintext in previous. The PII event backfill (jsonb-objects-v3) encrypts existing events once on the next boot and rebuilds the table. The column type stays jsonb, so there is no schema change.
  migration: Nothing to run; the backfill happens on boot. Code that reads read_form_drafts.draft with raw SQL must decrypt it (decryptPiiFieldValues) or use the form-draft lookup helpers; the get and list queries are unchanged for clients.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: PII backfill encrypts jsonb object and array fields
  detail: runPiiEventBackfill and backfillEventPiiEncryption now retro-encrypt plaintext jsonb objects and arrays of personal fields and personal jsonb scalars, and createPiiBackfillStateTable bootstraps under an advisory lock so concurrent first boots no longer skip the ALTER. Completed backfill states rerun once because the transform version changed.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: applyEntityEvent is exported from the db barrel, extension sources accept auto-verbs
  detail: applyEntityEvent can be used by extendEntityProjection apply handlers to project stored entity events of a foreign aggregate type. validateProjectionApplyKeys accepts the entity auto-verbs for an extension source that is not a registered entity.
  -->
  
  <!-- kumiko-changes
  feature: document-ingest-foundation
  type: fix
  title: documentExtract projection survives a rebuild
  detail: DOCUMENT_EXTRACT_AGGREGATE_TYPE is exported, and the documentExtract entity projection applies the stored document-extract.* events, so rebuildProjection restores the rows. No event is rewritten.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: SSE entity signals follow the read access of the connection
  detail: A signed-in connection receives an entity signal only when a query reading that entity lets one of its roles in (SseRouteOptions.entityReadAccess, built by collectEntityReadAccess). Entities without a reading query no longer go on the channel. When the reading access depends on a row or owner filter, the signal goes out without id and version, so a client refetches its query instead of learning which row changed.
  migration: Apps that rely on a signal for an entity no query exposes to the user must add a query for that entity with a matching access rule. Custom buildServer callers that build SseRouteOptions themselves must pass entityReadAccess.
  -->
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: fix
  title: Late Stripe events are dropped
  detail: The Stripe plugin passes event.created as providerEventAt, process-event stores it as providerEventAtIso in the subscription event and drops a created, updated or canceled event that is older than one already stored (result stale: true). A canceled subscription is no longer reactivated by a late delivery. Providers without a timestamp are unaffected; no migration.
  -->
  
  <!-- kumiko-changes
  feature: tags
  type: fix
  title: assign-tag and delete-tag no longer race
  detail: Re-assigning a tag after it was deleted no longer restores the assignment of a gone tag. assign-tag and delete-tag now take the same per-tag advisory lock, so a parallel assign can no longer leave an assignment for a deleted tag.
  -->
  
  <!-- kumiko-changes
  feature: auth-email-password
  type: fix
  title: Unknown e-mail addresses count towards the login lockout
  detail: Failed logins for unknown or deleted addresses are counted under a keyed digest of the normalized address (ctx.rateLimitDigest, derived from the JWT secret), so after the threshold they answer account_locked like a registered address and the lock no longer reveals which addresses exist. Without a digest key the old invalid_credentials answer stays.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Cause details only with NODE_ENV development or test
  detail: internal_error responses and write error infos carry the cause snapshot (name, message, stack) only when NODE_ENV is explicitly development or test. A missing or misspelled NODE_ENV no longer exposes stack traces, paths or upstream URLs. kumiko-dev starts the server with NODE_ENV=development when none is set, so local dev keeps the details; a dev script that runs the server directly (bun --watch bin/server.ts) must set NODE_ENV=development itself to see them.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Global IP rate-limit middleware default matches runProdApp
  detail: globalIpRateLimit defaults to 600 requests per 60 seconds (was 1000). DEFAULT_GLOBAL_RATE_LIMIT is exported from the api barrel and shared with server-runtime. authEndpointRateLimit keeps its default of 5 per 60 seconds.
  migration: Apps that use globalIpRateLimit directly and relied on 1000 pass limit explicitly. runProdApp users see no change.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot warning when /metrics is off in production
  detail: buildServer logs a warning in production when no metrics option is set, which happens when PROMETHEUS_METRICS_TOKEN is unset.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Empty list with an active default filter offers "Show all"
  detail: A list that is empty only because its defaultFilters are on says so and offers a Show all button instead of the "create the first one" text. The hard-coded Loading… banners use the kumiko.widget.loading key, so they follow the locale.
  -->
  
  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: Translations for the default-filter empty state
  detail: kumiko.list.empty.defaultFiltered and kumiko.list.empty.showAll are translated in de, es, fr and it.
  -->
  
  <!-- kumiko-changes
  feature: renderer-puppeteer-client
  type: improvement
  title: Retry documentation matches the client
  detail: The client retries 502, 503 and network errors; other 5xx and client timeouts fail at once because the render already ran. The feature description no longer promises a retry for every 5xx.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: Count messages use singular and plural forms
  detail: Nine count messages (template usage, mail preview entries, layout origin and footer, tag delete confirmation, embedded-list paste warnings) now come as .one and .other keys in en, de, es, fr and it, so "1 template" no longer reads "1 templates". Apps that override these keys must rename them to .one and .other.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: runDevApp stop releases the late-bound revokers
  detail: stop() swaps the session and PAT revokers that boot bound onto the auth-mfa, sessions and personal-access-tokens feature instances for inert ones, and those features now accept a new binding on a second boot instead of keeping the first. A later app or test stack on the same feature instances no longer reaches the closed database connection.
  -->
- ba1a10e: Embedded-list footer totals can sum several columns under their own label
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Embedded-list footer totals can sum several columns under their own label
  detail: EmbeddedFieldDef.totals entries are now a column name (as before) or { label, from } with an i18n label and the sub-fields to add up, for example Net { from: ["amount"] }, VAT { from: ["vatAmount"] } and Gross { from: ["amount", "vatAmount"] }. Display only, the server derivation is unchanged. The boot validator rejects an empty from and any from entry that is not a number, money or decimal sub-field. Money sums use the same format as string totals. The ui-walkthrough receive-invoice screen and the embedded recipe now lay out only the Positionen list with a footer of Net, VAT and Gross; the derived head totals are still computed on the server but not laid out, and the list requires at least one line (minItems 1).
  migration: Optional. Replace a totals string list with labelled entries where the footer should show Net, VAT and Gross (solon invoice screens).
  -->
- 7b01b0d: Removes deprecated API: `HandlerContext.outsideTransaction`, `buildEntityTableMeta`, `dsgvoSelfServiceFeatures` with `DsgvoSelfServiceOptions`, and the `observabilityOptions` option of the entrypoint and the prod/worker runners.
  
  <!-- kumiko-changes
  feature: types
  type: breaking
  title: HandlerContext.outsideTransaction removed
  detail: The deprecated outsideTransaction field no longer exists on HandlerContext. ctx.dbOutsideTransaction together with runInOwnTransaction replaces it.
  migration: Replace ctx.outsideTransaction(fn) with runInOwnTransaction(requireOutsideTransactionDb(ctx), fn); both are exported from @cosmicdrift/kumiko-framework/db and fn keeps its (db) => Promise signature.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: buildEntityTableMeta and observabilityOptions removed
  detail: buildEntityTableMeta was a deprecated alias of deriveEntityTableMeta. The deprecated observabilityOptions option of the entrypoint and the prod and worker runners is gone as well, it had no effect since the HTTP route label no longer carries a query string.
  migration: Rename buildEntityTableMeta to deriveEntityTableMeta (same signature). Delete observabilityOptions from the entrypoint and runner options, nothing replaces it.
  -->
  
  <!-- kumiko-changes
  feature: presets
  type: breaking
  title: dsgvoSelfServiceFeatures removed
  detail: The deprecated preset dsgvoSelfServiceFeatures and its DsgvoSelfServiceOptions type are gone. composeGdprStack covers the same features.
  migration: Use composeGdprStack({ selfService: { userDataRights } }), or mount createSessionsFeature, createDataRetentionFeature, createComplianceProfilesFeature, createUserDataRightsFeature and createUserProfileFeature yourself.
  -->
- ece210b: TenantDb gains databaseNow().
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: TenantDb.databaseNow
  detail: TenantDb has a databaseNow() method returning Postgres now(); custom TenantDb implementations must add it.
  migration: Add databaseNow(): Promise<Date> to hand-built TenantDb objects and mocks, returning the Postgres now().
  -->
- 434be6e: Four UI gaps from wave 3: an actionForm can load a singleton row, the dashboard text block gets a role-gated link, seeded PDF templates can carry an i18n title key, and the template overview shows locked tenant overrides.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: actionForm loads a singleton row without a record id
  detail: load.singleton: true on an actionForm sends the load query without idParam and prefills the form from the tenant's single row, like projectionDetail. A route id is never forwarded. The boot validator rejects singleton together with idParam.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Dashboard text block link shown only to given roles
  detail: A text block of kind link ({ text, screen, roles? }) renders a link to a screen and is hidden unless the user holds one of the roles. This only gates the display; the target screen still checks access on the server. The boot validator rejects an unknown target screen and an empty roles list.
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: seedSystemTemplate accepts titleI18nKey
  detail: A seeded template can store an i18n key as its title (titleI18nKey, exclusive with title). The overview returns the key; the document-designer overview, mail editor and PDF link modal translate it and fall back to the raw text. Templates without a key behave as before; no migration.
  -->
  
  <!-- kumiko-changes
  feature: document-designer
  type: improvement
  title: Template overview shows locked tenant overrides
  detail: Rows with lockedOverride and lockedOverrideI18nKey show the status text as a warning badge in the status column. The row action "Remove own version" calls the existing resetToSystem with the new overview field lockedOverrideId (the tenant row; one locale per click). The status shows a short label with the long sentence as tooltip.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: DataTable no longer hides its last column under the sticky actions column
  detail: Header and text cells wrap instead of staying on one line (badges, dates and row actions keep their own nowrap), and a row-action group wraps when the column is narrow. A table whose cells could not shrink scrolled sideways without a visible scrollbar and its last column slid under the sticky actions column. Long values now wrap (up to max-w-xs per column) instead of being cut with an ellipsis.
  -->

## 0.378.0

### Minor Changes

- 2d7ee3e: Document PDFs can embed the images of a record
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Document PDFs embed the images of a record
  detail: A template variable of type images (templateVariable.images()) holds FileRef ids of the record. The new Images block (div[data-images], PDF templates only, rejected for mail kinds) renders them as data-URI images in the real PDF render. Only files of the rendering tenant are read, only png, jpeg, gif and webp, at most 24 images and 20 MB per document; missing, foreign, oversized or non-image ids are dropped silently. Previews and draft PDFs never read files and show one placeholder box per block. An images variable never renders as inline text. i18n keys template-resolver.documentEditor.images, template-resolver.documentEditor.imagesVariable and templateResolver.errors.document.imagesBlockPdfOnly ship in de, es, fr and it.
  migration: Declare a template variable with type `images`, place the Images block, and pass FileRef ids of the record in `variables`. Images resolve only in the real PDF render, previews show placeholders. The ids must come from the record on the server, never from client input: a resolved id is read for the whole tenant without an entity access check.
  -->
- 0250376: actionForm can derive head totals from an embedded list
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: actionForm can derive head totals from an embedded list
  detail: An actionForm screen declares `derive` for head fields: sum, subtract, multiply, percent over other fields, or listSum over one cell of an embedded list with an optional whenEmpty fallback. The renderer recomputes them live and shows them read-only; a listSum without whenEmpty becomes an input while the list is empty. withFormDerivations(schema, screen) recomputes them on the server before validation, so client totals are never trusted; boot fails when the handler schema is not wrapped with the screen's own derive. A field that only feeds a `whenEmpty` fallback is read-only while the lists have rows. New embedded derived op `percent` (from[0] * from[1] / 100).
  migration: Add `derive` to the actionForm screen and wrap the handler schema with `withFormDerivations(schema, screen)`; new embedded derived op `percent`.
  -->

## 0.377.0

### Minor Changes

- 60a29a8: HandlerContext cleanup and persistence docs. `outsideTransaction` is deprecated in favour of `runInOwnTransaction(ctx.dbOutsideTransaction, fn)`. `JobContext._userId` is gone. `ProviderPluginContext` is the public context for provider plugins, built with `providerPluginContextFromHandler` or `providerPluginContextFromJob`; `configAccessorFactory` replaces `_configAccessorFactory`. The migration splitter and the replay parser handle dollar-quoted bodies, RENAME, CREATE TABLE AS and DO blocks. A new guard flags `unsafeAppendEvent` outside migrations, upcasters and tests.
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: outsideTransaction deprecated, ProviderPluginContext added
  detail: HandlerContext.outsideTransaction is marked deprecated; use runInOwnTransaction(ctx.dbOutsideTransaction, fn). ProviderPluginContext is a Pick of HandlerContext for provider plugins. SharedContextFields gains configAccessorFactory; _configAccessorFactory stays as a deprecated alias. dbOutsideTransaction stays TenantDb | undefined (undefined only in the member-resolution and before-transaction denial phases and in platform-metering tenant mode); hasOutsideTransactionDb(ctx) narrows it and requireOutsideTransactionDb(ctx) throws when it is missing.
  migration: Replace ctx.outsideTransaction(fn) with runInOwnTransaction(ctx.dbOutsideTransaction, fn). Read configAccessorFactory instead of _configAccessorFactory.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: breaking
  title: JobContext._userId removed
  detail: The job runner never set JobContext._userId; only user-data-rights read it, falling back to SYSTEM_USER_ID. Hand-built JobContext objects that still set it fail to type-check, and code that read it must use SYSTEM_USER_ID or the job's system user.
  migration: Drop _userId from hand-built JobContext objects (tests, job helpers) and replace reads of ctx._userId with SYSTEM_USER_ID. Known hits - money-horse data-export integration test, offlot-app channel-text generate-texts.job.ts.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Replay parser and migration splitter cover dollar quotes, RENAME, CREATE TABLE AS and DO
  detail: splitSqlStatements keeps dollar-quoted bodies whole and throws on an unterminated one. The replay parser follows RENAME TO, RENAME COLUMN, CREATE TABLE AS and DO blocks; tables with columns it cannot derive are skipped in the schema diff. The Bun.SQL wording in db/query.ts errors and logger names now says postgres-js.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: providerPluginContextFromHandler and providerPluginContextFromJob
  detail: Build a ProviderPluginContext from a HandlerContext or JobContext (jobs use the system user and have no dbOutsideTransaction).
  -->
  
  <!-- kumiko-changes
  feature: waitlist
  type: fix
  title: migrateLegacyWaitlist no longer replays legacy events on rebuild
  detail: The legacy event stream of each migrated row is archived, so a projection rebuild does not resurrect the old id next to the imported entry. The report gains archivedStreams.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: guard-unsafe-append-event
  detail: Flags ctx.unsafeAppendEvent outside migrations/, upcasters/ and tests. Existing call sites are frozen per file in .kumiko-unsafe-append-event-baseline.json and the count may only shrink; repos without the file get a warning only.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: hasOutsideTransactionDb and requireOutsideTransactionDb
  detail: Public helpers in the db barrel. hasOutsideTransactionDb(ctx) narrows ctx.dbOutsideTransaction to TenantDb; requireOutsideTransactionDb(ctx) returns it or throws an InternalError.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Provider contexts expose auditUserId instead of _userId
  detail: FileProviderContext, MailTransportContext, InboundMailContext and the context read by requireSecretsContext name the audit identity auditUserId. The old underscore field is gone.
  migration: Rename _userId to auditUserId wherever a provider context is built by hand (tests, custom resolvers, worker wiring). requireSecretsContext still falls back to ctx.user.id when it is unset.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot always sets configAccessorFactory and overrides an app value
  detail: addConfigAccessorFactory writes configAccessorFactory and the _configAccessorFactory alias from the effective configResolver, replacing any app-supplied factory. The replay parser also rejects DO blocks without a dollar-quoted body and accepts tags like $do1$.
  -->
- fd450c2: Screens out of one mould: actionForm result figures, month field, multi-reference links, mailbox screens, document time zone and smaller list, form and GDPR fixes
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: actionForm shows key figures from the handler's success payload
  detail: ActionFormScreenDefinition gets successFacts, a list of { field, label } entries read from the success payload and shown in the success box next to successLinks while the screen stays put. A number or string is one value, an array a comma-separated list of numbers, strings or { label } objects, a missing field is hidden. Mutually exclusive with redirect (boot validator). Default behaviour is unchanged.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: A text field with format month renders a native month input
  detail: createTextField({ format: "month" }) renders <input type="month"> and carries YYYY-MM. The schema builder validates the pattern server-side (an empty string is accepted for optional fields). New InputProps kind "month" for custom Input primitives.
  migration: Only custom CorePrimitives.Input implementations with an exhaustive switch over kind need a "month" branch; a text fallback is fine.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Array reference fields render as links in lists
  detail: A reference column over an array field renders one link per entry, labelled from the eagerloaded record or the label lookup, like single references. New CellLinkItem and RuntimeCellLinkItems exports from the headless view model; DataTableCell accepts linkItems.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: List empty state, sidebar rail cursor, toolbar description spacing and root form errors
  detail: The empty list no longer shows a second Create button when Create is already in the page header. The sidebar rail edge, which only toggles open and closed, shows a pointer cursor instead of a resize cursor. toolbarDescription always gets the standard bottom spacing, not only with fillsHeight. A server error without a field reference (path "(root)") shows once in the form banner instead of also at a field.
  -->
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: improvement
  title: Document dates can print the time in the tenant time zone
  detail: The date helper accepts time=true ({{date value time=true}}). Instants print date and time in the tenant's configured IANA zone (tenant timezone config, UTC without one), offset date-times keep their own wall clock, date-only values print no time. Without time=true nothing changes. formatDocumentDate takes an optional { time, timeZone } argument, DocumentFormat gets timeZone, and TENANT_TIMEZONE_CONFIG_KEY is exported from framework/pipeline.
  -->
  
  <!-- kumiko-changes
  feature: renderer-mail-html
  type: fix
  title: tenantName in the document context falls back to the tenant record
  detail: Without managed-pages there is no branding title, so tenantName was empty. It now falls back to the decrypted name of the tenant record when the tenant feature is mounted.
  -->
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: seedSystemTemplateBundle sets a title per template
  detail: Bundle locale entries accept an optional title, written to the template resource and exported again by the bundle export. SeedSystemTemplateOptions gets title. The template overview shows it instead of the slug.
  -->
  
  <!-- kumiko-changes
  feature: inbound-mail-foundation
  type: improvement
  title: Declarative mailbox list and rename screens
  detail: The feature registers the projectionList mail-accounts (name, address, provider, status, connected; row actions rename and disconnect) and the actionForm mail-account-edit, both restricted to SystemAdmin and TenantAdmin like the handlers. The list shows several mailboxes per tenant, never a credential. Screens are dormant, so the app places the list in its own nav. MAIL_ACCOUNT_LIST_SCREEN_ID and MAIL_ACCOUNT_EDIT_SCREEN_ID are exported.
  migration: Place mail-accounts in the app nav with r.nav; no other change.
  -->
  
  <!-- kumiko-changes
  feature: crypto-shredding
  type: fix
  title: Forgetting a user also removes their unbound pending uploads
  detail: forget-subject for a user deleted only files bound to a record. Uploads the user made but never attached (file refs without an entity id) stayed behind. They are now removed with their bytes, except refs a record still names in a single-file column.
  -->

### Patch Changes

- c00af64: kumiko-headless moves into kumiko-renderer as `@cosmicdrift/kumiko-renderer/headless` and kumiko-dispatcher-live as `@cosmicdrift/kumiko-renderer/live`. The old packages stay as deprecated re-export shims until the consumer pass of wave 4. The `package-merge` codemod rewrites imports and package.json dependencies for both moves.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: headless and the live dispatcher moved into renderer
  detail: The headless UI logic is exported from @cosmicdrift/kumiko-renderer/headless (with /headless/apex, /headless/dispatcher and /headless/locale-routing), the HTTP dispatcher from @cosmicdrift/kumiko-renderer/live. @cosmicdrift/kumiko-headless and @cosmicdrift/kumiko-dispatcher-live now only re-export these subpaths and are removed after the consumer pass of wave 4.
  migration: Run bun kumiko-upgrade --apply, or bun kumiko codemod package-merge . --write. It rewrites imports of @cosmicdrift/kumiko-headless (and its subpaths) to @cosmicdrift/kumiko-renderer/headless and imports of @cosmicdrift/kumiko-dispatcher-live to @cosmicdrift/kumiko-renderer/live, and replaces both dependencies in package.json with kumiko-renderer.
  codemod: scripts/codemod/package-merge.ts
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: package-merge codemod covers headless and dispatcher-live
  detail: The mapping table of the package-merge codemod gained the headless and dispatcher-live moves into kumiko-renderer.
  codemod: scripts/codemod/package-merge.ts
  -->
  
  <!-- kumiko-changes
  feature: headless
  type: improvement
  title: kumiko-headless is a deprecated shim over kumiko-renderer/headless
  detail: The package only re-exports @cosmicdrift/kumiko-renderer/headless and its subpaths and is removed after the consumer pass of wave 4.
  migration: Import from @cosmicdrift/kumiko-renderer/headless, or run bun kumiko codemod package-merge . --write.
  -->
  
  <!-- kumiko-changes
  feature: dispatcher-live
  type: improvement
  title: kumiko-dispatcher-live is a deprecated shim over kumiko-renderer/live
  detail: The package only re-exports @cosmicdrift/kumiko-renderer/live and is removed after the consumer pass of wave 4.
  migration: Import from @cosmicdrift/kumiko-renderer/live, or run bun kumiko codemod package-merge . --write.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: renderer-boundaries guard scans headless and live for imports only
  detail: The headless and live subtrees of kumiko-renderer must not import react-dom, jsdom or renderer-web; the symbol and JSX rules of the shared layer no longer apply to them. The section-fields-raw scope follows the moved headless sources.
  -->
- c00af64: kumiko-renderer-web moves into kumiko-renderer as `@cosmicdrift/kumiko-renderer/web` (with `/web/styles.css` and `/web/theme-plugin`). The old package stays as a deprecated re-export shim until the consumer pass of wave 4. The `package-merge` codemod rewrites imports, package.json dependencies and, new, CSS `@import`/`@plugin`/`@config` specifiers.
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: renderer-web moved into renderer
  detail: The web bindings are exported from @cosmicdrift/kumiko-renderer/web, the stylesheet from @cosmicdrift/kumiko-renderer/web/styles.css and the Tailwind theme plugin from @cosmicdrift/kumiko-renderer/web/theme-plugin. @cosmicdrift/kumiko-renderer-web now only re-exports these and is removed after the consumer pass of wave 4.
  migration: Run bun kumiko-upgrade --apply, or bun kumiko codemod package-merge . --write. It rewrites imports and CSS @import lines of @cosmicdrift/kumiko-renderer-web (including /styles.css and /theme-plugin) to @cosmicdrift/kumiko-renderer/web and replaces the dependency in package.json with kumiko-renderer.
  codemod: scripts/codemod/package-merge.ts
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: package-merge codemod covers renderer-web and CSS files
  detail: The mapping table of the package-merge codemod gained the renderer-web move into kumiko-renderer/web, and the codemod now also rewrites .css files (@import, @plugin, @config). A @source path into the old package is reported for manual follow-up.
  codemod: scripts/codemod/package-merge.ts
  -->
  
  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: kumiko-renderer-web is a deprecated shim over kumiko-renderer/web
  detail: The package only re-exports @cosmicdrift/kumiko-renderer/web and its theme-plugin, and its styles.css imports the new stylesheet. It is removed after the consumer pass of wave 4.
  migration: Import from @cosmicdrift/kumiko-renderer/web, or run bun kumiko codemod package-merge . --write.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: renderer-boundaries guard leaves the web subtree unscanned
  detail: renderer/src/web may use the DOM and every web dependency; the shared renderer root and headless/live must not import it. The tailwind-scan-surface guard follows the new stylesheet location through package exports and shim imports.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: comment-lang touched mode pairs renames
  detail: The touched mode diffs a moved file against its old path, so moving a file no longer counts every German comment in it as new.
  -->
  
  <!-- kumiko-changes
  feature: cli
  type: fix
  title: project rebuild keeps blind indexes and aborts without crypto, events prune names its aggregate types
  detail: `kumiko project rebuild` now wires the subject KMS and blind-index key from the env like `schema apply` and `ops backfill-pii`, so rebuilding a PII projection no longer nulls its bidx columns. Without the crypto env an app with PII fields aborts the rebuild unless `--allow-plaintext-pii <reason>` is passed. `kumiko events prune` takes the required `--aggregate-types <a,b>` flag; before, it always failed because pruneEvents needs explicit aggregate types.
  -->

## 0.376.0

### Minor Changes

- 05ba6c5: runDevApp and runWorkerApp understand the declarative boot options of runProdApp, and the default mail resolver stops reaching users outside the notifying tenant.
  
  `runDevApp` takes `mail`, `fileStorage`, `kmsMode`, `billing`, `seeds` (shortcuts plus free seeds that get the test stack), `demoMode`, `envSchema` and `featureToggles`; `runWorkerApp` takes `mail`, `fileStorage`, `kmsMode`, `billing`, `featureToggles` and `envSchema` and understands every `KUMIKO_DRY_RUN_ENV` mode. All of them resolve through the same functions as `runProdApp`. `featureToggles: true` mounts feature-toggles and layers the global operator switches over the tier resolver; `composeSaasStack({ featureToggles: true })` expects it. `runProdApp` seeds and `extraContext` factories receive `masterKeyProvider` and `configEncryption`; `appOverrides` overrides tenant-model, branding and seo defaults.
  
  <!-- kumiko-changes
  feature: server-runtime
  type: breaking
  title: effectiveFeatures is gone from runProdApp, runDevApp and runWorkerApp
  detail: The effectiveFeatures option of the boot functions is removed. Global operator switches come from the featureToggles option, tier gating from the tier-engine feature, which the boot functions wire themselves.
  migration: Replace a hand-built effectiveFeatures resolver with featureToggles true (global switches) and mount createTierEngineFeature for tier gating. A custom resolver that did neither has no replacement on the boot functions; wire it through createKumikoServer or setupTestStack in tests. The boot functions now abort when the option is still passed, because an ignored option would drop an operator kill-switch silently; the same goes for a feature-toggles feature in features without the featureToggles option, or with it set (the option mounts the feature).
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: breaking
  title: The default mail resolver only reaches members of the notifying tenant
  detail: The default resolveEmail of the mail boot option returns an address for a notification from a tenant other than the system tenant only if the user is a member of that tenant or holds the SystemAdmin role in the stored user row. Everyone else resolves to null and the mail is skipped. The new option mail.recipientScope takes "membership" (default) or "any", which restores the old behaviour of reaching every user. EmailChannelOptions resolveEmail now receives the tenant database as TenantDb instead of unknown.
  migration: Apps that notify users outside the notifying tenant on purpose, for example merchants reached from a SystemAdmin context, set mail recipientScope to "any" or keep their own resolveEmail. Apps whose notifications go to members of the active tenant need no change. Known consumers on the default: offlot-app (main.ts) reaches merchants and SystemAdmins across tenants and needs recipientScope any; publicstatus (main.ts), show-pony, solon (main.ts) and kumiko-studio (main.ts) take the default, which fits notifications to members of the active tenant. money-horse and phronexsis keep their own resolveEmail. Per-app resolvers that only copied the membership check can be deleted. A custom resolveEmail that cast ctx.db can drop the cast.
  -->
  
  <!-- kumiko-changes
  feature: channel-email
  type: improvement
  title: resolveEmail receives a typed tenant database
  detail: The context of EmailChannelOptions resolveEmail types db as TenantDb, so resolvers read tables without a cast.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: runDevApp and runWorkerApp take the declarative boot options
  detail: mail, fileStorage, kmsMode, billing, seeds, demoMode, envSchema and featureToggles work in runDevApp, and mail, fileStorage, kmsMode, billing, featureToggles and envSchema in runWorkerApp, through the same resolve functions as runProdApp. The worker honours KUMIKO_DRY_RUN_ENV with an env schema. A stack that sets runSingleInstance false only warns when no worker mounts the features.
  migration: RunDevAppOptions.seeds is now `readonly SeedFn[] | RunDevAppSeedsConfig`. Code that spreads `seeds` from an object typed as RunDevAppOptions no longer type-checks; declare that object with `satisfies RunDevAppOptions` so the array type survives, or build the seed list separately. An app that lists createFeatureTogglesFeature() in the features passed to runDevApp or runProdApp removes it there and sets `featureToggles: true`.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: featureToggles, appOverrides and secrets in boot deps
  detail: featureToggles true mounts feature-toggles and layers the global switches over the tier resolver in runProdApp, runDevApp and runWorkerApp. appOverrides sets tenant-model, branding and seo defaults. masterKeyProvider and configEncryption reach extraContext factories, system wiring and seed functions, so an app no longer resolves its KEK a second time.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: Boot errors for removed and half-wired feature toggles
  detail: runProdApp, runDevApp and runWorkerApp abort when the removed effectiveFeatures option is still passed, and when feature-toggles sits in features without the featureToggles option. runWorkerApp now enforces a stack that expects featureToggles, so a worker cannot keep running jobs and event handlers of features an operator switched off.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: Named S3 provider names are validated at boot
  detail: fileStorage.providers refuses the names s3-env, s3 and inmemory, which the bundled providers register, and a name listed twice. A tenant admin can still select any mounted provider through the file-foundation provider config, so name a provider only if every tenant may use its bucket.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: Named S3 providers and a corrected SMTP_HOST description
  detail: fileStorage.providers takes entries with name, envPrefix and lazy, each validated through createS3EnvSchema with its own prefix. The SMTP_HOST description in the env schema of mail smtp-env now says the variable is required.
  -->
  
  <!-- kumiko-changes
  feature: file-provider-s3
  type: improvement
  title: Named S3 provider feature
  detail: createFileProviderS3NamedEnvFeature mounts an additional S3 provider under its own name with an env prefix, next to the default one, so a second bucket needs no hand-written wiring.
  -->
  
  <!-- kumiko-changes
  feature: auth-foundation
  type: improvement
  title: authEnvSchema for auth.admin and auth.mail
  detail: authEnvSchema declares APP_BASE_URL, AUTH_ADMIN_EMAIL and AUTH_ADMIN_PASSWORD with descriptions and the pulumi secret marker; an app spreads its shape into its env schema.
  -->
  
  <!-- kumiko-changes
  feature: user-data-rights
  type: improvement
  title: DELETION_TOKEN_SECRET is part of the env schema
  detail: The feature declares DELETION_TOKEN_SECRET through its env schema, so the dry run and the pulumi inventory list it. Unset, it is derived from JWT_SECRET as before.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: composeSaasStack with stripe warns instead of requiring billing
  detail: A stripe stack without the billing option logs a boot warning instead of aborting, and composeSaasStack takes featureToggles to require that option.
  -->
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: StackBootRequirement severity and the featureToggles option name
  detail: StackBootRequirement takes severity "warn" for requirements that only log, and BootOptionName lists featureToggles.
  -->

## 0.375.0

No changes in this release.

## 0.374.0

### Minor Changes

- 40b8667: actionForm successLinks and resetOnSuccess, field placeholder
  
  An `actionForm` takes `successLinks` (`{ screen, idFrom?, label }[]`, exclusive with `redirect`): after a successful submit the screen stays and shows the success box (`successMessage`, default "Done.") with one link per entry. Targets resolve like `redirect`; the id comes from the handler's success payload, and a link to a record screen without a string id is hidden. `idFrom` is required for a record target (`entityEdit`, `projectionDetail`) and optional for a list, dashboard or form target, which opens without an id; boot rejects a record target without `idFrom`. `resetOnSuccess: true` resets the form to its initial values after a successful submit while the screen stays put. The box disappears with the next edit or submit.
  
  `EditFieldSpec.placeholder` (i18n key, literal as fallback) sets the empty-input hint of single-line text, number and textarea fields on every screen type with edit fields; other field kinds ignore it.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: actionForm successLinks and resetOnSuccess
  detail: successLinks keeps the actionForm open after a successful submit and lists links resolved like redirect; boot rejects it together with redirect, with an unknown target or with a record target without idFrom. resetOnSuccess clears typed values after success. Role projection drops links to screens the role cannot reach.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Success box with links, form reset and field placeholder
  detail: The actionForm success box shows the default text "Done." (kumiko.actionForm.success) next to successMessage links, resetOnSuccess remounts the form with its initial values, and EditFieldSpec.placeholder reaches text, number and textarea inputs.
  -->
- de5d674: clientAction row actions backed by a client registry
  
  A row action with `kind: "clientAction"` runs a function from a client bundle instead of a write handler. The schema carries `action: "<feature>:<kebab>"`; a client feature registers the function under `ClientFeatureDefinition.clientActions` (merged like `columnRenderers`, last wins with a warning). The handler gets the payload (default `{ id: row.id }`, or the `payload` extractor) and returns `{ ok: true }` or `{ ok: false, message }`. Success shows a toast (`successMessage`, default "Done.") and refetches, a failure shows an error toast, and a throw or an unregistered name shows a generic one and logs the name. `confirm`, `confirmLabel`, `style: "danger"`, `visible`, `icon` and `display` work as on a write handler; `redirect` and `rowClick` do not exist. Toolbar actions do not take it. Boot rejects a name that is not `<feature>:<kebab>`.
  
  auth-email-password registers `auth-email-password:request-password-reset` and `auth-email-password:request-email-verification`, both taking `{ email }`.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: clientAction row actions
  detail: RowAction gains kind "clientAction" with a client-registered handler name; boot rejects a name that is not <feature>:<kebab>, and the surface keys include its confirm, confirmLabel and successMessage.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Client action registry for row actions
  detail: ClientActionsProvider, ActionNoticeProvider and runClientAction execute clientAction row actions on list, related list and record actions, with confirm, toast feedback and refetch.
  -->
  
  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: ClientFeatureDefinition.clientActions
  detail: Client features register clientAction handlers; createKumikoApp merges them and shows their outcome as toasts.
  -->
  
  <!-- kumiko-changes
  feature: auth-email-password
  type: improvement
  title: Client actions for password reset and email verification
  detail: emailPasswordClient registers auth-email-password:request-password-reset and auth-email-password:request-email-verification for clientAction row actions.
  -->
- 47e3a05: Dashboard screen panels get a fallback, new static text panel
  
  A dashboard `screen` panel takes `fallback` (same-feature short id or `<feature>:screen:<id>`): when `visibleWhen` is unmet or its gate query fails, that screen is embedded in the panel's place, with the same `label` and `chromeless`. While the gate loads nothing renders. The boot validator requires `visibleWhen` for it, resolves the target like the panel's own screen and rejects a target that has its own `visibleWhen`. Extension-selector owner panels qualify a short `fallback` like `screen`, and a role without access to the fallback screen gets the panel without it.
  
  The new `text` panel (`DashboardTextPanel`) renders static `blocks`: `heading`, `paragraph` (`emphasis` muted or strong), `list`, `code` (verbatim, scrollable) and `hint`. `text` and list items are i18n keys and are checked as required translation keys; `visibleWhen`, `span` and an optional `label` work as on other panels.
  
  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Screen-panel fallback and static text panel
  detail: A dashboard screen panel embeds its fallback screen when visibleWhen is unmet or the gate query fails (nothing while loading). The new text panel renders heading, paragraph, list, code and hint blocks from i18n keys, without markdown or HTML.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot validation for screen-panel fallback and text panels
  detail: DashboardScreenPanel.fallback needs visibleWhen and a registered, embeddable target without its own visibleWhen. DashboardTextPanel (kind "text", exported with DashboardTextBlock) rejects empty blocks and empty lists; its text keys are required translation keys. Extension-selector panels qualify a short fallback ref, and role projection drops a fallback the role cannot reach.
  -->
- 926e08e: Dashboards bound to a record, with header actions, auto refresh and relative times
  
  `DashboardScreenDefinition.record: { param, payloadKey?, query?, titleField? }` ties a dashboard to one record via a URL search param. The id is merged into every panel and `visibleWhen` gate query after `filter`/`timeRange` and before a panel's own `params`; screen-kind panels get none. Without the param the dashboard shows a hint (`kumiko.dashboard.record.missing`) and runs no query. `record.query` loads the record row for the page title (`titleField`), the actions and `refresh.field`.
  
  `actions` puts writeHandler, navigate and clientAction actions in the dashboard header, running on the record row (or `{ id, [payloadKey]: id }` without `record.query`). After a success the record and all panels refetch. The header bar is the shared `HeaderActionsBar` component also used by projectionDetail. Boot rejects actions without `record`, drawer actions, `rowClick` and `redirect`.
  
  `refresh: { seconds } | { field }` polls the record and all panels, never faster than 5 s (`DASHBOARD_MIN_REFRESH_SECONDS`): boot rejects `seconds` below it, a `field` value is clamped at runtime. A running refetch is never stacked and polling stops on unmount.
  
  `valueFormat: { kind: "relativeTime" }` on stat panels and `{ kind: "relativeTime", atMs }` as a text param render epoch ms via `Intl.RelativeTimeFormat` in the user locale ("5 minutes ago", "in 30 seconds") and keep ticking while mounted.
  
  fillAction is only allowed on text, number, decimal and bigInt fields and rejected on password, sensitive and writeOnly ones; an actionForm `load` never fills those fields from the loaded record. The email clientActions answer a 429 with the new `auth.errors.tooManyRequests` instead of the login-specific rate-limit text.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Dashboard record binding, header actions, refresh and relative time
  detail: Dashboards take record, actions and refresh; stat panels and text params gain a relativeTime format; the surface keys include kumiko.dashboard.record.missing.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: DashboardChartPanel.valueFormat only takes the currency format
  detail: DashboardValueFormat is now a union of DashboardCurrencyFormat and DashboardRelativeTimeFormat. Stat panels take both, chart panels only the currency one, and boot rejects relativeTime on a chart.
  migration: A chart panel that declares valueFormat keeps working with { kind: "currency", currency }. Code that types a chart's valueFormat as DashboardValueFormat should use DashboardCurrencyFormat instead; relativeTime on a chart was never meaningful and now fails boot.
  -->
- 1d72366: Derived list searchability, actionForm load, drawer rowClick
  
  A projectionList over an entity-convention list query whose entity has no searchable field derives `searchable: false` (no search box, no whitelist entry needed); declaring `searchable: true` there fails boot. `ActionFormScreenDefinition.load` (`{ query, idParam? }`) seeds the form from a query keyed by the record id; with `load` no URL param, drawer param or handoff value reaches the form. A `drawer` row action takes `rowClick: true` like `navigate` does, in lists and relatedList sections, and counts toward the one-rowClick limit.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Derived list searchability, actionForm load and drawer rowClick
  detail: projectionList searchable is derived false for entity-convention lists without searchable fields (searchable true is rejected at boot), actionForm.load registers a query checked at boot, and a drawer row action may set rowClick, counted with navigate rowClick and rejected on projectionDetail header actions.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: actionForm load states and drawer row click
  detail: An actionForm with load queries by the route, drawer or URL id and shows loading, error, not-found and missing-id states; loaded values count as prefill for submitPrefilled. A row click fires a rowClick drawer action in entityList, projectionList and relatedList.
  -->
- c3df9a2: Field prefix, suffix and fill action
  
  `EditFieldSpec` takes `prefix` and `suffix` (an i18n key with the literal as fallback, or `{ field }` for the live value of another form field) and `fillAction` (`{ label, query, field, params? }`). The affixes render beside single-line text and number inputs. The fill button runs `query` with the form values picked by `params` and writes `result[field]` (string or number) into the field, which makes the form dirty and submits the value even on a `readOnly` field. A failed query or a result of another type shows an error under the field.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot checks for field affixes and fillAction
  detail: Boot fails when a fillAction query is not a registered query handler, or when a { field } affix or a fillAction params source is not a field of the same form.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Input prefix, suffix and fill button
  detail: Text and number inputs show prefix and suffix text, and a fillAction renders a button that fetches a suggestion into the field, also for a readOnly field. The Input primitive takes prefix, suffix and fill; renderer-web draws them beside the input.
  -->
- 8e735ed: progress-list rows take used/limit, an unlimited state and a danger tone
  
  A `progress-list` row may return `used` and `limit` (`number | null`) instead of `value` and `fraction`. The panel shows "used / limit" with the viewer's number format and fills the bar with `used / limit`. `limit: null` shows "used / unlimited" without a bar. The new row field `tone` (`DashboardProgressTone`: `"default" | "danger"`) colors bar and value; used/limit rows turn `danger` automatically once `used >= limit`, and an explicit `tone` wins. `ProgressListRow.fraction` accepts `null` (no bar) and gains `tone`. New translation key `kumiko.dashboard.progress.unlimited` in the defaults and the de, es, fr and it bundles.
  
  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: progress-list rows take used/limit, an unlimited state and a danger tone
  detail: A progress-list row may return used and limit (number or null) instead of value and fraction; limit null shows "used / unlimited" without a bar. Row tone "danger" (automatic once used >= limit in used/limit rows) colors bar and value. ProgressListRow.fraction accepts null and gains tone.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: DashboardProgressTone type and unlimited label key
  detail: New exported type DashboardProgressTone for progress-list row tones. The default translations gain kumiko.dashboard.progress.unlimited.
  -->
- fc221ab: TimeseriesChart shows the y-axis unit once and takes a per-viewport height
  
  `TimeseriesYAxis` gains `unit`: the ready-to-display unit is drawn once above the tick labels (test id `<testId>-y-unit`) while the ticks show only `format(tick)`. `TimeseriesChart` `height` also accepts `{ narrow, wide, narrowBelowPx? }` (default breakpoint 768) and picks the value from the viewport. The new `useIsViewportBelow(breakpointPx)` hook backs this; `useIsNarrowViewport` is now built on it.
  
  `DashboardChartPanel` gains `unit` (i18n key, chart `timeseries` only): the dashboard renders the y axis for it even without `valueFormat`. The boot validator rejects `unit` on other chart kinds, and a `unit` key without a translation fails the required-surface key check like `subtitle`.
  
  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: TimeseriesChart y-axis unit shown once and viewport-dependent height
  detail: TimeseriesYAxis.unit renders the unit once above the y ticks instead of on every tick label. TimeseriesChart height accepts { narrow, wide, narrowBelowPx? } (default 768). New exported hook useIsViewportBelow(breakpointPx).
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Dashboard chart panels take a y-axis unit
  detail: DashboardChartPanel.unit (i18n key) is shown once on the y axis of a timeseries chart, with or without valueFormat. The boot validator rejects unit on other chart kinds; an untranslated unit key fails the required-surface key check.
  -->

## 0.373.0

### Minor Changes

- 6913834: A handler can declare several rate-limit buckets
  
  `rateLimit` accepts a list: `rateLimit: [{ per: "user", limit: 2, windowSeconds: 3600 }, { per: "tenant+handler", limit: 3, windowSeconds: 3600 }]`. Each bucket applies on its own, and the check is all-or-nothing: if one bucket is exhausted the call answers 429 for that bucket and none of them is charged. `additionalRateLimits` (payload buckets) gets the same all-or-nothing check.
  
  All-or-nothing holds within one list. Handler `rateLimit` buckets are charged in the pre-handler gate, before schema validation; payload buckets (`additionalRateLimits`) need the validated payload. A later payload rejection therefore does not undo the handler charges.
  
  `RateLimitResolver` has a new required method `enforceAll(requests)` that checks and deducts several buckets atomically (one Lua script in the Redis resolver). Boot fails for an empty list, for the same `per` twice, for the same `payloadField` twice in `additionalRateLimits`, and for anonymous handlers with a user-keyed bucket or tenantless-anonymous handlers with a non-ip bucket in the list. `@cosmicdrift/kumiko-types/handlers` exports `RateLimitOptions`, `declaredRateLimitOptions` and `isRateLimitOption`.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: rateLimit accepts a list of buckets that are enforced all-or-nothing
  detail: RateLimitDeclaration is now a single option, a non-empty list of options or the disabled form. RateLimitResolver gains the required method enforceAll(requests: readonly RateLimitBucketRequest[]); createRateLimitResolver and createUnlimitedRateLimitResolver implement it. Payload buckets in additionalRateLimits are charged through the same call.
  migration: Custom RateLimitResolver implementations and test fakes need an enforceAll method (check every bucket, then deduct from all or none, and throw RateLimitError for the rejected bucket with the largest retryAfter). Existing rateLimit declarations stay valid. A duplicate payloadField in additionalRateLimits is now a boot error; merge the entries into one.
  -->

## 0.372.0

### Minor Changes

- 236858e: `executor.detail()` and `executor.list()` return the entity's row type
  
  `createEntityExecutor(name, entity)` and `createEventStoreExecutor(table, entity, options)` now return `EventStoreExecutor<EntityRow<E>>`. `detail` resolves to `EntityRow<E> | null` and `list` to `CursorResult<EntityRow<E>>`, so `row.title` needs no cast or schema parse. `EntityRow<E>` is exported from `@cosmicdrift/kumiko-framework/db` and follows what the executor returns at runtime: money is one `{ amount, currency, amountScaled, amountMinor }` key, a located timestamp one `{ at, tz, utc }` key, `date` is a `Temporal.PlainDate`, `timestamp` and `insertedAt` are `Temporal.Instant`, soft-delete keys are required only when `softDelete` is the literal `true`, and bigInt and jsonb stay `unknown`. A wide `fields` map falls back to `Record<string, unknown>`. Create and update payloads stay untyped, and a typed executor is still assignable to the untyped `EventStoreExecutor`.
  
  `createBooleanField` is now typed as non-null (`default: boolean`), matching what it stores.
  
  Breaking: a `row as T` cast whose target the row type no longer overlaps becomes a compile error, and casts that still compile but are now redundant can go. Run the codemod first, then fix what it lists as manual.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: executor.detail() and executor.list() return EntityRow<E>, derived from the entity definition
  detail: Rows of createEntityExecutor / createEventStoreExecutor are typed per entity; wide entities keep Record<string, unknown>. createBooleanField is typed non-null. UserMfaRow in the bundled auth-mfa feature now declares enabledAt and lastUsedAt as Temporal.Instant, which is what the row always held.
  migration: Remove the `row as T` casts on executor.detail() / executor.list() results with `bun kumiko-upgrade --apply` (codemod remove-engine-payload-casts). Casts to a type the row does not satisfy stay and are listed as manual; replace them with a field-level check or a narrower type.
  codemod: scripts/codemod/remove-engine-payload-casts.ts
  manualAfterCodemod: true
  -->
- 27b759f: Orphaned upload bytes are swept
  
  Bytes written by `POST /files`, `createFileRefFromBytes`, `uploadFileBytesBeforeTransaction` and the seed `createFileRef` are recorded in the new `store_file_upload_ledger` table before they reach storage. The commit that creates the fileRef row removes the ledger row in its own transaction. The new hourly `files:job:sweep-orphaned-uploads` job deletes the bytes (original and derivatives) of uploads still unclaimed after `uploadSweepGraceHours` (default 24, minimum 1; option of `createFilesFeature`). A commit that arrives after its upload was swept fails with `upload expired`. Plain `files.ref(key).write()` stays untracked and is never swept.
  
  `FileContext` gains `writeUploadBytes` and `forgetUploadBytes`, `FileProviderResolver` may carry `uploadLedgerFor`, and `TenantDb.deleteMany` now returns the number of deleted rows. Build a tenant's `FileContext` with `createTenantFileContext(resolver, tenantId)` so it carries the resolver's ledger.
  
  <!-- kumiko-changes
  feature: files
  type: breaking
  title: Orphaned upload bytes are swept through a new upload ledger
  detail: The files feature registers the store_file_upload_ledger table and an hourly sweep job. FileContext has the new methods writeUploadBytes and forgetUploadBytes, which the four upload paths use; a custom FileContext or resolver must provide the ledger (withUploadLedger wraps a resolver). TenantDb.deleteMany resolves to the number of deleted rows instead of void. A fileRef commit whose ledger row was already swept throws InternalError "upload expired".
  migration: Generate and apply a migration with `kumiko-schema generate` — uploads fail without the new store_file_upload_ledger table
  -->

### Patch Changes

- 7c04d2a: Template variable examples can be translated
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Text examples of template variables follow the template's language
  detail: The `example` of a text or richText templateVariable is now read like `label`: an i18n key resolves to the translation of the edited template's locale, plain text stays as it is. Preview, the sample values bar and send-test therefore show German examples for a German template. Example values of other types (link, number, enum-like text values) stay as declared; put the explanation of such a value into the variable's label. Apps: register `templateVariable.text({ example: "<app>:mail.example.x" })` and add the key with de, en and es via `r.translations`.
  -->

## 0.371.1

No changes in this release.

## 0.371.0

No changes in this release.

## 0.370.0

### Minor Changes

- 79a0aa6: Stacks name the runProdApp option they need, plus auth, SaaS and security stacks
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: runProdApp names the stack and the boot option it is missing
  detail: Features returned by the compose*Stack helpers carry bootRequires ({ stack, options }), a new optional FeatureDefinition field; BootOptionName and StackBootRequirement are exported from @cosmicdrift/kumiko-framework/engine. runProdApp checks them before it wires the boot options and fails with "[runProdApp] stacks in `features` need boot options that are not set:" followed by one line per gap, for example "composeSaasStack needs the boot option `billing`: set billing: { stripe: { priceToTier }, defaultTier }". composeMailStack and composeUserDataRightsStack need mail (or a mounted channel-email), composeFileStack without providers needs fileStorage (or a mounted file provider), composeGdprStack and composeSecurityStack need kmsMode (or kms / allowPlaintextPii), composeSecurityStack also fails with rateLimit: false, composeSaasStack with billing "stripe" needs billing (or a mounted subscription provider). composeFileStack takes providers as optional now. The renderer, pages, ops and identity stacks need no option. resolveBillingOption is exported from @cosmicdrift/kumiko-server-runtime/boot-options/billing for tests that mount the billing wiring on a test stack.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: composeAuthStack, composeSaasStack and composeSecurityStack
  detail: composeAuthStack({ sessions?, mfa?, accountSecurity? }) mounts auth-foundation and sessions, with mfa also auth-mfa and account-security; the password login still comes from the auth option or composeFeatures. composeSaasStack({ billing: "stripe" | "mollie", tiers, caps?, waitlist?, billingFoundation? }) mounts billing-foundation and tier-engine, cap-counter plus cap-overview with caps, waitlist with waitlist. With "stripe" the runProdApp billing option mounts subscription-stripe and the tier-sync webhook route; with "mollie" the stack mounts subscription-mollie from the mollie options and the app adds the webhook route. composeSecurityStack({ includeSessions? }) mounts sessions, crypto-shredding, rate-limiting and audit. composeGdprStack({ selfService: { userDataRights? } }) adds sessions, user-data-rights and user-profile in the order dsgvoSelfServiceFeatures used. billing-foundation requires tenant-lifecycle and compliance-profiles, which composeGdprStack({ tenantLifecycle: true }) mounts. user-profile in selfService requires user-data-rights-defaults and auth-email-password; composeUserDataRightsStack mounts the defaults, and the login comes from the auth option. Recipe: samples/recipes/compose-stacks.
  -->
  
  <!-- kumiko-changes
  feature: presets
  type: improvement
  title: securityBaselineFeatures and dsgvoSelfServiceFeatures are deprecated
  detail: Both presets stay for one release. Replace securityBaselineFeatures({ includeSessions }) with composeSecurityStack({ includeSessions }) and dsgvoSelfServiceFeatures({ userDataRights }) with composeGdprStack({ selfService: { userDataRights } }), both from @cosmicdrift/kumiko-dev-server/compose-stacks. The stacks mount the same features in the same order.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: runProdApp effectiveFeatures is deprecated
  detail: effectiveFeatures stays for one release. createTierEngineFeature({ tierMap }), or composeSaasStack, builds the per-tenant feature resolver at boot, and the prod-only features come from the mail, fileStorage and billing options.
  -->
- 8ff5d19: Follow-ups from the shim removal: typed hook events, a standalone EventDef factory and stricter escapeHatch checks
  
  <!-- kumiko-changes
  feature: types
  type: breaking
  title: SaveContext.event and DeleteContext.event are required
  detail: postSave and postDelete hooks always receive the stored event, so event is no longer optional on SaveContext and DeleteContext. Hooks read the caller from event.createdBy instead of guarding for undefined.
  migration: Code that builds a SaveContext or DeleteContext by hand, usually in tests, sets event, for example with createTestStoredEvent() from @cosmicdrift/kumiko-testing/helpers. Drop optional chaining on ctx.event in hooks.
  -->
  
  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: createTestStoredEvent builds a StoredEvent fixture
  detail: createTestStoredEvent(overrides) from @cosmicdrift/kumiko-testing/helpers returns a complete StoredEvent with stable defaults, for hook tests that construct SaveContext or DeleteContext directly.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: createEventDef builds an EventDef without a registrar
  detail: createEventDef({ feature, name, schema, version?, piiFields? }) from @cosmicdrift/kumiko-framework/engine returns the same EventDef that r.defineEvent returns, including the PII field validation, so shared event definitions can live outside a defineFeature callback.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: escapeHatch on a spread entity query handler requires SystemAdmin access
  detail: A query handler that spreads defineEntityListHandler or defineEntityDetailHandler and adds escapeHatch afterwards skipped the SystemAdmin-only access check that the factory option enforces. Registration now applies the same check and throws for any other access.
  migration: Pass escapeHatch as an option of defineEntityListHandler or defineEntityDetailHandler with access { roles: access.systemAdmin }, or write a plain r.queryHandler that does not reuse the entity convention handler when a tenant-scoped query needs a raw lookup.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: makeSeedCreateFileRef is exported
  detail: makeSeedCreateFileRef and the SeedCreateFileRef type are exported from @cosmicdrift/kumiko-server-runtime, so app seed scripts can create file references the same way the bootstrap seeder does.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Runtime-isolation guard resolves imports through the TypeScript resolver
  detail: The runtime-isolation guard resolves import and re-export targets with ts.resolveModuleName, so path aliases and package exports are followed, and classifies e2e directories as test code. resolveImportTargetPath is exported for other guards.
  -->

## 0.369.0

### Minor Changes

- 57c0cff: Tenant admins edit their own mail server in the settings
  
  <!-- kumiko-changes
  feature: mail-transport-smtp
  type: breaking
  title: Tenant admins edit their own SMTP server on the Email sending screen
  detail: mail-foundation's provider key and the SMTP keys (host, port, SSL/TLS, user name, sender address) carry settings masks, so the generated Settings-Hub shows tenant admins one Email sending form: the provider choice, the chosen provider's connection fields and its password, each field with a help text and every label in English, German and Spanish, saved together by one Save button in one /api/batch. Switching the provider swaps the fields at once; fields of a provider that is not selected are not saved. A selector owner's selection screen (`<owner>-tenant-selection`) now carries the plugins' config keys (field id `<owner>-<key>`) and secrets (field id `<plugin>-<key>`, listed in the new ConfigEditScreenDefinition.secretKeys) behind a visible condition on the provider field; the separate `<plugin>-tenant` and `<plugin>-tenant-secrets` screens and their dashboard panels are gone, and so is the `config.settings.saveProvider` label. A secret with its own writeRoles stays on the global secrets screen. Boot validation checks every secretKeys field (tenant scope, writeOnly text, declared secret). The configEdit renderer loads secretKeys fields from secrets:query:list (set or unset, no preview), writes them with secrets:write:set or secrets:write:delete in the same batch, and leaves hidden fields out. The provider key is no longer required: empty means the tenant has no own server and the platform sends, so readiness no longer reports it as missing (createTransportForTenant still throws on an empty provider). The provider and SMTP keys are written by TenantAdmin and the system identity, no longer by SystemAdmin, because a platform-level provider would reach every tenant without that tenant's password. The secrets set and delete handlers also admit the system identity, so server code stores a tenant secret via dispatchSystemWrite through the same key and value checks as an admin; the settings screens keep showing only the human roles. The provider choice shows each plugin's `<feature>.settings` name, also for a plugin without settings of its own, and keeps the English name when a locale feature mounted earlier declares the same key in its own language only. A MailTransportPlugin with `selectableInSettings: false` stays allowed on the server but is not offered in the form; the in-memory transport sets it, because apps mount it next to smtp in production and a tenant admin picking it would drop every mail. A plugin's secrets section takes an optional `<feature>.settings.secrets` title (SMTP password under "SMTP sign-in").
  migration: E2E specs that used the testIds `dashboard-panel-<plugin>-tenant`, `dashboard-panel-<plugin>-tenant-secrets` or the separate secret input of these screens address the fields of `<owner>-tenant-selection` instead (one Save). Code that wrote these keys as a SystemAdmin user writes them as the tenant's TenantAdmin or via dispatchSystemWrite. Apps that relied on readiness flagging an empty provider check it themselves.
  -->
- 57c0cff: Only notifications marked tenantTransport go through the tenant's own mail provider
  
  <!-- kumiko-changes
  feature: channel-email
  type: breaking
  title: The tenant mail transport applies per notification
  detail: r.notification(name, { tenantTransport: true }) marks a notification whose mails go through the tenant's own mail transport. channel-email consults its tenantTransport resolver only for these (also under a renamedFrom name); every other notification, such as password reset or sign-in mails, always takes the app transport, even when the tenant has a provider. With tenantTransport set, transport may be omitted: a mail that then has no transport fails with missing_credentials instead of throwing. The template test mail (template-resolver send-test) now gets the tenant config in its channel context and uses the template's notification, so it leaves through the same transport as the real mail.
  migration: Apps that pass tenantTransport to createChannelEmailFeature add `tenantTransport: true` to every r.notification whose mails should go through the tenant's provider; without the flag those mails now go through the app transport. Apps without an app SMTP server can drop transport and keep tenantTransport.
  -->

## 0.368.0

### Minor Changes

- 39b5de4: `personal: { of, whenAbsent: "self" }` encrypts rows without an owner under the row's own record key, so a record-forget shreds them
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: whenAbsent "self" keys ownerless personal fields on the record instead of the tenant
  detail: |
    A personal field with a nullable owner can now declare `personal: { of: "ownerId", whenAbsent: "self" }` (entity fields and `defineEvent` piiFields). While the owner is empty, the value is encrypted under `record:<entity>:<id>`, the same subject as `personal: "self"` on events and `personal: { of: "id" }` on entities. `forget-subject` on that record then erases the value, its blind index and its search document; with `"tenant"` the value stayed readable until the tenant was destroyed. A row can mix subjects: the ciphertext names its key inline, so owner-keyed, tenant-keyed and record-keyed fields decrypt side by side.
  
    The boot validator accepts "self" next to "tenant" and rejects it on `idType: "serial"` entities, because a forget-subject request needs a UUID record id. Owner transitions behave as for "tenant": when an update assigns an owner (absent to X) the value moves from the record key to the user key; the created event stays record-keyed. The data-retention hardDelete also erases the record key of an ownerless "self" row; a row with an owner keeps its owner key.
  migration: |
    Switching an existing field from `whenAbsent: "tenant"` to `"self"` changes only new writes. Events and rows written earlier stay tenant-keyed (still readable) until the PII event backfill re-keys them. The backfill fingerprint is bumped (`owner-rekey-v2`), so the boot-time backfill runs one more full pass: tenant-keyed values of rows without an owner move under their record key, tenant-keyed values of rows with an owner still move under that owner. The pass rewrites event payloads in place through the existing backfill path and queues the affected projections for rebuild. Apps that run the backfill manually call `backfillEventPiiEncryption` with `resolveOwnerFromProjection: true, rekeyTenantKeyedOwnerFields: true`, then rebuild the projections. Values of a record forgotten earlier become `[[erased]]`. The re-key covers entity lifecycle events only: custom `defineEvent` piiFields that switch from `whenAbsent: "tenant"` to `"self"` keep their old events tenant-keyed.
  
    Old events are never reinterpreted at read time: an old created event of a row that got an owner later keeps its record key until a forget of that record, which erases it, while the later owner-keyed copies stay readable.
  -->

### Patch Changes

- fbc0759: One DB connection factory: createDbConnection({ url, ... }) on postgres-js, and the query helpers move from the bun-db subpath into the db subpath
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: createDbConnection({ url, ... }) is the only connection factory, query helpers move from /bun-db to /db
  detail: |
    postgres-js is the only DB driver. createDbConnection takes one options object, is synchronous and accepts the new options ssl and onNotice. The Bun.SQL provider, createConnection, createPgConnection and DB_PROVIDER are removed. The query helpers (selectMany, insertOne, transaction, asRawClient, ...) keep their API and are now exported from @cosmicdrift/kumiko-framework/db. The `tx` handed to the transaction() callback is typed as DbTx (the postgres-js transaction handle it always was at runtime) instead of the Bun.SQL instance type; a helper that takes `db: DbConnection` and receives that tx needs `DbRunner` or `DbTx`.
  
    The positional form createDbConnection(url, options) and the @cosmicdrift/kumiko-framework/bun-db subpath keep working as deprecated aliases and are removed in the first release after 2026-10-29.
  
    old -> new:
      createConnection(url, options) (async) -> createDbConnection({ url, ...options }) (sync)
      createPgConnection(url, options) -> createDbConnection({ url, ...options })
      createDbConnection(url, options) -> createDbConnection({ url, ...options }) (positional form is deprecated)
      @cosmicdrift/kumiko-framework/bun-db -> @cosmicdrift/kumiko-framework/db (deprecated alias until the first release after 2026-10-29)
  
    Removed without replacement: createBunDbConnection, bunDbConnectionOptionsFromEnv, the BunDbConnection, BunDbTx, BunDbRunner and BunDbConnectionOptions types, DbPoolHandle (use DbConnectionHandle), the PgListenClient re-export from /bun-db (import it from @cosmicdrift/kumiko-types/db-connection) and the DB_PROVIDER environment variable.
  migration: Run `bun kumiko-upgrade --apply`. It rewrites bun-db imports to /db, createDbConnection(url, options) and createConnection/createPgConnection calls to the object form, and reports leftovers (removed Bun.SQL exports, DB_PROVIDER) with file and line. Remove DB_PROVIDER from your env files.
  codemod: scripts/codemod/db-factory.ts
  -->
- 7949df2: Bundled features are mounted through create*Feature() factories, the two S3 providers merge into createFileProviderS3Feature({ fromEnv }), and @app/define with kumiko codegen is removed
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Bundled feature constants become create*Feature() factories
  detail: |
    Every bundled feature that was mounted as a constant (tagsFeature, ledgerFeature, authFoundationFeature, ...) now has a create<Name>Feature() factory exported from the same subpath, and apps mount `createTagsFeature()` instead of `tagsFeature`. Factories of features without options take no arguments; the ones that already had options keep them. Two calls of a factory give interchangeable instances, so mounting the same feature from two stacks does not trip the "mounted twice as distinct instances" check.
  
    The old constants keep working as deprecated aliases and are removed in the first release after 2026-10-29.
  
    old -> new:
      tagsFeature -> createTagsFeature()
      ledgerFeature -> createLedgerFeature()
      authFoundationFeature -> createAuthFoundationFeature()
      fooBarFeature -> createFooBarFeature() (same rule for every bundled feature constant)
      typeof tagsFeature -> ReturnType<typeof createTagsFeature>
  migration: Run `bun kumiko-upgrade --apply`. It renames the imports and replaces every use with the factory call. It reports aliased imports, re-exports, namespace access, dynamic imports and files that compare a feature by identity with file and line; handle those by hand (one factory call per mount, or keep one shared instance).
  codemod: scripts/codemod/feature-factory.ts
  -->
  
  <!-- kumiko-changes
  feature: file-provider-s3
  type: breaking
  title: The S3 file providers merge into createFileProviderS3Feature({ fromEnv })
  detail: |
    createFileProviderS3Feature() mounts the per-tenant config provider as before. createFileProviderS3Feature({ fromEnv: true }) mounts the env-configured provider (feature name, provider key "s3-env" and requires unchanged). The S3 client helpers (createS3Provider, createS3ProviderFromEnv, parseS3EnvConfig, resolveForcePathStyle, S3ProviderConfig) move to the new subpath @cosmicdrift/kumiko-bundled-features/file-provider-s3/lib.
  
    The subpaths file-provider-s3-env and files-provider-s3 keep working as deprecated re-exports and are removed in the first release after 2026-10-29.
  
    old -> new:
      fileProviderS3EnvFeature from .../file-provider-s3-env -> createFileProviderS3Feature({ fromEnv: true }) from .../file-provider-s3
      fileProviderS3Feature -> createFileProviderS3Feature()
      @cosmicdrift/kumiko-bundled-features/files-provider-s3 -> @cosmicdrift/kumiko-bundled-features/file-provider-s3/lib
  migration: Run `bun kumiko-upgrade --apply`. It rewrites the imports and the env feature mount, and reports `typeof fileProviderS3EnvFeature` and re-exports of it with file and line.
  codemod: scripts/codemod/s3-imports.ts
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: breaking
  title: @app/define and kumiko codegen are removed
  detail: |
    The .kumiko/ codegen (define.ts, types.generated.d.ts, schemas.generated.ts) is gone: runCodegen, scanEvents and their types are no longer exported, the dev server no longer watches r.defineEvent calls, `kumiko codegen` is removed, `kumiko-build --check` is removed and kumiko-build no longer runs a codegen pass. The scaffolded .gitignore no longer lists .kumiko/, so the upgrade marker .kumiko/upgrade-state.json can be committed. ctx.appendEvent stays bound to the augmentable KumikoEventTypeMap; to emit an event with a payload checked against its definition use emitEvent(ctx, eventDef, { aggregateId, aggregateType, payload, headers? }) with the EventDef that r.defineEvent returns (emitEvent now also accepts headers).
  migration: Replace `@app/define` imports with direct framework imports (defineWriteHandler/defineQueryHandler/defineFeature from @cosmicdrift/kumiko-framework/engine, events via r.defineEvent and emitEvent) and drop the `file:./.kumiko` dependency plus the bunfig/tsconfig resolver entries. Known sites: publicstatus 43 files, kumiko-platform 13 (samples), solon 3, money-horse 1, phronexsis 1.
  -->
- 478ee1f: createTenantDb takes one options object, and HandlerContext/AppContext drop the internal _userId and _handlerType fields
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: createTenantDb({ db, tenantId, ... }) takes one options object
  detail: |
    createTenantDb takes one CreateTenantDbOptions object ({ db, tenantId, mode?, tracer?, meter?, signal?, grants? }); mode still defaults to "tenant". The positional form createTenantDb(db, tenantId, mode, tracer, meter, signal, grants) keeps working as a deprecated overload and is removed in the first release after 2026-10-29.
  
    old -> new:
      createTenantDb(db, tenantId) -> createTenantDb({ db, tenantId })
      createTenantDb(db, tenantId, "system", tracer, meter, signal, grants) -> createTenantDb({ db, tenantId, mode: "system", tracer, meter, signal, grants })
  migration: Run `bun kumiko-upgrade --apply`. It rewrites positional calls (literal undefined arguments are dropped) and reports spread arguments, calls with more than seven arguments and uses of createTenantDb as a value (callback, .bind/.call/.apply) with file and line.
  codemod: scripts/codemod/tenant-db-options.ts
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: HandlerContext and AppContext no longer expose _userId and _handlerType
  detail: |
    The dispatcher no longer sets _userId and _handlerType on the context of write handlers, query handlers and hooks. The caller identity is ctx.user.id. requireSecretsContext reads ctx._userId first and falls back to ctx.user.id, so passing a handler context to it keeps the same audit identity. Provider contexts (FileProviderContext, MailTransportContext, InboundMailContext) keep their own _userId. JobContext._userId is unchanged.
  migration: Replace ctx._userId with ctx.user.id in write/query handlers and hooks. Known sites: one file each in money-horse, offlot-app, phronexsis and kumiko-enterprise. _handlerType had no readers.
  -->

## 0.367.0

### Minor Changes

- f6b1803: Notifications can keep their mail template system-only
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Notifications can keep their mail template system-only
  detail: r.notification(name, { systemOnly: true }) marks the stored mail template as a platform text. Tenant admins no longer see it in the template overview, list or detail, and creating a tenant version (upsert-tenant, copy-locale, import-bundle, also a SystemAdmin writing for a tenant) is refused with access_denied and templateResolver.errors.systemOnlyTemplate. SystemAdmins edit the system template as before, and the mail renderer always uses it, even if a tenant row exists from before.
  -->
- f6b1803: Delivery signs unsubscribe links itself
  
  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: Delivery signs unsubscribe links itself
  detail: r.notification(name, { unsubscribe: true }) makes delivery put a signed data.unsubscribeUrl into every email of that notification when the service has unsubscribeLinks. User recipients get a user token, route recipients an address token (only with a blind-index key, otherwise no link). The token is scoped to tenant, notification and channel; a link the caller passes in data.unsubscribeUrl wins. runProdApp option unsubscribe: { secret } mounts createUnsubscribeRoutes and wires the links; the base URL comes from auth.publicOrigin, auth.mail.baseUrl or APP_BASE_URL, and without one boot warns and no link is added.
  -->
- f6b1803: Template conditions with data-if and a percent variable type
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Template conditions with data-if and a percent variable type
  detail: A paragraph, heading or table row with data-if="name" renders only when the variable has a value (0 counts as a value); inside a repeat row the name refers to the row field, on the repeat row itself to the root variable. The sanitizer keeps the attribute, and template validation reports a condition on an undeclared variable. New variable type percent (templateVariable.percent()) takes percentage points and renders locale-aware, 12 as "12 %" in German and "12%" in English; the preview uses its example value. The document designer has no toolbar control for conditions yet; the attribute survives editing.
  -->

## 0.366.0

### Minor Changes

- 22b7f6e: One injectable Clock for ctx.tz in handlers and jobs
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: One injectable Clock for ctx.tz in handlers and jobs
  detail: New type Clock and TzContextOptions.clock. AppContext.clock feeds ctx.tz.now() in handlers, and JobContext.tz gives jobs the same ctx.tz API (tenant timezone from tenant config, read once per job run, UTC fallback). The testing helper createManualClock(start) returns a clock with set and advance. The tenant-lifecycle job now reads time through ctx.tz.now().
  migration: Code that builds a JobContext literal itself (boot seeds, test doubles) adds `tz: createTzContext()`.
  -->
- 8a7d835: Renaming a notification type keeps user preferences and address opt-outs
  
  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: Renaming a notification type keeps user preferences and address opt-outs
  detail: r.notification accepts renamedFrom, a list of former qualified names. Preferences and address opt-outs stored under a former name keep applying to the renamed notification, and a stored choice under the current name wins over one under a former name. New writes via setPreference and the unsubscribe and resubscribe handlers are stored under the current name, resubscribeAddress also lifts opt-outs under former names. Boot fails if an alias is a current notification name, is the wildcard, or is claimed by two notifications.
  -->
- 7053800: The registrar takes one object per call: r.writeHandler, r.queryHandler, r.entity, r.requires and r.hook lose their positional forms
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Registrar methods take a single object, positional calls throw at registration
  detail: |
    r.writeHandler, r.queryHandler, r.entity, r.requires and r.hook now take one object. The positional overloads are gone from the types and throw when the feature is defined, with a message that points at the codemod. The throw is removed in the first release after 2026-10-29.
  
    writeHandler (queryHandler is the same shape):
      before: r.writeHandler("order:archive", schema, handler, { access });
      after:  r.writeHandler({ name: "order:archive", schema, handler, access });
  
    hook (type picks the handler shape, target is a name, a list or { allOf }):
      before: r.hook("postSave", "order", handler, { escapeHatch });
      after:  r.hook({ type: "postSave", target: "order", handler, escapeHatch });
  
    entity and requires:
      before: r.entity("order", definition, { table: ordersTable });  r.requires("auth", "tenant");
      after:  r.entity({ name: "order", ...definition, backingTable: ordersTable });  r.requires({ features: ["auth", "tenant"] });
  
    registerEntityCrud is no longer exported from @cosmicdrift/kumiko-framework/engine; call r.crud(name, entity, options) instead. The entity option { table } is now backingTable on the r.entity object and lands in the feature's entityTables, not in its entities. HookDefinition and EntityObjectDefinition are exported from @cosmicdrift/kumiko-types. Hook definitions are checked per type: validation takes no escapeHatch, phase only exists on postSave and postDelete, and { allOf } is not accepted on preSave.
  migration: Run `bun kumiko-upgrade --apply`. It rewrites every positional r.writeHandler, r.queryHandler, r.entity, r.requires, r.hook and registerEntityCrud call to the object form. Calls it cannot resolve statically (a spread argument, a registrar that is not typed as FeatureRegistrar) are listed as manual work with file and line; rewrite those by hand.
  codemod: scripts/codemod/object-form.ts
  manualAfterCodemod: true
  -->
- 3d58dea: Error boundaries keep a render error from blanking the whole page
  
  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: A throwing screen shows an error card instead of a blank page
  detail: createKumikoApp wraps the active screen in a boundary that keeps the shell and navigation visible, shows a card with the screen name and a reload action, and resets on route change. A second boundary around the whole app shows a minimal provider-free fallback. Both log the error with console.error. createKumikoApp takes an onError option for telemetry. kumiko-testing/e2e exports boundaryGuardedTest, a plain Playwright test that fails a spec when a boundary caught an error; the seeded test builds on it.
  -->
- 22b7f6e: selectMany supports column projection via SelectOptions.fields
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: selectMany supports column projection via SelectOptions.fields
  detail: SelectOptions gains fields, a list of entity field names. selectMany then selects only those columns instead of all of them. An empty list or a name that is not a column of the table throws.
  -->

## 0.365.1

### Patch Changes

- 8633239: step-dispatcher delivers through a BullMQ job
  
  <!-- kumiko-changes
  feature: step-dispatcher
  type: fix
  title: step-dispatcher delivers each dispatch as a retried job, so a slow receiver no longer delays other tenants
  detail: The step-dispatcher projection now only enqueues one `step-dispatcher:job:deliver` job per dispatch request, and the job performs the webhook or mail delivery. Redis holds only the dispatch stream id and the tenant, never the request payload. Transient failures (network error, timeout, 5xx, 408, 429, any mail adapter failure) are retried 3 times with exponential backoff; the outcome event and the payload key erase follow after the final attempt. Permanent failures (invalid url, blocked host, other 4xx, unavailable auth secret) are recorded at once. At most 2 deliveries per tenant run at the same time, so one tenant's slow receivers cannot hold up the others. This corrects the 0.346.0 note that a hanging receiver no longer stalls the dispatcher for every tenant: the shared consumer still delivered one request at a time.
  migration: step-dispatcher now needs a job runner (Redis) and a worker consuming the default worker lane. Without a job runner the projection throws instead of delivering. Test stacks must pass `jobs` to setupTestStack and call `drainJobs()` after the event dispatcher ran. `r.job` accepts `maxPerTenant: { limit, onLimit: "defer", deferMs? }`; a plain number still drops excess enqueues. A `webhook.send` request that gets a retryable status (5xx, 408, 429) is now sent up to 4 times under the same Idempotency-Key. Worker pods must know the deliver job before the projection enqueues it, so deploy worker and API together or the worker first. A dev server only consumes jobs when the app mounts `createJobsFeature()`.
  -->
- 34530bf: Timestamp format accepts a timeZone
  
  <!-- kumiko-changes
  feature: headless
  type: improvement
  title: The timestamp FormatSpec takes an IANA timeZone
  detail: { format: "timestamp", timeZone: "Europe/Berlin" } formats the instant in that zone instead of the runtime's zone. Without timeZone nothing changes. The option is ignored for the date format, which has no time component.
  -->

## 0.365.0

### Minor Changes

- 59bbd15: Job handlers get ctx.metricsFor like request handlers
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Job handlers get ctx.metricsFor like request handlers
  detail: JobContext now exposes ctx.metricsFor(featureName) with the same contract as HandlerContext, so shared code can count under one stable feature name from jobs too. Unregistered names stay a silent no-op.
  -->

### Patch Changes

- 7aa3223: Bun.SQL provider parity
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Bun.SQL provider parity fixes for DB_PROVIDER=bun
  detail: Array params bind as Postgres array literals, transaction handles are detected correctly, Instant params are stored at millisecond precision, integer params reject fractions, and migrations hold their advisory lock on one pinned connection. LISTEN/NOTIFY uses Bun.SQL listen() on its own connection, which the pool idle timeout does not close, so the Bun provider no longer opens a postgres-js peer.
  -->
- 80e2132: Erasure jobs delete the bytes of files that a tenant handover moved into the tenant
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Soft-delete cleanup and hardDelete retention delete the bytes of handed-over files
  detail: A tenant handover moves a fileRef row to the new tenant, but its storageKey keeps the previous tenant's prefix. The soft-delete cleanup and the data-retention hardDelete went through `ctx.files.ref()` and `ctx.files.list()`, which reject keys outside the job's tenant, so the bytes and derivatives of such files were never deleted and the soft-delete cleanup kept the row forever. Both now delete through the new `deleteFileRefBytes(files, row, context)` from `@cosmicdrift/kumiko-framework/derivatives`, built on the new `FileContext.listFromFileRef(row)` (the row's key plus its derivatives, under the same trust as `refFromFileRef`). Form-draft discard deletes draft files through `refFromFileRef` as well.
  -->
- eef5ff1: pruneEvents accepts batchSize and handler contexts carry an after-commit notify factory
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: pruneEvents batchSize and _notifyAfterCommitFactory on the handler context
  detail: pruneEvents takes an optional batchSize that deletes the lowest event ids first, so callers can loop until deletedCount is below the batch size with one short transaction per batch. The handler context exposes _notifyAfterCommitFactory, a notify factory bound to the dispatcher's job runner for use after the transaction has committed.
  -->
- 82dc9a4: DASHBOARD_STAT_TONES constant and DashboardStatTone type
  
  <!-- kumiko-changes
  feature: types
  type: improvement
  title: DASHBOARD_STAT_TONES is the single source for dashboard stat tones
  detail: screen.ts exports DASHBOARD_STAT_TONES and DashboardStatTone; DashboardStatPanel.tone derives from it, and the web renderer builds its runtime tone check and StatTone type from the same constant, so a new tone can no longer be silently dropped from toneField values.
  -->

## 0.364.0

### Minor Changes

- e9b032f: Write handlers can run external calls before the transaction
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Write handlers can declare a beforeTransaction phase, and file bytes can be uploaded before the transaction
  detail: defineWriteHandler accepts beforeTransaction(event, ctx), which the dispatcher runs after the pre-handler gates and any reserveBeforeTransaction and before the transaction opens, so a slow external call holds no pool connection. Its data reaches the handler as event.prepared; a failure result or throw rejects the write, and its release runs whenever the transaction does not commit. ctx.write, appendEvent, notify and the other write surfaces throw inside the phase, and a handler with the phase cannot run as a nested ctx.write. uploadFileBytesBeforeTransaction writes the bytes in that phase and createFileRefFromUploadedBytes creates the fileRef row in the handler; the release keeps the bytes when the row exists. Original files whose row never committed stay in storage, no job sweeps them.
  -->
- 6b1567e: CapExceededError carries resetAt and retryAfterSeconds, API sets Retry-After
  
  <!-- kumiko-changes
  feature: cap-counter
  type: breaking
  title: CapExceededError carries resetAt and retryAfterSeconds, API sets Retry-After
  migration: |
    Periodic caps no longer need RateLimitError({ windowSeconds: 0, ... }). Where you catch CapExceededError from enforceCap and rethrow it as RateLimitError, drop the catch and let CapExceededError pass: the response stays 429 with a correct Retry-After, error.code becomes cap_exceeded instead of rate_limited, and error.details carries resetAt and retryAfterSeconds. Keep a feature-specific message with enforceCap({ ..., i18nKey }) and pass a period end other than the calendar month with periodEndIso (e.g. a budget's resetsAtIso). Clients matching on rate_limited for these caps must also accept cap_exceeded. Any KumikoError with retryAfterSeconds (including RateLimitError thrown in a handler) now gets a Retry-After header from /api/write, /api/batch and /api/query.
  -->
- f1b4367: Writes without an open transaction run as their own command
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Writes without an open transaction run as their own command; ctx.db writes there throw
  detail: Write handlers accept transaction "perCommand". Such a handler runs without a transaction of its own, so every ctx.write and ctx.writeAs it issues runs as its own top-level command with its own transaction, gates and afterCommit hooks. A perCommand handler cannot run as a nested ctx.write, cannot be part of a multi-command batch (422 per_command_handler_in_batch) and cannot combine with beforeTransaction or reserveBeforeTransaction (boot error). ctx.write and ctx.writeAs from stream handlers and top-level query handlers now take the same route, so afterCommit hooks of the called write, which never fired before, fire now. ctx.db writes (entity executor, insertOne, updateMany, deleteMany, db.global() writes) and event appends (appendEvent, unsafeAppendEvent, tryAppendEvent, fetchForWriting, archiveStream, restoreStream, snapshotAggregate) throw in stream handlers, top-level query handlers, perCommand handlers and in beforeTransaction and reserveBeforeTransaction. ctx.dbOutsideTransaction and ctx.outsideTransaction stay available, and ctx.db.unsafeRaw stays open as the audited escape hatch.
  migration: Stream and query code that writes through ctx.db or an executor bound to ctx.db calls a write handler through ctx.write or ctx.writeAs instead, or writes deliberately through ctx.dbOutsideTransaction. Check code that relied on afterCommit hooks of a write called from a stream or query handler not firing. bookCapUsage from a stream or query handler needs outsideTransaction true or a command. runInOwnTransaction(ctx.db, ...) stays locked in these contexts; runInOwnTransaction(ctx.dbOutsideTransaction, ...) is the way to a deliberate own transaction. Measured consumers: one stream handler (AI agent turn: conversation, activity and tool-call records through an executor on ctx.db, plus cap booking) and one query handler (AI text run: cap booking on ctx.db, log via ctx.write). No other consumer app has stream or query writes. The beforeTransaction/reserveBeforeTransaction lock affects no released code.
  -->
- 8e81d73: SecretsContext.withRunner binds secret reads and writes to a transaction
  
  <!-- kumiko-changes
  feature: secrets
  type: improvement
  title: SecretsContext.withRunner(tx) runs secret access on a given transaction
  detail: The OAuth refresh now reads and writes the refresh token on its advisory-lock transaction, so a refresh holds one pool connection instead of two and parallel refreshes cannot starve the pool. Custom SecretsContext implementations need a `withRunner` method.
  -->
- b5a6395: templateVariable.richText declares a notification variable that carries sanitized HTML
  
  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: templateVariable.richText for notification variables that carry formatted HTML
  detail: Notification variables are escaped, so a value holding HTML (for example a document written in a rich text editor) showed up as literal tags in the mail. A variable declared with templateVariable.richText({ required }) is run through the document sanitizer at render time and inserted as HTML; bold, italic, lists and safe links stay, script, event handlers and javascript links are not emitted as markup. If the sanitizer rejects a value, it is rendered as escaped text and a warning with the violation codes is logged. All other variable types stay escaped.
  -->

### Patch Changes

- 8e81d73: CacheSyncBus.publish accepts remoteOnly to skip local listeners
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: CacheSyncBus.publish takes { remoteOnly } to skip same-process listeners
  detail: `publish(topic, message, { remoteOnly: true })` delivers only to other processes. Use it when the publisher has already applied the change locally and a local fanout would trigger a redundant reload.
  -->
- 8e81d73: Config key validators get a db scoped to the tenant being written
  
  <!-- kumiko-changes
  feature: config
  type: fix
  title: Config key validate() receives a db scoped to the written tenant
  detail: A SystemAdmin writing a config value for another tenant previously handed the validator a system-mode db that could read every tenant. `ConfigValidateContext.db` is now a `TenantDb` locked to the tenant the value is written for. The validator runs inside the write transaction, so a slow query there should set its own timeout.
  -->
- 8be3807: coerceRow takes a raw driver row and returns the caller's row type
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: coerceRow no longer claims the raw driver row already has the converted shape
  detail: coerceRow now accepts a Record<string, unknown> driver row and returns the explicitly requested row type, with the single cast at that boundary. The raw event-consumer, pending-event and projection-rebuild queries return untyped rows instead of a caller-chosen generic. The eventMigrations JSDoc and the expand/contract guide now state that pii and encrypted fields reach transforms as field-bound ciphertext and must not be renamed or derived from.
  -->
- 8e81d73: FileContext.refFromFileRef reads files whose fileRef moved to another tenant
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: FileContext.refFromFileRef reads files whose fileRef moved to another tenant
  detail: A tenant handover moves the fileRef row but not the bytes, so the storageKey keeps the previous tenant's prefix and the tenant-bound `ctx.files.ref(key)` rejected it. FileContext gains `refFromFileRef({ storageKey })` for keys read from a fileRef row the caller has already tenant-checked: it skips the tenant-prefix check and still rejects unsafe keys. The variant route and ctx.derivatives.variant use it, so variants of handed-over files render again. `ref(key)` keeps the prefix check for freely supplied keys.
  -->
- 7482ee2: Termination receipt limit no longer keys Redis by an unkeyed email hash
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: fix
  title: The termination receipt rate limit keys Redis with a keyed, handler-bound digest instead of an unkeyed SHA-256 of the email
  detail: HandlerContext gains an optional rateLimitDigest(value), an HMAC bound to the running handler, so a handler can build rate-limit keys without plaintext identifiers and cannot reproduce the dispatcher's payload-bucket digests. normalizePayloadBucketValue is exported from the pipeline entry point. The receipt limit reuses it, and withholds the receipt mail (the declaration is still recorded) when no digest is wired. Payload-bucket normalization now applies Unicode NFKC first, so fullwidth lookalikes share a bucket. Existing receipt buckets restart empty; they expire after the 24 hour window.
  -->
- 5a39305: ListFacetSpec docs state that reference facets are exempt from the declared-column rule
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Facet field docs name the reference exception
  detail: The docs of projectionList.facets and relatedList.facets said every facet field must be a declared column. A facet of type "reference" is exempt: it filters by id through the bound query's filters and needs a registered entity instead. Behavior is unchanged.
  -->
- 15039ce: Cascade deletes honour the record-lock exemptions and ignore soft-deleted children
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Cascade deletes honour the record-lock exemptions and ignore soft-deleted children
  detail: The cascade hook blocked a parent delete on a locked child even when the executor delete had skipped the lock guard (unsafeSkipLockGuard, a framework system write with a writePurpose, forget). DeleteContext now carries lockGuardBypassed and the hook follows it. Soft-deleted children no longer count as locked.
  -->
- 7482ee2: Payload rate limits can normalize emails and auth requests use a 15-minute window
  
  <!-- kumiko-changes
  feature: auth-email-password
  type: fix
  title: Email payload buckets ignore plus-tags and case; auth requests are capped at 3 per 15 minutes
  detail: additionalRateLimits accepts normalize: email, which lowercases and strips the plus-tag before hashing, and bucket keys are scoped by tenant and handler. Signup and token requests (reset, unlock, verification) and the waitlist default use it with a 3-request, 900-second window.
  -->
- 15039ce: A stale auth cookie on the SSE stream ends the web session with a session-ended frame
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: A stale auth cookie on the SSE stream ends the web session with a session-ended frame
  detail: With anonymousAccess, a stale or revoked auth cookie downgrades /api/sse to an anonymous 200, so the web client never noticed the session end and live updates stopped silently. The stream now opens with a session-ended frame carrying the rejection code and expires the auth cookies; the renderer-web live-events client calls onSessionEnded once for it.
  -->

## 0.363.0

### Minor Changes

- 58452ae: ctx.notify in write handlers delivers after commit

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: ctx.notify in write handlers delivers after commit
  detail: Inside a write handler's transaction ctx.notify only records the notification and delivers it once the write has committed, so a rolled-back write sends nothing and leaves no attempt event. Delivery no longer takes a connection from the app pool while the write holds one, which deadlocked at pool max N with N parallel writes. With immediate: true the call stays synchronous and runs its DB work on the outside-transaction pool.
  migration: |
    NotifyResult is now a union, NotifyDispatched ({ kind: "dispatched", deliveries }) or NotifyDeferred ({ kind: "deferred" }). In a write handler without immediate: true ctx.notify returns deferred and delivers after commit (a rollback means no notification). Code that reads the result (for example a "send test message" handler showing sent/failed) sets immediate: true, which delivers synchronously on the outside-transaction pool and returns dispatched; narrow on kind before reading deliveries. Errors such as a missing idempotency Redis, a tenant broadcast without the tenant feature or an unknown notification type no longer throw in a deferred write handler, they land in the afterCommit log. Notifications from jobs, from seeding and from handlers without a transaction stay synchronous. The boot default wires tenantUserIdsQuery for to: { tenant } when the tenant feature is mounted, so an app-side tenantUserIdsQuery wiring can go. Custom NotifyFactory implementations receive an optional 4th parameter deliveryDb, and DeliveryService.notify an optional 6th.
  -->

- 09a4aa2: New content editor format "document" for template bodies, built on the shared document schema

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: contentFormat "document" with a toolbar editor for mail and PDF templates
  detail: ContentEditorFormat gains "document". template-resolver registers DocumentContentEditor for it (tiptap, lazy-loaded) and stores the body as html. The toolbar offers paragraph style, bold, italic, lists, links, placeholders and the blocks image, table, button, divider, repeat and page break; the blocks prop picks them (MAIL_DOCUMENT_BLOCKS, PDF_DOCUMENT_BLOCKS). Placeholders are inserted only as variable nodes (data-variable), never as {{name}} text. ContentPreview does not substitute example values for "document" content, because substituting a button or link href would make the schema drop that node. New exports from template-resolver/web: DocumentContentEditor, DocumentEditorProps, DocumentToolbarBlock, MAIL_DOCUMENT_BLOCKS, PDF_DOCUMENT_BLOCKS.
  -->

- fcd6eb4: Shared type guards and fewer unchecked casts in framework internals

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Shared type guards and fewer unchecked casts in framework internals
  detail: "@cosmicdrift/kumiko-types/type-guards" exports isPlainObject, isOneOf and errorCodeOf. The framework replaces many unchecked as-casts with narrowing, generic query rows and table-introspection helpers. encryptPiiFieldValues is generic over the row and returns PiiEncryptedRow<TRow>, so callers read encrypted fields without casts. Behavior stays the same.
  -->

- 2972bc2: r.notification declares variables, mail template text and meta

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: r.notification declares variables, template and meta; applyBootSeeds seeds them
  detail: r.notification accepts variables (typed with templateVariable.text, link, money, date and list), template (per locale body, document html) and meta (per locale subject and more). Boot validation requires a kebab-case name, a meta.<locale>.subject for every template locale and valid placeholder names. templateVariablesToZod turns the variables into a Zod schema. applyBootSeeds calls seedNotificationTemplates, which writes the text as system templates of kind mail and fails loudly when notifications declare a template but the template-resolver feature is not mounted.
  -->

- ef689d8: r.notification without trigger, localizedTemplate and mail locale helpers

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: r.notification works without trigger and ships localized templates
  detail: trigger, recipient and data are optional and must be declared together, a notification without trigger is sent explicitly through ctx.notify. localizedTemplate groups body and meta per locale and is mutually exclusive with template and meta. The variable names link, money and date are reserved for template helpers. ctx.notify validates the data against the declared variables and fails the write on a missing required variable. New exports are listMailLocales, hasMailTranslationKey, assertNotificationVariables and NotificationLocalizedTemplate.
  -->

- cbed66e: Template resources (images) and mail attachments

  <!-- kumiko-changes
  feature: template-resolver
  type: breaking
  title: linkedResources is no longer a payload field of upsertSystem/upsertTenant; resourceUpload and resourceRemove manage it
  detail: Two steps - upload the image with POST /api/files (multipart, no entityType), then call template-resolver:write:resource-upload with { sourceFileRefId, templateId?, key? }. The handler re-encodes the caller's own unclaimed upload into a new file ref (width at most 1200 px) and links it into the template; resource-remove unlinks a key. upsertSystem and upsertTenant no longer accept linkedResources and leave the stored value untouched on update. The size cap is the system config key resource-max-bytes (default 2 MiB); a cap above the files route's maxUploadSize has no effect because the upload is rejected first. The source upload stays as an unclaimed file.
  migration: |
    Whoever sent linkedResources with upsertSystem or upsertTenant now uploads the image via POST /api/files (multipart, no entityType) and links it with template-resolver:write:resource-upload { sourceFileRefId, templateId, key }. Server-side seeding (seedSystemTemplate linkedResources) stays.
  -->

  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: Notification messages carry attachments (file refs and inline cid images)
  detail: RenderedMessage and the send job payload accept attachments as references (kind file or inline), never bytes. ChannelContext.readAttachment resolves them tenant-scoped at send time; createDeliveryService takes a new filesForTenant option for the inline fallback path.
  -->

  <!-- kumiko-changes
  feature: channel-email
  type: improvement
  title: Email channel sends file attachments and inline cid images
  detail: EmailMessage.attachments is sent through the SMTP transport (inline images with Content-ID). notify data.attachments with kind file entries are resolved through the file store; the PII guard rejects ciphertext file names.
  -->

  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: NotifyFactory takes an optional fileProviderResolver, so immediate and bootstrap mails can read attachments too
  -->

  <!-- kumiko-changes
  feature: template-resolver
  type: improvement
  title: Bundle import re-encodes its images like resource-upload; re-seeding keeps uploaded system resources
  detail: importBundle and importBundleSystem store each bundle resource through the same normalization as resource-upload (decoded format decides the content type, SVG and non-images are rejected, width at most 1200 px, resource-max-bytes applies), so an exported bundle carries the re-encoded bytes. seedSystemTemplate without linkedResources no longer resets the links of an existing row, so images a system admin uploaded survive the next boot. storeTemplateResource from the template-resolver barrel is the normalizing store; the raw byte variant is gone.
  -->

  <!-- kumiko-changes
  feature: delivery
  type: fix
  title: Queued mails render with the tenant's config again
  detail: The delivery render and send jobs read the tenant config through ctx.configFor, which job contexts do not carry, so queued mails rendered without tenant name, locale, currency and branding. Both jobs now use ctx.config, which the job runner builds for the payload's tenant.
  -->

- 366d89f: Template validation query, layout kinds as structured html, bundle import/export, copy-locale and notification record mapping

  <!-- kumiko-changes
  feature: template-resolver
  type: breaking
  title: Tenant mail-layouts are structured html, pdf-layout and document-pdf are placeholder-validated
  detail: A new validate query dry-runs the write pipeline (used, unknown and missing placeholders, canSave, canPublish). document-pdf, pdf-layout and mail-layout now go through the same placeholder gate as mail; document-pdf and pdf-layout know the system placeholders page and pages. A tenant mail-layout is html with a data-content slot plus header, signature and footer regions that renderer-mail-html wraps in a fixed MJML frame; raw mjml (with {{{content}}} exactly once) is system-only. New handlers export-bundle, import-bundle, import-bundle-system and copy-locale move a template with its resource files between tenants and locales. r.notification accepts a record mapping from an entity row to the declared variables, validated at boot. publish and archive no longer touch system rows through a tenant-scoped SystemAdmin.
  migration: |
    Tenant mail-layout rows stored as mjml are ignored by the renderer, which falls back to the system layout; re-create them as html with a data-content slot. upsert-system answers with an extra validation field. seedSystemTemplate errors now read `<label> rejected: <code> (<detail>); ...`. Layout bodies without the content slot are rejected on write. `set` now runs the same gate for mail, document-pdf, pdf-layout and mail-layout rows and rejects unsanitized markup or publish issues, since saving publishes; the mail renderer also re-sanitizes stored tenant html layouts and falls back to the system layout when they fail. upsert-system and upsert-tenant no longer accept linkedResources (resources go through the resource upload; bundle import and copy-locale attach them). Unknown data-resource keys are a validate warning (resource_not_uploaded), not a write error.
  -->

- a12e094: propertyOf type guard and fewer unchecked casts in the UI packages

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: propertyOf type guard and fewer unchecked casts in the UI packages
  detail: "@cosmicdrift/kumiko-types/type-guards" exports propertyOf, which reads one property off an unknown value. Headless, renderer, renderer-web and dispatcher-live replace unchecked as-casts and globalThis probes with it and with narrowing. Behavior stays the same for well-formed input; a format spec, upload response or stream event with a wrongly typed property is now ignored instead of passed through.
  -->

## 0.362.0

### Minor Changes

- 0e8fe37: `entityList` accepts `allowCreate: false` to hide that list's "+ New" button and empty-state create action. Unlike `allowCreate: false` on an `entityEdit` screen, the entity's edit screen keeps its create branch, so a custom action can still open it with a prefill.

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: EntityListScreenDefinition.allowCreate
  detail: allowCreate false hides the list's create button and empty-state create action; the entity's edit screen keeps its create branch.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: entityList honours allowCreate false
  detail: EntityListBody passes no onCreate when the list sets allowCreate false.
  -->

- ef14b5a: Dashboard stat panels and `StatCard` accept the tone `ok` (status green) next to `positive`, which keeps following the theme primary color. `toneField` results of `"ok"` are honoured.

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: Stat tone "ok"
  detail: DashboardStatPanel.tone accepts "ok" for a status-green value.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Stat tone "ok"
  detail: StatCard and dashboard stat panels render tone "ok" with the status-ok tokens, also via toneField. An app-side exhaustive Record<StatTone, …> needs an "ok" entry.
  -->

## 0.361.0

### Minor Changes

- a3a51aa: An edit field can be pre-filled when the create form opens. `{ field: "date", prefill: { kind: "today" } }` fills a date field with today's calendar date in the user's time zone, `{ field: "inspector", prefill: { kind: "currentUser", property: "displayName" } }` (or `email`, `id`) fills from the signed-in user. Only empty values are filled, the update form and values from URL params or a handoff are never touched, and unlike a field `default` nothing is applied server-side. The auth session now provides the user through the new `CurrentUserProvider` / `useOptionalCurrentUser()` renderer context, and `user:me` additionally returns `effectiveTimeZone`, the user's effective IANA zone (own setting, else tenant, else UTC); without a user zone the locale resolver's zone is used.

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: EditFieldSpec.prefill
  detail: New EditFieldPrefill, today or currentUser with displayName, email or id, on the object form of EditFieldSpec.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot check for edit field prefill
  detail: validateBoot allows today only on date fields, currentUser displayName and email only on text fields and id on text or reference fields.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Create form prefill and CurrentUserProvider
  detail: EntityEditCreateBody applies prefill to empty initial values. New exports CurrentUser, CurrentUserProvider and useOptionalCurrentUser.
  -->

  <!-- kumiko-changes
  feature: user
  type: improvement
  title: user:me returns effectiveTimeZone, SessionProvider provides the current user
  detail: The me query adds effectiveTimeZone (ctx.tz.user), CurrentUserProfile.effectiveTimeZone is parsed by fetchCurrentUser and SessionProvider wraps its children in CurrentUserProvider.
  -->

- a3a51aa: An `entityEdit` screen can show an existing record as a read-only view. `readOnly: { field: "acknowledged", eq: true }` (any `FieldCondition`) is evaluated against the loaded record only and never applies to the create form. While it holds, every field including file upload and embedded-list row actions is disabled, and the screen has no save, discard or delete button and no unsaved-changes footer; record actions and cancel stay. The title resolves `screen:<id>.view.title` first and falls back to `screen:<id>.title`. This is UI only: write protection still comes from access rules and handlers on the server.

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: entityEdit screens accept a readOnly condition
  detail: EntityEditScreenDefinition.readOnly is a FieldCondition evaluated against the loaded record. UI only, the server is not affected.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot check for the entityEdit readOnly condition
  detail: validateBoot rejects a screen readOnly condition whose field is not a field of the screen's entity.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Read-only view mode for entityEdit
  detail: RenderEdit takes viewMode, which disables all fields and removes submit, discard, delete and the dirty footer while keeping record actions and cancel. The update body sets it when screen.readOnly holds for the record and resolves screen:<id>.view.title before screen:<id>.title.
  -->

- a3a51aa: An embedded list field on an edit screen can lock parts of its table. `{ field: "checkpoints", embeddedList: { readOnlyCells: ["text"], fixedRows: true } }` shows the named columns as non-editable cells and removes add, remove, duplicate and move (including Tab-appends-a-row and pasting past the last row), while the other cells stay editable. Boot validation rejects `embeddedList` on a field that is not an embedded list and `readOnlyCells` that are not sub-fields.

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: EditFieldSpec.embeddedList for read-only cells and fixed rows
  detail: New EmbeddedListEditSpec with readOnlyCells and fixedRows on the object form of EditFieldSpec.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot check for embeddedList on edit fields
  detail: validateBoot requires the field to be an embedded list and every readOnlyCells entry to be a sub-field.
  -->

  <!-- kumiko-changes
  feature: headless
  type: improvement
  title: Edit view model carries read-only cells and fixed rows
  detail: EmbeddedListCellViewModel.readOnly and EditFieldViewModel.embeddedListFixedRows are derived from EditFieldSpec.embeddedList.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: EmbeddedListColumn.readOnly and EmbeddedListInput fixedRows
  detail: EmbeddedListField forwards both, skips readOnly columns when pasting and never appends rows from a paste when rows are fixed.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Embedded list input honours readOnly cells and fixed rows
  detail: A readOnly column renders disabled cells; fixedRows hides the actions column, the add button and the empty-state button and stops Tab/Enter from appending a row.
  -->

- a3a51aa: A select sub-field of an embedded list can be shown as segmented buttons in its table cell. Declare `display: "radio"` on the sub-field, the same option a single select field already has; the default in a cell stays a dropdown.

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: display on embedded select sub-fields
  detail: The select variant of EmbeddedSubFieldDef accepts display radio or dropdown.
  -->

  <!-- kumiko-changes
  feature: headless
  type: improvement
  title: Embedded list cells carry the select display
  detail: EmbeddedListCellViewModel.display is taken from the sub-field.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: EmbeddedListColumn.display
  detail: EmbeddedListField forwards the select display to the EmbeddedListInput primitive.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Segmented select in embedded list cells
  detail: A select column with display radio renders the SegmentedSelect control, now in its own module so the embedded list input can use it.
  -->

- a3a51aa: An entity can declare `lockedWhen: FieldCondition`, for example `lockedWhen: { field: "status", eq: "closed" }`. The event-store executor refuses `update` and `delete` on a stored row whose state meets the condition, so generic CRUD, custom handlers (whatever they return), nested `ctx.write` and jobs running as a regular user are all covered. The write answers 409 `record_locked` (`errors.recordLocked`) and the transaction rolls back, so no event is written. The check reads the state before the write, so the write that sets the lock still passes. A row that lacks the condition field counts as locked. The check runs after the entity and field ownership checks and before the event append, so a caller without write rights sees `ownership_denied`, not 409. `forget` (Art. 17) never checks the lock. A write by the framework system user skips it only when the executor call names a `writePurpose` (`WritePurposes.retention` or `WritePurposes.erasure`, exported from `@cosmicdrift/kumiko-framework/db`); retention cleanup, the user-data erasure hooks and tenant destroy set it, so statutory deletion and anonymisation reach locked rows. A system-user write without a purpose is rejected like any other. A server-code call site that must change a locked row on purpose passes `{ unsafeSkipLockGuard: true }` as an executor option; neither it nor `writePurpose` is ever read from a request payload. Boot rejects a condition on an unknown field, on a `personal` or `encrypted` field, and on any type other than text, longText, select, boolean, number or reference. An `entityEdit` screen without its own `readOnly` shows a locked record as a read-only view, so the condition is declared once; a record that lacks the lock field (for example no read right on it) is always shown as a view, like the server treats it; `screen.readOnly` adds a UI-only condition on top; either one shows the view. A parent delete with `onDelete: cascade` or `setNull` answers 409 for the parent when a child row is locked, instead of removing or detaching it with the parent; this check runs in the dispatch delete lifecycle, so a write handler that returns the result of a parent `forget` is held back by a locked cascade child too. Remaining limits: `restore` is not guarded (it brings back unchanged data), and a custom projection that reacts to a domain event from `ctx.appendEvent` can still change a locked row, because that bypasses the executor. An app-written erasure hook should use `forget`; one that deletes or anonymises a locked row with `delete` or `update` needs `writePurpose: WritePurposes.erasure` as the system user, or `unsafeSkipLockGuard` as a regular user.

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: EntityDefinition.lockedWhen and the executor options unsafeSkipLockGuard and writePurpose
  detail: lockedWhen is a FieldCondition evaluated against the stored row. update and delete on the EventStoreExecutor take unsafeSkipLockGuard to opt one call out, and writePurpose (WritePurposes.retention or erasure) lets the framework system user through. EntityEditScreenDefinition.readOnly is combined with the entity's lockedWhen (either shows the view).
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Locked records reject executor writes
  detail: The event-store executor checks entity.lockedWhen against the loaded row in update and delete and fails with RecordLockedError (409, code record_locked, i18n key errors.recordLocked); a missing condition field counts as locked. Create, restore, forget, framework-system-user writes that name a writePurpose and the write that sets the lock pass. validateBoot rejects a lockedWhen field that is unknown, personal, encrypted or not a plain scalar type.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: entityEdit shows locked records as a view
  detail: EntityEditUpdateForm shows the view when screen.readOnly matches or entity.lockedWhen matches or its field is missing from the record. Adds the default string errors.recordLocked.
  -->

  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: German string for locked records
  detail: Adds errors.recordLocked.
  -->

  <!-- kumiko-changes
  feature: locale-es
  type: improvement
  title: Spanish string for locked records
  detail: Adds errors.recordLocked.
  -->

- f2346e5: `primaryAction` on a projectionDetail screen names the header action that renders as the filled primary button; the boot validator rejects an id that is not a header action.

  `emptyState` on an entityList or projectionList defines the title, description and an optional action for an empty list, and `description` now also shows on searchable lists; a search or filter without matches shows its own "no entries match" text (`kumiko.list.empty.filtered`).

  `header.statusToneField` on a projectionDetail screen picks the `statusTones` entry from another record field, so a badge text like "Terminated on 31.03.2027" keeps its tone.

  A writeHandler `redirect` accepts `tab` to open a specific tab of a projectionDetail target.

  File and image fields render as a rectangular thumbnail (variant, then original, then placeholder) or the file name instead of an id, in read-only forms and in list cells; `{ format: "image" | "file" }` selects the same display for list columns.

  On narrow screens the status badge of a projectionDetail header moves into the page body so a long status stays readable, and the header keeps the edit pencil.

  In a flow layout an edit field with `span` takes a full row.

  Writes now reject file and image field values whose file id does not exist or does not belong to the writer's tenant, with a validation error on the field.

  File and image fields only request ids that are UUIDs and encode the id and variant in the URL path.

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Writes with file ids from another tenant are rejected
  detail: A create or update that puts a file id into a file or image field now fails with a ValidationError (code invalid_element, path = field name) when the id is not a UUID, does not exist, or belongs to another tenant. That includes files stored under the SYSTEM tenant. On update only the changed fields are checked. The check runs for every write that returns a save result, inside the transaction, before pending file refs are bound. System users created for a tenant pass with that tenant's own files.
  migration: Check seeds, imports and handlers that copy file ids across tenants or reference files uploaded as SYSTEM. Upload the file in the target tenant (or copy it there) before writing its id. A custom handler that writes through an executor directly, without returning a save result, is not covered and needs its own check.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Searchable lists show their description as its own row
  detail: An entityList or projectionList with search used to hide its description. It now renders as a muted row below the toolbar, the same as on lists without search.
  migration: Look at lists that set description together with search. Drop descriptions that were only kept as a hint for developers, or move the text into emptyState if it explains an empty list.
  -->

## 0.360.0

### Minor Changes

- cc46b78: Session cookies written Secure and without a Domain attribute now use the `__Host-` prefix: `__Host-kumiko_auth`, `__Host-kumiko_csrf` and `__Host-kumiko_tenant`. A browser only accepts such a cookie when it is Secure, Path=/ and host-only, so a sibling subdomain can no longer set or shadow it. With `auth.cookieDomain` or without Secure the plain names stay. The new auth option `secureCookies` forces the Secure flag (default: `NODE_ENV === "production"`); buildServer resolves it once.

  The base names and the naming rule live in `@cosmicdrift/kumiko-types/session-cookies` (`AUTH_COOKIE_BASE`, `CSRF_COOKIE_BASE`, `TENANT_COOKIE_BASE`, `sessionCookieName`, `resolveSessionCookieNames`). `readCsrfToken()` reads the prefixed csrf cookie first and falls back to the plain one.

  A request that carries the auth or the csrf cookie name twice is treated as having no session cookie (anonymous with `anonymousAccess`, otherwise 401) and the response expires every cookie variant, so a shadowed or stale duplicate can no longer pin a browser to the wrong session.

  The Origin guard now also runs without `allowedOrigins` when the app's public origin is known: the new auth option `publicOrigin`, which runProdApp fills from `auth.mail.baseUrl` and then from the `APP_BASE_URL` env. It admits that origin plus the request's own host. Without such a URL runProdApp warns at boot in production and keeps running.

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Secure host-only session cookies use the __Host- prefix
  detail: Auth, csrf and tenant cookies are named __Host-kumiko_auth, __Host-kumiko_csrf and __Host-kumiko_tenant when they are written Secure and without a Domain (the tenant cookie is always host-only). With auth.cookieDomain or without Secure the auth and csrf names stay kumiko_auth and kumiko_csrf. New auth option secureCookies forces Secure (default NODE_ENV === "production"). Login deletes the legacy unprefixed host-only cookies, logout and deleteTenantCookie delete the prefixed and the legacy names. The server reads only the resolved names, so a request that carries only the legacy kumiko_auth is anonymous. AUTH_COOKIE_NAME, CSRF_COOKIE_NAME and TENANT_COOKIE_NAME are removed from the framework and dispatcher-live; the base names and sessionCookieName() are exported from @cosmicdrift/kumiko-types/session-cookies and @cosmicdrift/kumiko-framework/api, getSessionCookies(c) returns the resolved names of a request. The testing package's CSRF_COOKIE_NAME stays and resolves to the unprefixed name (e2e servers run without Secure).
  migration: Every user logs in once after the deploy, because the old kumiko_auth cookie is no longer read. Custom clients, proxies or scripts that read or forward the cookies by literal name break: read the names through sessionCookieName() / resolveSessionCookieNames() (types package) or getSessionCookies(c) on the server, and handle both the prefixed and the plain name in browser code (readCsrfToken() already does). Replace imports of AUTH_COOKIE_NAME, CSRF_COOKIE_NAME and TENANT_COOKIE_NAME with AUTH_COOKIE_BASE, CSRF_COOKIE_BASE and TENANT_COOKIE_BASE plus sessionCookieName(); e2e helpers that imported CSRF_COOKIE_NAME from @cosmicdrift/kumiko-dispatcher-live import it from @cosmicdrift/kumiko-testing/e2e instead (known: solon e2e/_helpers/api.ts and e2e/session-ended.spec.ts, kumiko-enterprise ai-agent-live-transcription.integration.test.ts uses AUTH_COOKIE_NAME). A reverse proxy that strips or rewrites cookie names must pass the __Host- names unchanged. Staging or preview deployments over plain http need no change (Secure is off there); set auth.secureCookies (also accepted by runProdApp) explicitly when TLS terminates before the app and NODE_ENV is not "production". A standalone createAuthRoutes mount outside buildServer must also mount sessionCookiesMiddleware with the same resolved names, otherwise the readers fall back to the domain-less default.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Duplicate session cookie names end the cookie session
  detail: When the Cookie header carries the resolved auth or csrf cookie name more than once, authMiddleware ignores the cookie transport and expires every variant (prefixed host-only, legacy host-only, the cookieDomain variant and retired domains). With anonymousAccess the request continues as anonymous, otherwise it gets 401 missing_token; a Bearer token on the same request still authenticates. A prefixed and a legacy name side by side are not a duplicate. The cookie clearing moved from the auth routes into clearSessionCookies in session-cookies.ts; ResolvedSessionCookies carries domain and retiredDomains.
  -->

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Origin guard defaults on when the public app URL is known
  detail: New auth option publicOrigin. Without allowedOrigins, cookieDomain and unsafeSkipOriginCheck, buildServer mounts the Origin guard for cookie-authenticated state-changing /api requests and admits publicOrigin plus the request's own host (Host header). runProdApp sets publicOrigin from auth.publicOrigin, then auth.mail.baseUrl, then the APP_BASE_URL env (origin only, path dropped); with none of them in production it logs a warning that the Origin guard is off and boots anyway. allowedOrigins keeps its strict meaning, and the WebSocket check and the anonymous downgrade still use only allowedOrigins.
  migration: Cookie-authenticated POST, PUT, PATCH or DELETE requests from a page on another origin than the public app URL and than the API host itself now get 403 origin_not_allowed in runProdApp deployments that set auth.mail.baseUrl or APP_BASE_URL. A web client served from a different host than the API (for example a sibling subdomain) must list its origin in auth.allowedOrigins. Same-host setups, custom domains served by the same server and Bearer clients need no change.
  -->

- b0e8bd3: New `renderer-pdf` bundled feature: `renderTablePdf(doc)` draws a table document as a PDF in pure JavaScript (pdf-lib, no browser, no native dependency). The document has a title, meta lines, weighted columns, cell wrapping, a header row repeated on every page and a footer with page numbers. `createRendererPdfFeature()` registers it as the `pdf` plugin for `kind: "document-pdf"` in `renderer-foundation`. Recipe: `samples/recipes/pdf-audit-export`.

  `createFileRefFromBytes(ctx, { fileName, mimeType, data, attachTo? })` from `@cosmicdrift/kumiko-framework/files` stores bytes a write handler or job produced itself as a FileRef. It runs the same pipeline as `POST /api/files`, which now calls it too. That covers the identifier check, field resolution, size and accept limits, content sniffing and the MIME allowlist, the tenant-bound storage key and the `fileRef.created` event. Rejections come back as 422 `file_rejected` with the upload error in `details.error`.

  `createImagesField({ capture })` forwards `capture` to the edit view model the same way `createImageField` does.

  Cron jobs take an optional IANA time zone: `trigger: { cron: "0 7 * * *", tz: "Europe/Berlin" }`. Boot aborts for an invalid zone.

  `createUserProfileFeature({ allowEmailChange: false })` drops the `change-email` handler and the email section of the profile screen. The default keeps both.

  <!-- kumiko-changes
  feature: renderer-pdf
  type: improvement
  title: Pure-JS PDF renderer for table documents
  detail: renderTablePdf(doc, options?) renders a PdfTableDocument (title, subtitle, meta lines, weighted columns, wrapped cells, header row repeated per page, footerText and a pageLabel template with {page} and {pages}) to PDF bytes with pdf-lib. Characters outside WinAnsi are replaced by "?". Identical input yields identical bytes. createRendererPdfFeature() registers it as plugin "pdf" for kind "document-pdf"; payload.variables is validated against pdfTableDocumentSchema, anything else fails with RendererError invalid_payload.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: createFileRefFromBytes creates FileRefs from handler- or job-produced bytes
  detail: createFileRefFromBytes({ db, files, registry, user }, { fileName, mimeType, data, attachTo? }) shares one pipeline with POST /api/files, so identifier checks, field-level maxSize/accept, content sniffing, MIME resolution, the tenant-prefixed storage key and the fileRef.created event are identical. The tenant always comes from ctx.user. A rejected file returns a 422 write failure with reason file_rejected and the upload error string in details.error. The FileRef's insertedById is the passed user, so the default access guard lets only that user and privileged roles read files attached to an entity.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Cron jobs with an IANA time zone, images fields with capture
  detail: A cron trigger accepts tz (IANA name; without it the server process zone applies) and is scheduled in that zone, DST included. r.job() throws at boot for an invalid zone. createImagesField accepts capture ("environment" | "user") like createImageField, and the edit view model carries it for images fields.
  -->

  <!-- kumiko-changes
  feature: user-profile
  type: improvement
  title: change-email can be switched off
  detail: createUserProfileFeature({ allowEmailChange: false }) neither registers the change-email write handler nor shows the email section on the profile screen. Without the option nothing changes.
  -->

- 16fe359: Behaviour change: files uploaded from an update form are now attached to the record. `computeEditViewModel` takes the edited record's id (`entityId`, update mode only) and puts it on the hints of `file`, `image`, `files` and `images` fields. `RenderEdit` passes the id it was mounted with, the file input sends it as the `entityId` part of `POST /api/files`, and the new `buildFileUploadFormData` builds that body. Before, such uploads carried only `entityType` and `fieldName`, so `ctx.derivatives.variant(...)` on a qr-overlay variant threw because the FileRef had no `entityId`. Uploads from a create form are bound to the new record by the create itself: after a successful create, every file id in the record's `file`, `image`, `files` and `images` fields that is still pending (same entity and field, no `entityId`, uploaded by the same user) gets the record id through a regular `fileRef.updated` event in the create's transaction.

  Attached files are readable by everyone who may read their record: the default file access guard runs the entity's `<entity>:detail` query as the requesting user (handler access, row ownership and parent visibility apply) when the user is neither the uploader nor in `privilegedRoles`. Delete stays with the uploader and `privilegedRoles`. Entities without a detail query keep the uploader/privileged rule.

  `images` and `files` fields have an edit widget. `FileListField` shows one tile per stored file with move up, move down and remove buttons plus one empty tile to add a file, and hides the add tile at `maxCount` or when the field is read-only. It is composed from the existing `Input kind="file" | "image"`, `Button` and layout primitives, so web and native primitive sets get it without a new primitive kind. `required: true` on `images`/`files` is now allowed and means "at least one file". `NO_WIDGET_FIELD_TYPES` shrinks to `jsonb` and `embedded`. The edit view model carries `maxCount` for these fields.

  Embedded lists are accessible: every cell control has an accessible name ("Qty, row 2"), also in the mobile card layout, and the row-actions column header uses the translated `kumiko.field.embedded-list.actions` instead of a hard-coded "Actions". `EmbeddedListInput` has a new required `actionsLabel` prop; custom primitive sets must pass it through. `MoneyInput`, `DateField`, `TimestampInput` and `ComboboxInput` accept an optional `ariaLabel`.

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Uploads from an update form are attached to the record
  detail: computeEditViewModel accepts entityId (the record being edited, update mode only) and sets it on the hints of file, image, files and images fields; RenderEdit passes the id it was mounted with and the file input sends it as the entityId multipart part of POST /api/files. Create forms send no entityId; after a successful create the write pipeline binds the caller's own pending uploads named in the record's file fields (same entityType and fieldName, entityId null, insertedById = caller) to the new record via a fileRef.updated event in the same transaction, for single and plural file fields alike, when the files feature (fileRef entity) is mounted. Behaviour change: such files are now attached to the record. The default file access guard allows read on an attached file to the uploader, privilegedRoles (default Admin/SystemAdmin) and everyone whose run of the entity's <entity>:detail query returns the record; delete stays uploader and privilegedRoles only. A qr-overlay variant of an image field no longer throws for a file uploaded from an update or create form. Write-form sections send no entityId. EmbeddedListInput has a new required actionsLabel prop.
  migration: Files attached through forms now follow the record's read access instead of being tenant-wide: anyone who cannot read the record no longer reads the file, anyone who can read it does. Check image, images, file and files fields whose files must be visible beyond the record's readers (for example an avatar shown in lists to users without detail access) and add those roles to privilegedRoles or set accessGuard in the files feature options. An entity without a detail query falls back to uploader plus privilegedRoles. Files uploaded before the update keep their old attachment. Custom primitive sets that implement EmbeddedListInput accept the new actionsLabel prop and render it as the actions column header; custom file/image Input primitives forward entityId into the upload and offer a remove control that calls onChange(null).
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: images and files fields get an edit widget; required is allowed
  detail: NO_WIDGET_FIELD_TYPES now holds only jsonb and embedded. required true on an images or files field passes boot validation and the client-side check treats an empty array as missing. The edit view model carries maxCount for files and images fields.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: FileListField edits images and files fields
  detail: RenderField renders type images and files as FileListField instead of the unsupported banner. One tile per stored FileRef id with move up, move down and remove buttons, one trailing empty tile to add a file (hidden at maxCount or when read-only). It is built from Input kind file or image, Button and the layout primitives, passes accept, maxSize, entityType, entityId, fieldName, imageVariant and capture to every tile, and reads only string ids from the stored value. The read-only text display of these fields lists the ids. New i18n keys kumiko.field.file-list.add, move-up, move-down and empty; kumiko.field.file-upload.upload, change, remove, attached and failed; kumiko.field.embedded-list.actions and cell-label. The file and image Input kinds accept entityId. EmbeddedListInput has a new required actionsLabel prop.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: File inputs post entityId; embedded list cells have accessible names
  detail: FileUploadInput accepts entityId, translates its labels (kumiko.field.file-upload.*) and builds its multipart body with the exported buildFileUploadFormData. Every embedded list cell control (text, number, boolean, date, timestamp, money, select, reference) carries aria-label "<column>, row <n>" in the table and the mobile card layout, and the actions column header uses the actionsLabel prop instead of the fixed "Actions". MoneyInput, DateField, TimestampInput and ComboboxInput accept an optional ariaLabel.
  -->

  <!-- kumiko-changes
  feature: headless
  type: improvement
  title: Edit view model carries entityId and maxCount for file fields
  detail: ComputeEditViewModelInput has an optional entityId (the record being edited, omitted on create). EditFieldViewModel gains entityId for file, image, files and images fields and maxCount for files and images. The file-field hints now also cover type files, which was missing.
  -->

  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: German strings for the file list widget and embedded list accessibility
  detail: Adds kumiko.field.file-list.add, empty, move-down and move-up, kumiko.field.file-upload.attached, change, failed, remove and upload, plus kumiko.field.embedded-list.actions and cell-label.
  -->

  <!-- kumiko-changes
  feature: locale-es
  type: improvement
  title: Spanish strings for the file list widget and embedded list accessibility
  detail: Adds kumiko.field.file-list.add, empty, move-down and move-up, kumiko.field.file-upload.attached, change, failed, remove and upload, plus kumiko.field.embedded-list.actions and cell-label.
  -->

## 0.359.0

### Minor Changes

- dacda2f: actionForm screens now honour the `excludedFields` of the write handler they call. `buildAppSchema` projects them onto the screen as `writeExcludedFields` (a flat list, since an actionForm has one handler and no create/update mode). The form shows those fields read-only, does not require them and never sends them, so a handler that excludes a field no longer needs a hand-written `readOnly` lock on its screen.

  `custom-fields:write:update-tenant-field` accepts a payload without `serializedField.type` and keeps the stored type. A different type is still refused with 422 `field_type_immutable`. The handler declares `excludedFields: ["type"]`.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: actionForm screens honour the called handler's excludedFields
  detail: buildAppSchema projects the handler's excludedFields onto actionForm screens as writeExcludedFields (a flat list, unlike entityEdit's per-verb object). The form shows these fields read-only, not required and never in the payload.
  migration: Drop a hand-written readOnly lock on an actionForm field once the handler it calls declares excludedFields for it.
  -->

  <!-- kumiko-changes
  feature: custom-fields
  type: improvement
  title: update-tenant-field keeps the stored type when serializedField.type is omitted
  detail: custom-fields: update-tenant-field accepts serializedField without type and keeps the stored type; a different type is still refused with 422 field_type_immutable. The handler declares excludedFields ["type"].
  -->

## 0.358.0

### Minor Changes

- 5037fe8: Dashboards keep their width at 390 px and the stacked-area chart reads better

  The dashboard grid has an explicit single column on narrow screens and its cells can shrink, so a wide panel no longer stretches the page. The panel header wraps: title, subtitle and range switch stack instead of squeezing into one row. The KPI strip delta chip no longer wraps, it moves below the label when space is short. Stacked-area charts get a taller plot, a compact y axis ("1,5 Mio. €"), dashed grid lines, calendar-aligned x-axis ticks that thin out with the container width, and larger brush handles (24 px hit area). New panel option `markerLabels` writes marker labels vertically next to their guide lines on wide panels; narrow ones keep numbered pins with a list below. Labeled stat groups now wrap their cards instead of overflowing when values are wide (e.g. 2 + 1 instead of 3 columns).

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Dashboards fit 390 px screens; stacked-area chart gets compact axis, grid lines, x ticks and markerLabels
  -->

- e028f23: Entity PII fields get personal.whenAbsent: "tenant"; a nullable owner field without it fails boot

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Entity PII fields need whenAbsent: "tenant" when the owner field is nullable
  detail: |
    personal: { of: "<owner>", whenAbsent: "tenant" } makes rows without an owner editable, deletable and forgettable with an active KMS, without plaintext PII. The subject is resolved in this order: the owner on the previous row, the owner the same event sets, then the tenant key (tenant:<tenantId>). Before, an update, delete or forget of an ownerless row failed with SubjectResolutionError (HTTP 500) once a KMS was configured. backfill-pii follows the same chain and checks the projection row for the owner before it falls back to the tenant key; an updated event whose previous.owner is null but whose changes.owner is set no longer loses the owner. Entity fields have no plaintext fallback, so "tenant" is the only value. bundled jobs: cron and system runs (triggeredById null) now store payload, error and log messages as ciphertext under the system tenant key instead of plaintext.
  migration: |
    Boot now aborts for a personal: { of: "<owner>" } field whose owner field is not required and that declares no whenAbsent: [Feature X] Field "f" on entity "e" is personal: { of: "ownerId" }, but "ownerId" is not required — rows without an owner would fail to encrypt (SubjectResolutionError, HTTP 500) on update, delete and forget. Declare { personal: { of: "ownerId", whenAbsent: "tenant" } } to encrypt those rows under the tenant key, or make "ownerId" required: true. Entity fields have no plaintext fallback (fw#3654). Fix: add whenAbsent: "tenant", or make the owner field required: true if every row has one. whenAbsent on personal: { of: "id" } throws at declaration. Known consumer sites: kumiko-enterprise kumiko-credit entity.ts and bauspar-entity.ts (ownerUserId), ai-agent entity.ts (authorId, ownerId) and attachment-store.ts (authorId), ai-conversation entity.ts (authorId), pattern-storage entity.ts (authorId), offlot-app src/features/lead/schema/entity.ts (enquiryId). Existing plaintext job-run rows of cron runs stay readable; new ones are ciphertext.
  -->

## 0.357.0

### Minor Changes

- 774c60c: Executor update accepts includeDeleted for soft-deleted rows

  `executor.update(payload, user, db, { includeDeleted: true })` loads the row without the soft-delete filter (the tenant filter stays), so server code can move a trashed row together with its parent (for example a team change) and a later restore lands consistently. The row stays deleted. The default is unchanged (NotFound) and the generic HTTP update handler never sets the option. The projection apply was already unfiltered by `isDeleted`, so live and rebuild agree. The search consumer treats an update on a soft-deleted row as a removal, so the moved row does not reappear in search.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Executor update accepts includeDeleted for soft-deleted rows
  -->

- d7872bd: Multi-select options can be hidden per caller, and the member roles form only offers assignable roles

  `MultiSelectFieldDef.optionsAvailabilityQuery` names a query that returns `{ rows: { value, disabled?, hint? }[] }`, called with an empty payload. The renderer hides every option whose row has `disabled: true`, in the combobox and in the `display: "checkboxes"` grid, unless the value is currently selected. `hint` is ignored because the combobox cannot show a per-option hint. Static `options` stay authoritative, and until the result arrives or when the query fails all options are shown, so the write path still has to enforce the rule. Boot fails when the query is empty or not a registered query handler, on entity fields and on form screen fields.

  The tenant feature registers `tenant:query:member-role-availability` and wires it to the `roles` field of `memberRolesEditScreen`. An Admin no longer sees TenantAdmin or an app role declared with `assignableFrom: "TenantAdmin"`; a TenantAdmin sees every role. The rank rule is the one `updateMemberRoles` already enforces, so the server behaviour is unchanged.

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: MultiSelectFieldDef.optionsAvailabilityQuery hides static multiSelect options per caller
  detail: The query returns { rows: { value, disabled?, hint? }[] }; disabled options are hidden unless currently selected.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot validation covers multiSelect optionsAvailabilityQuery on entity and screen fields
  -->

  <!-- kumiko-changes
  feature: headless
  type: improvement
  title: Edit view-model carries selectOptionsAvailabilityQuery for multiSelect fields
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: MultiSelect inputs load optionsAvailabilityQuery and hide unavailable options
  -->

  <!-- kumiko-changes
  feature: tenant
  type: improvement
  title: The member roles form only offers roles the signed-in admin may assign
  detail: New query tenant:query:member-role-availability; TenantAdmin still sees every role.
  -->

### Patch Changes

- 91501d3: secretMint `reveal.acknowledge` (i18n key) renders a checkbox on the reveal card that must be ticked before the confirm step or the acknowledge button can be used; the tick never reaches the payload. Text fields accept an `autoComplete` token that reaches the input. The MFA enable screen uses both: a "saved my recovery codes" gate and `one-time-code` on the code field

  <!-- kumiko-changes
  feature: auth-mfa
  type: improvement
  title: MFA enable asks to confirm saved recovery codes, code field autocompletes one-time codes
  -->

## 0.356.0

### Minor Changes

- 77c6851: entityEdit actions can go into the header "..." menu via placement: "menu"

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: entityEdit actions can go into the header "..." menu via placement: "menu"
  -->

  `EntityEditScreenDefinition.actions` entries accept `placement: "inline" | "menu"` (new types `EntityEditAction` and `EntityEditActionPlacement`). The default stays inline: the action renders with the secondary form actions in the footer. `"menu"` puts it into the header "..." menu ahead of copy-link and delete, with the same confirm dialog and busy lock as other menu items. Without a header menu (drawer, card form, shell without a header slot) a `"menu"` action falls back to a footer button. The role projection keeps `placement`.

## 0.355.0

## 0.354.1

## 0.354.0

### Minor Changes

- 03c000a: crossTenant removed from entity convention handlers; write handlers with escapeHatch need SystemAdmin-only access

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: crossTenant removed from entity convention handlers; write handlers with escapeHatch need SystemAdmin-only access
  migration: |
    Replace crossTenant: true with escapeHatch: { reason } (run bun node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/migrate-cross-tenant.ts, then replace its placeholder reason, which is rejected otherwise). A create/update/delete/restore handler with escapeHatch must declare access: { roles: ["SystemAdmin"] }; list and detail handlers keep their access.
  -->

- c10805f: Tenant-visible job run state: `r.job({ tenantVisibleRun })` plus `jobs:query:tenant-runs`

  A tenant can read whether work for a subject is queued or running, with its times, and the last completed or failed run. Counterpart to `tenantVisibleFailure`, without payloads, error texts or logs.

  - `JobDefinition.tenantVisibleRun: { subjectFields? }`: opt in per job. `subjectFields` name primitive payload fields that scope the state (stored in clear, never a PII field). A non-primitive value fails the run, as for `tenantVisibleFailure`.
  - New table `store_tenant_job_runs`: run `kumiko-schema generate <name>` in your app and apply the migration (`kumiko-schema apply`). It stays empty until a job opts in.
  - `jobs:query:tenant-runs` (payload `{ jobName?, subject?, limit? }`, every membership rank, own tenant only) returns `{ rows: [{ jobName, subject, status, queuedAt, startedAt, finishedAt }], nextCursor: null }`: all queued and running runs plus the latest completed or failed one per job and subject, active runs first.
  - A failed attempt that BullMQ retries shows as `queued` again; only the final failure shows `failed`. The stale-run sweep fails `running` rows and drops `queued` rows older than `staleRunTimeoutHours`; `retention-cleanup` purges finished rows older than `retentionDays`.
  - `JobRunnerOptions` gains optional `onJobQueued(jobName, jobId, { tenantId, subject })` and `onJobDropped(jobName, jobId)`; `JobMeta.tenantVisibleRun` and `JobOutcomeMeta.tenantVisibleRun` carry the subject to `onJobStart`/`onJobComplete`/`onJobFailed`. `jobRunLoggerCallbacks` and the test stack wire them automatically; existing callbacks keep working.

  <!-- kumiko-changes
  feature: jobs
  type: improvement
  title: Tenant-visible job run state: r.job({ tenantVisibleRun }) plus jobs:query:tenant-runs
  detail: A job that declares `tenantVisibleRun` keeps its queued, running, completed and failed state per tenant and subject in the new table `store_tenant_job_runs`, and the tenant reads it through `jobs:query:tenant-runs` (payload `{ jobName?, subject?, limit? }`, own tenant only). Each row is `{ jobName, subject, status, queuedAt, startedAt, finishedAt }`: every queued or running run plus the latest completed or failed one per job and subject, active runs first. No payload, error text or log ever reaches the tenant. A failed attempt that is retried shows as `queued` again. The stale-run sweep and `retention-cleanup` also cover the new table. `JobRunnerOptions` gains `onJobQueued` and `onJobDropped`.
  migration: New store table. Run `kumiko-schema generate <name>` and apply the migration with `kumiko-schema apply` - `store_tenant_job_runs` is created empty and stays empty until a job declares `tenantVisibleRun`. No change needed for apps that do not opt in.
  -->

- cc7e2ce: actionForm and secretMint screens gain `submitPrefilled`: a row action that navigates in with `params` can submit the form right away, with the record id carried in a hidden or read-only field.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Row actions can open a secretMint or actionForm that submits without edits
  -->

- 8d5fa1a: Select fields gain `conditionalOptions`: options that are only available while a condition on a sibling field holds, filtered in the form and enforced on write.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Select field options can depend on another field
  -->

- 4803d4c: Stacked-area charts and panels pick the date format by span, can start at today regardless of the default range, scale the y axis finer and list markers in the legend

  - `dateFormat` ("day" | "month"): automatic by visible window, month and year from 18 months, day and month below; `formatBucketLabel` and `formatMarkerTime` receive the format as second argument.
  - `initialWindow` ("default-range" | "from-today"): "from-today" starts at today even with `ranges.default` set; the range switch then shows no active pill.
  - The y scale rounds up in finer steps (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8), so 1.1 million tops out at 1.2 million instead of 2 million.
  - `markerLegend` ("list" | "legend") with `DashboardChartMarkerKind.label` and `ChartMarker.legendLabel`: unnumbered pins with tooltip and one dashed legend entry per marker kind. Boot validation checks the new props, the marker kind labels are required i18n keys.
  - `@cosmicdrift/kumiko-bundled-features/tenant-lifecycle/testing` exports `runTenantDestructionSweep`, `seedDestroyingTenant` and `driveDestructionToCompletion` for destroy tests.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: StackedAreaChart and the stacked-area dashboard panel take dateFormat, initialWindow and markerLegend and round the y scale in finer steps
  -->

  <!-- kumiko-changes
  feature: tenant-lifecycle
  type: improvement
  title: tenant-lifecycle/testing exports runTenantDestructionSweep, seedDestroyingTenant and driveDestructionToCompletion
  -->

- fde53b0: Reference fields can opt out of the handover with handover: "stay"; boot depth limit and mover share one graph definition

  ReferenceFieldDef gains handover: "stay". An entity that should NOT travel with its host but points at it through a plain reference no longer blocks the claim with entity_not_transferable when that reference field carries handover: "stay": the edge is not walked, its rows stay in the source tenant, and the reference crosses the tenant boundary after the handover. Without the opt-out the behaviour is unchanged (entity_not_transferable at claim time). Migration: an entity that should NOT travel with its host: mark the reference field handover: "stay" (removing transferable alone does not help once rows exist, the claim still fails). The framework now exports one adjacency definition (resolveEntityTransferAdjacency, reference and parentRef edges, non-transferable intermediate nodes included, handover: "stay" respected) that the boot validator's depth limit and the tenant-handover mover both use. Consequence: the boot-time MAX_TRANSFER_DEPTH check now also counts parentRef edges and chains running through non-transferable entities, as the mover always did; a graph that was deeper than 5 hops only through such nodes now fails the boot instead of the claim.

  <!-- kumiko-changes
  feature: tenant-handover
  type: improvement
  title: Reference fields can opt out of the handover with handover: "stay"; boot depth limit and mover share one graph definition
  -->

### Patch Changes

- a734025: Event append without a transaction is atomic; ctx.outsideTransaction; pending-gap ranges merge and are exported as a gauge; seed scan starts at the highest consumer cursor

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Event append without a transaction is atomic; ctx.outsideTransaction; pending-gap ranges merge and are exported as a gauge; seed scan starts at the highest consumer cursor
  -->

- edcb2d0: event-store-executor list: the search path now asks the SearchAdapter for up to 1000 candidate ids instead of the adapter's default 50, so hits beyond the 50th are no longer silently dropped. When the adapter returns the full 1000 (Meilisearch's maxTotalHits cap), the list result carries `searchTruncated: true` (new optional field on `CursorResult`) so clients can tell the match set may be incomplete.

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: list search no longer drops hits beyond the 50th candidate
  -->

- a62e62c: Database, event-store consumer, search and Redis review fixes

  `db.global(table)` writes are rejected on executor-managed entity tables, and `unsafeRaw` handles derived through `begin`, `transaction` or `reserve` keep the personal-data gate. Reference sorting and search re-check label and read access plus ownership, and a stale search index can no longer surface another tenant's row. A cross-tenant convention handler reports one audit event per touched row with that row as target.

  A failing dispatcher pass no longer records its error on a consumer whose cursor moved in the meantime and skips a row another pass holds locked. A projection rebuild aborts when the configured blind-index key differs from the one used to build the live table. An array `ne` filter on a jsonb column means "does not contain all of these", matching the entity list filter. `date` columns that still hold a timestamptz log a warning once per column.

  `kumiko_event_dispatcher_listen_connected` only drops to 0 on a real connection-loss error and is restored when the pre-check recovers. A consumer logs once when it tracks more than 1000 pending gap ranges. The lazy Meilisearch default config no longer overwrites settings stored by an earlier `configure()` after a restart.

  Access invalidation publishes through `PubSubSignal.publishConfirmed`, so a Redis failure fails the consumer and the event is redelivered instead of being dropped (`SseBroker.publishAccessInvalidation` may return a promise). `KUMIKO_REDIS_CHANNEL_PREFIX` namespaces the SSE and feature-toggle Pub/Sub channels for apps sharing one Redis; `createRedisToggleSyncSignal` takes the prefix as an optional third argument. Types that mention `Temporal` now carry the `temporal-polyfill/global` reference into their `.d.ts` files.

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: db.global(table) writes on executor-managed entity tables are rejected
  migration: Write entities through the entity executor and keep db.global for hand-written unmanaged tables.
  -->

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: unsafeRaw handles derived through begin, transaction or reserve keep the personal-data gate
  -->

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: A stale search index can no longer surface another tenant's row
  -->

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: A projection rebuild aborts when the blind-index key differs from the one used to build the live table
  -->

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: An array ne filter on a jsonb column means "does not contain all of these"
  -->

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Access invalidation publishes with confirmation so a Redis failure redelivers the event
  -->

- 6bd7df1: Final review batch D.

  - `FileHandle.derive(suffix)` now throws unless the suffix is `<name>-<16 hex>` (build it with `variantSuffix(name, spec)`). Free-form suffixes such as `derive("thumb")` wrote keys the forget/tenant-destroy sweep could not recognize, so those binaries survived erasure. Callers passing a bare name must switch to `variantSuffix`.
  - `resolveKmsWiring` / `requireKmsWiring` throw when a `*_CIPHERTEXT` slot is set without its plaintext, pointing at the async entry points, instead of a misleading "trio required" error or a silent plaintext-PII fallback.
  - Event-PII owner/`whenAbsent` resolution now also runs without a configured KMS, so a missing owner fails in dev like in prod.
  - PII event backfill queues rebuilds under a per-run migration id, so a peer replica's re-queue is no longer cleared by another run.
  - `seedAdminGuarded` re-writes the canonical admin's email so the blind index is repaired, and skips undecryptable foreign user rows instead of aborting the boot seed.
  - A tenant-bound `FileContext.list` refuses prefixes outside the tenant's key space.
  - An entityList whose create screen was dropped for the caller's roles now carries `createUnavailable`, so the renderer no longer falls back to a generic create form.
  - Boot validation rejects an object-form `redirect` with `idFrom` whose same-feature target screen carries no id.
  - `defineFeature` throws when `dedupeOptions` holds a nested object (it can never compare equal across two mounts).
  - `FileContext.ref` and `list` (tenant-bound) refuse keys outside `${tenantId}/`; list columns accept `virtual: true`; `httpRoute` session-only routes now pass the global IP rate limit; tenant timezone cache TTL is 30 s; text fields without a personal stance warn at boot; the orphan-derivative sweep keeps derivatives whose original still exists; `piiFields` owner fields that can never yield a string throw unless `whenAbsent` is set.

  <!-- kumiko-changes
  feature: files
  type: breaking
  title: FileHandle.derive throws for suffixes outside <name>-<16 hex>
  migration: Build the suffix with variantSuffix(name, spec) instead of passing a free-form string.
  -->

  <!-- kumiko-changes
  feature: files
  type: breaking
  title: A tenant-bound FileContext.list throws for prefixes outside the tenant's key space
  migration: Pass a prefix that starts with `${tenantId}/`.
  -->

  <!-- kumiko-changes
  feature: files
  type: breaking
  title: A tenant-bound FileContext.ref throws for keys outside the tenant's key space
  migration: Use keys that start with `${tenantId}/`.
  -->

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: defineFeature throws when dedupeOptions holds a nested object
  migration: Flatten dedupeOptions to primitive values.
  -->

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Boot validation rejects an object-form redirect with idFrom on a screen that has no id
  migration: Point the redirect at a screen with an id or drop idFrom.
  -->

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: A list column absent from the query output schema must set virtual: true
  migration: Add virtual: true to computed columns that are not part of the query output.
  -->

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Session-only httpRoutes now pass the global IP rate limit
  -->

  <!-- kumiko-changes
  feature: files-tenant-data
  type: fix
  title: The orphan-derivative sweep keeps derivatives whose original still exists in storage
  -->

- 67d8d41: Final review batch F: renderer, renderer-web, types

  The boot validator rejects a `listScreenId` that matches no mounted screen, a `sortable` column that the list cannot sort (entityList: any value; projectionList: `true`) and an authored `urlPrefillFields`. `TreeAction` is a union: exactly one of `screen` or `target`. `Button` without children needs `icon` and `ariaLabel`. `RenderEditControls` gains `next` and `back`, and `controls.submit()` saves on an intermediate wizard step. An actionForm money field with a tenant currency that cannot be loaded shows an error instead of submitting with a guessed EUR. The MFA setup and recovery-code buttons sit below the content. The boot context passes Redis to the delivery service, so `notify` with an `idempotencyKey` dedupes. `user:query:user:detail` skips the tenants label when the tenant feature is not mounted.

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Grid columns is number | "auto"
  migration: Pass a number or "auto" to Grid columns; other values no longer type-check.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: breaking
  title: Button without children requires icon and ariaLabel
  migration: A custom wrapper that forwards ButtonProps must pass either children or both icon and ariaLabel.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: RenderEditControls has next and back; submit saves on an intermediate wizard step
  migration: No action needed. A host that renders its own wizard buttons with hideActions can call controls.next(), controls.back() and controls.submit().
  -->

  <!-- kumiko-changes
  feature: renderer
  type: fix
  title: actionForm money fields with a tenant currency block the form when the currency cannot be loaded
  migration: No action needed. secretMint and the reference create dialog keep their fallback currency.
  -->

  <!-- kumiko-changes
  feature: renderer-web
  type: breaking
  title: MFA setup and recovery-code buttons moved from Section actions to the section body
  migration: Section actions always render in the title row. Put a footer button into the section children instead of Section actions.
  -->

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Boot validator rejects inert sortable, authored urlPrefillFields and an unknown listScreenId
  migration: Remove sortable from entityList columns and sortable true from projectionList columns (declare sorting on the entity field), remove urlPrefillFields from form screens (buildAppSchema derives it from navigate params), and point listScreenId at a mounted screen short id.
  -->

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: TreeAction is screen XOR target at the type level
  migration: Give every createAction and actions[] entry either screen or target, not both and not neither; the boot validator already rejected the other forms.
  -->

  <!-- kumiko-changes
  feature: user
  type: fix
  title: user:query:user:detail skips the tenants label when the tenant feature is not mounted
  -->

  <!-- kumiko-changes
  feature: server-runtime
  type: fix
  title: Boot context passes Redis to the delivery service
  detail: notify with an idempotencyKey used to throw because the delivery service had no idempotencyRedis. Production boot, dev boot and the worker boot now hand over the existing Redis.
  migration: No action needed.
  -->

  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: Dev boot passes Redis to the delivery service so notify idempotencyKey dedupes
  migration: No action needed.
  -->

- a7bbfc3: Final review batch G: guards and tooling

  The security guards (`direct-fetch`, `direct-entity-writes`, `tenant-escalation`, `unsafe-json-parse`, `html-escape`, `no-direct-fs`, `restricted-symbols`, `admin-api`, `access-denied-test`, `open-to-all-reason`, `escape-hatch-declared`) now scan a `tooling` root too. `direct-fetch` rejects a `guard-allow` marker without a specific reason. The `direct-entity-writes` canary also blocks when table declarations exist but write resolution finds nothing. `@cosmicdrift/kumiko-types` accepts the `postgres` prerelease alias in its peer range.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: Security guards scan the tooling root, direct-fetch guard-allow needs a concrete reason, types postgres peer accepts the prerelease alias
  -->

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

- f05c4e7: `r.crud` takes per-verb `agents` hints, and same-named features only dedupe when their registered surface matches

  `registerEntityCrud` accepts `agents: { delete: { risk: "high" } }` so one irreversible verb can be raised without raising create/update. `dedupeFeatures` additionally requires equal entity and handler key sets before collapsing two same-named features with equal `dedupeOptions`; otherwise it throws the existing duplicate-feature error instead of silently dropping the second one. `i18nKey()` marks live on a `globalThis` registry so two installed framework copies agree.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: r.crud accepts per-verb agent hints and dedupeFeatures no longer drops a same-named feature that registers different handlers
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

## 0.352.0

### Minor Changes

- 9fb0657: Cap reservations run after every pre-handler gate and settle with the handler transaction

  Handlers wrapped with `withCapEnforcement` used to reserve capacity before rate limits, access and payload validation had run, so a rejected caller could use up cap or trigger a soft-warn. The dispatcher now runs the same gates, billing rate limits once, before it calls `reserveBeforeTransaction`; a failing gate rejects the command and releases the reservations taken before it. A hook that returns a `ReservationHandle` also confirms inside the handler transaction after the handler succeeded, and a confirm failure fails the write.

  Calendar reservations are now rows in the new `store_cap_reservations` table: the counter increment and the row commit together, the handler transaction deletes the row on its own commit, and a release only gives back what is still booked. Rolling caps reserve the same way: a version-guarded `rolling-incremented` append plus a reservation row before the handler transaction, undone by the new `cap-counter:event:rolling-released` event. `readRollingCapUsage` returns incremented minus released amounts in the window, never below 0. Rows a crashed process left behind expire after 60 minutes and are given back before the next reserve for the same cap. `withCapEnforcement` keeps the wrapped handler's other settings and chains an existing `reserveBeforeTransaction` of that handler: the inner reservation is taken first and given back if the outer one fails.

  <!-- kumiko-changes
  feature: cap-counter
  type: breaking
  title: Calendar cap reservations are stored in the new store_cap_reservations table
  detail: Capped writes now insert and delete rows in store_cap_reservations, so they fail until the table exists.
  migration: Generate and apply a migration with `kumiko-schema generate` — capped writes fail without the new store_cap_reservations table
  -->

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Rate-limited, denied or invalid callers no longer consume cap usage or trigger soft-warn, because pre-handler gates run before reserveBeforeTransaction
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: reserveBeforeTransaction may return a ReservationHandle whose confirmInTransaction settles the reservation inside the handler transaction
  -->

  <!-- kumiko-changes
  feature: cap-counter
  type: improvement
  title: Reservations expire after 60 minutes and are swept before the next reserve of the same cap
  -->

  <!-- kumiko-changes
  feature: cap-counter
  type: fix
  title: withCapEnforcement keeps the wrapped handler's settings (rateLimit, additionalRateLimits) and composes with an inner reserveBeforeTransaction
  -->

  <!-- kumiko-changes
  feature: cap-counter
  type: improvement
  title: withRollingCapEnforcement reserves before the handler transaction and releases through the new rolling-released event, so rejected or failed writes no longer consume rolling cap
  -->

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

- 9fb0657: Direct `temporal-polyfill` imports are now a manual upgrade step and a guard error

  Since 0.351.0 the native `globalThis.Temporal` is the single Temporal source whenever the runtime has one. App code that still imports `Temporal` from `temporal-polyfill` gets the polyfill classes, while the framework hands it native ones, so `instanceof Temporal.Instant` and `z.instanceof(Temporal.Instant)` fail ("expected Instant, received Instant"). 0.351.0 shipped this as an improvement, so `kumiko-upgrade` never flagged it. It now shows up as an open manual step, and the new No-Temporal-Polyfill-Import guard reports every value import from `temporal-polyfill` (including `temporal-polyfill/global`, re-exports, `import()` and `require`) outside kumiko-types, with the replacement import. `import type` and `/// <reference types="temporal-polyfill/global" />` stay allowed.

  <!-- kumiko-changes
  feature: types
  type: breaking
  title: Apps must import Temporal from @cosmicdrift/kumiko-types/temporal instead of temporal-polyfill (affects every app since 0.351.0)
  detail: Since 0.351.0 the native globalThis.Temporal wins over the polyfill. A Temporal imported from "temporal-polyfill" is a second implementation, so instanceof and z.instanceof(Temporal.Instant) reject values the framework creates. This applies whether you upgrade from before 0.351.0 or are already on it.
  migration: Replace every value import from "temporal-polyfill" in app code and tests, e.g. `import { Temporal } from "temporal-polyfill"`, with `import { Temporal } from "@cosmicdrift/kumiko-types/temporal"`, and drop side-effect imports of "temporal-polyfill/global" (importing @cosmicdrift/kumiko-types/temporal already installs the global when the runtime has none). `import type` and `/// <reference types="temporal-polyfill/global" />` may stay. Then run `kumiko check`; the No-Temporal-Polyfill-Import guard lists anything left. Close the step with `kumiko-upgrade --resolve <id> --reason "<what you changed>"`, or add `--not-applicable` when the repo never imported temporal-polyfill.
  -->

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: New No-Temporal-Polyfill-Import guard reports direct temporal-polyfill value imports outside kumiko-types
  detail: Scans source and test files (ts, tsx). Flags named, default, namespace and side-effect imports, re-exports, import() and require of "temporal-polyfill" or its subpaths, and prints the replacement import from @cosmicdrift/kumiko-types/temporal. Type-only imports and triple-slash type references pass.
  -->

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

- 44be746: One Temporal implementation: `@cosmicdrift/kumiko-types/temporal`

  The new export returns the native `globalThis.Temporal` when the runtime has it (Bun 1.4, current browsers) and falls back to `temporal-polyfill` otherwise, installing it on `globalThis`. Framework, bundled features and renderers import from there, so values made by the framework pass `instanceof` and `z.instanceof(Temporal.Instant)` checks in app code. `ensureTemporalPolyfill()` puts the same instance on the global. Apps should import `Temporal` from `@cosmicdrift/kumiko-types/temporal` instead of `temporal-polyfill`.

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: New @cosmicdrift/kumiko-types/temporal export resolves one Temporal (native first, polyfill as fallback) for framework and app code
  migration: Replace imports from "temporal-polyfill" with "@cosmicdrift/kumiko-types/temporal" so app code and framework share one set of Temporal classes.
  -->

### Patch Changes

- 44be746: ContainsSecret works on recursive types

  `ContainsSecret<T>` stops after eight levels of nesting. Query handlers whose output contains `DashboardI18nText` (which refers to itself through `i18nParams`) no longer fail to compile with TS2615. A secret nested deeper than that is still caught by the runtime leak guard.

  <!-- kumiko-changes
  feature: types
  type: fix
  title: ContainsSecret no longer fails with TS2615 on recursive types such as DashboardI18nText
  -->

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

## 0.348.1

## 0.348.0

### Patch Changes

- 400490e: withCapEnforcement reserves cap usage before the handler transaction

  `withCapEnforcement` used to check the cap and book the usage in two separate steps, so parallel calls could all pass the same stale read and exceed the hard limit. The wrapper now only declares the cap through the new `WriteHandlerDef.reserveBeforeTransaction` hook. The dispatcher runs the hook after the access, feature and schema checks and before the handler transaction opens. The hard-cap check and the increment are one short, version-guarded write that commits at once, so no connection is held across the handler and capped calls on the same counter still run in parallel. The returned release gives the amount back (never below 0) after the transaction ended without committing: rollback, failure result, throw or failed commit. Each reservation covers exactly one top-level execution: a capped handler reached through a nested `ctx.write` or run a second time in the same command is rejected. A wrapped handler now keeps its own `rateLimit`, `escapeHatch` and `additionalRateLimits` (the old wrapper dropped them). The reservation runs before the rate-limit gate, so a rate-limited caller can still cause reserve and release writes. If a COMMIT fails with an unknown outcome, the release can under-count. `bookCapUsage` accepts a `guardCurrentValue` callback, `markCapSoftWarned` and `enforceCapAndMaybeNotify` can write outside the handler transaction, and the soft-warning pre-check now honors `amount`. `withRollingCapEnforcement` is unchanged and keeps its check-then-book race.

  <!-- kumiko-changes
  feature: cap-counter
  type: fix
  title: withCapEnforcement reserves cap usage before the handler transaction so parallel calls cannot exceed the hard limit
  migration: No action needed. Calls above the hard limit are now rejected with cap_exceeded even when they race. A capped handler must not be called through ctx.write from another handler.
  -->

## 0.347.0

### Minor Changes

- a35ad24: actionForm screens can confirm a submit with the chosen record

  A new `successMessage` i18n key on an `actionForm` screen shows a confirmation above the form after a successful submit, for screens that stay put (no `redirect`, not in a drawer). `{field}` placeholders take the submitted values, and a `reference` field shows the chosen record's label instead of its id. The tier-engine admin form uses it: "Tier assigned: Acme → Pro", so choosing the wrong tenant is visible right away. New i18n key: `tier-admin.success` (en/de/es). `RenderEdit`'s `onSubmit` receives the submitted values as a second argument.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: actionForm successMessage names the chosen record's label after a successful submit
  -->

## 0.346.0

### Minor Changes

- 6b8dde4: `r.step.webhook.send` no longer accepts `retry`

  The option was never applied: every dispatch request is delivered once. Passing it is now a type error, and the dispatch-requested payload no longer carries it. Stored events that still contain `retry` are parsed and delivered as before.

  <!-- kumiko-changes
  feature: step-dispatcher
  type: breaking
  title: r.step.webhook.send drops the unused retry option
  migration: |
    Remove `retry` from `r.step.webhook.send` calls; it was never applied. Each dispatch request is delivered once; a delivery error ends as step.dispatch-failed.
  -->

## 0.345.0

## 0.344.0

## 0.343.0

### Minor Changes

- 446b714: Jobs whose `escapeHatch` grants `unsafeRaw` get `ctx.crossTenantReads` with `selectMany`, `fetchOne` and `count` across all tenants, read-only. Each call is reported as the new escape-hatch kind `cross-tenant-read`; system crons audit it once per process and the metric `kumiko_escape_hatch_uses_total` counts every call. `EscapeHatchKind` and the `escape-hatch-used` audit schema gain `cross-tenant-read`.

  `tenant-lifecycle:job:run-tenant-destruction` checks through `ctx.crossTenantReads` whether a tenant is due and only then calls `ctx.db.unsafeRaw()`, so idle minutes no longer write an `unsafe-raw` audit event.

  <!-- kumiko-changes
  feature: jobs
  type: improvement
  title: ctx.crossTenantReads for read-only cross-tenant job reads
  -->

- 6adca33: Screens take `visibleWhen` and `fallback`. Every screen definition accepts an optional `visibleWhen: { query, field, eq }` (the same `DashboardPanelVisibility` as dashboard screen panels) and an optional `fallback` (same-feature short id or `<feature>:screen:<id>`). `KumikoScreen` evaluates the condition before the screen content mounts, so it also applies when the screen is opened by URL. While the query loads only a loading banner shows. If the condition is not met or the query fails, the fallback screen renders, or without a fallback a standard notice (`kumiko.screen.unavailable`, en/de/es). The gate is UI only; handlers still enforce access. The boot validator checks the query, the output field and the fallback screen, and rejects a `fallback` without `visibleWhen`. Panels with `visibleWhen` behave as before and share the new `evalVisibleWhen` helper exported from the renderer.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Screens take visibleWhen and fallback
  detail: |
    Any screen can gate itself on a query field with `visibleWhen`, including on direct URL access. Unmet or failed conditions render the `fallback` screen or a standard notice instead of the content. New i18n key: `kumiko.screen.unavailable`.
  -->

## 0.342.0

## 0.341.0

### Minor Changes

- c5a7dc2: `r.secret` and `r.secretNamespace` accept a `valueSchema`. `secrets:write:set` checks the value against it after the key and role checks and answers a failure with a 400 validation error on field `value` (`secrets.errors.invalidValue`); the response never contains the value or the schema's issues. `secrets:write:delete` is unaffected.

  The chat channels use it: Slack, Discord and Teams webhook secrets must be URLs that pass the channel's host allowlist (including the Discord `/api/webhooks/` path), and the Telegram bot token must have the `<bot id>:<secret>` shape. The allowlist comes from the same options as the channel, so `createChannelSlackFeature({ allowedHosts })` also governs what can be stored.

  `channel-slack`, `channel-discord`, `channel-teams` and `channel-telegram` now export their secret keys (`SLACK_SECRET_KEYS`, `DISCORD_SECRET_KEYS`, `TEAMS_SECRET_KEYS`, `TELEGRAM_SECRET_KEYS`), allowlist constants and `isTelegramChatId` / `isTelegramBotToken`. `delivery` exports `checkChatWebhookTarget`, `chatWebhookUrlSchema` and `resolveChatWebhookTarget`, so apps can validate an address or URL when a user creates a channel.

  Existing invalid secrets stay stored; only new writes are checked. Writes through `ctx.secrets.set` in feature code run through the same check.

  <!-- kumiko-changes
  feature: secrets
  type: improvement
  title: Chat channel secret values are validated on write
  -->

- 82309a5: Chat channels (slack, discord, teams, telegram) now deliver in production boot. `runProdApp`, `runDevApp` and `runWorkerApp` pass the tenant secrets to the delivery service and hand queued channels to the `delivery.render`/`delivery.send` jobs of the calling context's job runner. `delivery.render` now receives `ctx.secrets` as well. Without a job runner, queued channels still deliver inline, now with secrets. `runBootstrap` is a one-shot process whose queue nobody drains after it exits, so it keeps delivering queued channels inline (the SystemAdmin invitation goes out before the process ends).

  `NotifyFn` returns a `NotifyResult` (`{ deliveries }` with channel, recipientId, status `queued | sent | failed | skipped`, error and `deliveryAttemptId` per delivery) instead of `void`. `NotifyOptions.immediate` delivers queued channels inline for one call and bypasses job retry, for "send test message" handlers. `NotifyFactory` takes an optional job dispatcher as third argument, and `DeliveryService.notify` an optional per-call dispatcher.

  Consumers: `NotifyFn` implementations in tests and mocks must now return a `NotifyResult`, e.g. `async () => ({ deliveries: [] })`. When running the API without a worker (`runSingleInstance: false`), a dedicated worker must process the delivery jobs.

  <!-- kumiko-changes
  feature: delivery
  type: breaking
  title: Chat channels deliver in production boot, ctx.notify returns a NotifyResult
  migration: |
    NotifyFn implementations in tests and mocks must return a NotifyResult, e.g. async () => ({ deliveries: [] }). Queued channels now run through the delivery jobs in production; an API-only deployment (runSingleInstance: false) needs a worker that mounts delivery and the channel features.
  -->

- c2c7862: `r.extendEntityProjection` accepts `rowIdOf`, the row id the extension's applies write for events on its `sources` when that id is not the aggregate id (for example a tenant-salted `uuidv5(tenantId|aggregateId)` over workflow events). The ghost-row guard of the projection rebuild now counts a live row as backed when its id is `rowIdOf` of a source event, so such projections can be rebuilt instead of aborting. The guard stays strict: a row keyed by the raw aggregate id of a derived source still aborts the rebuild.

  `rowIdOf` requires `sources`, must not name the entity's own stream, and must return a uuid; a source shared by several extensions needs the same `rowIdOf` in all of them. Violations fail at boot. `ProjectionDefinition` carries the result as `extraSourceRowIds`, and `assertNoUnreachableLiveRows` takes it as an optional fifth parameter. New type `ProjectionRowIdOf`.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: rowIdOf on extendEntityProjection for derived row ids
  -->

- e7dbdb6: r.httpRoute rateLimit option

  Per-IP limit enforced through the rate-limit resolver before the route guards; legal-pages and GET /user-export/by-token declare defaults.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: r.httpRoute rateLimit option
  -->

- dba5100: `ctx.notify` accepts `locale`, and the locale now travels through the delivery jobs (`delivery.render`, `delivery.send`) to `NotificationRenderer.render`, where `RendererInput.locale` is available. Jobs queued before this release have no locale and keep working. The email channel and `renderer-simple` pass it on; the auth mails and the consumer-protection mails set it to the language they already translate their content into. This lands in the same release as the `NotifyOptions` change from #3508.

  `MailBranding` for `renderer-simple` can now be localized: `footerText`, `footerLinks[].label` and `footerLinks[].url` take a plain string or a map of locale to string. The renderer picks the exact locale, then the language part (`de-AT` falls back to `de`), then the new optional `MailBranding.defaultLocale`, then the first entry. Every URL in a map must be an absolute http(s) URL, otherwise `createSimpleRenderer` throws at boot. Without a locale and with plain strings the HTML is unchanged.

  `MailBranding` also gets `logoPath` and `baseUrl`, so an app can point at a raster logo on its own origin (`logoPath: "/logo.png"`, `baseUrl` the same base as `auth.mail.baseUrl`). `logoPath` and `logoUrl` exclude each other, `logoPath` needs a valid `baseUrl`, must start with a single `/` and must stay on the base origin; violations throw at boot. Use PNG or JPEG, because mail clients block SVG.

  <!-- kumiko-changes
  feature: renderer-simple
  type: improvement
  title: Localized mail branding, locale through delivery, logoPath
  -->

- c5e6814: Write handlers can declare `additionalRateLimits: [{ per: { payloadField: "email" }, limit, windowSeconds }]` next to `rateLimit`. The named string field of the validated payload is trimmed, lowercased and HMAC-hashed (key derived from the server's current JWT signing secret) into the bucket key `payload+handler:<handler>:<field>:<digest>`, so one address is limited across all IPs and Redis never holds it in plaintext. The check runs after schema validation and before the handler, answers 429 `rate_limited`, behaves the same for matching and non-matching values, and is skipped for system callers. Rotating the JWT secret only resets these buckets.

  Boot rejects `additionalRateLimits` on an anonymous handler without a real ip-keyed `rateLimit` (the payload bucket only complements the IP bucket), an empty list, a `payloadField` that is not a field of the Zod object schema, and a non-positive `limit` or `windowSeconds`. A handler with `additionalRateLimits` makes `buildServer` wire the rate-limit resolver. The option exists on write handlers only and appears in the feature-ast patterns, render and patch schema.

  Behavior change: `request-contract-termination` and `signup-request` now allow 3 requests per email address per 24 hours, and each token-request endpoint (`request-password-reset`, `request-email-verification`, `request-account-unlock`) allows 5 per address per 24 hours, in addition to the existing per-IP limits. The public `/api/auth` token-request routes still answer `{ isSuccess: true }` when the limit is hit; only the mail is not sent.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Per-recipient rate limits on payload fields (additionalRateLimits)
  -->

## 0.340.0

### Patch Changes

- 483bb16: bun-db gains typed helpers for the cases that used to need raw SQL: `insertOnConflictDoNothing`, `selectInnerJoin`, a `jsonText` where operator for jsonb text fields and `orderByKeys` for `aggregateWhere`.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Typed bun-db helpers for insert-ignore, inner joins, jsonb text filters and key-ordered aggregates
  detail: |
    `insertOnConflictDoNothing(db, table, values, { conflictKeys? })` returns the inserted row, or `undefined` when the conflict target already exists. `selectInnerJoin(db, { left, right, on, leftWhere?, rightWhere?, leftFields?, rightFields?, limit? })` joins two tables on one or more column pairs (casting to text only when the column types differ) and returns `{ left, right }` rows; `rightFields` defaults to none, so secrets on the joined table are only read when named. The where operator `jsonText: { keys, eq }` compares `col->>key` on jsonb columns, with several keys combined through `COALESCE`. `aggregateWhere` accepts `orderByKeys: "asc" | "desc"` to sort groups by their key before `limit`. All identifiers come from the table metadata and all values are bound parameters. The helpers refuse tenant-scoped tables like the other raw-connection helpers; use the `TenantDb` methods there.
  migration: |
    keine
  -->

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: Where clauses and aggregate options describe jsonb text matches and key ordering
  detail: |
    `WhereOperator` gains `jsonText?: JsonTextMatch | readonly JsonTextMatch[]` with `JsonTextMatch = { keys: readonly [string, ...string[]]; eq: string }`, and the aggregate options gain `orderByKeys?: "asc" | "desc"`.
  migration: |
    keine
  -->

## 0.339.0

### Minor Changes

- 1954386: `ctx.db.unsafeRaw()` no longer takes a reason argument. The reason was never audited anyway: the `unsafe-raw` audit entry always carried the reason declared in `escapeHatch: { reason }` on the handler, hook or job (or the step reason for engine-forwarded steps). Dropping the parameter removes a second, unused reason string from every call site. `ctx.systemDb.unsafeRaw(reason)` is unchanged.

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: ctx.db.unsafeRaw() takes no reason; the audit uses the declared escapeHatch reason
  detail: |
    `TenantDb.unsafeRaw` is now `unsafeRaw(): DbRunner`. The `unsafe-raw` audit entry carries the reason from the `escapeHatch` declaration, as before. Calls without a matching declaration are still rejected with an `AccessDeniedError`.
  migration: |
    Replace `ctx.db.unsafeRaw("...")` with `ctx.db.unsafeRaw()`. The reason lives only in `escapeHatch: { reason }` on the handler, hook or job; TypeScript flags old calls. `ctx.systemDb.unsafeRaw(reason)` is unchanged.
  -->

### Patch Changes

- 5b6e5f7: The public § 312k cancellation pages work again: the confirm POST no longer fails with `400 tenant_required` on any host. New `consumerProtection.terminationScope: "platform"` serves the declaration on a host that resolves no tenant (the platform apex), for example publicstatus. Write handlers can declare `tenantlessAnonymous: true` for this. A public declaration's provider cancel now runs in a job instead of in the request.

  <!-- kumiko-changes
  feature: billing-foundation
  type: fix
  title: The § 312k confirm POST forwards the visitor's host to /api/write
  detail: |
    The `/legal/kuendigen` and `/legal/cancel` pages re-enter `/api/write` through the app. The re-entry now carries `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Tenant` and the `kumiko_tenant` cookie as the visitor sent them, so a host-based `tenantResolver` resolves the same tenant as for a direct call; before, it saw no host and every confirm failed with `400 tenant_required`. The session cookie, `Authorization` and `X-Forwarded-For` are not forwarded.
  migration: |
    keine
  -->

  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: consumerProtection.terminationScope "platform" for hosts without a tenant
  detail: |
    `consumerProtection.terminationScope` is `"tenant-host"` (default, unchanged) or `"platform"`. With `"platform"`, `request-contract-termination` is flagged `tenantlessAnonymous` and also runs on a host whose resolver returns no tenant: it finds the contract by the declarant's email as before, records on the matched tenant's subscription stream, and answers every outcome identically. An unknown option value fails at `createBillingFoundationFeature`.
  migration: |
    Apps that serve the pages on a platform apex (publicstatus) set `consumerProtection.terminationScope: "platform"`. Other apps change nothing.
  -->

  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: Public termination declarations cancel at the provider in a job
  detail: |
    For the public channel, `request-contract-termination` no longer calls the provider in the request. A matched request appends the PII-free `contract-termination-declared` event (`requestId`, `declarationType`, `terminationKind`, `receivedAtIso`, `locale`) via the system-only `declare-contract-termination`; the job `cancel-on-public-termination-declared` then runs `record-contract-termination`, which asks the provider for `cancel_at_period_end` and appends `contract-termination-requested` with the outcome. Matched and unmatched requests do the same work in the request, so the response time does not reveal whether the email is a customer. The job is idempotent per `requestId`. A provider without `cancelSubscription`, a provider error or a missing subscription now sends a separate operator notice with request id and tenant id but no name or email. A public withdrawal still makes no provider call. The account path (`terminate-contract`) stays synchronous.
  migration: |
    Code that expected `contract-termination-requested` right after the public request must wait for the job (in tests: `drainJobs`).
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Write handlers can declare tenantlessAnonymous
  detail: |
    `r.writeHandler({ ..., tenantlessAnonymous: true })` lets an anonymous `POST /api/write` for exactly that handler run under `SYSTEM_TENANT_ID` where the anonymous middleware would otherwise answer `400 tenant_required` (resolver silent, no client tenant). It never applies to `/api/batch`, to a client-supplied `X-Tenant` or `kumiko_tenant`, to `tenant_mismatch` or when a tenant resolved; `tenantExists` and the lifecycle gate are skipped for the system tenant. Boot rejects the flag unless `access.roles` is exactly `["anonymous"]` and a real `rateLimit` (not `{ disabled: true }`) is declared. `authMiddleware` gets the option `isTenantlessAnonymousWrite`, which `buildServer` builds from the registry.
  migration: |
    keine
  -->

## 0.338.0

### Minor Changes

- c710f1e: Config key definitions accept a new async `validate(value, ctx)` function. `config:write:set` runs it after the type, bounds and pattern checks and before the value is stored, for every scope and backing. A validator rejects the write by throwing a `KumikoError`, for example an `UnprocessableError`. The feature manifest reports `validated` per key.

  <!-- kumiko-changes
  feature: config
  type: improvement
  title: config keys can declare an async write validator that rejects with a KumikoError
  migration: |
    No action needed: keys without `validate` behave as before.
  -->

- 3613e5a: Handlers get `ctx.configFor(tenantId)`, a config accessor resolved for another tenant. The cap overview uses it so a cross-tenant limit reads the target tenant's config instead of the caller's.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: ctx.configFor(tenantId) resolves config for another tenant
  detail: |
    Query and write handler contexts get `configFor(tenantId)` next to `config`, present when the config feature wired its accessor factory. The accessor runs as the target tenant's system user on a db scoped to that tenant, so the caller's user-scope values never leak into the result. Calls for another tenant throw `AccessDeniedError` unless the caller is the system identity or has the `SystemAdmin` role; the caller's own tenant needs no privilege and returns the same accessor as `ctx.config`.
  migration: |
    No code change needed. Handlers that compute values for a tenant other than the caller's (limits, quotas, billing previews) call `ctx.configFor(tenantId)` instead of passing `ctx.config`.
  -->

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: ctx.configFor on the handler context types
  detail: |
    `configFor?: (tenantId: TenantId) => ConfigAccessor` is part of the shared handler context fields, optional like `config`.
  migration: |
    No code change needed.
  -->

  <!-- kumiko-changes
  feature: cap-overview
  type: fix
  title: Cross-tenant cap limits read the target tenant's config
  detail: |
    `caps:usage` with a SystemAdmin `tenantId` override and `tenant-caps:list` passed the caller's config accessor to `CapSpec.limit`, so a limit that reads a tenant-scoped config key showed the caller's value for every tenant. Both now resolve one accessor per target tenant through `ctx.configFor`, and `tenant-caps:list` resolves each tenant's limit separately instead of once per tier.
  migration: |
    No code change needed.
  -->

### Patch Changes

- 3451156: escapeHatch: new optional `grants` (`systemIdentity`, `globalWrites`, `unsafeRaw`) narrows what a declaration unlocks. Without `grants` the declaration keeps unlocking all three. An empty or unknown `grants` list is a boot error. Bundled handlers that only needed the raw runner now declare `grants: ["unsafeRaw"]`, so they no longer gain the SYSTEM identity switch.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: escapeHatch grants split the SYSTEM identity switch from raw access
  migration: |
    No action needed: `grants` is additive and an escapeHatch without it behaves as before.
    Declare `grants: ["unsafeRaw"]` on handlers that only call ctx.db.unsafeRaw to drop the SYSTEM identity switch.
  -->

## 0.337.1

### Patch Changes

- 6c1c1d4: The generated secrets screen now hides fixed secret keys the current user may not write according to the key's `writeRoles`, and drops sections left without visible keys. The generator emits a per-field `fieldAccess` map on the screen for this. It only affects what the UI shows; the server-side write check is unchanged and still decides.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Secrets screen hides keys the user cannot write
  -->

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

- e889f3f: `secrets:write:set` and `secrets:write:delete` now accept only keys declared via `r.secret`, and `r.secret` takes an optional `writeRoles` list. Before, any tenant admin could store a secret under an arbitrary key name.

  <!-- kumiko-changes
  feature: secrets
  type: breaking
  title: secrets:set and secrets:delete accept only keys declared via r.secret; r.secret takes writeRoles
  detail: |
    Both handlers reject a key that no feature declared with `r.secret` (404, i18n key `secrets.errors.unknownKey`). `r.secret` takes `writeRoles`: when set, only users holding one of those roles may set or delete that key (403, i18n key `secrets.errors.writeDenied`). The roles narrow the handler access, so both checks must pass. An empty `writeRoles` array throws at declaration.
  migration: |
    Declare every key you set through `secrets:write:set` via `r.secret`. Rows stored under undeclared keys stay in the table but can no longer be set or deleted through the API. A key that only SystemAdmin may write declares `writeRoles: ["SystemAdmin"]`, and the secrets feature must then grant SystemAdmin handler access via `createSecretsFeature({ roles: ["TenantAdmin", "SystemAdmin"] })`. Tests that set a key no feature declares need the same fix: the kumiko-studio test `bundled-stack.integration.test.ts` sets `ai-foundation:secret:anthropic-api-key`, which no feature declares; kumiko-ai-foundation 0.39.1 and 0.40.1 declare the Anthropic key as `ai-provider-anthropic:secret:anthropic-api-key`.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: r.secretNamespace declares a family of runtime-named secret keys
  detail: |
    `r.secretNamespace(name, { label, scope: "tenant", writeRoles?, nameSchema? })` declares the prefix `<feature>:<name>.` (kebab-cased) and returns `{ prefix, keyFor(name) }`. `secrets:write:set` and `secrets:write:delete` accept a key under that prefix when the suffix is non-empty and passes `nameSchema`; `writeRoles` applies to every key in the namespace. Namespaces are kept out of `getAllSecretKeys` and the generated secrets screen. `Registry.findSecretNamespace(key)` resolves the namespace of a key. step-dispatcher declares `webhook-auth`, so webhook auth secrets (`step-dispatcher:webhook-auth.<name>`) stay settable through the API.
  migration: |
    No code change needed. A feature that stores secrets under a runtime-chosen suffix declares a namespace instead of one `r.secret` per key.
  -->

## 0.336.1

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

## 0.335.0

### Minor Changes

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

- 1da9e2c: Dashboard list columns accept `display: "datetime"`, which formats an ISO string or epoch-ms value in the user's locale and time zone. The admin-shell overview lists use it for `startedAt` and `failedAt` instead of showing raw ISO strings.

  <!-- kumiko-changes
  feature: renderer-web
  type: fix
  title: Dashboard list columns support display "datetime"; overview lists no longer show raw ISO timestamps
  -->

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

## 0.333.0

### Minor Changes

- 2d7f76f: Apps declare assignable membership roles via `r.useExtension(EXT_ASSIGNABLE_ROLE, "<Role>", { assignableFrom? })` (the feature must `r.requires("tenant")`). `assignableFrom` defaults to "Admin"; set it higher to raise the bar. The role-elevation guard and the members/invite screens pick the declarations up; undeclared roles stay rejected. "Member" is now ranked with "User" and labelled.

  <!-- kumiko-changes
  feature: tenant
  type: improvement
  title: Apps declare assignable membership roles via EXT_ASSIGNABLE_ROLE
  -->

- 90420cb: Additive screen options for list, drawer, form and wizard screens

  entityList: `facets` (per-field `display: "chips"`, `showCounts`, `hideEmpty`, `extraOptions`, or `false` to hide), `defaultFilters` (initial value only, the URL wins, "no filter" stays chosen) and `rowActionMode`. Row actions get `display: "button" | "link" | "icon"`; with `display` set an action stays inline next to the kebab. Drawer actions get `title` / `subtitle` (i18n keys, `{param}` filled from the row prefill). Edit fields get `submit: false` (kept out of the payload), actionForm gets `footerActions` (patch values, then submit), relatedList gets `groupBy` / `rowTone` / `rowActionMode`. Wizard sections get `subtitle`, `layout.wizard.aside.upNext` adds an "up next" box, entityEdit gets `titleTemplate`. `Button` gets a `pressed` style, the DataTable contract `rowGrouping` / `rowTone`, `StepBar` `subtitles` / `upNext`, `Drawer` `subtitle`.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: New optional screen options for facet chips, default filters, row action display, drawer titles, footer actions, grouped related lists and wizard side info
  migration: No code change needed.
  -->

  - Screenshot runner: `SCREENSHOT_DESKTOP_WIDTH` overrides the desktop viewport width (default 1920).

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

- 541d24b: extensionSelector owner panels on the generated settings page

  `r.extensionSelector(extension, key, { panels })` lets the selector owner add its own `custom` or `screen` panels to the generated `<ownerGroup>-tenant` settings dashboard, after the selection panel and before the plugin panels. Short `screen` refs resolve against the declaring feature. Dead screen or `visibleWhen` query refs, empty, duplicate or `selection` panel ids fail at boot or declaration.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: A selector owner can add its own custom or screen panels to the generated settings page (extensionSelector panels)
  migration: No code change needed.
  -->

### Patch Changes

- b4e827d: `ActionMenuItemSpec` takes an optional `testId` that overrides the menu entry's default `data-testid` in the action overflow menu and the phone header menu. `Button` takes `expanded` (rendered as `aria-expanded`). New icon key `chevron-up`. Below 768 px the whole `header-actions` container sits in the closed "…" menu: E2E settled checks should wait for `[data-kumiko-layout="shell-header"]` and open header actions via `shell-header-overflow-trigger`.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Menu items accept testId, Button accepts expanded, chevron-up icon
  -->

## 0.331.0

### Minor Changes

- 16797a4: entityList rows can expand into a related list

  `expandableRow` on an entityList declares a related list under each row, with the same fields as a projectionDetail `relatedList` section (query, `parentFilter` or `parentParam`, columns, row and toolbar actions, emptyState). The parent id is the row's `id`. An arrow button at the start of the row opens and closes the area, carries `aria-expanded`, and works by keyboard. Several rows can be open at once. A successful write from the area reloads both the related list and the parent list, so counters on the parent row update. The boot validator and the role projection check the area like a relatedList section. `DataTableProps` gains `expandedRowIds`, `onToggleRowExpanded` and `renderExpandedRow` for custom DataTable primitives.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: entityList rows can expand into a related list with its own row actions (expandableRow)
  -->

- 3ea4ffc: relatedList columns can be formatted like entityList columns

  A relatedList section (projectionDetail tab or entityList `expandableRow`) takes an optional `entity`: an entity name or `feature:entity`. Columns that name a field of that entity render through the same cell formatter as an entityList column. A select shows as a status badge with its translated option label, dates are locale-formatted, and the header defaults to the field's label key. A column's own `sortable` still controls the header sort. The boot validator rejects an `entity` that does not resolve. Without `entity`, columns render as before.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: relatedList columns format select, date and other field types like entityList columns (entity)
  -->

- e4ea9f0: Select fields can load their options from a query

  A `select` config key and a `select` field on configEdit and actionForm screens accept `optionsQuery` (a query QN returning `{ rows: { value, label }[] }`) plus an optional static `optionsQueryPayload`. The Settings-Hub derives the field from the config key, the renderer mounts the query and shows the returned labels as they are. The boot validator rejects dead QNs, static `options` together with `optionsQuery`, `allowPerRequest` keys, and `optionsQuery` on entity fields. The write side does not check the value against the query result.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Select fields in configEdit and actionForm screens and select config keys can load their options from a query (optionsQuery)
  migration: No code change needed. Existing select fields and config keys keep their static options.
  -->

## 0.330.2

## 0.330.1

### Patch Changes

- 39c2fbd: projectionDetail tab panels get page padding, recordTitleField on projectionDetail

  Tab panels on a projectionDetail with `layout.mode: "tabs"` now pad their content like the rest of the page: extension, field-section, groups and writeForm tabs render as an unframed padded panel with space below the tab strip. relatedList tabs stay flush. This fixes extension tabs sitting flush against the shell edge since 0.330.0. `CardOptions.framed` (default true) drops the card frame and keeps the padding. A projectionDetail without `header` can set `recordTitleField`: the query output field then titles the page header (breadcrumb "list > record"). The boot check requires the field to be in the query's outputSchema and rejects it next to `header`.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: projectionDetail tab panels get page padding, recordTitleField on projectionDetail
  migration: |
    Extension tab panels get their padding back, so extension components that added their own padding to make up for the flush panel in 0.330.0 should drop it. Set `recordTitleField: "<field>"` on a projectionDetail without `header` to show the record name in the breadcrumb.
  -->

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

- 89e32ce: TenantDb.aggregate and aggregateWhere: grouped count, countDistinct, sum and avg with time buckets (fw#3396)

  `tenantDb.aggregate(table, { measure, groupBy?, orderByValue?, limit? }, where?)` and the standalone `aggregateWhere(db, table, spec, where?)` run one grouped aggregate with the same tenant scoping as `read`/`count`. A dimension can be a plain column or a time bucket (`{ field, bucket: 'hour' | 'day' | ..., timeZone }`) on a timestamptz column; bucket keys come back as epoch milliseconds. Types live in `@cosmicdrift/kumiko-types/aggregate-types`. Unknown fields, non-timestamptz bucket columns and bad limits throw before any SQL runs.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: TenantDb.aggregate and aggregateWhere: grouped count, countDistinct, sum and avg with time buckets (fw#3396)
  migration: |
    Only code that implements the `TenantDb` interface itself (for example a hand-written mock) must add an `aggregate` method; `createTenantDb` already provides it.
  -->

- f19fb5c: Add metrics feature: declarative dashboard metrics over TenantDb.aggregate (fw#3396)

  New bundled features `metrics` (tenant scope, `access.admin`) and `metrics-system` (platform-wide, `access.systemAdmin`). A metric is declared once with `defineMetric` (source table, measure, optional timeField, window, bucket, groupBy, stackBy, where) and becomes the query `<feature>:query:<metric.id>` returning a `MetricResult` (total, delta against the previous period, bucketed series, group rows, segments). Definitions are validated when the feature is built. Eight default metrics ship: job-runs-by-status, failed-job-runs, tenant-job-failures, deliveries-by-channel, failed-deliveries, active-users, active-tenants, audit-writes. Pass your own list via `createMetricsFeature({ metrics })`.

  <!-- kumiko-changes
  feature: metrics
  type: improvement
  title: Add metrics feature: declarative dashboard metrics over TenantDb.aggregate (fw#3396)
  migration: |
    Opt-in: mount `createMetricsFeature(...)` and/or `createSystemMetricsFeature(...)`. The new indexes on jobs, delivery and sessions need `kumiko migrate generate`.
  -->

### Patch Changes

- 1e18129: Screen schema gains createScreen on entityList, recordTitleField on entityEdit and fillHeight on configEdit; extension tabs render unframed

  `createScreen` on an entityList names the screen opened by the create button. `recordTitleField` on an entityEdit shows a field value as the record title in the header breadcrumb (list > record > screen title). `fillHeight` on a configEdit (default true) switches it to the screen-form layout with a pinned footer; `false` restores the card layout. All three are optional and validated at boot. Extension tabs on a projectionDetail no longer wrap their content in a Card, like relatedList tabs. A `headerSlot` now renders inside the page-header slot instead of replacing the header.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Screen schema gains createScreen, recordTitleField and configEdit fillHeight; extension tabs render unframed
  migration: |
    Additive. Set `createScreen: "<screen-id>"` on an entityList and `recordTitleField: "<field>"` on an entityEdit to use them. configEdit screens now fill the shell height; set `fillHeight: false` to keep the card layout. Apps with screenshot tests of extension tabs lose the surrounding card frame.
  -->

## 0.329.0

### Minor Changes

- 9bbdb64: Button gains `title` and `pressed`; icon set gains `camera` and `headphones`

  `title` renders the native tooltip attribute, `pressed` renders `aria-pressed` for toggle buttons. `camera` and `headphones` join the `NavIconKey` vocabulary and the lucide-backed icon registry.

  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: Button gains title and pressed props; icon set gains camera and headphones
  -->

## 0.328.1

### Patch Changes

- 863e8e4: kumiko-types declares zod and ioredis as peer dependencies

  The published `.d.ts` files import `zod` and `ioredis`, so consumers need both for type resolution. `ioredis` is an optional peer.

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: kumiko-types declares zod and ioredis as peer dependencies
  -->

## 0.328.0

### Minor Changes

- 2a4350b: SearchAdapter gains an optional dropAllIndexes() for rebuilds on a persistent index

  `dropAllIndexes()` deletes every tenant index the adapter owns and returns the count. The in-memory adapter clears all tenants; the Meilisearch adapter deletes all indexes under its prefix (and refuses an empty prefix) and resets its configured-tenant state so the next write recreates a filterable index.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: SearchAdapter gains an optional dropAllIndexes() for rebuilds on a persistent index
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

- 10685ec: kumiko-types is published as compiled JavaScript plus .d.ts

  The package now ships `dist` (`.js` and `.d.ts`) instead of TypeScript source. Export keys are unchanged; only the targets behind them move to `dist`. Consumers on plain Node ESM can import every subpath without a TypeScript-aware loader.

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: kumiko-types is published as compiled JavaScript plus .d.ts
  -->

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

## 0.326.1

## 0.326.0

## 0.325.2

## 0.325.1

## 0.325.0

### Minor Changes

- 100732a: JobContext exposes ctx.attempt and ctx.finalAttempt

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: JobContext exposes ctx.attempt and ctx.finalAttempt
  detail: |
    Job handlers can read the 1-based run number and whether the current run is
    the last one BullMQ will attempt, so a handler can defer writing a
    business-facing failure state until the final attempt instead of writing
    it on every retry.

    Migration note: hand-built `JobContext` objects (test doubles, boot
    seeders) must add `attempt` and `finalAttempt` (e.g. `attempt: 1,
    finalAttempt: true`).
  -->

## 0.324.0

### Minor Changes

- efa4114: Agent-risk floor for writes on fields read as instructions

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Writes on readAsInstruction fields now require agent.risk "high" on the directly-dispatched handler
  migration: |
    New field flag `readAsInstruction: true` on `text`, `longText`, and `jsonb`
    fields (`@cosmicdrift/kumiko-types`) marks a field whose value a later run
    reads as an instruction — a prompt, rule, or template. Any create/update
    whose payload writes such a field must resolve `agent.risk: "high"` on the
    directly-dispatched entry handler, or the executor gate denies it with
    `access_denied` / `instruction_field_write_requires_high_risk` before any
    DB write. This is opt-in per field, but touches every write path once a
    field carries the flag — consumer checklist:

    1. Mark fields that a later run reads as an instruction (prompts, rules,
       templates) with `readAsInstruction: true`.
    2. Update your own handlers that write such a field via
       `executor.create`/`executor.update`, or delegate into one via
       `ctx.write`/`writeAs`, to `agent: { risk: "high" }` — the directly
       called handler must carry it, delegation does not inherit it.
    3. Standard entity-convention create/update handlers on an entity with such
       a field now default to "high" automatically; declaring a lower
       `agent.risk` on one is a define-time error, same as the delete floor
       from #3345.
    4. An update whose payload doesn't include the flagged field stays allowed
       unchanged — the gate checks payload presence after `preSave`, not
       whether the value actually changed.
    5. Not gated: `delete`/`restore` (they don't write the field; the existing
       irreversible-delete floor still applies), and your own domain events
       applied via `ctx.appendEvent` whose projection writes a flagged field —
       route such writes through the executor primitives (`create`/`update`)
       to get the gate.
    6. On `create`, a flagged field with a `default` counts as written even if
       the payload omits it — `applyDefaults` runs before the gate. A custom
       mid-risk create handler whose payload leaves the field out is denied
       just the same, and a standard create with `excludeFields` on such a
       field still resolves to "high".
  -->

## 0.323.0

### Minor Changes

- 1343b18: `createTextField`/`createLongTextField` accepted no options at all, or an options object with no `personal` key — every one of those silently shipped a text/longText field with no personal-data stance (kumiko-framework#2918 only warned about it at boot). `PersonalAnnotations`/`PersonalAnnotationsLongText` no longer include the "nothing declared" shape, so `overrides` is now a required parameter on both factories and must carry a `personal` stance; a runtime gate re-checks the same shape for untyped JS callers before the field is ever built. `PersonalAnnotationsNoFind` (every other field type) is unchanged — `personal` stays optional there.

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: createTextField/createLongTextField require an explicit personal-data stance
  detail: |
    Both factories' `overrides` parameter is no longer optional and must
    include a `personal` stance:
    `{ personal: "self", find: "exact" | "fuzzy" | "none" | "secret" }`
    (longText: `find: "none" | "secret"`), `{ personal: "tenant", find: … }`,
    `{ personal: { of: "<ownerField>" }, find: … }`, `{ personal: "ref" }`, or
    `{ personal: false, reason: "<why this is not personal data>" }`. A
    missing/malformed shape throws at the call site (`createTextField(...)` /
    `createLongTextField(...)` in the message, with every valid option
    listed) instead of silently resolving to an unannotated field — this
    also removes the #2918 boot-time deprecation warning, since the shape it
    warned about can no longer be constructed.
  migration: |
    Two call forms now throw: `createTextField()` / `createLongTextField()`
    with no argument at all, and an options object with no `personal` key,
    e.g. `createTextField({ required: true })`. Add a stance to every call:

      createTextField({ personal: "self", find: "exact" })
      createTextField({ personal: "tenant", find: "none" })
      createTextField({ personal: { of: "authorId" }, find: "none" })
      createTextField({ personal: "ref" })
      createTextField({ personal: false, reason: "is_business_data" })

    `personal: false` additionally requires a non-empty `reason` string.
    `find` is mandatory whenever `personal` names a subject (`"self"` /
    `"tenant"` / `{ of }`) — not for `"ref"` or `false`. The #2918 boot-time
    deprecation warning for this shape is gone; there's nothing left for it
    to warn about.

    To find remaining call sites (the #2919 codemod mode below is the
    migration tool): `kumiko-guards guards
    --guard="Text-Field Personal-Stance Guard"` flags every
    statically-decidable call missing a stance. `bun
    node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/pii-personal-migration.ts
    <targetDir> --report-stance` classifies unannotated text/longText fields
    by name heuristic (direct/user-owned/user-reference/near-miss/
    unclassified) to help pick the right stance — it does not add one
    automatically, since a wrong guess would be worse than the throw. This
    codemod is not wired into `kumiko upgrade --apply`; run it by hand. It
    also only transforms fields still carrying the OLD flag-based API
    (`pii`/`userOwned`/`tenantOwned`/`subjectRef`/`allowPlaintext`) — a field
    with no annotation at all was never in its mapping table and needs a
    stance added by hand either way.
  -->

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Text-Field Personal-Stance Guard exempts the two framework tests that assert the throw
  detail: |
    `guard-text-field-stance.ts` now skips an explicit, exact
    repo-relative-path allowlist
    (`packages/framework/src/engine/__tests__/factories-long-text.test.ts`,
    `packages/framework/src/engine/__tests__/factories-personal.test.ts`) —
    these two deliberately call `createTextField`/`createLongTextField`
    without a stance to prove the fail-closed throw. A different file
    sharing one of those basenames is not exempt; the match is on the exact
    repo-relative path. The guard also scans `samples/**` and `demo/**`
    now, not only `packages/*/src/**`. The baseline
    (`.kumiko-text-field-stance-baseline.json`) drops to 0.
  -->

## 0.322.0

### Minor Changes

- 9e7bedc: i18n plural forms via Intl.PluralRules

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Translation values may now be CLDR plural-form objects, resolved per locale with Intl.PluralRules
  migration: |
    A translation entry's value type widens from `string` to
    `string | PluralForms`, so an existing `TranslationEntry` locale value can
    now also be an object with `one`/`few`/`many`/`other` (etc.) CLDR
    categories, where `other` is required:

    ```ts
    { de: { one: "{count} Status-Seite", other: "{count} Status-Seiten" } }
    ```

    `createI18n(...).t(key, locale, { count })` resolves the CLDR category for
    the given locale via a per-locale-cached `Intl.PluralRules` and interpolates
    `{count}`; it falls back to `other` when `count` is missing/non-finite, the
    locale tag is invalid, or `Intl.PluralRules` is unavailable (older Hermes).
    `mailT` and the renderer's `translateWithFallbacks` resolve plural values
    the same way, through the shared `resolveTranslationValue` helper.

    Existing string-only translations keep working unchanged. Code that reads
    values back out of a bundle (`TranslationBundle`, `TranslationsByLocale`,
    `TranslationEntry`) and annotates them as `string` no longer typechecks:
    annotate as `TranslationValue` (from `@cosmicdrift/kumiko-framework/ui-types`)
    or flatten with `translationValueOtherText(value)`.
  -->

## 0.321.0

### Minor Changes

- b74db24: `r.step.webhook.send`'s `auth.secretRef` resolved through a module-global `secretResolver`, defaulting to `process.env["WEBHOOK_SECRET_" + ref]` — a platform-wide, process-scoped credential store with no tenant boundary. Any tenant able to configure a webhook auth ref could, in principle, reach a secret meant for another tenant or for the operator's own infrastructure, and the only way to change what a ref resolved to was redeploying the process with new env vars.

  `auth.secretRef` is now `auth.secret`, resolved per-tenant at dispatch time through the `secrets` bundled-feature under the tenant-owned namespace `step-dispatcher:webhook-auth.<secret>`. The `step-dispatcher` feature now `r.requires("secrets")`. A missing or unconfigured secret — or a request from a tenant that never set one — fails with the same generic `webhook auth secret is not available` message, without ever echoing the secret's name back onto the tenant-visible `step.dispatch-failed` event.

  <!-- kumiko-changes
  feature: step-dispatcher
  type: breaking
  title: Webhook auth secrets are now tenant-owned via the secrets feature, not a global env var
  detail: |
    `r.step.webhook.send`'s `auth` config renamed `secretRef` → `secret`. The
    value is now a name inside the tenant-owned secrets namespace
    `step-dispatcher:webhook-auth.<secret>` (secrets feature), resolved via
    `SecretsContext.get()` at dispatch time with an audit read stamped with
    the triggering event's userId (or the system actor for cron/resume
    dispatches). `setWebhookSecretResolver` / the `WEBHOOK_SECRET_*` env
    convention are gone. `performWebhookDispatch(spec)` now takes a required
    second `deps: { tenantId, userId, secrets }` argument.
  migration: |
    Mount `createSecretsFeature()` (with a `MasterKeyProvider`) alongside
    `createStepDispatcherFeature()` — boot-validation now fails without it.
    For each tenant that uses `r.step.webhook.send` with `auth`, set the
    credential via `secrets:write:set` under
    `step-dispatcher:webhook-auth.<secret>` (the same name passed as
    `auth.secret`). Rename `auth.secretRef` → `auth.secret` at every
    `r.step.webhook.send({ auth: {...} })` call site. Remove any
    `WEBHOOK_SECRET_*` env vars — they're no longer read.

    A `step.dispatch-requested` event already enqueued before this upgrade
    (still carrying the old `secretRef` shape) fails validation on drain and
    is recorded as `step.dispatch-failed` with `error: "invalid dispatch
    payload"` instead of silently resolving a stale ref — drain the queue (or
    accept the one-time failed event) before deploying.

    Tests calling `performWebhookDispatch` directly or using
    `setWebhookSecretResolver` must pass a `SecretsContext` (or `undefined`)
    via the new `deps` argument instead.
  -->

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: webhook.send step auth secretRef renamed to secret; MultiStreamApplyContext gained an optional secrets field
  detail: |
    `r.step.webhook.send`'s `auth` union renamed `secretRef` → `secret` (see
    the step-dispatcher entry for the full rationale). `MultiStreamApplyContext`
    (and `createMultiStreamApplyContext`'s deps) gained an optional
    `secrets?: SecretsContext` field, mirroring `files`/`derivatives` — present
    when the app booted with the secrets feature, letting a saga/process-
    manager MSP apply read a tenant secret with its own audit context. The
    server's MSP consumer wiring now threads the boot-time `AppContext.secrets`
    through automatically; `rebuildMultiStreamProjection`'s rebuild context
    deliberately does not carry `secrets` (rebuild must stay side-effect-free).
  migration: |
    Rename `auth.secretRef` → `auth.secret` at every `r.step.webhook.send`
    call site. No action needed for `MultiStreamApplyContext` consumers that
    don't read `ctx.secrets` — the field is optional and additive.
  -->

## 0.320.0

### Minor Changes

- c61cc7a: ToolbarAction's navigate variant gets `tab`, merged into the navigate search params and checked by the boot validator against the target projectionDetail's sections, same as RowActionNavigate.tab and MetricNavigate.tab (fw#3260)

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: ToolbarAction's navigate variant gets `tab`
  detail: |
    The navigate-kind ToolbarAction (entityList, projectionList and
    relatedList-section toolbars) accepts `tab?: string`, the section id of the
    tab to activate on the target projectionDetail (layout.mode "tabs"),
    analogous to RowActionNavigate.tab and MetricNavigate.tab.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Toolbar navigate actions merge `tab` into the search params
  detail: |
    buildNavigateToolbarAction (shared by entityList, projectionList and
    relatedList-section toolbars) sets `tab` in the same params object as any
    declared `params`/prefill, so it lands in the single navigateWithReturnTo
    call next to returnTo.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot validator checks the target tab of toolbar navigate actions
  detail: |
    A ToolbarAction with kind "navigate" and `tab` fails boot when its target
    is not a projectionDetail with layout.mode "tabs" or has no section with
    that id. The check covers entityList, projectionList and relatedList
    section toolbars.
  -->

### Patch Changes

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

- c498565: `concurrency: "sequential"` job lock now scoped by `queueNamePrefix`; corrected docs and test to the actual mutual-exclusion (not FIFO) contract

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Sequential-job lock key scoped by queueNamePrefix; contract clarified as mutual exclusion, not FIFO
  detail: |
    The per-name Redis SETNX lock behind `concurrency: "sequential"` used a fixed `kumiko:lock:seq:<lane>:` key, unlike the queues themselves, which are scoped by `queueNamePrefix`. Two runners sharing a Redis but isolated by distinct prefixes (e.g. per-test-run prefixes) could collide on the same lock key even though their queues never saw each other's jobs. The key is now `kumiko:lock:seq:<queueNamePrefix>:<lane>:`. Separately, `JobDefinition.concurrency`'s doc comment and the integration test now state the contract precisely: "sequential" guarantees same-name dispatches never run concurrently, but does not guarantee they run in dispatch order. A lock loser is re-enqueued to the back of its queue, so a later dispatch can still complete before an earlier one. See fw#3265 for the local repro evidence backing this.
  -->

- c61cc7a: user-data-rights takes the audit IP from the shared client-IP resolver

  `extractAuditMeta` read the first `X-Forwarded-For` entry itself — a header any client can set — so a caller could plant a fake IP for their own download attempt in the audit trail (`recordDownloadUse`/`recordInvalidAttempt`). `r.httpRoute` handlers had no access to the server's `trustedProxyHops`-aware resolver at all: `requestIdMiddleware` only wraps `/api/*`, and `user-export/by-token` is an anonymous `r.httpRoute`. `HttpRouteHandlerDeps` gained a `clientIp: string` field, computed once per request in `buildServer`'s httpRoute mount loop from the same shared resolver instance `/api/*` and the L1/L2 rate limits already use. `extractAuditMeta` now takes that resolved value as a parameter instead of parsing headers itself.

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: HttpRouteHandlerDeps carries the resolved clientIp
  detail: |
    `r.httpRoute` handlers get a new `clientIp: string` dep, resolved once per
    request via `buildServer`'s existing shared `clientIpResolver` (the same
    instance `requestIdMiddleware` and the L1/L2 rate limits use), instead of
    each handler parsing `X-Forwarded-For`/`X-Real-IP` itself with no
    knowledge of the deployment's actual `trustedProxyHops`. `UNKNOWN_CLIENT_IP`
    is now exported from `@cosmicdrift/kumiko-framework/api` so callers can
    detect the resolver's no-value sentinel without hardcoding the string.
  -->

  <!-- kumiko-changes
  feature: user-data-rights
  type: fix
  title: Audit IP comes from the framework's trustedProxyHops-aware resolver, not a self-parsed X-Forwarded-For
  detail: |
    `extractAuditMeta` no longer reads `X-Forwarded-For`/`X-Real-IP` itself —
    it takes the `clientIp` the `/user-export/by-token` httpRoute handler now
    receives from `HttpRouteHandlerDeps`, mapping the resolver's `unknown`
    sentinel to `null`. Closes the spoofed-first-XFF-entry gap for that
    route. A caller invoking `/api/query`'s `download-by-token` handler
    directly (not through this httpRoute) can still pass its own `auditMeta`
    in the payload — a pre-existing, documented tradeoff (the handler's own
    comment: audit data isn't security-relevant), unchanged by this fix.
  -->

## 0.319.0

## 0.318.0

### Minor Changes

- 5d3b3e8: Generic create/update entity handlers can exclude individual fields

  `defineEntityCreateHandler`/`defineEntityUpdateHandler` accept `excludeFields`, and `registerEntityCrud`/`r.crud` accept `excludeFields: { create?, update? }`. An excluded field stays in the payload schema as "must be absent": a payload that still carries it fails validation (400, path `changes.<field>` on update) instead of being stripped silently. Definition fails loud for an unknown field, for delete/restore, for a totalsMatch field, and on create for a required field without default. `buildInsertSchema`/`buildUpdateSchema` take the exclusion list as an optional third argument.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Generic create/update entity handlers can exclude individual fields
  detail: |
    `excludeFields` on defineEntityCreateHandler/defineEntityUpdateHandler, and `excludeFields: { create?, update? }` on registerEntityCrud/r.crud. A payload that still carries an excluded field fails validation instead of being stripped silently, so an app no longer needs a hand-written handler just to make one field read-only (e.g. a VIN after creation).
  -->

## 0.317.0

## 0.316.0

### Minor Changes

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

## 0.315.0

## 0.314.0

## 0.313.0

### Minor Changes

- 93d7b77: Event-triggered jobs get the triggering event's id and headers via ctx.triggerEvent

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Event-triggered jobs get the triggering event's id and headers via ctx.triggerEvent
  detail: |
    r.job's `trigger.on` reached via an r.defineEvent QN (async, at-least-once
    delivery through the job-trigger event consumer) had no way to key an
    idempotency check on the stored event that fired it. JobContext now
    carries `triggerEvent?: { id, headers }` — the stored event's id and
    metadata.headers — when the job was reached this way. Undefined for
    cron/manual jobs and for jobs triggered synchronously off a write/query
    handler (no stored event to hand over). No migration needed.
  -->

## 0.312.0

## 0.311.0

## 0.310.0

### Minor Changes

- 4f36c3f: RowActionNavigate gets `tab`: navigate actions open the target projectionDetail on a given tab (fw#3254)

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: RowActionNavigate.tab selects the tab on the target projectionDetail
  detail: |
    Navigate row actions, screen/section actions and relatedList emptyState
    actions accept `tab?: string`, the section id of the tab to activate on the
    target projectionDetail (layout.mode "tabs"), analogous to MetricNavigate.tab.
    Example: `{ kind: "navigate", id: "edit-channels", label: "...",
    screen: "vehicle-detail", entityId: "vehicleId", tab: "channels" }`.
  -->

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Navigate actions merge `tab` into the search params next to returnTo
  detail: |
    Row, record and section navigate actions set `tab` in the same
    setSearchParams call as their `params` and `returnTo`, so the back
    navigation survives. Metric navigate with screen/entity plus tab now also
    lands in that single call instead of a second setSearchParams after it.
  -->

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot validator checks the target tab of navigate actions
  detail: |
    A navigate action with `tab` fails boot when its target is not a
    projectionDetail with layout.mode "tabs" or has no section with that id.
    The check covers list rowActions, relatedList rowActions, screen actions,
    section actions and relatedList emptyState actions.
  -->

## 0.309.0

## 0.308.0

### Minor Changes

- 6e5ed00: EditFieldsSection/EditExtensionSection/EditRelatedListSection/EditWriteFormSection gain actions; EditRelatedListSection gains emptyState; number fields gain grouping (fw#3234)

  All four Edit\*Section spec types accept an optional `actions?: readonly RowAction[]`, resolved and rendered in that section's own title row. EditRelatedListSection additionally accepts `emptyState?: { title, description?, action? }` for its zero-rows state. A number field spec accepts `grouping?: boolean` (default true) — false renders without thousands separators. Every projectionDetail/entityEdit-tabs screen/section/emptyState action must resolve an icon (declared `icon`, or the framework's id-derived default via resolveActionIcon) — checked by the boot validator (see @cosmicdrift/kumiko-framework's changes.json).

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: EditFieldsSection/EditExtensionSection/EditRelatedListSection/EditWriteFormSection gain actions; EditRelatedListSection gains emptyState; number fields gain grouping (fw#3234)
  migration: |
    Additive — every field is optional. An existing screen/section/emptyState action on a projectionDetail (or entityEdit's section-level actions) whose id resolves no icon and declares none itself now fails boot; give it an explicit `icon` or an id the shared action-icon map already resolves.
  -->

### Patch Changes

- 9816d20: The Meilisearch adapter now configures each tenant index on first access from the registry's searchable fields, so search works on every tenant without an app-side `configure()` call. An explicit `configure()` still wins.

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Meilisearch tenant indexes are configured automatically on first access
  -->

- 685ecc9: `import { z } from "zod"` pulled the whole zod namespace — including all 63 locales and the json-schema module — into every client bundle that imported it (359 KB in a publicstatus admin bundle). All framework packages now use `import * as z from "zod"`, which Bun.build can tree-shake (a probe bundle went from 264 KB to 67 KB). A new Biome rule (`noRestrictedImports` on `packages/*/src/**`) keeps `{ z }` from coming back.

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: zod namespace import lets client bundles tree-shake unused locales
  -->

## 0.307.0

## 0.306.0

## 0.305.0

### Minor Changes

- 0ee6000: Job backoff now waits between retries: backoff defaults to a 1000 ms base delay and accepts { type, delayMs } (fw#3167)

  Previously, jobs with backoff set retried immediately: BullMQ received only { type } with no delay, and its fixed/exponential strategies compute NaN/undefined without one (falsy, so no wait). Now "fixed" waits a constant 1000 ms and "exponential" waits 1000/2000/4000 ms... between attempts by default. Jobs with a high retries count will therefore take noticeably longer to reach their final failure. A new object form, backoff: { type, delayMs }, lets a job configure its own base delay instead of the 1000 ms default.

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Job backoff now waits between retries: backoff defaults to a 1000 ms base delay and accepts { type, delayMs } (fw#3167)
  -->

## 0.304.0

## 0.303.0

## 0.302.0

## 0.301.0

## 0.300.0

## 0.299.0

## 0.298.0

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

## 0.296.0

## 0.295.0

## 0.294.1

## 0.294.0

## 0.293.0

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

## 0.291.0

### Minor Changes

- ef54b65: Event-PII stops failing open without a subject KMS (fw#2776)

  `defineEvent` has required an explicit PII stance since fw#2558, but a declared stance still did not guarantee ciphertext in `kumiko_events`. Two paths leaked silently and now fail closed.

  Boot: `assertPiiBootInvariants` only looked at entity annotations, so an app whose PII lives exclusively in catalogued events booted without a `kms` adapter and wrote plaintext. It now collects events with a non-`"none"` stance alongside the PII entities — prod aborts, dev warns, `allowPlaintextPii: "<reason>"` acknowledges, same as for entities.

  Append: `{ personal: { of: "<ownerField>" } }` skipped encryption whenever the owner field carried no id, so the same event type was ciphertext for user-triggered writes and plaintext for system-triggered ones with no signal. The stance now carries `whenAbsent`: `"tenant"` encrypts under the envelope tenant key, `"plaintext"` is an explicit acknowledgement that the value cannot be crypto-shredded. Registration rejects a nullable owner field without one, and an owner that is empty at append time with no declared fallback aborts the write instead of storing the value in the clear.

  `delivery:event:attempt` declares `whenAbsent: "tenant"` — a send whose `recipientId` is null now stores the recipient address under the tenant key instead of in plaintext.

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Declared event PII fails closed without a subject KMS (fw#2776)
  migration: |
    Three things can newly fail. (1) Boot aborts with `BOOT ABORTED — ... events
    [...]` when a mounted feature declares a non-`"none"` `piiFields` stance and
    `runProdApp`/`runWorkerApp` gets no `kms`. Pass
    `kms: createPgKmsAdapter({ databaseUrl, platformKek })`, or acknowledge the
    plaintext with `allowPlaintextPii: "<reason>"` until the KMS is provisioned;
    `runDevApp` only warns. (2) Registration aborts when a
    `{ personal: { of: "<ownerField>" } }` stance names an owner field the payload
    schema allows to be null or undefined. Add `whenAbsent: "tenant"` to encrypt
    those writes under the envelope tenant key, or `whenAbsent: "plaintext"` to
    declare that the value ships unencrypted and is not crypto-shreddable. The
    deprecated `{ subjectField: "<ownerField>" }` form cannot express `whenAbsent`
    — move it to the canonical `{ personal: { of: ... } }` form. (3) `append()`
    throws `SubjectResolutionError` when the owner field is empty at write time
    and the event declared no `whenAbsent`. Registration catches this for
    ZodObject payload schemas; a non-object schema surfaces it here. An owner
    value that is not a non-empty string — a numeric id, an empty string — counts
    as absent, so it takes the same path and needs the same declaration.
    Separately, `delivery:event:attempt` rows written with a null `recipientId`
    used to hold a plaintext recipient address in `kumiko_events` and in
    `store_delivery_attempts`. New rows are tenant-subject ciphertext.
    `delivery:query:log` decrypts either form, so the admin log view is unchanged;
    tooling that reads `store_delivery_attempts.recipient_address` directly must
    go through `decryptStoredPii`. Existing plaintext rows stay readable and are
    re-encrypted by `backfillEventPiiEncryption`.
  -->

- 0621367: Tenant-visible job failures: `r.job({ tenantVisibleFailure })` plus `jobs:query:failures` (fw#3079)

  A fire-and-forget job that fails left the tenant's screen on a spinner that never ends — `jobs:query:list` is SystemAdmin and reads cross-tenant over `systemDb.unsafeRaw`, so a tenant could not see its own job failing. Apps worked around it with their own failure entity written in the job's catch.

  A job now opts in declaratively: `r.job("generateTexts", { trigger: …, tenantVisibleFailure: { messageKey: "app:errors.generationFailed", subjectFields: ["campaignId"] } }, handler)`. When its last attempt fails, the run-logger records one row per tenant, job and subject in the new `store_tenant_job_failures` table, and the tenant reads it back through `jobs:query:failures` (every membership rank, own tenant only).

  Only a translation key travels to the tenant: the thrown error's own `i18nKey` when it carries one, otherwise the declared `messageKey`. The provider's message stays on `store_job_runs.error` and in the run log, both SystemAdmin-only. Records are scoped to the run's tenant — a tenant-less run (cron, `SYSTEM_TENANT_ID`) records nothing.

  Lifetime and retries: a record lives until the next successful run of the same job and subject deletes it; there is no acknowledgement step (tenant job administration stays out of scope). Only the final attempt records, so a job with `retries` that succeeds on a later attempt never shows the tenant a failure. The daily `retention-cleanup` job purges leftovers past `retentionDays`.

  `jobs:query:list`, `jobs:query:details` and `jobs:query:retry` are unchanged. `JobRunnerOptions.onJobComplete`/`onJobFailed` gained an optional fifth `outcome` argument — existing four-argument callbacks keep working.

  <!-- kumiko-changes
  feature: jobs
  type: improvement
  title: Tenant-visible job failures: `r.job({ tenantVisibleFailure })` plus `jobs:query:failures` (fw#3079)
  migration: New store table. Run `kumiko migrate generate` and apply the migration — `store_tenant_job_failures` is created empty and stays empty until a job declares `tenantVisibleFailure`. No change needed for apps that do not opt in.
  -->

- 0fd6bb5: A `money` field on an entity-less form screen must declare its currency source (fw#2839)

  `actionForm` and `secretMint` have no entity, so their money fields never received `entity.defaultCurrency`: an untouched one seeded a bare `0` that the handler's zod schema then rejected on submit. fw#2763 closed the prefill half of this; the default half stayed open. `MoneyCurrencySource` gains `{ kind: "literal", code }` next to the existing `{ kind: "tenant" }`, and the field maps of `actionForm`, `secretMint` and its `confirm` step are narrowed so a money field there requires `currency` — enforced by the compiler at bump time and by the boot validator for untyped callers. A literal code is checked against the app's `currencies` list, the same rule `entity.defaultCurrency` already follows. Entity fields, embedded-list money cells and `configEdit`'s plain-number contract are unchanged.

  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: money fields on actionForm/secretMint screens declare their currency source (fw#2839)
  migration: |
    Only affects entity-less form screens — `actionForm`, `secretMint` and a
    secretMint's `confirm` step — that hold a `money` field. Entity money fields
    are unchanged (`entity.defaultCurrency` is already boot-enforced for them),
    as are embedded-list money cells (currency at the head, fw#2764) and
    `configEdit`, which keeps its plain-number contract.
    Add a `currency` to each money field in such a screen's `fields` map:
    `currency: { kind: "literal", code: "EUR" }` for one fixed currency, or
    `currency: { kind: "tenant" }` for the tenant's own currency.
    A `literal` code must be in the app's `currencies` list (`createApp({ currencies })`,
    which already includes the defaults). A `tenant`-declared field resolves through
    the tenant-settings bundle and holds the form until the value has landed, so that
    bundle has to be mounted. Missing declarations fail at compile time; an untyped
    caller fails at boot with the screen and field name in the message.
  -->

- 229298b: Reference fields can source their picker from a query handler

  `labelField` names one column of the referenced entity, so an entity whose identity is composed from joined rows — a lease identified by its tenant and unit, not by any column on the lease row — has no right answer, only a least-wrong one, and its picker lists raw dates or UUIDs. `ReferenceFieldDef.optionsQuery` (also on a reference sub-field of an embedded field) names a query handler that returns `{ rows: { id, label }[] }` and receives `{ limit, search? }` like the default list handler, so the app composes the label itself. The picker, the read-only display of a reference value and an embedded-list reference cell all read it; the QN is pinned at boot against the registered handlers, the same treatment `DashboardFilterDefinition.optionsQuery` gets.

  It is additive, not a replacement: `labelField` keeps serving the paths a query handler cannot back, since list cells, `searchable` and `sortable` all resolve to an SQL column on the referenced table. A field without `optionsQuery` behaves exactly as before.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Reference fields can source their picker from a query handler
  -->

## 0.290.0

### Minor Changes

- 878d8b2: EventMetadata: feature + handler + UNATTRIBUTED_ORIGIN

  EventMetadata traegt zwei neue optionale Felder (feature, handler) und exportiert die Sentinel-Konstante UNATTRIBUTED_ORIGIN fuer Appends ausserhalb eines attribuierten Ausfuehrungsscopes. Additiv, bestehende Zeilen bleiben ohne Backfill lesbar.

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: EventMetadata: feature + handler + UNATTRIBUTED_ORIGIN
  -->

## 0.289.0

### Minor Changes

- f01015e: EntityDefinition gains an optional transferable flag

  Declares that an entity's rows can move to a different tenant via the tenant-handover bundled feature (kumiko-framework#3035): the root entity, or any parentRef-linked entity, that is NOT declared transferable makes a claim attempt fail with a named error instead of silently leaving its rows behind. Additive — every existing entity is unaffected (transferable defaults to unset/false).

  <!-- kumiko-changes
  feature: types
  type: improvement
  title: EntityDefinition gains an optional transferable flag
  -->

## 0.288.0

## 0.287.0

## 0.286.0

## 0.285.2

## 0.285.1

## 0.285.0

## 0.284.0

## 0.283.0

### Minor Changes

- 45f7641: `loadAggregate` and `ctx.fetchForWriting` gain an optional `aggregateType` stream filter, plus `handle.hasEvent(...)`

  `loadAggregate(db, aggregateId, tenantId, options)` accepts an optional `options.aggregateType`. Without it, behavior is unchanged — every event on the aggregateId's stream is returned, same as today. With it, only events matching that `aggregateType` are returned, so two features that happen to share an `aggregateId` (e.g. reusing an upstream id as the key for a second, unrelated aggregate type) no longer leak each other's events into a business-rule check that only expected its own type.

  `ctx.fetchForWriting({ aggregateId, aggregateType, ... })` now passes `aggregateType` through to `loadAggregate`, so `handle.events` is scoped the same way. The returned `AggregateStreamHandle` also gains `hasEvent(type: string): boolean`, an idempotency check against the fetch-time `events` snapshot — cheaper and safer than an `appendIfAbsent`-style helper, which risks masking a genuine optimistic-concurrency conflict as an already-applied write.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: loadAggregate and ctx.fetchForWriting gain an optional aggregateType filter, plus handle.hasEvent(...)
  migration: |
    No action required — purely additive. Every existing loadAggregate/fetchForWriting
    call keeps its current behavior; opt into the aggregateType filter only where an
    aggregateId is shared across more than one aggregate type.
  -->

## 0.282.0

## 0.281.0

## 0.280.0

## 0.279.0

## 0.278.0

### Minor Changes

- 17dcac1: TenantDb gains a count(table, where?) method for a tenant-scoped COUNT(\*) (fw#2854).

  `TenantDb.count(table, where?)` returns a tenant-scoped row count with the same tenant semantics as `selectMany`: "tenant" mode counts the caller's own tenant plus `SYSTEM_TENANT_ID` reference rows, a caller-supplied `where.tenantId` may only narrow that scope, and "system" mode counts unfiltered. Lets app/feature code compute stock-caps (`count(*) WHERE tenant_id = …`) without an `unsafeRaw`/`escapeHatch` detour. A hand-built `TenantDb` object literal (test fakes, mocks) must add a `count` method to keep satisfying the `TenantDb` type — `db.global()` is unaffected, `count` is only on the tenant-scoped surface.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: TenantDb gains a count(table, where?) method for a tenant-scoped COUNT(*) (fw#2854).
  migration: |
    No action required for existing `TenantDb` consumers — purely additive. Any hand-built object literal typed as `TenantDb` (not built via `createTenantDb`) needs a `count(table, where?)` method added; `bunCountWhere`/`countWhere` from `@cosmicdrift/kumiko-framework/db` implements the same query shape if you need equivalent logic outside a `TenantDb`.
  -->

## 0.277.0

## 0.276.0

### Minor Changes

- a5347bc: entityEdit and actionForm screens accept `slots.titleAction`: an extension component rendered on the right of the form title, in the same row — for status chips or allowance badges that belong to the screen. `FormProps.titleAction` carries it to the primitives; the web form renders it in `<testId>-title-action`.

## 0.275.0

### Minor Changes

- 2cb61dd: `JobContext.db` is now a tenant-filtered `TenantDb` bound to the job's resolved tenant (`SYSTEM_TENANT_ID` for tenant-less cron jobs) instead of the unfiltered boot `DbConnection`. Unfiltered access needs a declaration: `r.job({ ..., escapeHatch: { reason } })` grants `ctx.db.unsafeRaw(reason)` for that job, and `r.systemScope()` features keep `ctx.systemDb`. Every grant use reports an `"unsafe-raw"` escape-hatch audit event. `r.job` rejects an `escapeHatch` with an empty reason at registration. Bundled cross-tenant jobs (auth-mfa reencrypt, sessions cleanup, form-draft cleanup, secrets rotate, files-tenant-data sweep, data-retention, inbound-mail retention, tenant-lifecycle destruction, user-data-rights export/forget) now declare `escapeHatch`. The exported `rotateJob` and `sweepOrphanedDerivativesJob` take the raw runner as a third argument.

## 0.274.0

## 0.273.0

### Minor Changes

- e9d3944: `ctx.queryProjection(qualifiedName, { unsafeAllTenants: true })` now requires a grant (fw#2913): an `r.systemScope()` feature, or a declared `escapeHatch: { reason }` on the write/query/stream handler (or the `r.hook(...)` call, when the read happens inside a lifecycle hook — a hook never inherits its enclosing handler's grant, not even from an `r.systemScope()` feature, only its own declared `escapeHatch`). Without one, the call throws `AccessDeniedError` with `details.reason: "unsafe_all_tenants_denied"`. A granted call reports exactly one `unsafe-all-tenants` event through the existing escape-hatch audit sink. `defineProjectionQueryHandler` gained an `escapeHatch` option so a projection list-handler can declare the grant.

  Also fixes projection tenant-filtering for plain `EntityTableMeta` tables (`defineUnmanagedTable`/`deriveEntityTableMeta`, no drizzle `SchemaTable` symbols): `ctx.queryProjection` previously read `table.tenantId` directly, which is always `undefined` on such tables, so their rows were never tenant-filtered. It now reuses `hasTenantColumn`, the same canonical-meta check `TenantDb`'s other escape hatches already use — an internal `framework/db/tenant-db` helper, not a public package export.

- 01c9133: `r.step.read.findOne`/`read.findMany` now apply the caller's tenant filter by default (own tenant + `SYSTEM_TENANT_ID` reference rows), the same as `ctx.db`'s method-form reads — a foreign `where.tenantId` is narrowed to the caller's own scope instead of passing through unfiltered. Cross-tenant reads need `unsafeAllTenants: { reason }` on the step plus `escapeHatch: { reason }` on the handler (or, in a `r.systemScope()` feature, are routed through `ctx.systemDb.unsafeRaw`); a declared cross-tenant read reports an `"unsafe-raw"` escape-hatch audit event, same as `ctx.db.unsafeRaw`.

## 0.272.0

### Minor Changes

- 6c55fa2: Entity-convention handlers (`defineEntity*Handler`, `defineEntityWriteHandler`/`defineEntityQueryHandler`, `registerEntityCrud` write/read) now accept `escapeHatch: { reason }` for one-handler cross-tenant access, reported as an `acknowledge-cross-tenant` audit event the same way the hand-written-handler escape hatches already are. `crossTenant: true` is deprecated: it keeps working, but boot now logs a `deprecation:entity-handler-cross-tenant` warning per handler and its use is audited too; it is planned for removal in a later breaking release. Run `scripts/codemod/migrate-cross-tenant.ts` to migrate — it rewrites `crossTenant: true` to `escapeHatch: { reason }` wherever the handler name and verb can be derived from the call, and lists every other site (shared/spread access objects, `registerEntityCrud` write/read blocks, non-literal values, sites that already declare `escapeHatch`) for manual review. Bundled features migrated: `download-attempt:list`, `export-job:list`, `export-job:detail`, `cap-counter:list`.

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

- c704c75: Every framework escape-hatch use now emits a `security:escape-hatch-used` signal (fw#2861): `ctx.db.unsafeRaw`/`ctx.dbOutsideTransaction.unsafeRaw`, `ctx.systemDb.unsafeRaw`, `ctx.systemDb.acknowledgeCrossTenant` (incl. `outsideTransaction`), `db.global()` write methods, and a granted non-self identity switch via `queryAs`/`writeAs`/`queryAsMember`. Each use reports `{ handler, kind, reason, tenantId, actor, target? }` through the new `AppContext._escapeHatchAuditSink` when the `audit` feature is mounted (persisted as an `audit:event:escape-hatch-used` event), or a structured `log.warn(...)` otherwise — deduplicated per dispatcher within a 60s window for identical (handler, kind, reason, tenant, actor, target) tuples. `createTenantDb`/`createUncheckedSystemDb` used without an explicit reporter warn-log as `"<unattributed>"`.

  New optional params: `TenantDbGrants.report`, `createUncheckedSystemDb`'s 3rd param, `createGatedIdentitySwitch`'s 5th param. New exports: `EscapeHatchKind`, `EscapeHatchTarget`, `EscapeHatchUseEvent`, `EscapeHatchAuditSink`, `EscapeHatchReporter` (types package), `createEscapeHatchReporter`, `createEscapeHatchReportWindow`, `fallbackEscapeHatchReporter`, `reportEscapeHatchUse`, `ESCAPE_HATCH_USED_SIGNAL` (framework/pipeline), `createEscapeHatchAuditSink`, `ESCAPE_HATCH_USED_EVENT` (bundled-features/audit). `server-runtime` wires `_escapeHatchAuditSink` at boot whenever the `audit` feature is mounted.

- c704c75: `r.systemScope()` write/query/stream handlers that declare no `rateLimit` now default to `{ per: "tenant+handler", limit: 600, windowSeconds: 60 }` (fw#2861) — cross-tenant systemScope handlers were previously reachable at unlimited rate. `per: "tenant+handler"` (not `"tenant"`) so one hot handler cannot starve every other systemScope handler's shared tenant quota. The default only fires when the app has a `RateLimitResolver` already configured (`context.rateLimit`), never fires for a SYSTEM-identity caller (jobs, replay, internal `queryAs(SYSTEM, ...)`), and is overridden by any explicit `rateLimit` on the handler. `RateLimitDeclaration` (`RateLimitOption | RateLimitDisabled`) replaces `RateLimitOption` on `WriteHandlerDef`/`QueryHandlerDef`/`StreamHandlerDef`, their `WriteHandlerDefinition`/`QueryHandlerDefinition`/`StreamHandlerDefinition` counterparts and the `r.writeHandler`/`r.queryHandler`/`r.streamHandler` inline-options overloads: a handler can now declare `rateLimit: { disabled: true, reason: "..." }` to opt out of both an explicit and the systemScope default limit; the boot validator (`validateRateLimitDisabledReason`, `engine/boot-validator/entity-handler.ts`) rejects an empty `reason`. New exported type guard `isRateLimitDisabled`. `enforceRateLimit` (`pipeline/dispatch-shared.ts`) takes a 5th `isSystemScope: boolean` parameter; the three dispatch call sites (`dispatch-query.ts`, `dispatch-write.ts`, `dispatch-stream.ts`) call it unconditionally instead of guarding on `handler.rateLimit !== undefined`. `computeHasRateLimitedHandler`/`hasRateLimitedHandler()` (`registry-validate.ts`, `server.ts`'s `wantsL3`) stay limited to explicit, non-`disabled` `rateLimit` declarations on purpose — a `{ disabled: true }` opt-out and the systemScope default itself never force auto-wiring of a resolver an app never configured.

  40 bundled systemScope write/query handlers newly get the default (none previously declared `rateLimit`; none is anonymous-accessible under `validateAnonymousRateLimit`'s existing gate — every anonymous-adjacent bundled handler uses `openToAll`, which that check already exempts, so no opt-out was required for that reason). 7 self-scoped read handlers whose traffic scales with signed-in users rather than tenant operations (hit on every page load) declare `rateLimit: { disabled: true, reason: "..." }` instead, so a per-tenant(+handler) bucket cannot throttle a whole tenant's page loads — L1 IP limits still apply to them:

  - `cap-overview` (3 query, default): `cap-overview:query:tenant-caps:list`, `cap-overview:query:caps:usage`, `cap-overview:query:tenant-options`
  - `compliance-profiles-ops` (1 query, default): `compliance-profiles-ops:query:tenants-missing-profile`
  - `config` (2 write default, 4 query opted out): default: `config:write:set`, `config:write:reset`; opted out: `config:query:cascade`, `config:query:values`, `config:query:schema`, `config:query:readiness`
  - `delivery` (1 write + 1 query default, 1 query opted out): default: `delivery:write:set-preference`, `delivery:query:log`; opted out: `delivery:query:preferences`
  - `feature-toggles` (1 write, 2 query, all default): `feature-toggles:write:set`, `feature-toggles:query:list`, `feature-toggles:query:registered`
  - `jobs` (2 write, 3 query, all default): `jobs:write:trigger`, `jobs:write:retry`, `jobs:query:list`, `jobs:query:details`, `jobs:query:catalog`
  - `tenant` (8 write, 7 query default + 3 entity-convention aliases, 1 query opted out): default: `tenant:write:create`, `tenant:write:update`, `tenant:write:disable`, `tenant:write:enable`, `tenant:write:add-member`, `tenant:write:remove-member`, `tenant:write:update-member-roles`, `tenant:write:cancel-invitation`, `tenant:query:list`, `tenant:query:memberships`, `tenant:query:members`, `tenant:query:active-tenant-ids`, `tenant:query:resolve-user-ids`, `tenant:query:invitations`, `tenant:query:team:list`, plus the entity-convention aliases `tenant:query:tenant:list`, `tenant:query:tenant:detail`, `tenant:write:tenant:update`; opted out: `tenant:query:me`
  - `user` (2 write, 3 query default, 1 query opted out): default: `user:write:user:create`, `user:write:user:update`, `user:query:user:detail`, `user:query:user:list`, `user:query:user:find-for-auth`; opted out: `user:query:user:me`
  - `workflow-runner` (1 write, default): `workflow-runner:write:resume-run`

  Nested-write parent-row ownership check (fw#2861): `executeNestedWrite` (`pipeline/dispatch-write.ts`) now refuses to attach nested children to a parent row it did not just legitimately create. A custom (non-`defineEntityWriteHandler`) `:create` handler that hands back an EXISTING row (find-or-create, or a bug) instead of inserting a fresh one previously let children attach to that row with no ownership check. Two checks now run right after the parent write returns and before any child write: (1) a new `isForeignTenantParentRow` predicate refuses a returned row whose `tenantId` differs from the caller's tenant — skipped for `r.systemScope()` handlers, which legitimately write across tenants; (2) `checkWriteFieldOwnership(parentEntity, parentRow, user)` refuses a same-tenant row whose ownership-bound field (e.g. `from("user:id", "ownerId")`) does not resolve to the caller. Both return `AccessDeniedError` (`access_denied`, `details.reason: FrameworkReasons.fieldAccessDenied`) and roll back the whole write in the same transaction — no task rows persist. Role-only same-tenant parent entities (no ownership-typed field) rely on their handler's role gate; `checkWriteFieldOwnership` is a no-op there by design, but the tenant check still applies.

- 5f8be0d: `TenantDb.raw` is removed — the only DbRunner escape hatches off `ctx.db` are now `ctx.db.unsafeRaw(reason)` (gated by `escapeHatch: { reason }`) and `db.global(table)` writes. Framework infrastructure (the event-store executor, engine steps, entity-convention `crossTenant` handlers, `UncheckedSystemDb.unsafeRaw`) resolves its connection through a framework-private `tenant-db-runner.ts` binding instead, which feature code cannot import. `asRawClient` and the raw-SQL helpers built on it (`countWhere`, `transaction`, `runInSavepoint`/`runInSavepointIfSupported`, `executeRawQuery`/`executeRawQueryRead`, `upsertOnConflict`, `incrementCounter`, `insertMany`, `deleteManyBatched`) now throw when handed a tenant-scoped `TenantDb` instead of silently unwrapping it. `fireEntityPostSave`'s optional 4th argument changed from a bare `tenantId` to `{ tenantId, db }` — a caller re-scoping the hook context now hands in its own already-declared `DbRunner`. The boot validator now also rejects a `tenancy: "global"` entity whose owning feature does not declare `r.systemScope()`.

  New codemod `scripts/codemod/migrate-db-raw.ts` rewrites `ctx.db.raw` to `ctx.db.global(table)` (for `tenancy: "global"` tables) or `ctx.db.unsafeRaw(reason)` in test files and reports every non-test site for a manual reason.

## 0.270.0

### Minor Changes

- dba0a60: `openToAll: true` is removed from `OpenToAllAccessRule` — every `openToAll` grant now requires `{ reason: string }`. `isOpenToAllGranted` denies a bare `true` reaching it from an untyped source (pattern JSON, Designer) the same way it already denied a malformed object. The boot validator rejects an untyped `openToAll: true` access declaration with an error pointing at `{ reason }`. The pattern-library Designer access field is now a required text input on `access.openToAll.reason` instead of a boolean toggle. `build-config-feature-schema.ts` synthesizes `{ openToAll: { reason: "..." } }` (instead of `{ openToAll: true }`) for a config key whose roles include `"all"`. `boot-validator/nav.ts` and `renderer-web/app/create-app.tsx` switched from `"openToAll" in access` to `isOpenToAllGranted(access)`. The feature-AST extractor now also extracts `escapeHatch: { reason }` on write/query handlers and on `r.hook` options.

  New codemod `scripts/codemod/migrate-open-to-all.ts` rewrites `openToAll: true` to `openToAll: { reason }` in test files and reports every non-test site for a manual reason.

## 0.269.2

## 0.269.1

## 0.269.0

### Minor Changes

- ec9aaca: Breaking: `ctx.queryAs`/`ctx.writeAs` without a grant only accept the caller itself — same `id`, `tenantId`, `origin` and `claims`, with roles that are a subset of the caller's roles. Any other identity (a different user, a different tenant, extra roles, changed claims) now throws `AccessDeniedError` with `details.reason: "identity_switch_denied"`; SYSTEM targets keep `system_identity_switch_denied`. The grant is unchanged from fw#2859: an `r.systemScope()` feature, `escapeHatch: { reason }` on the write/query/stream handler, or the hook's own `r.hook(..., { escapeHatch })` — non-transitive, never inherited by hooks. `isSystemIdentitySwitchAllowed` is replaced by `isIdentitySwitchAllowed(caller, asUser, hasGrant)` and `createGatedIdentitySwitch` takes the caller as second argument. Jobs, top-level dispatcher calls, `ctx.queryAsMember` and `ctx.resolveActiveMembership` are unchanged. Migration: declare `escapeHatch` on handlers that act as another user or tenant, or move the call into a job / `r.systemScope()` feature (see `changes.json`, fw#2876).
- 8412e09: `StreamHandlerDef`/`StreamHandlerDefinition` (`@cosmicdrift/kumiko-types/handlers`, `/define-handler`) and the `r.streamHandler` options param now accept `escapeHatch: { reason }`, same contract as `WriteHandlerDef`/`QueryHandlerDef`: a stream handler that switches identity to SYSTEM via `ctx.queryAs` needs its own `escapeHatch` declaration (or its feature must be `r.systemScope()`), same as write and query handlers already require. Stream handlers still cannot reach `db.global()` (`globalWrites` stays write-only) but do get the same SYSTEM-identity-switch and `ctx.db.unsafeRaw(reason)` grant a query handler's `escapeHatch` already unlocks. The boot validator rejects an empty `escapeHatch.reason` on a stream handler the same way it does for write/query handlers.

## 0.268.0

### Minor Changes

- b16457a: `ctx.db.unsafeRaw(reason)` returns the unfiltered runner only for write/query handlers and hooks that declare `escapeHatch: { reason }`. `tenancy: "global"` entities must be `systemStream` and only hold `SYSTEM_TENANT_ID` rows; `declareGlobalTenancy(table)` declares plain stores without `tenant_id` as global. `createTenantDb`'s 7th parameter is now `{ globalWrites?, unsafeRaw? }`. Bundled features no longer use `ctx.db.raw` (`user` and `store_global_feature_state` are global); `scripts/migrate-db-raw.ts` migrates consumer call sites.

## 0.267.0

### Minor Changes

- e87ab51: New `ctx.queryAsMember(userId, qn, payload)` on `HandlerContext`, `JobContext` and (optional) `AppContext` — reads a query handler as a stored member of the current tenant, resolved internally by the framework (`resolveActiveMembershipFn` with a new, stricter `BACKGROUND_READ_POLICY` — no pending-destruction grace window, no unknown-principal pass) → `PrincipalStatusPlugin.resolveProfile` for global roles/timezone/locale → `buildSessionRoles` → `resolveAuthClaims`. The resolved `SessionUser` is never exposed: it carries no `sid`, `origin: "member-resolution"`, and is minted only for the duration of the call. Rejection (not a member, principal blocked, tenant in teardown, or the resolved principal would be SYSTEM) always surfaces the same generic `AccessDeniedError` (`member_resolution_denied`, no rejection reason in `details`) so a caller can't probe another user's membership state. Resolution is cached per handler invocation (its lifecycle hooks share that cache) or job run — repeated calls for the same `userId` resolve once; a nested dispatch gets its own cache. `ctx.queryAsMember` needs the same grant as a SYSTEM `queryAs` — `r.systemScope()` or a declared `escapeHatch` — and, for hooks, is re-gated by the HOOK's own `escapeHatch` rather than inheriting (or failing to inherit) the enclosing handler's grant, so a hook can grant `queryAsMember` even when the handler it fires on has none. Jobs stay ungated, same as `JobContext.queryAs`.

  There is deliberately no `writeAsMember`: a resolved member principal is read-only by construction. `ctx.write`, `writeAs`, `appendEvent`, `unsafeAppendEvent`, `tryAppendEvent`, `fetchForWriting`, `archiveStream`, `restoreStream`, `snapshotAggregate`, `queryAsMember`, `resolveActiveMembership` and `jobRunner` all throw `member_resolution_read_only` on a `HandlerContext` built for such a principal; `scheduleAfterCommit` throws the same error; `dbOutsideTransaction`, `systemDb`, `runPreSave`, `files` and `derivatives` are unset. This is enforced structurally in `buildHandlerContext` and, as defense in depth, again at the shared event-append sink behind `appendEvent`/`unsafeAppendEvent`/`fetchForWriting().appendOne` and in the write/stream dispatch paths (covers a handler that spreads/copies the resolved user into a direct `dispatcher.write`/`batch`/`stream` call). `ctx.db` itself is NOT blocked — a queried handler's raw `ctx.db` writes are exactly as reachable as they'd be if that same handler ran for the member over HTTP; this is a known, documented gap, not something this change closes. `jwt.sign()` now throws if handed a `SessionUser` with `origin` set, so a resolved member principal can never be minted into a session.

  Membership/principal/lifecycle are resolved on the root database connection (outside the caller's transaction, same as `resolveActiveMembershipFn`/`resolveAuthClaims`); the target query itself runs inside the caller's transaction when one is threaded through.

  `PrincipalStatusPlugin.resolveProfile(userId, { db })` is now a REQUIRED method (previously the plugin only needed `resolveStatus`) — it returns `{ globalRoles, timezone?, locale? } | null`, the source `ctx.queryAsMember` uses to mint a resolved principal's roles/timezone/locale. The bundled `user` feature implements it. No new boot check is added for `ctx.queryAsMember` usage itself — it can't be detected statically without breaking apps that mount `tenant` without `user`; a missing `resolveProfile` provider fails closed at first use with an `InternalError` naming the `user` feature. `#2883`'s existing boot check (membershipQuery registered + auth wired ⇒ a `principalStatus` provider is required) is unchanged.

  Also: `setupTestStack`'s job runner now calls `attachDispatcher(...)` after `buildServer()`, mirroring the production entrypoints — previously `JobContext.write`/`writeAs`/`queryAs`/`queryAsMember` always threw "dispatcher attached — call attachDispatcher() first" inside a `setupTestStack`-based job (no existing test happened to exercise that path).

## 0.266.0

### Minor Changes

- 4d36b68: The boot check for `openToAll` write handlers that accept personal data now finds personal-data fields anywhere in the input schema — inside `z.intersection`, `z.union`/`z.discriminatedUnion`, `.transform()`/`z.preprocess()`/`.pipe()`, wrappers (`.optional()`, `.nullable()`, `.default()`, `.readonly()`, `.catch()`, `z.lazy()`), nested objects such as an update's `changes`, arrays and records — not only at the top level of a `z.object`. A field bound to the caller needs no declaration: every role in the target entity's `access.write` is `from("user:id", "<ownerField>")` for a `personal: { of: "<ownerField>" }` field, or `from("user:id", "id")` for a `personal: "self"` field, and the handler has no `escapeHatch` and its feature no `r.systemScope()`. The `publicIntake` flag is removed; a handler that lets signed-in tenant members write unbound personal data declares `openToAll: { reason, personalData: "tenant-members" }`. Bundled `user:update` now uses that declaration.

## 0.265.0

### Minor Changes

- 371a263: New `dispatcher.resolveActiveMembership(userId, tenantId)` / `ctx.resolveActiveMembership` returns an `ActiveMembershipResult` — either `active` with the raw membership roles, or `rejected` with reason `not_a_member` | `principal_blocked` | `tenant_teardown` (membership is checked first, so a non-member can't learn a foreign tenant's lifecycle/blocked state). It composes two new framework contracts, `EXT_PRINCIPAL_STATUS` (fulfilled by the bundled `user` feature) and `EXT_TENANT_LIFECYCLE_STATUS` (fulfilled by `tenant-lifecycle`), plus `TENANT_TEARDOWN_STATUSES` and the default `TENANT_MEMBERSHIPS_QUERY` handler name, and is now used by switch-tenant, login and auth-mfa verify/enable-confirm-preauth instead of each independently composing membership + status checks. `ctx.resolveActiveMembership` requires the same SYSTEM-identity grant as `ctx.queryAs`/`ctx.writeAs` with a system user (`r.systemScope()` or a declared `escapeHatch`), since it queries memberships as SYSTEM internally. Behaviourally: `POST /api/auth/switch-tenant` now answers 403 `principal_blocked` for a blocked principal and 410 `tenant_unavailable` for a target tenant in teardown (a tenant in `destroyRequested` is still allowed so its owner can cancel destruction); login skips a last-active tenant that is in teardown and falls through to the next active membership; MFA verify and enable-confirm-preauth reject a tenant in teardown; `buildServer` now throws at boot when the auth `membershipQuery` handler is registered but no feature provides the `principalStatus` contract (mount the bundled `user` feature); and `isPrincipalBlocked` now lives in `user` (still re-exported from `sessions` for existing importers).

## 0.264.1

## 0.264.0

### Minor Changes

- d0184f7: `ctx.queryAs`/`ctx.writeAs` with a SYSTEM identity now throws `access_denied` unless the calling handler belongs to an `r.systemScope()` feature or declares `escapeHatch: { reason }` (now also accepted on query handlers and as `r.hook(..., { escapeHatch })`); jobs stay ungated, hooks no longer inherit their handler's grant, and grants never propagate to nested handlers. Bundled auth, MFA, user-profile and user-data-rights handlers declare their SYSTEM lookups via `escapeHatch`.

## 0.263.0

### Minor Changes

- f6732fa: Security: URL query parameters only prefill form fields that a declared navigate `params` targets.

  **BREAKING** — previously an actionForm, secretMint or entityEdit-create screen took _any_ query parameter whose name matched a field, so a crafted link could seed e.g. an IBAN or e-mail field. `buildAppSchema` now derives `urlPrefillFields` per form screen from every navigate `params` (entityList/projectionList rowActions, projectionDetail/entityEdit actions, relatedList rowActions, projectionDetail metrics) that targets it, and the renderer ignores every other query parameter. A form no navigate `params` targets takes nothing from the URL. Declared rowAction/action `params` keep working unchanged.

  Custom code that prefilled a form via `nav.navigate` + `nav.setSearchParams` (without a declared `params`) must switch to the new `useNavigateWithInitialValues()` hook from `@cosmicdrift/kumiko-renderer`, which hands initial values to the target form in memory instead of the query string. This includes the ai-agent `openForm` client tool (`agentPrefill=1`), which ships in the matching kumiko-enterprise release.

  `sensitive` is now projected into the client schema, so the existing "never prefill a sensitive field" rule also applies to entityEdit-create (it was silently inactive there). Sensitive and `format: "password"` fields are never prefilled — not from the URL, not from an allowlist entry, not from a handoff.

## 0.262.0

## 0.261.0

### Minor Changes

- 5139a3f: `access` is now required on every handler definition (`openToAll: true` still compiles but is deprecated in favor of `openToAll: { reason: "..." }`, and a boot validator now rejects an empty reason or a write handler that accepts personal-data fields under `openToAll` without `publicIntake: true`); `EntityDefinition.tenancy: "global" | "tenant"` plus `TenantDb.global(table)` let a "global" table's rows be reached across every tenant (writes gated by a write handler's `escapeHatch: { reason }`); `UncheckedSystemDb.unsafeRaw(reason)` replaces the now-`@deprecated` `TenantDb.raw` escape hatch with an auditable, named declaration.

## 0.260.0

### Minor Changes

- 71b9c4b: Four "Akte" bedienkonzept ergonomics improvements for record screens:

  - `projectionDetail`'s header now renders the status badge directly next to the record title instead of on its own line with the subtitle, so the record's state is visible at a glance without a second line.
  - `entityList`, `projectionList` and `relatedList` rows now get a default "Edit" row action for free whenever the row's entity has an accessible `entityEdit` screen somewhere in the app — no more hand-declaring the same navigate rowAction on every list. A screen that already declares its own `id: "edit"` rowAction keeps it unchanged (the declared one always wins, never doubled up).
  - Multi-line text inputs (`Input kind="textarea"`) accept a new `onSubmitShortcut` prop: Ctrl+Enter / Cmd+Enter now submits instead of inserting a newline, wired up in the notes-history `NotesSection` so adding a note no longer requires reaching for the mouse.
  - `entityEdit`'s `redirect` now accepts the same object form as `actionForm`'s (`{ screen, idFrom }`), so a child record's edit screen (a deposit movement, a protocol section) can redirect back into the parent's Akte with the parent's id instead of only a list. The id is read from the write handler's success payload first, falling back to the already-loaded record's own field when the handler reports only its own id — matching how `actionForm`'s object-form redirect already resolves.
  - The ledger's `reverse-transaction` (Storno) handler now copies `subjectType`/`subjectId` from the transaction it reverses onto the reversing entry, matching `confirm-schedule-period`. A Storno of a booking without a subject stays without one. Without this, a Storno booked against a subject (a lease, a contract) dropped out of any `subjectId` filter, so an Akte's booking list showed a stale entry with no visible counter-booking.
  - `MetricNavigate` gains an optional `tab`: a metric click can now jump straight into a tab of the current or a target Akte instead of only entities/screens. Set alone, it activates that section on the current record; combined with `screen`/`entity`, it also sets the `?tab=` search param at the destination. The boot-validator rejects an unknown tab id when the target is the current screen.

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

## 0.258.1

## 0.258.0

### Minor Changes

- f2e57b4: fw#2548: new `secretMint` screen type for "mint → one-time reveal → confirm" flows — an API token, recovery codes, or any other secret that a write-handler hands back only once in its success payload. `actionForm` can't express this: it discards the success payload after extracting the navigation id, and no query can ever redisplay a secret that was never stored in the clear. `secretMint` renders the same field/section form as `actionForm`, then swaps to a one-time reveal card built from `reveal.fields` — a whitelist of success-payload fields, never the payload as a whole — with an explicit confirm before navigating on. The revealed values live only in the form component's own state, never in the URL, a query cache, or nav. `TextFieldDef` grows a `format: "password"` render hint (masked input, no storage semantics) — such a field is also excluded from a wizard's persisted draft blob, so it is never written to the server in the clear or restored on resume — and the renderer ships a new `SecretReveal` primitive for the reveal card (falls back to `Grid`/`GridCell` when a platform hasn't registered one).

  `personal-access-tokens` is migrated onto it end to end: the former dormant `type: "custom"` screen (a hand-written client component) is now two declarative screens — a `projectionList` for "your tokens" (with a `revoke` row action) and the new `secretMint` for minting one, wired through `patGrantOptions`/`patScopeOptionTranslations`. No app needs a client plugin for this feature anymore.

  **BREAKING**

  1. `personal-access-tokens:query:mine` now returns the paged envelope `{ rows, nextCursor }` instead of a blank array. Migration: callers read `response.rows`. The handler also newly accepts `limit`/`sort`/`sortDirection` and each row carries a computed `status` (`"active" | "revoked" | "expired"`).

  2. The subpath export `@cosmicdrift/kumiko-bundled-features/personal-access-tokens/web` is gone (`personalAccessTokensClient()`, `PatTokensScreen`, `defaultTranslations`). The PAT screens are declarative now and need no client plugin. Migration: remove the `personalAccessTokensClient()` entry from `createKumikoApp({ clientFeatures: [...] })`; an app that embedded `<PatTokensScreen embedded />` directly should navigate to the feature's `api-tokens` screen instead.

- c1b53a3: fw#2766: join-row entities declare their carrier once, and both paths gate on it. `EntityDefinition.parentRef` (`{ entityTypeField, entityIdField, allowedTypes? }`) says "rows of this entity hang off a host row named by these two fields". The write handlers and the read path now derive one visibility rule from that single declaration instead of mechanising it twice: a caller may see or touch a join row only if the host row is visible through the host entity's own read path (tenant scope, soft-delete, `access.read` ownership). `note-entry`, `tag-assignment` and `folder-assignment` declare it; the `tag` catalog stays tenant-wide by design.

  The read gate is an `EXISTS` sub-select spliced into the `WHERE` clause, not a post-filter over the fetched page — so it runs before `LIMIT`/`OFFSET` and `rows`, `nextCursor` and `total` all stay honest, including on the `tag-assignment` scatter query that filters on `tagId` across many different host types. One query per page, no N+1. Filtering on the entityType field (`eq` or `in`) narrows the gate to those hosts, which is why the bundled tag widgets now send `entityType` server-side instead of discarding foreign rows after the fetch.

  **BREAKING**

  1. `note-entry:list`, `tag-assignment:list` and `folder-assignment:list` are fail-closed by default. A caller who cannot see the host row no longer receives the join row — previously the only lever was `createNotesHistoryFeature({ ownership })` / `createTagsFeature({ ownership })`, and `folders` had no lever at all. Mounts that relied on tenant-wide reads of these lists will see fewer rows.

  2. Rows whose `entityType` names no registered entity disappear from those lists (default-deny, matching what the write path has rejected since #2721/#2745). Audit before upgrading:

     ```sql
     SELECT entity_type, count(*) FROM read_tag_assignments GROUP BY 1;
     SELECT entity_type, count(*) FROM read_note_entries GROUP BY 1;
     SELECT entity_type, count(*) FROM read_folder_assignments GROUP BY 1;
     ```

     Any `entity_type` in the result that is not a registered entity name becomes invisible.

  3. Join rows on a soft-deleted host are no longer listed. This mirrors the write path, which has always resolved the host through `executor.detail` (soft-deletes filtered). `includeDeleted: true` lifts it for trash views.

  4. A hand-written `<entity>:list` / `<entity>:detail` query handler on a `parentRef` entity now fails boot validation until it either uses `defineEntityListHandler` / `defineEntityDetailHandler` or passes `parentVisibility` to the executor itself. The gate needs the registry, which only exists at request time; enforcing this at boot keeps the raw executor usable for framework-internal cascade and GDPR paths without turning a missed wiring into a silent leak. A query handler under a _different_ name that calls `executor.list` on a `parentRef` entity is not detectable this way and stays ungated — pass `parentVisibility` there yourself.

  5. Listing a join-row entity now reads the host tables it might match against, so every registered entity that is an admissible host must actually have its table. Migrations provision all of them, so a migrated deployment is fine; hand-rolled test stacks that create only some tables will need the rest. Narrow the set with `parents` (`allowedTypes`) — it is also the lever that keeps the generated SQL and its query plan small.

  Also fixed: the `totalCount` fast path on the search path returned `filterIds.length` even when the `WHERE` had been narrowed further by ownership, field-read rules, screen filters or soft-delete, so `total` could overcount. It now only applies when the search-id clause is the whole `WHERE`.

  `ownership` keeps a distinct job and is no longer the mechanism for host visibility: `ownership.read` is an _additional_ row rule on the join row itself (for example author-only notes) and is AND-ed with the host gate. `ownership.write` is unchanged. New: `createFoldersFeature({ ownership, parents })` — folders had neither — and `createTagsFeature({ parents })`. `createNotesHistoryFeature({ parents })` now narrows the read path too, not just `add-note`.

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

## 0.257.0

## 0.256.0

## 0.255.2

## 0.255.1

## 0.255.0

### Minor Changes

- 0374846: Record-Akte "Bedienkonzept": tabbed detail screens render without a nested card and show a record-field count in the tab label; the metrics band supports click-to-navigate metrics with an overridable label and no longer requires a `fieldLabels` entry when the metric declares its own; the record header subtitle can link out to an absolute URL; header actions never collapse to icon-only, and row actions always keep `[Bearbeiten]` as a visible text button with the rest collapsed to a kebab menu; and `SidebarPanel` gained a `tone="surface"` option for lists that need content colors instead of navigation chrome. Also fixes the confirm dialog so Enter confirms instead of accidentally cancelling.

  Consumer note: a record header with more than two actions now also keeps only one labeled button (`[Bearbeiten]` if declared, else the primary action) and moves the rest into an overflow menu — the same A7 rule already applied to table rows.

- 1212eeb: fw#2801: `r.defineEvent(...).piiFields` gains the entity-field `personal` vocabulary as its canonical subject declaration: `{ <field>: { personal: { of: "<ownerField>" } } }`, matching `createTextField({ personal: { of: "<ownerField>" } } })` on entities.

  The previous `{ <field>: { subjectField: "<ownerField>" } }` form still works unchanged — it is now a deprecated alias for the same declaration, not a separate code path. Both forms resolve through the same internal normalizer (`normalizeEventPiiSubject`, exported from `@cosmicdrift/kumiko-types/handlers`) and encrypt under the identical subject key, so mixing old and new declarations across events is safe.

  Migration (optional, non-breaking): replace `{ subjectField: "authorId" }` with `{ personal: { of: "authorId" } }` in `piiFields` declarations at your convenience. Only a user subject is resolvable via this declaration today (fw#2801 step 1 of 3) — `"self"`/`"tenant"`/`"ref"` subjects on events land in a follow-up.

- 7003472: fw#2801 step 2: `r.defineEvent(...).piiFields` can now declare a `tenant` or `self` (record) subject, not just a user subject: `{ <field>: { personal: "tenant" } }` encrypts under the event's own `tenantId`, `{ <field>: { personal: "self" } }` under `record:<aggregateType>:<aggregateId>`. Both the live-append path (`encryptEventPayloadPii`) and `backfillEventPiiEncryption`'s custom-event-catalog branch resolve the declared subject through the same `resolveEventSubject` (`@cosmicdrift/kumiko-framework/crypto`), so a catalogued field always encrypts under the identical subject key regardless of which of the two write paths produced it.

  **Breaking:** `encryptEventPayloadPii(eventType, payload)` now requires a third argument, `envelope: { tenantId, aggregateType, aggregateId }` — needed to resolve `tenant`/`self` subjects. `append()` (the only framework call site) already supplies it from the appended event; direct callers of `encryptEventPayloadPii` must pass it too.

  `validateEventPiiFields` no longer requires an owner field for `tenant`/`self` subjects — only that the declared PII field itself exists on the payload schema.

  **Breaking:** `subjectKeyForRecord` (`@cosmicdrift/kumiko-framework/crypto`) now validates `entity` against `RECORD_ENTITY_PATTERN` (`/^[A-Za-z][A-Za-z0-9_-]*$/`, exported next to it) instead of only rejecting `""`/`":"`. This closes a gap where a `personal: "self"` event subject (or any `recordOwned` field) could mint a `record:<entity>:<id>` key for an entity name that `forgetSubject`'s `subjectIdSchema` would never accept — encrypted but permanently unshreddable. A consumer minting record subjects for an entity/aggregate-type name outside this pattern (leading digit/underscore, dots, etc.) will now get a loud `SubjectResolutionError`/thrown error at encrypt time instead of a silent future dead end. All entity names currently registered across the bundled features satisfy the pattern.

## 0.254.0

## 0.253.0

## 0.252.1

## 0.252.0

## 0.251.0

### Minor Changes

- 55691fd: fw#2558: **BREAKING** — `r.defineEvent(name, schema, options)` now requires an explicit PII stance. The third argument is mandatory and must carry `piiFields`, typed `EventPiiStance = EventPiiFields | "none"`.

  Before this change, omitting `piiFields` silently opted the event out of the crypto-shredding catalog, so `append()` wrote the payload to `kumiko_events` in plaintext with no signal that a decision had ever been made. Omission and "this payload holds no personal data" were indistinguishable. Now the registrar throws at registration time, and `publishEventPiiCatalog` re-checks every registered event at boot as defense in depth.

  Migration — every `r.defineEvent(...)` call site needs one of:

  ```ts
  // payload holds no personal data
  r.defineEvent("invoice-paid", schema, { piiFields: "none" });

  // payload holds personal data, encrypted under the owning user's DEK
  r.defineEvent("attempt", schema, {
    piiFields: { recipientAddress: { subjectField: "recipientId" } },
  });
  ```

  `piiFields: {}` is rejected — an empty object is indistinguishable from "the author forgot to list fields", so `"none"` is the only way to declare a payload PII-free. A `subjectField` names the payload field holding the owning user's id; it is a pseudonymous reference, not itself a catalogued PII field.

  Existing stored events are untouched: no backfill runs, and every bundled-features event that previously had no stance now declares `"none"`, which keeps `encryptEventPayloadPii` on exactly the path it took before. The one bundled event that already declared a stance (`delivery/attempt`) is unchanged.

  The feature-AST round-trip carries the stance too: `DefineEventPattern.piiFields` is required, the extractor fails on a `defineEvent` without one rather than inventing a default, and the renderer always emits the options block. Designer-regenerated feature files therefore keep the author's stance verbatim instead of silently downgrading it to plaintext.

  Forcing the stance surfaced five bundled events whose payload can carry plaintext personal data but which the current `EventPiiStance` cannot express — an `unknown`-typed custom-field value, operator free-text on the crypto-shredding audit events, a mail-account `displayName`, an ingest `fileName`. They ship as `"none"` with an in-code note pointing at the follow-up (#2776); their behaviour is unchanged from before this release, when they carried no stance at all.

- 28ad1f3: fw#2740: `relatedList` sections on `projectionDetail` gain `searchable` and `facets`, over the exact same payload/facet path as `projectionList` — no second SQL path, no read-side hack. Search rides along as `payload.search` and facet selections as `payload.filters` on the section's own query. Both are opt-in and validated at boot against the bound query's Zod schema, same as `projectionList.searchable`/`facets`. Facet resolution is shared with `projectionList` via `resolveProjectionFacetSpecs`/`buildFilterPayload` (moved to their own module to avoid a require cycle with `related-list-section.tsx`) — no duplicate implementation. Search term and filter selections live in local component state rather than URL state, since a section's `id` is optional and has no stable URL key to namespace against.

## 0.250.0

### Minor Changes

- a4a25ee: fw#2585: `JobContext` gains `writeAs(user, qn, payload)`, the explicit-identity counterpart to the existing `queryAs` — a job could read as any identity but only ever write as its own systemUser. Since `hasAccess` has no system bypass, every write handler whose `access` lists concrete roles (e.g. `["TenantAdmin"]`) was unreachable from a job: the dispatch came back `access_denied` and the only signal was a failed job. `writeAs` routes through the same `DispatchWriteRef.write` the dispatcher already exposes, so the write runs the full pipeline (access check, validation, hooks) as the passed identity and the resulting events are attributed to it rather than to SYSTEM. The job assembles the `SessionUser` itself — `ctx.triggeredBy` carries only id + tenantId and no roles, so the roles have to come from a trusted lookup, and the passed `tenantId` decides the target tenant with nothing cross-checking it against the job's own (same as the existing `queryAs` and `ctx.db`). `writeAs` is a required field on `JobContext`, so app code that hand-builds a `JobContext` object literal instead of letting the JobRunner build one (e.g. a boot seed) has to add it when bumping. `ctx.write` is unchanged and still runs as the job's systemUser.
- 0be08d9: fw#2606: the default presentation heuristic for `kind: "select"` no longer looks at label length. Until now a select rendered as a segmented radio group only when it had at most four options **and** every label was at most 14 characters long. Labels reach the primitive already translated, so the second condition made the widget type depend on the active UI language: the same field rendered as `segmented-${id}` in German and as `combobox-${id}` in English, which broke language-independent e2e selectors and made a row of fields jump on locale switch. The option count is now the only criterion (still at most four); labels that no longer fit wrap inside the group, which already has `flex-wrap`.

  Consumer note: selects with at most four options and long labels now expose `role="radiogroup"` where they previously rendered a combobox. `display: "dropdown"` on the field (or on the `Input` primitive) keeps the combobox where that is the wanted presentation.

- d9f9337: fw#2741: `ReferenceFieldDef` gains `sortable?: true`. A list sorted by such a field now orders by the referenced row's `labelField` instead of the FK column's UUID, resolved with a tenant-scoped correlated subquery on the read path (no join, no read-model change). Like `searchable`, the boot validator rejects `sortable` without an explicit non-`"id"` `labelField` and rejects it on `multiple` references. `Registry` gains `getSortableReferences(entityName)`, and `EventStoreExecutor.list`'s `runtimeOptions` gains a `referenceSort` counterpart to `referenceSearch`.

  Behavior change: a `sort` on a reference field that did not opt into `sortable` (or whose target label cannot be resolved) now falls back to plain id order instead of ordering by the raw UUID column — a UUID order looks deliberate to the user while being arbitrary.

- 3737271: fw#2752: `style: "danger"` is now allowed on the `navigate` and `drawer` variants of `RowAction` and `ToolbarAction` — there it only renders the action red, the forced confirm dialog stays bound to the `writeHandler` variants. `ActionFormScreenDefinition.submitStyle: "danger"` marks the form's submit button as destructive.

## 0.249.0

### Minor Changes

- 812795d: fw#2756: `FieldCondition` gains `{ field, in }` and `{ field, notIn }` set-membership variants alongside the existing `eq`/`ne`, evaluated by `evalFieldCondition`.

## 0.248.0

### Minor Changes

- 109ff0d: fw#2750: `TreeAction` (the type behind `NavDefinition.createAction` and `.actions`, the "+" and hover-actions on a nav node) now carries `screen` as an alternative to `target` — the same `screen` XOR `target` polymorphism the node itself already has. `target` is now optional. Previously an action could only dispatch via `TargetRef` (the EditorPanel path), so an app with plain screen routes had no way to wire a "+" affordance to a normal route.

  The boot validator (`validateNavs`) rejects a `createAction`/`actions[]` entry that sets neither or both of `screen`/`target`, and rejects a `screen` that isn't a registered screen QN — same error class as the node's own dangling-`screen` check.

  `renderer-web`'s `NodeActions` renders a `KumikoLink` to the route for a `screen`-action and keeps the dispatch-button for a `target`-action, same look either way. Also fixed while touching this: the actions container was hard-pinned `right-7` to clear the collapse-chevron even on non-expandable nodes (the common case for a flat app nav), leaving a 28px gap; it now sits at `right-1` when the node has no chevron.

## 0.247.0

### Minor Changes

- 25cbdd2: fw#2722 (remaining scope — Card-Rahmen already shipped separately): a `relatedList` section can now sort and no longer stretches the page.

  **Sorting.** `ListColumnSpec` gains a `sortable?: boolean` flag and `EditRelatedListSection` gains `defaultSort?: ListSortSpec` — declared per-column, the same shape `entityList.defaultSort` uses, and validated the same way at boot (`defaultSort.field` must name a listed, `sortable: true` column, or the app fails to boot). Both are opt-in: a `relatedList` section that declares neither behaves exactly as before.

  Sorting is applied **client-side**, over the rows already loaded for the section. Unlike `entityList`/`projectionList`, a `relatedList` section has no pager at all — one one-shot fetch, no cursor, no `onReachEnd`. When the server-side `limit` truncates that fetch (`PagedRows.nextCursor !== null`), the loaded rows are only the first page in the server's own order, not "the top N by this column" — sorting that subset client-side would otherwise silently misrepresent it as the latter. `RelatedListSection` now renders an info `Banner` above the table whenever `nextCursor !== null`, independent of whether a sort is active, naming how many rows are shown (`kumiko.list.related-list-truncated`, added to `i18n-defaults.ts` and the `locale-de`/`locale-es` packages). Sending the sort to the server instead would need pagination this section doesn't have, so it was not built for this PR.

  **Height.** A `relatedList` section in a tabs-mode Akte (the layout that already hides the section title, `hideSectionTitles: true`) now fills the tab panel's available height and scrolls its table internally, instead of a fixed `60vh` guess or growing the whole page — the concrete complaint (a 40-row Akte tab pushing the page and making the record unusable, on any viewport height) is fixed. `FormProps` gains a `fillHeight` flag; `RenderEdit` sets it only when tabs mode has narrowed the form to a single, active `relatedList` section (`hideSectionTitles === true && filteredSections[0]?.kind === "relatedList"`) — every other form (multi-section, non-`relatedList` tabs, stacked non-tabs forms, `entityList`/`projectionList`) is untouched. The flag threads a `flex-1 min-h-0` chain from `FormRoot` through `FormScreenShell`, the form's card, `RelatedListSection`'s own wrapper, down to `DataTableProps.scrollBody`'s table body (now `flex-1 min-h-0 overflow-y-auto` instead of `h-[60vh] overflow-y-auto`) — the narrow-viewport card list (`scrollBody`'s `cardsInner()` branch) gets the same `flex-1 min-h-0 overflow-y-auto` treatment so it scrolls internally instead of clipping. No change to `app-layout.tsx`/`DefaultAppShell` was needed: `<main>` is already viewport-bounded with a passive `overflow-auto`, so a child that itself never grows past `<main>`'s available height never triggers it — avoiding nested scrollbars without touching shell code shared by every screen. This depends on the shell's `fill` prop staying at its default `true` (an app-level choice, not per-screen); `fill={false}` is an explicit page-scroll escape hatch that leaves `<main>` height-unbound, so the chain degrades gracefully to the pre-fix, unbounded-growth behavior rather than clipping — grepped across every consuming app repo in the workspace, none currently sets `fill={false}`.

  `@cosmicdrift/kumiko-renderer` stays platform-neutral (no DOM/Tailwind), so the terminal link of this chain — the wrapper around `RelatedListSection`'s `hideTitle` content — can't be a raw `<div>`. `CorePrimitives` gains an optional `FillContainer` primitive (same additive-rollout pattern as `JsonView`/`Drawer`/`Progress`: existing partial `CorePrimitives` test doubles keep compiling), implemented in `renderer-web` as the `flex-1 min-h-0 flex-col` div; `RelatedListSection` falls back to rendering its content unwrapped when a host has no `FillContainer` (e.g. a native impl, where the parent is already a bounded viewport and the wrapper is meaningless).

  Not included: search/facets on `relatedList` (`ListFacetSpec`, as `projectionList` has it). Doing this properly would mean replacing `RelatedListSection`'s synthetic minimal entity (a `{ type: "text" }` field per column, with no real query-schema/facet metadata behind it) with genuine reuse of the `projectionList` path — a structural rebuild out of scope for this PR. Left for a follow-up ticket.

  https://claude.ai/code/session_0135cRvFdyV956Aae8PxyyDd

## 0.246.0

### Minor Changes

- b5e44ad: Fix a double orientation loss (fw#2724): navigating from a list into a sub-screen that has no nav entry of its own (an `entityEdit`/`actionForm` reached via a row action, for example) used to mark nothing in the sidebar AND shrink the breadcrumb to a single crumb — nearly every non-nav-listed screen in a real consumer app.

  - `listScreenId` (already available on `custom`/`projectionDetail`) is now also accepted on `entityEdit` and `actionForm` screens, naming the parent list screen for breadcrumb and nav-highlight resolution.
  - An explicit `listScreenId` now wins over the existing rowAction/entity-list heuristics on every screen type that carries it (previously the heuristic could override a declared `listScreenId` on `custom`/`projectionDetail`; both resolutions agree on every screen shipped in bundled-features, so no visible change there).
  - `NavTree`'s active-item marking now shares this exact resolution with the breadcrumb (`resolveParentScreenId` in `shell-breadcrumb.ts`): when the routed screen has no node of its own in the nav tree, the resolved parent's nav entry is highlighted instead of nothing. `aria-current="page"` stays reserved for the screen that IS the routed one — the parent-fallback match gets the visual highlight only, not that assertion.
  - This is a visible behavior change for existing apps, by design: any `entityEdit` screen without its own nav entry that shares an entity with a listed `entityList` (or is a rowAction target of one) now lights up that list's nav entry — nothing needs to be declared for this, the existing heuristic just now also drives nav highlighting, not only the breadcrumb.

## 0.245.0

### Minor Changes

- eb6fe2f: fw#2711: a `select` field can now request a radio group instead of hoping for one.

  The web renderer already rendered `kind: "select"` as a WAI-ARIA radio group, but only behind a heuristic — at most 4 options, every label at most 14 characters. An app that wanted the radio group had no way to ask for it; one 15-character label silently turned the whole group into a dropdown. The next consumer then reached for raw `<input type="radio">`, because that was the only way to decide the presentation.

  `SelectFieldDef` and the `Input` primitive's `kind: "select"` both gain an optional `display: "radio" | "dropdown"`. `"radio"` always renders the radio group, whatever the label lengths and option count; `"dropdown"` always renders the combobox. Omitted keeps the existing heuristic, so no existing field changes its rendering.

  `display` is a request, not a contract: custom primitives implementations may ignore it and keep their own presentation. An empty `options` list still renders the dropdown even with `display: "radio"` — an empty radio group has nothing to operate.

## 0.244.0

## 0.243.4

## 0.243.3

## 0.243.2

## 0.243.1

## 0.243.0

### Minor Changes

- 349d763: `actionForm` screens can name the success-payload field their post-submit redirect navigates by: `redirect: { screen: "lease-detail", idFrom: "leaseId" }` (`ActionFormRedirect`, `@cosmicdrift/kumiko-types`). Until now the renderer always navigated with `data.id`, so an action that creates a child record (add a lease item, add a protocol section) could only land on the child — a redirect back into the parent's detail screen resolved the parent id to the child's and 404'd.

  The alternative was to make the write-handler report the parent id as its own `id`, breaking the handler's contract for every other caller. The routing decision now sits on the screen, where it belongs, and handlers keep reporting what they actually wrote.

  Backwards compatible: `redirect` still accepts the plain string, which keeps navigating by `data.id`. The boot-validator resolves the object form's `screen` exactly like the string form (short id or cross-feature QN) and rejects an empty `idFrom`. As before, the id is only appended when the target screen carries one (`entityEdit`, `projectionDetail`).

## 0.242.0

### Minor Changes

- efd5891: Screens can now opt out of the AI agent with `agent: { expose: false }`, the same way handlers already could. A sysadmin-only or PII-heavy screen no longer has to carry an alibi `description` written solely to satisfy `agent-doc-lint` — the opt-out silences the lint gap AND removes the screen from the agent manifest, so it never reaches the `navigate` tool's screen-id enum or a nav entry pointing at it.

  Every `ScreenDefinition` variant gains the optional `agent` slot (`@cosmicdrift/kumiko-types`), and `isAgentVisibleScreen` is exported from `@cosmicdrift/kumiko-framework/engine` alongside `resolveAgentExposure`.

  The default is unchanged and deliberately not fail-closed: a screen without an `agent` slot stays visible to the agent whether or not it has a `description`, exactly as before. Only an explicit `expose: false` hides one.

  Note the knock-on effect for `open_form`: an `actionForm` or `entityEdit` screen that opts out also loses its handler-to-screen mapping in the manifest, so the agent can no longer offer that form — the handler itself stays listed and directly callable.

## 0.241.0

### Minor Changes

- 33059e9: `admin-shell`'s `tenant-overview` and `platform-overview` screens now use declarative `dashboard` screens (`kind: "stat"` panels) instead of custom React components — both render through the generic renderer. Fixes the platform-overview "undefined" tile bug: `tenant:query:list` and `jobs:query:list` didn't return `total` even with `totalCount: true` requested, because their Zod schemas stripped the field before the handler ever saw it.

  Adds `DashboardStatPanel.params` (`@cosmicdrift/kumiko-types`) — static, author-set query parameters merged under the panel's dynamic `filterParams` (`@cosmicdrift/kumiko-renderer-web`'s dashboard body now does that merge).

  Additive query-handler changes: `tenant:query:list` and `jobs:query:list` accept `totalCount: boolean` and return `total` when set (`jobs:query:list`'s total is a real count, not `rows.length`, so it isn't capped by `limit`); `config:query:readiness` gains `missingCount`/`missingTone` alongside the existing `missing` array.

  `PlatformOverviewScreen`/`TenantOverviewScreen` and their supporting `overview-layout`/`overview-query` modules are gone (never public exports — the renderer selects screens by `screen.type`, not a client component registry). The `overview-allowlist` exports (`isOverviewQueryAllowed`, `overviewAllowedQueries`, the allow/forbidden-list constants) stay — they're now checked against the screen definitions in tests instead of gating a client-side dispatch call.

- 43b41b5: `audit` and `jobs` bundled features now use declarative screens (`projectionList`/`projectionDetail`) instead of custom React components: `audit-log`/`audit-log-detail` and `job-runs`/`job-run-detail` render through the generic renderer, and job triggering moved to a new `job-trigger` `actionForm` opened via a drawer `toolbarAction` on `job-runs`.

  Removed exports (dead since the renderer selects screens by `screen.type`, not the client component registry): `AuditLogScreen`, `AuditLogDetailScreen`, `JobRunsScreen`, `JobRunDetailScreen` from `@cosmicdrift/kumiko-bundled-features`. No shipped consumer app imported these.

  Adds a `json` field-renderer format (`EditFieldSpec.renderer.format`, `@cosmicdrift/kumiko-types` + `@cosmicdrift/kumiko-headless`) that pretty-prints a JSON-string field instead of showing the raw escaped string; used by the new `job-run-detail` screen's `logs` field.

- 8289b69: `projectionDetail` screens gain an optional `singleton: boolean` flag (`ProjectionDetailScreenDefinition`) for a self-service screen bound to a query that determines its row from the caller's session/context instead of a row id in the path (e.g. `user:query:user:me`). Without the flag, `ProjectionDetailBody` always rejected a missing path id with an error banner — the only path a singleton screen has — so `user-profile`'s `profile` screen and `user-data-rights`' `privacy-center` screen, both converted to `projectionDetail` bound to `me`-style queries, rendered nothing but that banner. Both now set `singleton: true` and render.

  Under `singleton`, the query is called without the `idParam` key (there is no id to send) and any path id — even a stray or spoofed one — is ignored rather than forwarded into the query or into extension sections' entity-id resolution: a singleton row is server-picked, so no client-supplied id can reach it. The boot-validator rejects declaring `idParam` or `detailFor` together with `singleton` (both are meaningless/unsound once the server owns row selection — `detailFor`'s auto-generated "Edit" action navigates via the path id, which a singleton screen never has) instead of letting one silently win.

## 0.240.0

### Minor Changes

- db53bbc: `projectionDetail` screens can now declare a `writeForm` section: a `kind: "writeForm"` layout section with its own `fieldDefs`/`fields` and a `handler` write-handler QN, rendered as an editable form that submits through the ambient dispatcher and reloads the screen (record + any relatedList sections) on success. Unlike every other `projectionDetail` section, its fields are never forced `readOnly:true` — a `writeForm` field's own `readOnly`/`required` wins.

  `relatedList` sections gain `rowActions`, the same `RowAction` shape (`navigate` / `writeHandler`, with a declarative `payload` extractor) already used by `entityList`/`projectionList` row actions, dispatched through the identical execution path — no second row-action mechanism. The boot-validator rejects `writeForm` on `entityEdit`/`configEdit`/`actionForm` (mirroring the existing `relatedList` restriction), an unregistered `writeForm`/`rowAction` handler, a `writeForm`/`relatedList` section in a wizard layout, a `writeForm` field missing from its own `fieldDefs`, and more than one row-click source on a `relatedList` section.

## 0.239.0

### Minor Changes

- 2fbab3d: Reference fields can now opt into text search matching by their target row's label instead of the raw FK column: add `searchable: true` to a `ReferenceFieldDef` alongside an explicit, non-`"id"` `labelField`. A search request unions native text-field hits with tenant-scoped label matches against the reference target (and, in system-scoped cross-tenant searches, the implicit `tenantId` → `tenant.name` row-meta reference — in ordinary tenant-scoped searches that lookup is skipped, since tenantId can only ever hold the caller's own tenant there anyway), capped at 200 target matches — above that the reference clause is dropped and native search still applies.

  Also removes the unused `searchInclude` option from `r.relation()`'s `belongsTo`/`manyToMany` definitions and `Registry.getSearchIncludes` (replaced by `Registry.getSearchableReferences`) — that mechanism had no production consumers.

## 0.238.0

### Minor Changes

- 8206493: `ListColumnSpec` gains optional `refEntity`/`refLabelField` fields so `projectionList`/`relatedList` columns can declare a reference lookup — those screens have no `EntityDefinition` to carry a real `reference` field type, so a declared reference column previously rendered the raw id. `computeListViewModel` now checks this metadata before the entity-fields lookup and marks the column as `type: "reference"`; the existing renderer-side bulk lookup (`useReferenceLookup`) picks it up automatically.

  `delivery-log`'s `tenantId` column and `sessions-list`'s `userId` column now declare this metadata and resolve to the tenant/user display name instead of the GUID. `useReferenceLookup` also gained a generic fallback (`SYSTEM_REFERENCE_LABELS`, keyed by `refFeature:refEntity`) for reference ids that have no backing row — currently covering `SYSTEM_TENANT_ID`, which renders as the new `kumiko.reference.system-tenant` ("System") label instead of the all-zero GUID.

  `EditFieldSpec` gains the same `refEntity`/`refLabelField` metadata for `projectionDetail` fields, resolved by `computeEditViewModel` with the same before-the-fieldDef-lookup precedence; `session-detail`'s `userId` field now declares it (matching `sessions-list`) and its read-only display (`ReadOnlyReferenceValue`) also consults `SYSTEM_REFERENCE_LABELS`.

## 0.237.2

### Patch Changes

- 562b11f: Add an app-wide `screenWidth` option to `createKumikoApp` so a consumer can set the default width for every form/detail screen that doesn't set its own `layout.width`, instead of forking every bundled-feature screen it doesn't own to change one Tailwind class. `FormScreenShell` now reads its default from a `ScreenWidthProvider` context (exported from `@cosmicdrift/kumiko-renderer-web`) instead of a hardcoded `max-w-4xl`; per-screen `layout.width` still wins over the app default. Behavior is unchanged for apps that don't pass `screenWidth` (default stays `"4xl"`).

  Also removes the now-redundant hardcoded `maxWidth` on the bundled `profile`, `privacy-center`, `tier-admin`, and admin-shell overview screens so they inherit the app default too.

  Fixes the Cancel button on form/detail screens having no visible hover state: it used the `link` button variant, which strips the button's box (`h-auto px-0 py-0`); it now uses `secondary` (outline + `hover:bg-accent`) like the framework's other secondary actions.

  Fixes the profile screen's email/password row rendering as two unevenly sized cards followed by a stray full-width row: `items-start` opted the row out of the grid's default stretch behavior, so two cards of different content height sat at their own heights instead of matching each other.

## 0.237.1

## 0.237.0

## 0.236.1

## 0.236.0

## 0.235.4

## 0.235.3

## 0.235.2

## 0.235.1

## 0.235.0

### Minor Changes

- 9dc8d1c: New `bootGate: true` job flag — a job that actually gates a deploy.

  - A `bootGate` job runs inline while the job runner for its lane starts, before cron schedules and `runOnBoot` enqueues. Its handler is awaited, so a throw rejects `start()` and with it `runProdApp`'s boot: the process exits before it ever reports ready. It runs on every start and is never deduped.
  - `runOnBoot` is now documented for what it does: it only enqueues (fire-and-forget), and it dedupes on a fixed job id, so it runs at most once per Redis dataset — a boot job that already ran or failed is not retried on a later deploy. A throw there fails a queue job, never the boot.
  - `bootGate` cannot be combined with `perTenant` or `concurrency: "sequential"` — both have re-enqueue paths that would let a gate pass without ever running the handler. The registry rejects those combinations at build time.

  **Breaking for `legal-pages` consumers:** its boot check moves from `runOnBoot` to `bootGate`, which makes the documented "hard-fails production when the required blocks aren't seeded" promise true for the first time. Two failure modes that were previously swallowed by the fire-and-forget queue now abort the boot:

  - **Missing required blocks — `NODE_ENV=production` only.** Outside production the check still only logs a warning, unchanged. In production, an app shipping without the required blocks seeded in `SYSTEM_TENANT` now fails to boot instead of serving a site without an imprint. Fix by seeding the required blocks (`seedTextBlock`), or by narrowing/emptying `requiredBlocks` in the feature options.
  - **Missing `extraContext.templateResolver` — every environment.** The check has always thrown here; the throw is now visible. `runProdApp` and `runDevApp` wire `templateResolver` automatically, so this only affects bootstraps that call `createKumikoServer` directly. Fix by passing `extraContext: ({ db }) => ({ templateResolver: createTemplateResolverApi(db) })`.

  The `seo` feature's boot check stays on `runOnBoot` — it promises no hard fail, and converting it would turn a warning into a boot abort for apps without a sitemap entry source.

- 38d7ffc: The self-populating settings hub now also derives a screen from `r.secret(...)` declarations, alongside masked config keys.

  - New `secretsEdit` screen, grouped by declaring feature, shown under the tenant-audience nav with label/hint taken from the declaration.
  - The screen only appears when the `secrets` feature is mounted, and mirrors the access rule of `secrets:write:set`.
  - Inputs always start empty — the redacted preview is shown next to the field but never loaded into it; deleting a secret goes through `secrets:write:delete`.

  Consumer note: new screen type `SecretsEditScreenDefinition` added to the `ScreenDefinition` union — consumers that switch exhaustively on `screen.type` need to handle it.

## 0.234.0

### Minor Changes

- 40a8143: Edit masks and screen actions now carry visual defaults instead of stacking identical text buttons.

  - `RowAction` accepts an `icon` key, and `entityEdit` screens accept `actions` at all — an edit mask is no longer limited to Cancel and Save. Actions without a declared icon derive one from their id, so existing screens gain icons without a schema change.
  - More than two icon-bearing actions collapse to icon-only buttons; the delete action moves to the far left of the form footer.
  - Boolean fields render as a switch with the label above; select fields with at most four options render as a segmented group at content width instead of a full-width dropdown.
  - Text fields derive a prefix icon from their name (email, phone, url, city, …).
  - The form card gets a tinted, divided header band matching its footer, and metric cells render as dividers rather than nested cards.

  Consumer note: boolean fields now expose `role="switch"` instead of `role="checkbox"`, and selects with at most four options expose `role="radiogroup"` with `role="radio"` children plus a `segmented-kumiko-edit-<field>` test id instead of a combobox. End-to-end tests that drive these controls by their old role — `setChecked` on a checkbox, or opening a combobox popover — need to be updated. `layout: "inline"` still renders a checkbox, and selects with more than four options still render a dropdown.

## 0.233.0

### Minor Changes

- b0b9484: `NumberFieldDef` gained a `unit` option: an editable number field can now show a unit-of-measure suffix in its input, either a static string (`unit: "km"`) or a sibling field's live value (`unit: { field: "mileageUnit" }`), so the unit can vary per record (e.g. an odometer reading in "mi" or "km"). Display-only — the stored numeric value is never converted. Added `mi` (miles) to the read-only `unit` format registry's vocabulary alongside it.

### Patch Changes

- 56c3f2d: Form action bars now group into two rows: destructive/record actions (Delete, copy-link, custom actions, Cancel) on their own row, wizard/submit navigation on the other — desktop shows them side by side, narrow viewports stack the primary action on top. Buttons gained `icon`/`iconEnd` props (resolved against the shared `NavIconKey` vocabulary, now covering button icons too) and a new `danger-ghost` variant for destructive actions rendered as red text instead of a red fill.

## 0.232.0

### Minor Changes

- 05bdf93: **Breaking:** `r.step.waitForEvent`'s `event` argument is now a branded `AwaitedEventType` instead of a raw `string`. A workflow declares the events it expects via a new `defineWorkflow({ awaits: { shipped: "order.shipped", ... } })` map, and a step can only reference one of those through `awaits.<key>` inside the `stepsPipeline` closure — `stepsPipeline`, `PipelineDef` and `PipelineBuildCtx` all gained a matching `awaits` type parameter/field for this. `buildPipelineSteps` is the sole place a raw event-type string is branded, so a typo like `awaits.shiped` is now a compile error instead of a run that suspends forever. `computeDefinitionFingerprint` folds the declared `awaits` map into the Q7 snapshot fingerprint, since changing which events a run waits on changes its routing/behavior the same way changing the step source does.

  No compatibility shim: any existing `r.step.waitForEvent({ event: "some.type" })` call with a literal string must be rewritten to declare that event under the workflow's `awaits` and reference it as `awaits.<key>`.

## 0.231.0

### Minor Changes

- 404d143: `ctx.files` (`FileContext`) gains `list(prefix)`, delegating to the already-required `FileStorageProvider.list`. Derived variants (thumbnails, resized images, …) live under deterministic, hashed storage keys that are never written back onto the originating `FileRef` row, so the only way to find them is a prefix listing — previously only the GDPR hook's `buildStorageProvider` could do that. Ordinary handlers deleting a file through `ctx.files` had no way to discover and delete its variants, leaving them as orphaned bytes.
- 4f4bc49: **Breaking:** `r.step.waitForEvent`'s `match` argument is now a serializable `EventMatch` AST (`{ version: 1, expr: ... }` built from `and`/`or`/`atom` nodes and `eq`/`ne`/`in`/`gt`/`gte`/`lt`/`lte` ops) instead of a `(payload: unknown) => boolean` closure. The resolved AST is persisted into the `workflow.step.waiting-for-event` suspension event's payload so the Resume-Loop can evaluate it (via the new `evaluateEventMatch` export) without re-running app code — a closure cannot survive that round-trip. No compatibility shim: any existing `match` closure must be rewritten as an `EventMatch` expression.

## 0.230.0

## 0.229.1

## 0.229.0

## 0.228.0

## 0.227.0

### Minor Changes

- 5f157b6: `projectionDetail` screens can now declare `EditExtensionSection`s that persist through their own dispatcher writes (e.g. a notes/history block), motivated by solon#264 losing a hand-written `NotesSection` with no declarative equivalent. The boot-validator only rejects an extension section when `contributesToFormSubmit: true` — there is no form submit on a read-only detail screen. Extension sections can also declare `entityName` to override the host-derived value passed to the mounted component; on `projectionDetail` this is required, since the screen has no real entity to derive one from.

## 0.226.0

### Minor Changes

- c4ed490: Query handlers can now declare an optional `outputSchema` (a Zod schema of the handler's actual return value — the paged envelope for `definePagedQueryHandler`, or the flat record for a plain `defineQueryHandler`). When set, the boot-validator checks a screen's column/field references against it and throws on a typo instead of it surfacing as a silently-empty cell at runtime: `projectionList`/`relatedList`/dashboard-list `columns`, `projectionDetail` `header`/`metrics`, and dashboard stat-panel `valueField`/`subField`/`toneField`/`deltaField`/`deltaDirectionField`/`deltaToneField`. Fully additive — a handler without `outputSchema` (every existing one) skips these checks exactly as before.

## 0.225.0

### Minor Changes

- d63b2e8: `projectionDetail` screens can now declare an optional record header (`header: { title, subtitle?, status? }`), a metrics band (`metrics: string[]`, labeled via `fieldLabels`), and a tabbed layout (`layout.mode: "tabs"`) alongside the existing single-section layout. All three are additive — a screen that doesn't set them renders unchanged. Tabs are read via a new `Tabs` Core-Primitive (wired to a vendored shadcn/Radix implementation in `kumiko-renderer-web`) and driven by the `?tab=` search param; only the active tab's section mounts, so its query fires on selection instead of upfront.

## 0.224.2

## 0.224.1

## 0.224.0

## 0.223.0

### Minor Changes

- c4d07f5: `createMultiSelectField` can now render as a checkbox grid instead of the combobox dropdown. Set `display: "checkboxes"` on the field to get one checkbox per option plus a select-all/deselect-all toggle; omitting `display` keeps the existing combobox behavior unchanged.

  Two more options come on top, both only meaningful with `display: "checkboxes"`:

  - `columns` (1–4) sets the grid's column count at the widest breakpoint; narrow viewports always collapse to a single column.
  - `maxRows` caps how many grid rows stay visible before the grid becomes vertically scrollable; omitted, the grid grows with its content.

  Setting `columns` or `maxRows` without `display: "checkboxes"`, or an invalid `maxRows` (not a positive integer), fails at boot.

## 0.222.0

### Minor Changes

- b00604c: Fix GDPR erasure gap (#2461): thumbnails/resized variants (derivatives) written under a deterministic, untracked storage key survived user-forget and tenant-destroy even after the original was deleted, because the forget hook only ever deleted `storageKey` itself.

  `FileStorageProvider` and `UserDataStorageProvider` gain a required `list(prefix)` method (implemented for the in-memory, local-filesystem, and S3 providers). The fileRef forget hook now lists each original's derivative prefix, filters candidates through a grammar-anchored check (same extension + `<name>-<16 hex>` suffix) so an unrelated same-prefix sibling is never touched, and deletes every match alongside the original.

  **Breaking for custom `FileStorageProvider`/`UserDataStorageProvider` implementations**: add a `list(prefix): Promise<readonly string[]>` method (prefix-match over currently-stored keys, paginated internally). Also note the new required IAM permission for S3-compatible backends: forget/erasure now needs `s3:ListBucket` in addition to `s3:DeleteObject`, or forget runs will fail (loudly — the hook wraps the raw provider error with a hint) instead of silently leaving binaries behind.

  Not covered by this fix: derivatives rendered before this ships are not retroactively cleaned up (no backfill/GC job — tracked as a follow-up), and the tenant-destroy path does not yet call this hook at all (no `EXT_TENANT_DATA` registration for `fileRef` — pre-existing gap, tracked separately).

## 0.221.0

### Patch Changes

- 1656ff9: Security review batch: prototype-safe role ranks, prod KMS fail-closed scaffolding, payload-tenant occupancy latch, invite-accept reserved-role writeFailure, and related contract docs.

## 0.220.1

## 0.220.0

### Minor Changes

- c2ea385: FormScreenShell / EditLayout.width default to full width (same chrome as lists). Override with layout.width or maxWidth when a screen needs a narrow column.

## 0.219.0

## 0.218.0

## 0.217.0

## 0.216.0

## 0.215.7

## 0.215.6

## 0.215.5

## 0.215.4

## 0.215.3

## 0.215.2

## 0.215.1

## 0.215.0

### Minor Changes

- 67805ac: `FieldFormatRegistry` gains an `enumOption` format key (`{ format: "enumOption", keyPrefix: "..." }`) that resolves an enum value to its translated label through the standard option-key convention (`<feature>:entity:<entity>:field:<field>:option:<value>`), client-side.

  `applyFormatSpec` takes an optional `translate` parameter; `FieldRendererOutput` (`projectionDetail` fields) and `DataTableCell` (`entityList`/`projectionList`/`relatedList` columns) now pass `useTranslation()` through. An untranslated key falls back to the raw enum value, mirroring `buildOptionLabels`'s convention for `entityList` select columns.

  This closes the last gap that forced server-side enum translation via hand-rolled locale dictionaries (fw#2315, solon#203): a query handler no longer needs to know the request's locale to make an enum value readable.

- 2bcf3c9: `SessionUser` gains an optional `locale` field, carried in the JWT `locale` claim alongside the existing `timezone` claim. It's set at login from the user's stored `locale` column (the same column `user:update` already lets users change explicitly) and threaded through every session-minting handler (login, invite-accept, MFA enable/verify).

  `ctx.locale`'s fallback chain now checks the persisted `SessionUser.locale` (validated as a well-formed BCP-47 tag) between the live per-request signal (`X-Locale`/`Accept-Language`) and the app's boot-configured `defaultLocale` — so a user's chosen language now survives across devices and background/job contexts that carry no request-scoped locale signal.

  Silent server-side adoption of the live `ctx.locale` back onto `SessionUser` at login was considered and rejected: `ctx.locale` is already cascaded through the boot default by the time a handler sees it, so a login without an `X-Locale`/`Accept-Language` signal (curl, non-browser clients) would silently overwrite an explicitly-chosen locale. The existing `user:update` write path stays the sanctioned way to change a stored locale.

## 0.214.0

### Minor Changes

- 4e72848: Added a `unit` field formatter (`{ format: "unit", unit: "m2" | "km" | "m" | "kg" | "percent" }`) to `FieldFormatRegistry`/`applyFormatSpec`, so apps showing a value-with-unit on a detail page (e.g. `58 m²`) can declare `field.renderer` instead of hand-rolling an i18next `{{value}} m²` template. CLDR-sanctioned units (`km`/`m`/`kg`/`percent`) render locale-correctly via `Intl.NumberFormat({ style: "unit" })`; `m2` has no sanctioned ECMA-402 unit (`square-meter` throws `RangeError`), so it renders as a locale-formatted number with a literal `m²` suffix instead.

  `RenderField`'s readOnly + declared-`renderer` path (`FieldRendererOutput`) now also defaults `locale` to the app's `LocaleProvider` locale when the `FormatSpec` doesn't set its own — previously it silently fell back to the JS runtime's default locale for every locale-sensitive format (`timestamp`/`date`/`number`/`decimal`/`bigInt`/`unit`), not just the new one. An explicit `renderer.locale` still wins, same precedence as `dateLocale` vs. app-locale elsewhere in the same component.

## 0.213.0

### Minor Changes

- 7ffd0f6: The browser's active UI language now reaches the server. `createLiveDispatcher` reads `document.documentElement.lang` and sends it as an `X-Locale` header on every request; `createKumikoApp`/`createPublicSurface` keep that attribute in sync with the app's `LocaleResolver` via a new `DocumentLangSync` component, so this works in every app with zero app-side wiring.

  The server resolves the header (falling back to `Accept-Language`, then the app's boot-configured default locale, then `"en"`) into a new, always-present `ctx.locale` on `HandlerContext` — the same Request → Boot-Default precedence `ctx.tz` already uses.

  Every magic-link mail in the auth-email-password feature (signup, password-reset, email-verification, invite, account-unlock) now renders in the requester's active locale instead of a hardcoded boot-time default, and each flow's `appUrl` can now be a `(locale: string) => string` function so apps with language-prefixed paths can point the link at the right locale.

## 0.212.0

### Minor Changes

- 35b0005: `RowActionNavigate` (rowActions on entityList/projectionList, and header actions on projectionDetail) can now target an entity instead of a screen id: set `entity: "<entityName>"` instead of `screen`. The boot validator resolves it against the screen that declares `detailFor: "<entityName>"` (in any feature), the same way hand-written `nav.navigate({ entity, id })` calls already resolve via `resolveTarget`. `screen` and `entity` are mutually exclusive; `projectionList`/`projectionDetail` entity-targets require an explicit `entityId` field name since those rows have no guaranteed `id` field.

## 0.211.0

## 0.210.0

### Minor Changes

- 8b4467d: `projectionDetail`'s `hideActions: true` (0.209.0) hid RenderEdit's entire footer, including the screen's own declared `actions` — a screen that set `hideActions` to lose its Cancel button silently lost its header actions along with it (e.g. `RowActionNavigate` buttons opening related records).

  `projectionDetail` has no write path, so there's nothing for a Cancel button to discard: RenderEdit's `onCancel` is no longer wired up for this screen type at all, regardless of `listScreenId`. Back-navigation continues to work via the breadcrumb, which already resolved `listScreenId` independently. Declared `actions` now always render.

  **If you're on 0.209.0 and this affects you:**

  - Every existing `projectionDetail` screen with `listScreenId` set now renders without a Cancel button by default — that button used to show unless you opted out.
  - `hideActions` is removed from `ProjectionDetailScreenDefinition` entirely (it only ever shipped in 0.209.0, with the bundled sessions feature as its only consumer). Delete it from any screen definition that still sets it — it no longer exists on the type. `RenderEdit`'s own `hideActions` prop (for hosts driving their own action bar directly) is unrelated and unchanged.

- d85987c: PII field annotations collapse from twelve low-level flags (`pii`, `userOwned`, `tenantOwned`, `subjectRef`, `allowPlaintext`, `lookupable`, `searchable`, `sensitive`, `piiEncrypted`, ...) to two author-facing options: `personal` (whose data it is) and `find` (how it stays findable). No backward compatibility — the old flags are a type error now and every field definition must migrate.

  Before:

  ```ts
  email: createTextField({ required: true, pii: true, lookupable: true }),
  body: createLongTextField({ userOwned: { ownerField: "authorId" } }),
  ```

  After:

  ```ts
  email: createTextField({ required: true, personal: "self", find: "exact" }),
  body: createLongTextField({ personal: { of: "authorId" }, find: "none" }),
  ```

  `personal` picks the erasure subject, and with it the key whose destruction shreds the value: `"self"` (the row's own subject), `{ of: "<fieldName>" }` (someone else's data, keyed by that field), `"tenant"`, `"ref"` for a plain foreign key to a subject stored elsewhere, or `false` with a required `reason` for a field that looks sensitive but deliberately is not PII.

  `find` picks findability, and is mandatory on text fields once `personal` names a subject — forgetting it is what produced the drift this change removes:

  - `"exact"` — equality lookup over an HMAC blind index (`<column>_bidx`)
  - `"fuzzy"` — full-text search over the derived index, and equality on top
  - `"none"` — encrypted, not queryable
  - `"secret"` — never indexed, and stripped from the write-response echo. It is not a read gate: a detail query still returns the value, and who may see it remains `access: { read: [...] }`.

  `longtext` takes only `"none" | "secret"` — it has no field-level search index.

  `encrypted: true` is unchanged and orthogonal: an app-wide master key that stacks _on top of_ a subject key (as `userMfa.totpSecret` does), not an alternative to it. `piiEncrypted` is gone from entity fields; config keys keep their own.

  Fields that gain `"fuzzy"` where they previously had only `searchable` need a `_bidx` column — run `kumiko-schema generate` and let the projection rebuild backfill it. `scripts/codemod/pii-personal-migration.ts` migrates existing field definitions and reports anything it cannot map mechanically.

## 0.209.1

## 0.209.0

## 0.208.3

## 0.208.2

## 0.208.1

## 0.208.0

## 0.207.0

## 0.206.0

## 0.205.0

### Patch Changes

- 0aeb168: DataTable list columns of type `number`/`decimal`/`bigInt` now render locale-formatted via `Intl.NumberFormat`, matching how `timestamp`/`date`/`money` cells already behave. Previously they fell through to a raw `String(value)`, showing e.g. `245.5` with a dot even on a German-locale app while every other numeric column type used the locale's separator.

## 0.204.1

## 0.204.0

### Minor Changes

- 0d53fbd: `projectionDetail` screens can now declare a `relatedList` section (`layout.sections[]`, `kind: "relatedList"`) — a read-only list of related records that runs its own query, independent of the screen's own detail query. Fields: `title`, `query` (fully qualified QN, same paged envelope as `projectionList.query`: `{ rows, nextCursor, total? }`), `columns` (`ListColumnSpec[]`), optional `parentParam` (query-payload key the shown record's id is passed under, default `"id"`), optional `pageSize`, and optional `rowClick: { entity, idColumn? }`. A row click resolves its navigation target via `detailFor` (same lookup `resolveTarget` already uses for `ObjectTarget` navigation) — no `screenId` is named on the section itself.

  The boot-validator rejects: an empty/non-string `query`; a `rowClick.entity` with no screen anywhere declaring `detailFor` for that entity (error names the missing `detailFor` the same way `nav.ts`'s `resolveTarget` does); and a `relatedList` section inside a `mode: "wizard"` layout (a read-only list has no place in a stepped form). Extension sections remain rejected on `projectionDetail`, unchanged; `entityEdit`/`configEdit`/`actionForm` do not gain `relatedList` support.

  The renderer's `RelatedListSection` component (`@cosmicdrift/kumiko-renderer`, also usable standalone) fetches via the section's own query and renders through `RenderList` with no toolbar, search, sort, or pagination controls — deliberately out of scope for this section type. `@cosmicdrift/kumiko-headless`'s `EditSectionViewModel` gains the matching `EditRelatedListSectionViewModel` variant so `computeEditViewModel` can pass the section through to the renderer unresolved (the section runs its own query at render time, not at view-model-build time).

## 0.203.0

### Minor Changes

- 29e46a9: Screens can now declare `detailFor: "<entity>"` on `ScreenDefinition` to mark themselves as the detail view for that entity. A new boot-validator rule (`validateDetailForScreens`) rejects two screens declaring the same `detailFor` entity, and rejects a `detailFor` naming an entity no feature registers — apps that end up with either of those (e.g. after a rename) now fail at boot instead of silently misbehaving. Navigation targets can now be an `ObjectTarget` (`{ entity, id, workspaceId? }`) in addition to the existing `ScreenTarget` (`{ screenId, entityId?, workspaceId? }`) — `NavTarget` (exported from `@cosmicdrift/kumiko-renderer`) is now the union of both. The new `resolveTarget(features, target)` turns an `ObjectTarget` into a `ScreenTarget` by finding the screen whose `detailFor` matches, and throws if none exists. `useBrowserNavApi` resolves `ObjectTarget`s before building any path; callers that want `navigate`/`replace`/`hrefFor` to accept `ObjectTarget`s must pass the new `features` option (the app's `FeatureSchema[]`). Existing `ScreenTarget`-only call sites are unaffected. `formatPath` is now typed to accept `ScreenTarget` only — it never handled an `ObjectTarget`, so this is a type-only tightening.

  `projectionList` screens now wire search/sort/pagination state into their bound query the same way `entityList` screens do. `screen.searchable`, `screen.sortable` and `screen.paginated` are derived by `buildAppSchema` from the query handler's Zod schema (presence of `search`, `sort`, and `cursor`/`offset` params respectively) instead of being author-set — a hand-authored `sortable` or `paginated` on a `projectionList` screen now **fails boot** (`"sortable is derived from the query's Zod schema, don't set it"`), and `defaultSort` is now required as soon as search or sort is active. `searchable: true`/`false` set explicitly on the screen still wins over the derived default, and is still boot-validated against the schema as before. On the renderer side, `ProjectionListBody` now drives the URL-backed search box, sort headers and (pages-mode) pager into the query payload through the extracted `buildListQueryPayload` helper (also exported, and now shared with `EntityListBody` instead of each having its own inline payload construction) — previously a `projectionList` screen's query always received `{}` and ignored `searchable`/`defaultSort` at render time. Apps whose query handler accepts `sort`/`cursor`/`offset` params will start receiving those params on every request; handlers that don't inspect extra payload keys are unaffected.

- 437d3fb: `projectionDetail` screens can now declare header action buttons via a new optional `actions: readonly RowAction[]` field, reusing `RowAction` from `entityList`/`projectionList` — the screen's single displayed record stands in for the "row", so `pick`/`map` payload extraction, `visible`, `confirm`/`confirmLabel` and `style` keep their existing meaning. `rowClick` has no target on a detail screen (there is no row to click) and is rejected at boot with the screen QN and action id in the error. The existing rowActions/toolbarActions boot checks (navigate-target exists in some feature, writeHandler QN is registered, `params` only on targets that read it) now also cover `projectionDetail.actions`.

  When `screen.detailFor` names an entity, and some mounted feature (searched cross-feature via the app's full feature list, not just the projectionDetail's own feature) declares an `entityEdit` screen for that entity that the current user's roles can access, a default "Edit" action (`id: "edit"`) is prepended to the header actions automatically, navigating to that screen with the displayed record's id. A screen that declares its own action with `id: "edit"` in `actions` suppresses the default — the declared one wins, with no separate opt-out flag.

  `RenderEdit` (renderer) gains a new optional `actions?: readonly RenderEditAction[]` prop, rendered in the same header action-bar region as the existing copy-link/delete/cancel/save controls (before them, in array order) — no new action-bar region was added. Each action's `confirm`/`confirmLabel`/`style: "danger"` drive the same confirm-dialog behavior as `RowActionWriteHandler`. A declared navigate action without an explicit `entityId`, targeting an `entityEdit` screen for the `detailFor` entity, auto-fills the shown record's id so the target opens that record instead of a blank create-form — the same convention entityList/projectionList row actions already follow. When a header action's `onPress` throws, the error surfaces in the form's existing error banner region, not inside the action button row.

## 0.202.0

## 0.201.0

### Patch Changes

- aa3f669: `ctx.dbOutsideTransaction` is now fail-closed on `r.systemScope()` handlers, the same way `ctx.db` already was: touching it directly throws instead of handing back an unfiltered cross-tenant `TenantDb`. The guarded escape hatch is `ctx.systemDb.outsideTransaction`, a new pair of `assertTenantMatch(tenantId)` / `acknowledgeCrossTenant(reason)` methods mirroring the existing `ctx.systemDb.assertTenantMatch`/`acknowledgeCrossTenant`, but backed by the unbound-pool `dbOutsideTransaction` instead of the in-tx `db`.

  `UncheckedSystemDb` (`@cosmicdrift/kumiko-types`) gains a new required `outsideTransaction` member. `createUncheckedSystemDb`'s new second parameter is optional, so every existing call site keeps compiling unchanged; a hand-built `UncheckedSystemDb` object literal (none found in this repo) would need to add the new member. No handler currently reads `ctx.dbOutsideTransaction` directly on a `systemScope()`'d feature, so this closes a gap rather than fixing an active bug — but it is a real behavior change: the guard is a Proxy (truthy), so a bare `if (ctx.dbOutsideTransaction)` presence check on a system-scoped handler now passes and then throws on first property access, instead of silently handing back an unfiltered cross-tenant `TenantDb`.

## 0.200.1

## 0.200.0

## 0.199.2

## 0.199.1

## 0.199.0

### Minor Changes

- 8485e63: `HandlerContext` gains `systemDb?: UncheckedSystemDb` (fw#2067's fail-closed wrapper), populated for `r.systemScope()` handlers alongside the existing `ctx.db`. Non-system handlers don't receive it — `ctx.db` behavior is unchanged for everyone.

## 0.198.0

### Minor Changes

- 89ebe92: `NavDefinition.icon`, `ContentCollectionDefinition.nav.icon`, `ScreenNavSugar.icon` and `ConfigMask.icon` were all `icon?: string` — any typo (`icon: "seting"`) compiled fine and silently fell back to a dot in the sidebar. New `NavIconKey` union (`@cosmicdrift/kumiko-types/nav-icon`, re-exported from `@cosmicdrift/kumiko-framework/{engine,ui-types}`) types all four against the closed set of keys the web renderer actually registers, so an unregistered icon key is now a compile error at the `r.nav()`/`r.screen({ nav })`/config-mask call site instead of a missing icon at runtime.

  `packages/renderer-web`'s `NAV_ICONS` map is checked against the same union via `as const satisfies Record<NavIconKey, …>`, so the type and the map can no longer drift — adding a key requires updating both in the same change. This also surfaced a real pre-existing gap: `tenant-settings` declared `icon: "languages"`, which had never been a registered key (silently rendered as a dot); `languages` (lucide `Languages`) is now registered.

  This is a breaking type change for any app that passes an icon key outside the vocabulary in `packages/types/src/nav-icon.ts` — such a call site will fail to compile after this bump.

### Patch Changes

- 9b2c94a: `createKumikoApp`'s boot diagnostic (#2025) flagged every `type: "custom"` screen without a registered `clientFeatures` component as a missing client plugin — including screens that are dormant by design (registered without a self-owned `r.nav()`, meant to be navved by the consuming app itself, e.g. `user-data-rights`'s privacy center, `auth-mfa`'s enable screen, `personal-access-tokens`'s token screen). Added an optional `dormant?: boolean` field to `CustomScreenDefinition`; the diagnostic now skips screens flagged `dormant: true` instead of false-positiving on every app that hasn't wired the client plugin yet. Screens a feature self-navs (e.g. compliance-profiles' profile-picker) are unaffected and still trigger the diagnostic when their client plugin is missing — that stays a real bug (infra#503).

## 0.197.1

## 0.197.0

## 0.196.1

## 0.196.0

## 0.195.0

## 0.194.0

### Minor Changes

- 04f7a96: `ImageFieldDef` accepts `capture?: "environment" | "user"`, forwarded to the file input's `capture` attribute so a phone opens the camera instead of the file picker. Omitted by default, so existing image fields are unchanged.

  Not added to `ImagesFieldDef`: multi-image fields still have no widget (they render an "unsupported" banner), and a flag no renderer reads is the dead-flag state `thumbnails` was just removed for.

## 0.193.1

## 0.193.0

### Minor Changes

- 181003b: Image fields declare named derived versions: `createImageField({ variants: { profile: { fit: "cover", size: { width: 512, height: 512 }, format: "webp" } } })`. The specs are boot-validated, and `GET /api/files/:id/variant/:name` serves them behind the same tenant + access guard as the download — a request carries only a NAME, never a spec, so no caller can drive an arbitrary render. The edit-form preview loads the first declared variant instead of the original.

  BREAKING: `ImageFieldDef.thumbnails` / `ImagesFieldDef.thumbnails` are removed. The flag was never read by anything; `variants` is what it pointed at.

## 0.192.0

### Minor Changes

- 58505c6: New `derivatives-sharp` feature: server-only image renderer that registers at the `derivativeRenderer` extension point for `image/*`. Resize (cover/inside/contain), format conversion with quality (webp/avif/jpeg), whole-image blur and `blurRegions` for burning blur into plates or faces. EXIF orientation is applied, all other EXIF (including GPS) is dropped. `blurRegions` is part of `VariantSpec`, so corrected regions hash to a fresh variant URL instead of serving a stale cache hit.

## 0.191.0

## 0.190.0

## 0.189.0

### Minor Changes

- 64c5f92: **BREAKING:** `type:"date"` fields (`createDateField`) now back onto a real Postgres `DATE` column and round-trip as `Temporal.PlainDate`, fully decoupled from `Temporal.Instant`/`TIMESTAMPTZ` (kumiko-framework#1924). Previously `date` was silently aliased onto the same `instant()`/`TIMESTAMPTZ` column as `type:"timestamp"`: reads returned a full ISO instant (`"2026-03-15T00:00:00Z"`), writes expected a bare `"yyyy-mm-dd"` string that got bound to a timestamptz column through the session's TimeZone — so both directions were timezone-dependent for what is meant to be a pure calendar-day value (invoice date, lease term).

  After this change:

  - **Read shape**: a `date` field now serializes as `"2026-03-15"` (via `Temporal.PlainDate`'s own `toJSON()`), not `"2026-03-15T00:00:00Z"`. Any non-form client that Instant-parses a date field's JSON value (`Temporal.Instant.from(value)`) will throw — that parse requires a UTC designator/offset a PlainDate string doesn't have. A client that only reads the leading `"yyyy-mm-dd"` (string slice, or the existing form-fill path) is unaffected, since both old and new values share that prefix.
  - **Write shape**: unchanged — `date` fields already took a bare `"yyyy-mm-dd"` string; that now binds directly to a real `DATE` column instead of drifting through the session TimeZone on the way into a `TIMESTAMPTZ` column.
  - **Where-filters**: a filter value built as a `Temporal.Instant` against a `date` column (a leftover pattern from when `date` was an Instant alias) still works — `prepareValue` anchors it at UTC before binding — but new code should build `date` filters as plain `"yyyy-mm-dd"` strings or `Temporal.PlainDate`.

  **Migration, per entity's table kind:**

  - **Managed (event-sourced projection) tables**: the generator emits `DROP TABLE` + `CREATE TABLE` and replays from the event log — no manual SQL needed, but factor in the replay cost for entities with a large event history.
  - **Unmanaged (`store_*`, direct-write) tables**: the generator emits an in-place `ALTER TABLE … ALTER COLUMN … TYPE date USING (col AT TIME ZONE 'UTC')::date` for exactly this `timestamptz → date` transition — anchored explicitly at UTC. A bare `ALTER COLUMN … TYPE date` (no `USING`) falls back to Postgres's implicit cast, which reads the _session_ TimeZone and can migrate the same row to a different calendar day depending on who runs it; do not hand-write that fallback form.

  No consumer-repo migration is included in this PR — solon has ~15 `type:"date"` fields on unmanaged tables and needs its own migration + existing-data audit as a follow-up.

- 833c4f7: `redirect` (actionForm, entityEdit) and `cancelTarget` (actionForm) now also accept a fully-qualified cross-feature screen QN (`<feature>:screen:<id>`), in addition to the existing same-feature short screen-ID. Boot-validator resolves the QN directly against all registered screens; the renderer strips it to the short id before navigating, since the runtime router already resolves bare short ids app-wide. Short IDs keep their unchanged same-feature behavior (kumiko-framework#1946).

### Patch Changes

- 321b375: `entityEdit` screens now support `redirect?: string`, mirroring `actionForm`'s field: navigate to this same-feature screen ID after a successful save (create or update) instead of the default "back to the entity's list" target. Boot-validator checks the ID resolves to a registered screen, same as `actionForm.redirect`. Delete is unaffected — it still always navigates to the list.
- d0f03f9: `entityEdit` screens now support `singleton: true` for entities with exactly one record per tenant (organization, settings, tenant profile). A call without an `entityId` resolves the existing record via `<entity>:list` (limit 1) and renders the update branch with prefill on a hit, instead of always rendering an empty create form — so a declarative nav entry can point straight at a singleton edit screen without a wrapping entityList-with-one-row workaround. The create branch (and `allowCreate: false`) still applies when the table is empty.

## 0.188.0

### Patch Changes

- e55c957: Raise the hono peer range to ^4.13.1 so consumers no longer resolve 4.12.x builds affected by the JSX context-isolation, memo() and cx() advisories.

## 0.187.0

## 0.186.3

## 0.186.2

## 0.186.1

## 0.186.0

## 0.185.0

### Minor Changes

- 0a059a0: `createEmbeddedListField()` now has an editable widget, so line-item forms (invoices, bookings, orders) can be declared instead of hand-built as a custom screen. The field type gains `select`/`reference` cell types, `minItems`/`maxItems` bounds, derived cells (`multiply`/`sum`/`subtract`), and column totals; the new `EmbeddedListInput` renders it as a controlled table/card with add/remove/duplicate/reorder, keyboard navigation, and paste-from-spreadsheet support (fw#1838).

### Patch Changes

- 43e0291: Embedded-list widget follow-ups from #1838 review (fw#1839):

  - Keyboard focus after Tab/Enter-to-add-row now lands on the actual focusable control (date/timestamp/money/select/reference cells), not the non-focusable wrapper `div`; Enter on the last cell now also appends+focuses a new row, mirroring Tab.
  - Embedded-list money cells and the totals row use the entity's `defaultCurrency` instead of a hardcoded `"EUR"`.
  - Reference sub-fields inside an embedded field get the same boot-time target-entity/labelField/list-query-handler checks as top-level reference fields.
  - New declarative `totalsMatch` on `EmbeddedFieldDef` validates (client and server, via the same Zod schema) that the sum of a list subfield equals a sibling top-level money field, with boot-time checks that both fields exist and are money-typed.
  - New `"timestamp"` embedded-list cell type, end to end (types, schema validation, view-model, renderer primitives, `TimestampInput` in the web renderer).
  - Derived embedded-list cells (`field.derived`) are now re-validated server-side against a local mirror of the client's `computeDerivedCellValue`; an absent derived cell is never flagged as a mismatch against 0.

## 0.184.0

## 0.183.2

## 0.183.1

## 0.183.0

### Minor Changes

- 08c5c8c: `ContentCollectionDefinition.variableSchema` now maps each variable name to an example value (e.g. `{ customerName: "Max Mustermann" }`) instead of an unused placeholder. The renderer gets `ContentPreview` + `substituteVariables`: a read-only render of the collection's registered editor with `{{name}}` replaced by its example value, same mechanic for every `contentFormat` since it reuses the very component the collection edits with. `template-resolver`'s content-collection editor gets a Preview toggle next to the content field.

## 0.182.1

## 0.182.0

### Minor Changes

- 8a3b0a9: `r.contentCollection()` accepts a new `contentFormat: "plain" | "rich"` field. `ClientFeatureDefinition` gets a sixth registry, `contentEditors` — a `contentFormat → EditorComponent` map merged with the same last-wins semantics as `columnRenderers`. `createKumikoApp` mounts a `ContentEditorsProvider`; `useContentEditor(contentFormat)` resolves the registered component or falls back to a plain textarea, so a missing editor is never an empty panel. `template-resolver`'s content-collection editor now renders through this registry instead of a hardcoded textarea.
- 9c62bc8: `ContentCollectionDefinition` accepts a new `variableSchema` field — fixed variable names the app declares for a collection (e.g. an `ai-prompt` collection's `{customerName}`, `{orderId}`). The renderer gets `VariableChips`, an editor-agnostic chip bar that inserts `{{name}}` at the caret on click, and `renderer-web` gets `PlainContentEditor`, which pairs it with the existing textarea fallback. `template-resolver`'s client now registers `PlainContentEditor` under `contentEditors.plain` and passes the collection's variable names through, so AI-prompt and mail-html collections with `contentFormat: "plain"` get the chip bar without any app-side wiring.

## 0.181.0

## 0.180.0

## 0.179.0

## 0.178.1

## 0.178.0

## 0.177.0

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

## 0.176.1

## 0.176.0

## 0.175.0

## 0.174.1

## 0.174.0

## 0.173.1

## 0.173.0

## 0.172.0

## 0.171.2

### Patch Changes

- c717af3: `NotifyOptions` gains an optional `recipientId` for the `route` (direct, no-user-account) delivery path. Previously `route:{email}` sends always logged `recipientId: null` in the delivery-attempt event, so `recipientAddress` (piiFields subject = recipientId) had no subject key to encrypt under and stayed plaintext. Callers without a user account (e.g. a share-token recipient) can now pass `recipientId` to tie the logged address to a crypto-shredding subject.

## 0.171.1

## 0.171.0

### Minor Changes

- 32123ff: `entityEdit`/`configEdit`/`actionForm`/`projectionDetail` screens can now set `layout.width` ("sm" | "3xl" | "4xl" | "full") to opt out of the hardcoded 3xl-centered form shell — useful for dense multi-column masks that previously left dead space on both sides (#1676). Unset stays "3xl" (unchanged default).

## 0.170.0

## 0.169.0

### Patch Changes

- 644274a: Fix `preSave` hooks being a silent no-op (#1672). `r.hook("preSave", ...)` was registered and boot-validated, but no dispatch path ever ran it — only `postSave`/`preDelete`/`postSaveBatch` were wired.

  `preSave` now runs for entity CRUD `create`/`update` handlers (`r.crud(...)`, `defineEntityCreateHandler`/`defineEntityUpdateHandler`), transforming `changes` before persistence and before ownership checks (authorization evaluates the final, hook-shaped row). Register per verb — there is no `{ allOf }` shorthand for `preSave` since create/update are separate handlers:

  ```ts
  r.hook("preSave", "contact:create", deriveDisplayName);
  r.hook("preSave", "contact:update", deriveDisplayName);
  ```

  Scope: only entity CRUD handlers that go through the event-store executor get this automatically. A fully custom `r.writeHandler` that doesn't call the executor must invoke `ctx.runPreSave(...)` itself.

## 0.168.0

### Minor Changes

- 4c7d3c9: `r.crud`/`registerEntityCrud` gain `verbAccess?: Partial<Record<EntityCrudVerb, AccessRule>>` to gate individual verbs (e.g. `delete`/`restore`) more strictly than the shared `write`/`read` access rule. Resolution per verb: `verbAccess?.[verb] ?? (isWrite ? write?.access : read?.access)`. Existing calls without `verbAccess` are unchanged.

## 0.167.1

### Patch Changes

- cf5302a: `ctx.tz.tenant`/`ctx.tz.user` no longer hardcode `"UTC"` — `tenant` now reads the `tenant:config:timezone` config key (via the already-wired `ctx.config` accessor, falling back to `"UTC"` when unset or no config feature is mounted) and `user` reads the new `SessionUser.timezone` field (set at login, falling back to `tenant`). `SessionUser` gains an optional `timezone` field, carried through the signed JWT (`JwtPayload.timezone`) the same way `roles` is (kumiko-framework#1636).

  `buildHandlerContext` (exported from `@cosmicdrift/kumiko-framework/pipeline`) is now `async` — it was previously synchronous. Direct external callers (not the normal dispatch path, which already awaits it) need to add `await`.

## 0.167.0

### Minor Changes

- 57c1da2: `packaging`: the six identity-sensitive error classes moved out of `@cosmicdrift/kumiko-types` into `@cosmicdrift/kumiko-framework` — `VersionConflictError`, `IdempotentAppendConflictError` and `ArchivedStreamError` to `/event-store`, `KeyErasedError`, `KeyNotFoundError` and `KeyAlreadyExistsError` to `/crypto`. Those are the public paths callers already import from, so nothing moves for consumers; the `@cosmicdrift/kumiko-types/event-store-errors` subpath is gone.

  With no classes and no local `Symbol()` left in it, `kumiko-types` no longer needs the single-copy guarantee a peerDependency buys, and framework/bundled-features declare it as a plain dependency. That closes the changesets cycle where a peer-dependent bump escalated every minor release to `1.0.0`.

### Patch Changes

- ce30a2c: `deps`: hono range raised to `^4.12.27` — the floor that carries the fixes for three advisories on the production HTTP layer: cross-request data disclosure in `hono/jsx` (context not isolated per request), server-side XSS via a JSX escaping bypass in `cx()`, and a dropped repeated request header in the API-Gateway v1 adapter. The old `^4.12.18` allowed the patched versions but the lockfile sat on 4.12.25, so the range now states the security floor instead of relying on resolution luck.
- 8647246: `secrets`: `SecretBrand` uses `Symbol.for("kumiko.secret")` instead of a per-copy `Symbol()`. Two resolved copies of the package branded with two different symbols, so `createSecret()` from one and `isSecret()` from the other disagreed — and `isSecret()` is the only check `assertNoSecretLeak` has, so the response-leak guard walked past the value and serialized the plaintext. Matches the `Symbol.for` treatment the schema symbols already use (#1632).

## 0.166.0

## 0.165.4

## 0.165.3

### Patch Changes

- e4a0b9b: Allow `searchable` on subject-annotated PII: decrypt into the derived Meili index and purge docs on Art.17 erase (fw#1610).

## 0.165.2

### Patch Changes

- ed36555: Rename `buildEntityTableMeta` → `deriveEntityTableMeta` so the helper is not mistaken for the unmanaged escape hatch (`defineUnmanagedTable`). Deprecated alias kept. Unmanaged builders now reject the reserved `read_` table-name prefix (#1208/#1220).

## 0.165.1

## 2.0.0

### Major Changes

- eb856c6: Fixes a batch of code-review findings across kumiko-framework/bundled-features/types (PR#1222/1501/1431/1529/1333/1461/1424/1439/1423/1337/1398/1252/1257/1489/1472/1452/1545/1543/1547/1549/1551).

  **Breaking:**

  - `makeAuthGate(LoginComponent, loginProps, MfaVerifyComponent, MfaSetupComponent)` and `makeSessionAuthGate(...)` (`@cosmicdrift/kumiko-bundled-features/auth-email-password`) now take a single `LoginRouteOptions` object instead of four positional args — the positional signature didn't scale past two optional MFA params. Update call sites to `makeAuthGate({ loginScreen, loginScreenProps, mfaVerifyScreen, mfaSetupScreen })`.

  **Fixes (non-breaking):**

  - `document-ingest-foundation`'s `documentExtractEntity.pages` column is now `encrypted: true` (stored as serialized JSON in an encrypted `longText` column instead of plaintext `jsonb` — the underlying Postgres column type changes from `jsonb` to `text`) — it held the full extracted text of ingested documents (invoices, IDs, contracts) in plaintext. Apps mounting this feature now need an entity-field-encryption master key configured (same requirement every other PII-encrypted field already has) if they don't already have one. No migration needed: this entity has no writer yet (`#1497` unlanded), so no app has persisted rows against the old `jsonb` shape.
  - `reindexEntity()`'s `ReindexEntityResult` gains `wouldIndexRows` — a dry run no longer inflates `indexedRows` (which now stays 0 when nothing was written); also now reports a `failures` entry instead of silently indexing a partial document when a searchable field can't be mapped from the read-table row.
  - `UserDataDeleteHook`'s return type now includes bare `void` in the union (previously only `undefined`), so a hook explicitly typed `Promise<void>` (not just a contextually-typed arrow literal) type-checks again.
  - `run-forget-cleanup` write-handler's response now includes `incompleteCount`/`incomplete` so operator tooling can see partial-deletion hook results, not just hard failures.
  - tenant `invitations`/`members` query handlers: bounded-concurrency (pool-limit 4) PII decrypt instead of a strict sequential loop, and `invitations` no longer decrypts `invitedBy` (a plain userId, never PII-encrypted at write time).
  - `packages/framework/src/db/dialect.ts`'s `KUMIKO_NAME_SYMBOL`/`KUMIKO_COLUMNS_SYMBOL`/`KUMIKO_META_SYMBOL` are now imported from `@cosmicdrift/kumiko-types/schema-table-types` everywhere internally instead of being re-declared per call site — `SchemaTable` now also carries `[KUMIKO_META_SYMBOL]`.
  - `peerDependencies["@cosmicdrift/kumiko-types"]` changed from `workspace:*` to `workspace:^` in `kumiko-framework`/`kumiko-bundled-features` (a staggered-bump consumer previously got two unresolvable exact peer pins); removed the no-op `peerDependenciesMeta.optional: false`.
  - `request-helper`'s `authHeader()` now caches one session id per `(user.id, tenantId)` instead of per `user.id` alone — the same user id holding sessions in two tenants previously got handed the wrong tenant's cached sid.
  - `auth-foundation`'s anonymous-access tenant-resolver/tenant-exists merge no longer casts through `as TenantResolver`/`as TenantExists` — the underlying function types were already structurally compatible.
  - `isSafeHref` (`@cosmicdrift/kumiko-headless`) now decodes HTML character references (`&colon;`, `&#58;`, `&Tab;`, `&#9;`, ...) before its scheme check — `javascript&colon;alert(1)`/`java&Tab;script:alert(1)` previously slipped through because neither contains a literal `:` for the pre-decode regex, but the browser decodes the entity back into an executable `javascript:` URL on click. Affects `renderSafeMarkdown` (page-render) and the renderer-web `Link` primitive.
  - `user-data-rights`'s `restrict-account` write-handler now runs the same cross-tenant membership check as `lift-restriction` — previously any Admin/TenantAdmin (not just SystemAdmin) could restrict a user's account and force-revoke their sessions regardless of tenant, as long as they held an admin role in _some_ tenant.
  - `dispatch-shared.ts`'s `runStreamInstrumented`: a close-time error from `generator.return()` (e.g. a handler's `finally` failing to release a cursor/unsubscribe) is now folded into the dispatcher error metric and span status when nothing else already failed, instead of being silently discarded; also drops the unused/untested `it.throw()` forwarding branch (no production caller ever calls `.throw()` on a dispatcher stream).
  - `event-store.ts`'s `ensureIdempotencyKeyIndex` re-verifies the index is actually valid before treating a caught error as a benign concurrent-build race — a `lock_timeout` during `CREATE INDEX CONCURRENTLY` (55P03) was being misclassified as "the other pod already built it", silently leaving the idempotency-key uniqueness unenforced.
  - `routes.ts`'s SSE `pumpStream`'s finally block and the pre-pull client-abort path no longer `await generator.return(undefined)` — V8 queues that call behind an in-flight `.next()`, so awaiting it could hang the response indefinitely if the handler's pull never settles (e.g. a dead Redis/DB subscription after a client disconnect). Now fire-and-forget, matching the existing `stream.onAbort()` handler's style (which was already fire-and-forget).
  - `reindexEntity()` now fails fast with one clear error when a searchable field has no matching read-table column (dropped/never-migrated schema), instead of pushing one identical `failures[]` entry per scanned row.
  - `user-data-rights`'s GET `/user-export/by-token?token=` fallback now forwards `x-forwarded-for` to the internal `/api/query` call the same way the POST fragment-exchange route already does — previously every legacy magic-link download collapsed onto request-id-middleware's own (empty/localhost) IP, turning `download-by-token`'s per-IP 30/min rate limit into a single global bucket shared by every user (self-inflicted 429s). Also logs a warning on each hit so ops can see when it's safe to remove (kumiko-framework#1562).

  **Missed changesets (retroactively documented, already merged in #1547):**

  - `pumpStream`'s exported signature changed: `firstOutcome?: IteratorResult<unknown>` → `firstPull?: Promise<IteratorResult<unknown>>`.
  - `validateSessionStoreMultiplicity` no longer throws on zero registered `sessionStore` providers — a pure machine-API deployment (PAT-bearer auth only, no browser sessions) can now mount `auth-foundation` without also mounting `sessions`.
  - New public exports: `StreamFrame` (`kumiko-framework`/`-headless`), `isToggleableFeature` (`kumiko-framework`), `parseSseFrames`/`parseSseBlock`/`iterateSseChunks` (`kumiko-dispatcher-live`).

### Patch Changes

- c58f20f: `NumberFieldDef` / `createNumberField` accept optional `max` (mirrored from `min`); schema-builder applies Zod `.max()` at the write boundary so integer CRUD can reject values that would overflow Postgres `integer` (#1573).

## 1.0.0

### Patch Changes

- 53f83f5: `@cosmicdrift/kumiko-types` moves from a plain `dependency` to a `peerDependency` of both `@cosmicdrift/kumiko-framework` and `@cosmicdrift/kumiko-bundled-features` (kumiko-framework#1438).

  **Why:** `@cosmicdrift/kumiko-types` ships identity-sensitive runtime error classes (`VersionConflictError`, `ArchivedStreamError`, `KeyErasedError`, `KeyNotFoundError`, `KeyAlreadyExistsError`) despite its description previously claiming "no runtime code". If a consumer app installs `@cosmicdrift/kumiko-types` directly at a different version than the one framework/bundled-features resolve internally, `instanceof` checks against these classes silently return `false` across the two copies — a `catch (e) { e instanceof VersionConflictError }` in your app code would miss errors thrown from framework's own copy. Declaring it as a peer dependency forces a single resolved copy across the dependency tree instead of silently tolerating two.

  **Consumer action:** if your app doesn't already list `@cosmicdrift/kumiko-types` as a direct dependency, no action needed — `bun install` resolves the peer automatically from what framework/bundled-features already pull in (verified empirically in this repo's own workspace: `bun install` after this change reported 0 peer-dependency warnings). If you do list it directly (e.g. to build against its type contracts without the full framework import), pin it to the same version as your `@cosmicdrift/kumiko-framework`/`@cosmicdrift/kumiko-bundled-features` release.

## 0.165.0

### Minor Changes

- cf56745: Removes dead public API with zero verified consumers across all Kumiko repos:

  - `@cosmicdrift/kumiko-framework`: `getUnscopedAggregateStreamTenant` (event-store), `createEncryptionProvider`/`EncryptionProvider` (legacy single-key db encryption, superseded by `createEnvelopeCipher`), and the unused `tx` parameter on `executeStream`/`dispatcher.stream()`.
  - `@cosmicdrift/kumiko-types`: `ConfigResolver.getAllWithSource` and the corresponding resolver implementation.
  - `@cosmicdrift/kumiko-dispatcher-live`: `SseFrame`, `iterateSseChunks`, `parseSseFrames` re-exports (internal consumers already import from `./sse-stream` directly).
  - `@cosmicdrift/kumiko-dev-server`: `IdentityStackOptions.providers` (never wired by any app — provider features are appended positionally instead; `GdprStackOptions.providers` is unaffected, it has real callers/tests).

  Adds `toInstant` to `@cosmicdrift/kumiko-headless`'s public barrel (previously an unexported helper duplicated by `@cosmicdrift/kumiko-renderer`'s `formatWhen`).

## 0.164.0

### Minor Changes

- 90b4221: `EventMetadata` gains an optional `idempotencyKey`. When set, `append()` enforces it via a tenant-scoped partial unique index (`metadata->>'idempotencyKey'`) and throws the new `IdempotentAppendConflictError` on a repeat — a second line of defense against duplicate appends when the Redis-backed HTTP idempotency guard misses a retry window. Opt-in only; existing callers are unaffected.

## 0.163.3

## 0.163.2

## 0.163.1

## 0.163.0

## 0.162.0

## 0.161.0

## 0.160.0

## 0.159.1

### Patch Changes

- 6d37eb5: `FileContext`/`FileHandle` move from `packages/framework/src/files/file-handle.ts` to `@cosmicdrift/kumiko-types/file-handle-types`. The old path stays a re-export, so no internal import site changes. `FileStorageProvider` (from `files/types.ts`) is unrelated to these two types and stays put.

## 1.0.0

### Patch Changes

- d0280c8: `@cosmicdrift/kumiko-types` gains its first real content: `identifiers`, `target-ref`, `event-type-map`, and `http-route` move out of `packages/framework/src/engine/types/`. The old paths stay as re-export shims, so no internal import site changes. Framework now depends on `@cosmicdrift/kumiko-types` for these.
- a997cc8: `relations` and `tree-node` move from `packages/framework/src/engine/types/` to `@cosmicdrift/kumiko-types`. The old paths stay as re-export shims, so no internal import site changes.
