---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
"@cosmicdrift/kumiko-renderer-puppeteer-client": minor
"@cosmicdrift/kumiko-document-designer": minor
"create-kumiko-app": minor
---

Fixes for the gaps the attack tests found: form drafts are encrypted per owner, SSE entity signals follow the read access of the connection, late Stripe events no longer roll a subscription back, unknown e-mail addresses count towards the login lockout, and cause details no longer leak when NODE_ENV is missing.

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
