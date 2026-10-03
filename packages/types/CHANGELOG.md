# @cosmicdrift/kumiko-types

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
