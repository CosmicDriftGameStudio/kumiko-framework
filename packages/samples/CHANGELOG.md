# @cosmicdrift/kumiko-samples

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
