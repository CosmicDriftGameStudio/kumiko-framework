# create-kumiko-app

## 0.383.1

### Patch Changes

- Updated dependencies [4ea38e1]
  - @cosmicdrift/kumiko-framework@0.383.1
  - @cosmicdrift/kumiko-dev-server@0.383.1
  - @cosmicdrift/kumiko-server-runtime@0.383.1
  - @cosmicdrift/kumiko-testing@0.383.1

## 0.383.0

### Patch Changes

- Updated dependencies [72ac4b1]
- Updated dependencies [9ef4b39]
- Updated dependencies [9ef4b39]
- Updated dependencies [9ef4b39]
  - @cosmicdrift/kumiko-framework@0.383.0
  - @cosmicdrift/kumiko-testing@0.383.0
  - @cosmicdrift/kumiko-server-runtime@0.383.0
  - @cosmicdrift/kumiko-dev-server@0.383.0

## 0.382.0

### Patch Changes

- Updated dependencies [7548064]
  - @cosmicdrift/kumiko-testing@0.382.0
  - @cosmicdrift/kumiko-dev-server@0.382.0
  - @cosmicdrift/kumiko-framework@0.382.0
  - @cosmicdrift/kumiko-server-runtime@0.382.0

## 0.381.0

### Patch Changes

- Updated dependencies [5470b13]
  - @cosmicdrift/kumiko-testing@0.381.0
  - @cosmicdrift/kumiko-dev-server@0.381.0
  - @cosmicdrift/kumiko-server-runtime@0.381.0
  - @cosmicdrift/kumiko-framework@0.381.0

## 0.380.0

### Patch Changes

- Updated dependencies [07ccdc9]
  - @cosmicdrift/kumiko-framework@0.380.0
  - @cosmicdrift/kumiko-testing@0.380.0
  - @cosmicdrift/kumiko-dev-server@0.380.0
  - @cosmicdrift/kumiko-server-runtime@0.380.0

## 0.379.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [ba1a10e]
- Updated dependencies [aa886cc]
- Updated dependencies [ba1a10e]
- Updated dependencies [ba1a10e]
- Updated dependencies [ba1a10e]
- Updated dependencies [632da48]
- Updated dependencies [94d55c0]
- Updated dependencies [d72e1fc]
- Updated dependencies [ba1a10e]
- Updated dependencies [9d81e04]
- Updated dependencies [7b01b0d]
- Updated dependencies [ece210b]
- Updated dependencies [7b01b0d]
- Updated dependencies [ece210b]
- Updated dependencies [7b01b0d]
- Updated dependencies [7b01b0d]
- Updated dependencies [ece210b]
- Updated dependencies [ece210b]
- Updated dependencies [434be6e]
  - @cosmicdrift/kumiko-framework@0.379.0
  - @cosmicdrift/kumiko-server-runtime@0.379.0
  - @cosmicdrift/kumiko-dev-server@0.379.0
  - @cosmicdrift/kumiko-testing@0.379.0

## 0.378.0

### Patch Changes

- Updated dependencies [2d7ee3e]
- Updated dependencies [0250376]
- Updated dependencies [a08f6d6]
- Updated dependencies [a08f6d6]
- Updated dependencies [6352d97]
  - @cosmicdrift/kumiko-framework@0.378.0
  - @cosmicdrift/kumiko-dev-server@0.378.0
  - @cosmicdrift/kumiko-server-runtime@0.378.0
  - @cosmicdrift/kumiko-testing@0.378.0

## 0.377.0

### Patch Changes

- Updated dependencies [e552c13]
- Updated dependencies [c00af64]
- Updated dependencies [60a29a8]
- Updated dependencies [9400d43]
- Updated dependencies [c00af64]
- Updated dependencies [c00af64]
- Updated dependencies [fd450c2]
  - @cosmicdrift/kumiko-framework@0.377.0
  - @cosmicdrift/kumiko-dev-server@0.377.0
  - @cosmicdrift/kumiko-testing@0.377.0
  - @cosmicdrift/kumiko-server-runtime@0.377.0

## 0.376.0

### Patch Changes

- Updated dependencies [05ba6c5]
- Updated dependencies [5274ebc]
- Updated dependencies [6a15526]
- Updated dependencies [e3e3faa]
  - @cosmicdrift/kumiko-server-runtime@0.376.0
  - @cosmicdrift/kumiko-dev-server@0.376.0
  - @cosmicdrift/kumiko-framework@0.376.0
  - @cosmicdrift/kumiko-testing@0.376.0

## 0.375.0

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.375.0
  - @cosmicdrift/kumiko-server-runtime@0.375.0
  - @cosmicdrift/kumiko-testing@0.375.0
  - @cosmicdrift/kumiko-framework@0.375.0

## 0.374.0

### Patch Changes

- Updated dependencies [40b8667]
- Updated dependencies [de5d674]
- Updated dependencies [47e3a05]
- Updated dependencies [926e08e]
- Updated dependencies [1d72366]
- Updated dependencies [c3df9a2]
- Updated dependencies [1b710f1]
- Updated dependencies [8e735ed]
- Updated dependencies [fc221ab]
  - @cosmicdrift/kumiko-framework@0.374.0
  - @cosmicdrift/kumiko-dev-server@0.374.0
  - @cosmicdrift/kumiko-server-runtime@0.374.0
  - @cosmicdrift/kumiko-testing@0.374.0

## 0.373.0

### Patch Changes

- Updated dependencies [6913834]
- Updated dependencies [6913834]
- Updated dependencies [6913834]
  - @cosmicdrift/kumiko-framework@0.373.0
  - @cosmicdrift/kumiko-dev-server@0.373.0
  - @cosmicdrift/kumiko-server-runtime@0.373.0
  - @cosmicdrift/kumiko-testing@0.373.0

## 0.372.0

### Patch Changes

- Updated dependencies [67238d2]
- Updated dependencies [a4401ab]
- Updated dependencies [de53a14]
- Updated dependencies [16ab9fe]
- Updated dependencies [7c04d2a]
- Updated dependencies [a45b3ee]
- Updated dependencies [236858e]
- Updated dependencies [5cd8710]
- Updated dependencies [27b759f]
- Updated dependencies [221f81c]
- Updated dependencies [dca222d]
- Updated dependencies [2cb8b4f]
- Updated dependencies [4224023]
- Updated dependencies [9bc4bc4]
  - @cosmicdrift/kumiko-dev-server@0.372.0
  - @cosmicdrift/kumiko-framework@0.372.0
  - @cosmicdrift/kumiko-server-runtime@0.372.0
  - @cosmicdrift/kumiko-testing@0.372.0

## 0.371.1

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.371.1
  - @cosmicdrift/kumiko-framework@0.371.1
  - @cosmicdrift/kumiko-server-runtime@0.371.1
  - @cosmicdrift/kumiko-testing@0.371.1

## 0.371.0

### Patch Changes

- Updated dependencies [5a822b2]
  - @cosmicdrift/kumiko-server-runtime@0.371.0
  - @cosmicdrift/kumiko-framework@0.371.0
  - @cosmicdrift/kumiko-testing@0.371.0
  - @cosmicdrift/kumiko-dev-server@0.371.0

## 0.370.0

### Patch Changes

- Updated dependencies [8ff5d19]
- Updated dependencies [a02e354]
- Updated dependencies [79a0aa6]
- Updated dependencies [8ff5d19]
- Updated dependencies [4a6e151]
- Updated dependencies [c051152]
- Updated dependencies [8ff5d19]
- Updated dependencies [75c45e4]
- Updated dependencies [cbaaeb8]
- Updated dependencies [8ff5d19]
  - @cosmicdrift/kumiko-server-runtime@0.370.0
  - @cosmicdrift/kumiko-framework@0.370.0
  - @cosmicdrift/kumiko-dev-server@0.370.0
  - @cosmicdrift/kumiko-testing@0.370.0

## 0.369.0

### Patch Changes

- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [a4cab24]
  - @cosmicdrift/kumiko-framework@0.369.0
  - @cosmicdrift/kumiko-server-runtime@0.369.0
  - @cosmicdrift/kumiko-dev-server@0.369.0
  - @cosmicdrift/kumiko-testing@0.369.0

## 0.368.0

### Patch Changes

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
- 1404b33: Test stack and test helpers move from kumiko-framework to kumiko-testing; the old framework paths stay as deprecated re-exports
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Test stack and helpers moved to kumiko-testing, old framework paths are deprecated
  detail: |
    Everything a test needs now lives in @cosmicdrift/kumiko-testing. Its core (stack, helpers, preload, bunfig, integration-runner) depends only on kumiko-framework and kumiko-types; bundled-features and dev-server are optional peers used by the root entry and /e2e. Install kumiko-testing as a dev dependency where tests import it.
  
    The old framework paths re-export the new ones and are removed in the first release after 2026-10-29. Production symbols that tests also use stay in the framework.
  
    old -> new:
      @cosmicdrift/kumiko-framework/stack -> @cosmicdrift/kumiko-testing/stack
      TestUsers, testTenantId, testUserId, createTestUser from /stack -> @cosmicdrift/kumiko-framework/seeding
      @cosmicdrift/kumiko-framework/testing -> @cosmicdrift/kumiko-testing/helpers
      bridgeStub from /testing and /testing/handler-context -> @cosmicdrift/kumiko-framework/engine
      @cosmicdrift/kumiko-framework/testing/real-providers -> @cosmicdrift/kumiko-testing/helpers/real-providers
      @cosmicdrift/kumiko-framework/testing/e2e-generator -> @cosmicdrift/kumiko-testing/helpers/e2e-generator
  migration: Run `bun kumiko-upgrade --apply`. It rewrites imports from the old paths and splits mixed imports by target. Add @cosmicdrift/kumiko-testing to devDependencies where it is missing.
  codemod: scripts/codemod/testing-move.ts
  -->
- Updated dependencies [133ef08]
- Updated dependencies [fbc0759]
- Updated dependencies [7949df2]
- Updated dependencies [39b5de4]
- Updated dependencies [39b5de4]
- Updated dependencies [541adc0]
- Updated dependencies [478ee1f]
- Updated dependencies [1404b33]
  - @cosmicdrift/kumiko-framework@0.368.0
  - @cosmicdrift/kumiko-testing@0.368.0
  - @cosmicdrift/kumiko-dev-server@0.368.0
  - @cosmicdrift/kumiko-server-runtime@0.368.0

## 0.367.0

### Patch Changes

- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [04bf143]
- Updated dependencies [5f2cc2f]
  - @cosmicdrift/kumiko-framework@0.367.0
  - @cosmicdrift/kumiko-server-runtime@0.367.0
  - @cosmicdrift/kumiko-dev-server@0.367.0
  - @cosmicdrift/kumiko-testing@0.367.0

## 0.366.0

### Patch Changes

- Updated dependencies [22b7f6e]
- Updated dependencies [15d76a8]
- Updated dependencies [22b7f6e]
- Updated dependencies [8a7d835]
- Updated dependencies [7053800]
- Updated dependencies [3d58dea]
- Updated dependencies [5df8e3a]
- Updated dependencies [22b7f6e]
- Updated dependencies [7053800]
  - @cosmicdrift/kumiko-framework@0.366.0
  - @cosmicdrift/kumiko-server-runtime@0.366.0
  - @cosmicdrift/kumiko-dev-server@0.366.0
  - @cosmicdrift/kumiko-testing@0.366.0

## 0.365.1

### Patch Changes

- Updated dependencies [93e1a7d]
- Updated dependencies [9a8abc9]
- Updated dependencies [34530bf]
- Updated dependencies [8633239]
- Updated dependencies [34530bf]
  - @cosmicdrift/kumiko-framework@0.365.1
  - @cosmicdrift/kumiko-server-runtime@0.365.1
  - @cosmicdrift/kumiko-dev-server@0.365.1
  - @cosmicdrift/kumiko-testing@0.365.1

## 0.365.0

### Patch Changes

- 8a59aa4: New projects read the prod admin password from DEMO_ADMIN_PASSWORD
  
  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: New projects read the prod admin password from DEMO_ADMIN_PASSWORD
  detail: The scaffolded bin/main.ts no longer seeds the prod admin with a fixed password. It reads DEMO_ADMIN_PASSWORD (declared in the env schema, min 12 chars), and boot fails without it. Existing apps are untouched; apps from an older scaffold should change bin/main.ts the same way.
  -->
- 9424924: A freshly scaffolded app passes `bun run lint` without rework
  
  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: A freshly scaffolded app passes bun run lint without rework
  detail: New projects now get a .gitignore, an exactly pinned @biomejs/biome and lint-clean generated files (import order, formatting). Existing apps are untouched.
  -->
- Updated dependencies [cd16f29]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [7aa3223]
- Updated dependencies [efa6253]
- Updated dependencies [7e1b974]
- Updated dependencies [ec7d696]
- Updated dependencies [efa6253]
- Updated dependencies [8a59aa4]
- Updated dependencies [9424924]
- Updated dependencies [efa6253]
- Updated dependencies [efa6253]
- Updated dependencies [efa6253]
- Updated dependencies [fbc6938]
- Updated dependencies [5a1cdc1]
- Updated dependencies [efa6253]
- Updated dependencies [80e2132]
- Updated dependencies [72a5c9c]
- Updated dependencies [82dc9a4]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [eef5ff1]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [eef5ff1]
- Updated dependencies [2a33c8d]
- Updated dependencies [eef5ff1]
- Updated dependencies [eef5ff1]
- Updated dependencies [efa6253]
- Updated dependencies [59bbd15]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [efa6253]
- Updated dependencies [45abe9d]
- Updated dependencies [45abe9d]
- Updated dependencies [72a5c9c]
- Updated dependencies [a546703]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [5c276e6]
- Updated dependencies [21c5cbc]
- Updated dependencies [26854dd]
- Updated dependencies [fbc6938]
- Updated dependencies [efa6253]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [b6b75fa]
- Updated dependencies [b6b75fa]
- Updated dependencies [b6b75fa]
- Updated dependencies [0f8bff5]
- Updated dependencies [067aa7b]
- Updated dependencies [efa6253]
- Updated dependencies [efa6253]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [45abe9d]
- Updated dependencies [72a5c9c]
  - @cosmicdrift/kumiko-framework@0.365.0
  - @cosmicdrift/kumiko-dev-server@0.365.0
  - @cosmicdrift/kumiko-testing@0.365.0
  - @cosmicdrift/kumiko-server-runtime@0.365.0

## 0.364.0

### Patch Changes

- Updated dependencies [8e81d73]
- Updated dependencies [e9b032f]
- Updated dependencies [cfbffba]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [6b1567e]
- Updated dependencies [2b255c2]
- Updated dependencies [8e81d73]
- Updated dependencies [8be3807]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [15039ce]
- Updated dependencies [fd5009a]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [dfb2523]
- Updated dependencies [8fb6aa6]
- Updated dependencies [7482ee2]
- Updated dependencies [8e81d73]
- Updated dependencies [5a39305]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [f1b4367]
- Updated dependencies [fd5009a]
- Updated dependencies [15039ce]
- Updated dependencies [22f40e1]
- Updated dependencies [5a2bea5]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [15039ce]
- Updated dependencies [b5a6395]
- Updated dependencies [fd5009a]
- Updated dependencies [55f003d]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
  - @cosmicdrift/kumiko-framework@0.364.0
  - @cosmicdrift/kumiko-server-runtime@0.364.0
  - @cosmicdrift/kumiko-dev-server@0.364.0
  - @cosmicdrift/kumiko-testing@0.364.0

## 0.363.0

### Minor Changes

- 9120f65: Scaffold feature picker drops renderer-simple

  <!-- kumiko-changes
  feature: create-kumiko-app
  type: improvement
  title: The scaffold no longer offers renderer-simple
  detail: renderer-simple is removed from the bundled features, so the feature picker and the bundled feature manifest no longer list it. Template-based mails need template-resolver, renderer-foundation and renderer-mail-html.
  -->

### Patch Changes

- 2972bc2: Error texts for template meta and placeholder validation, formatMoney delegates to headless, feature manifest refreshed

  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: error texts for template meta and placeholder validation in German and Spanish
  detail: The locale packages carry the new templateResolver.errors keys (invalid meta, unknown and missing placeholders, mail layout format, collection kind not allowed); renderer-web's formatMoney delegates to headless and the create-kumiko-app feature manifest is refreshed.
  -->

- Updated dependencies [045f886]
- Updated dependencies [a12e094]
- Updated dependencies [58452ae]
- Updated dependencies [ef689d8]
- Updated dependencies [9120f65]
- Updated dependencies [fcd6eb4]
- Updated dependencies [2972bc2]
- Updated dependencies [ef689d8]
- Updated dependencies [4a748c3]
- Updated dependencies [ef689d8]
- Updated dependencies [9120f65]
- Updated dependencies [cbed66e]
- Updated dependencies [366d89f]
  - @cosmicdrift/kumiko-framework@0.363.0
  - @cosmicdrift/kumiko-dev-server@0.363.0
  - @cosmicdrift/kumiko-server-runtime@0.363.0
  - @cosmicdrift/kumiko-testing@0.363.0

## 0.362.0

### Patch Changes

- Updated dependencies [61f7dd2]
- Updated dependencies [b6870d9]
- Updated dependencies [e5c2657]
- Updated dependencies [e5c2657]
- Updated dependencies [e5c2657]
- Updated dependencies [e5c2657]
- Updated dependencies [75d3e38]
  - @cosmicdrift/kumiko-framework@0.362.0
  - @cosmicdrift/kumiko-dev-server@0.362.0
  - @cosmicdrift/kumiko-server-runtime@0.362.0
  - @cosmicdrift/kumiko-testing@0.362.0

## 0.361.0

### Patch Changes

- Updated dependencies [4bf01ba]
- Updated dependencies [a3a51aa]
- Updated dependencies [a3a51aa]
- Updated dependencies [a3a51aa]
- Updated dependencies [a3a51aa]
- Updated dependencies [99d1037]
- Updated dependencies [a3a51aa]
- Updated dependencies [4bf01ba]
- Updated dependencies [7f32198]
- Updated dependencies [a3a51aa]
- Updated dependencies [a3a51aa]
- Updated dependencies [91fc70e]
- Updated dependencies [99d1037]
- Updated dependencies [99d1037]
- Updated dependencies [f2346e5]
  - @cosmicdrift/kumiko-dev-server@0.361.0
  - @cosmicdrift/kumiko-server-runtime@0.361.0
  - @cosmicdrift/kumiko-framework@0.361.0
  - @cosmicdrift/kumiko-testing@0.361.0

## 0.360.0

### Patch Changes

- Updated dependencies [cc46b78]
- Updated dependencies [b0e8bd3]
- Updated dependencies [16fe359]
  - @cosmicdrift/kumiko-framework@0.360.0
  - @cosmicdrift/kumiko-dev-server@0.360.0
  - @cosmicdrift/kumiko-testing@0.360.0
  - @cosmicdrift/kumiko-server-runtime@0.360.0

## 0.359.0

### Patch Changes

- Updated dependencies [dacda2f]
  - @cosmicdrift/kumiko-framework@0.359.0
  - @cosmicdrift/kumiko-dev-server@0.359.0
  - @cosmicdrift/kumiko-server-runtime@0.359.0
  - @cosmicdrift/kumiko-testing@0.359.0

## 0.358.0

### Patch Changes

- Updated dependencies [5037fe8]
- Updated dependencies [b182c6c]
- Updated dependencies [067bc4c]
- Updated dependencies [eec3b6b]
- Updated dependencies [e028f23]
  - @cosmicdrift/kumiko-framework@0.358.0
  - @cosmicdrift/kumiko-server-runtime@0.358.0
  - @cosmicdrift/kumiko-dev-server@0.358.0
  - @cosmicdrift/kumiko-testing@0.358.0

## 0.357.0

### Patch Changes

- Updated dependencies [774c60c]
- Updated dependencies [06e8ad8]
- Updated dependencies [d7872bd]
- Updated dependencies [eb71a72]
- Updated dependencies [da74267]
- Updated dependencies [71b4f59]
  - @cosmicdrift/kumiko-framework@0.357.0
  - @cosmicdrift/kumiko-server-runtime@0.357.0
  - @cosmicdrift/kumiko-testing@0.357.0
  - @cosmicdrift/kumiko-dev-server@0.357.0

## 0.356.0

### Patch Changes

- Updated dependencies [4e110c4]
- Updated dependencies [4c06248]
- Updated dependencies [77c6851]
- Updated dependencies [93aca05]
  - @cosmicdrift/kumiko-framework@0.356.0
  - @cosmicdrift/kumiko-server-runtime@0.356.0
  - @cosmicdrift/kumiko-dev-server@0.356.0
  - @cosmicdrift/kumiko-testing@0.356.0

## 0.355.0

### Patch Changes

- Updated dependencies [17496fd]
- Updated dependencies [326bfb5]
- Updated dependencies [c40ac62]
- Updated dependencies [32d725c]
- Updated dependencies [44650be]
  - @cosmicdrift/kumiko-framework@0.355.0
  - @cosmicdrift/kumiko-dev-server@0.355.0
  - @cosmicdrift/kumiko-server-runtime@0.355.0
  - @cosmicdrift/kumiko-testing@0.355.0

## 0.354.1

### Patch Changes

- Updated dependencies [a5f13a7]
- Updated dependencies [a7b381b]
  - @cosmicdrift/kumiko-framework@0.354.1
  - @cosmicdrift/kumiko-dev-server@0.354.1
  - @cosmicdrift/kumiko-server-runtime@0.354.1
  - @cosmicdrift/kumiko-testing@0.354.1

## 0.354.0

### Patch Changes

- Updated dependencies [36a08aa]
- Updated dependencies [81153cb]
- Updated dependencies [03c000a]
- Updated dependencies [03c000a]
- Updated dependencies [03c000a]
- Updated dependencies [03c000a]
- Updated dependencies [03c000a]
- Updated dependencies [a734025]
- Updated dependencies [94eb2fc]
- Updated dependencies [f060e44]
- Updated dependencies [fde53b0]
- Updated dependencies [8307320]
- Updated dependencies [03c000a]
- Updated dependencies [03c000a]
- Updated dependencies [f060e44]
- Updated dependencies [f1a576b]
- Updated dependencies [a2bafb2]
- Updated dependencies [c10805f]
- Updated dependencies [edcb2d0]
- Updated dependencies [2873c76]
- Updated dependencies [357f33d]
- Updated dependencies [a62e62c]
- Updated dependencies [4d058fb]
- Updated dependencies [beab610]
- Updated dependencies [6bd7df1]
- Updated dependencies [a6d5c20]
- Updated dependencies [b15e90d]
- Updated dependencies [67d8d41]
- Updated dependencies [cc7e2ce]
- Updated dependencies [8d5fa1a]
- Updated dependencies [4803d4c]
- Updated dependencies [a62e62c]
- Updated dependencies [2b0566a]
- Updated dependencies [fde53b0]
- Updated dependencies [13f6b6f]
- Updated dependencies [15e6930]
  - @cosmicdrift/kumiko-framework@0.354.0
  - @cosmicdrift/kumiko-dev-server@0.354.0
  - @cosmicdrift/kumiko-server-runtime@0.354.0
  - @cosmicdrift/kumiko-testing@0.354.0

## 0.353.0

### Patch Changes

- Updated dependencies [1d1ff03]
- Updated dependencies [3932e47]
- Updated dependencies [8310091]
- Updated dependencies [f05c4e7]
- Updated dependencies [8310091]
- Updated dependencies [4ec1c59]
- Updated dependencies [0609d09]
- Updated dependencies [649b512]
- Updated dependencies [d32c9b3]
- Updated dependencies [a9ab2be]
- Updated dependencies [b5466a7]
  - @cosmicdrift/kumiko-testing@0.353.0
  - @cosmicdrift/kumiko-framework@0.353.0
  - @cosmicdrift/kumiko-server-runtime@0.353.0
  - @cosmicdrift/kumiko-dev-server@0.353.0

## 0.352.0

### Patch Changes

- Updated dependencies [9fb0657]
- Updated dependencies [9fb0657]
- Updated dependencies [b905d4b]
- Updated dependencies [9fb0657]
- Updated dependencies [9fb0657]
  - @cosmicdrift/kumiko-framework@0.352.0
  - @cosmicdrift/kumiko-dev-server@0.352.0
  - @cosmicdrift/kumiko-server-runtime@0.352.0
  - @cosmicdrift/kumiko-testing@0.352.0

## 0.351.0

### Patch Changes

- 44be746: `--help` prints usage on every bin

  `kumiko-init-deploy --help` used to write the deploy files, and `kumiko-testing integration --help` crashed while parsing its arguments. Both now print their usage and exit 0, as do `kumiko-build`, `kumiko-dev`, `kumiko-schema-check` and `create-kumiko-app`.

  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: --help prints usage instead of running the command (init-deploy, build, dev, schema-check, kumiko-testing integration)
  -->

- Updated dependencies [44be746]
- Updated dependencies [44be746]
- Updated dependencies [44be746]
- Updated dependencies [44be746]
- Updated dependencies [44be746]
  - @cosmicdrift/kumiko-testing@0.351.0
  - @cosmicdrift/kumiko-dev-server@0.351.0
  - @cosmicdrift/kumiko-framework@0.351.0
  - @cosmicdrift/kumiko-server-runtime@0.351.0

## 0.350.0

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.350.0
- @cosmicdrift/kumiko-server-runtime@0.350.0
- @cosmicdrift/kumiko-testing@0.350.0
- @cosmicdrift/kumiko-framework@0.350.0

## 0.349.0

### Patch Changes

- Updated dependencies [6e850b8]
- Updated dependencies [6e850b8]
- Updated dependencies [6e850b8]
  - @cosmicdrift/kumiko-framework@0.349.0
  - @cosmicdrift/kumiko-dev-server@0.349.0
  - @cosmicdrift/kumiko-server-runtime@0.349.0
  - @cosmicdrift/kumiko-testing@0.349.0

## 0.348.1

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.348.1
- @cosmicdrift/kumiko-server-runtime@0.348.1
- @cosmicdrift/kumiko-testing@0.348.1
- @cosmicdrift/kumiko-framework@0.348.1

## 0.348.0

### Patch Changes

- Updated dependencies [400490e]
- Updated dependencies [d7fd7e0]
  - @cosmicdrift/kumiko-framework@0.348.0
  - @cosmicdrift/kumiko-testing@0.348.0
  - @cosmicdrift/kumiko-dev-server@0.348.0
  - @cosmicdrift/kumiko-server-runtime@0.348.0

## 0.347.0

### Patch Changes

- Updated dependencies [69c182c]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [69c182c]
  - @cosmicdrift/kumiko-dev-server@0.347.0
  - @cosmicdrift/kumiko-framework@0.347.0
  - @cosmicdrift/kumiko-server-runtime@0.347.0
  - @cosmicdrift/kumiko-testing@0.347.0

## 0.346.0

### Patch Changes

- Updated dependencies [eb9dfef]
- Updated dependencies [6b8dde4]
  - @cosmicdrift/kumiko-server-runtime@0.346.0
  - @cosmicdrift/kumiko-framework@0.346.0
  - @cosmicdrift/kumiko-dev-server@0.346.0
  - @cosmicdrift/kumiko-testing@0.346.0

## 0.345.0

### Patch Changes

- Updated dependencies [cef5fa0]
- Updated dependencies [07495cf]
- Updated dependencies [c325eb2]
- Updated dependencies [07495cf]
- Updated dependencies [07495cf]
- Updated dependencies [07495cf]
- Updated dependencies [07495cf]
- Updated dependencies [c325eb2]
  - @cosmicdrift/kumiko-server-runtime@0.345.0
  - @cosmicdrift/kumiko-framework@0.345.0
  - @cosmicdrift/kumiko-dev-server@0.345.0
  - @cosmicdrift/kumiko-testing@0.345.0

## 0.344.0

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.344.0
- @cosmicdrift/kumiko-server-runtime@0.344.0
- @cosmicdrift/kumiko-testing@0.344.0
- @cosmicdrift/kumiko-framework@0.344.0

## 0.343.0

### Patch Changes

- Updated dependencies [23b0bec]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [cf6d31b]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [d32e123]
- Updated dependencies [6adca33]
- Updated dependencies [446b714]
- Updated dependencies [cf6d31b]
- Updated dependencies [446b714]
  - @cosmicdrift/kumiko-framework@0.343.0
  - @cosmicdrift/kumiko-server-runtime@0.343.0
  - @cosmicdrift/kumiko-dev-server@0.343.0
  - @cosmicdrift/kumiko-testing@0.343.0

## 0.342.0

### Patch Changes

- Updated dependencies [e7f2d36]
- Updated dependencies [e7f2d36]
- Updated dependencies [0978e85]
- Updated dependencies [e7f2d36]
- Updated dependencies [0978e85]
- Updated dependencies [0978e85]
  - @cosmicdrift/kumiko-testing@0.342.0
  - @cosmicdrift/kumiko-dev-server@0.342.0
  - @cosmicdrift/kumiko-framework@0.342.0
  - @cosmicdrift/kumiko-server-runtime@0.342.0

## 0.341.0

### Patch Changes

- Updated dependencies [610201f]
- Updated dependencies [82309a5]
- Updated dependencies [9bc1069]
- Updated dependencies [465e14c]
- Updated dependencies [1feae69]
- Updated dependencies [fcd9081]
- Updated dependencies [c2c7862]
- Updated dependencies [610201f]
- Updated dependencies [37c0974]
- Updated dependencies [e7dbdb6]
- Updated dependencies [1feae69]
- Updated dependencies [c5e6814]
- Updated dependencies [8443f22]
- Updated dependencies [1f0a63b]
- Updated dependencies [9bc1069]
- Updated dependencies [e7dbdb6]
- Updated dependencies [37c0974]
- Updated dependencies [610201f]
  - @cosmicdrift/kumiko-framework@0.341.0
  - @cosmicdrift/kumiko-server-runtime@0.341.0
  - @cosmicdrift/kumiko-dev-server@0.341.0
  - @cosmicdrift/kumiko-testing@0.341.0

## 0.340.0

### Patch Changes

- Updated dependencies [483bb16]
- Updated dependencies [b71234a]
  - @cosmicdrift/kumiko-framework@0.340.0
  - @cosmicdrift/kumiko-dev-server@0.340.0
  - @cosmicdrift/kumiko-server-runtime@0.340.0
  - @cosmicdrift/kumiko-testing@0.340.0

## 0.339.0

### Patch Changes

- Updated dependencies [5b6e5f7]
- Updated dependencies [c1e6186]
- Updated dependencies [fcbf184]
- Updated dependencies [e3adda3]
- Updated dependencies [10e84fb]
- Updated dependencies [dc3a61e]
- Updated dependencies [1954386]
- Updated dependencies [b040ca7]
- Updated dependencies [252f749]
  - @cosmicdrift/kumiko-framework@0.339.0
  - @cosmicdrift/kumiko-server-runtime@0.339.0
  - @cosmicdrift/kumiko-testing@0.339.0
  - @cosmicdrift/kumiko-dev-server@0.339.0

## 0.338.0

### Patch Changes

- Updated dependencies [c710f1e]
- Updated dependencies [3613e5a]
- Updated dependencies [c8ca453]
- Updated dependencies [3451156]
- Updated dependencies [4a13a0e]
- Updated dependencies [57467b5]
- Updated dependencies [a71189f]
- Updated dependencies [f093d93]
- Updated dependencies [e8e5e2f]
- Updated dependencies [bac056f]
- Updated dependencies [f4f3d4a]
- Updated dependencies [b036209]
- Updated dependencies [87938e0]
- Updated dependencies [51b4867]
- Updated dependencies [d1bba78]
  - @cosmicdrift/kumiko-framework@0.338.0
  - @cosmicdrift/kumiko-dev-server@0.338.0
  - @cosmicdrift/kumiko-server-runtime@0.338.0
  - @cosmicdrift/kumiko-testing@0.338.0

## 0.337.1

### Patch Changes

- Updated dependencies [b1b01b8]
- Updated dependencies [9074b71]
- Updated dependencies [6c1c1d4]
  - @cosmicdrift/kumiko-framework@0.337.1
  - @cosmicdrift/kumiko-dev-server@0.337.1
  - @cosmicdrift/kumiko-server-runtime@0.337.1
  - @cosmicdrift/kumiko-testing@0.337.1

## 0.337.0

### Patch Changes

- Updated dependencies [c68ebb6]
- Updated dependencies [3ad5398]
- Updated dependencies [3ad5398]
- Updated dependencies [3ad5398]
- Updated dependencies [3ad5398]
- Updated dependencies [a7fcca9]
- Updated dependencies [469df86]
- Updated dependencies [7bd2624]
- Updated dependencies [8b6daed]
- Updated dependencies [c2da99c]
- Updated dependencies [7949847]
- Updated dependencies [a5023de]
- Updated dependencies [edc2b80]
- Updated dependencies [d25d363]
- Updated dependencies [acde687]
- Updated dependencies [e889f3f]
  - @cosmicdrift/kumiko-framework@0.337.0
  - @cosmicdrift/kumiko-testing@0.337.0
  - @cosmicdrift/kumiko-dev-server@0.337.0
  - @cosmicdrift/kumiko-server-runtime@0.337.0

## 0.336.1

### Patch Changes

- Updated dependencies [ad3999e]
- Updated dependencies [c4a1155]
- Updated dependencies [c4a1155]
  - @cosmicdrift/kumiko-framework@0.336.1
  - @cosmicdrift/kumiko-testing@0.336.1
  - @cosmicdrift/kumiko-dev-server@0.336.1
  - @cosmicdrift/kumiko-server-runtime@0.336.1

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
  - @cosmicdrift/kumiko-dev-server@0.336.0
  - @cosmicdrift/kumiko-server-runtime@0.336.0
  - @cosmicdrift/kumiko-testing@0.336.0

## 0.335.0

### Patch Changes

- Updated dependencies [ff1dea2]
- Updated dependencies [d973444]
- Updated dependencies [a4fa088]
- Updated dependencies [ed072dc]
- Updated dependencies [44c5898]
- Updated dependencies [c97a39a]
- Updated dependencies [bf12ac5]
- Updated dependencies [6d4068f]
- Updated dependencies [1e9cc86]
- Updated dependencies [0ae79d4]
- Updated dependencies [6fee777]
- Updated dependencies [9061d9e]
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
- Updated dependencies [1e25ae5]
- Updated dependencies [9acf185]
- Updated dependencies [d7d5bd7]
- Updated dependencies [57f0e78]
- Updated dependencies [173a581]
- Updated dependencies [5e9cc10]
- Updated dependencies [1e25ae5]
- Updated dependencies [a86aa83]
- Updated dependencies [a39d8a6]
- Updated dependencies [9061d9e]
- Updated dependencies [e550021]
- Updated dependencies [a8c0abd]
- Updated dependencies [4e617da]
- Updated dependencies [3d37d50]
- Updated dependencies [7cdc623]
  - @cosmicdrift/kumiko-framework@0.335.0
  - @cosmicdrift/kumiko-dev-server@0.335.0
  - @cosmicdrift/kumiko-server-runtime@0.335.0
  - @cosmicdrift/kumiko-testing@0.335.0

## 0.334.0

### Patch Changes

- Updated dependencies [6633f59]
- Updated dependencies [6633f59]
- Updated dependencies [bc0172a]
  - @cosmicdrift/kumiko-framework@0.334.0
  - @cosmicdrift/kumiko-dev-server@0.334.0
  - @cosmicdrift/kumiko-server-runtime@0.334.0
  - @cosmicdrift/kumiko-testing@0.334.0

## 0.333.0

### Patch Changes

- Updated dependencies [2d7f76f]
- Updated dependencies [90420cb]
  - @cosmicdrift/kumiko-framework@0.333.0
  - @cosmicdrift/kumiko-server-runtime@0.333.0
  - @cosmicdrift/kumiko-testing@0.333.0
  - @cosmicdrift/kumiko-dev-server@0.333.0

## 0.332.0

### Patch Changes

- Updated dependencies [991ed87]
- Updated dependencies [dcf135e]
- Updated dependencies [3917e63]
- Updated dependencies [b81f794]
- Updated dependencies [541d24b]
- Updated dependencies [e82b023]
- Updated dependencies [dcf135e]
- Updated dependencies [dcf135e]
  - @cosmicdrift/kumiko-framework@0.332.0
  - @cosmicdrift/kumiko-dev-server@0.332.0
  - @cosmicdrift/kumiko-server-runtime@0.332.0
  - @cosmicdrift/kumiko-testing@0.332.0

## 0.331.0

### Patch Changes

- Updated dependencies [16797a4]
- Updated dependencies [6b95958]
- Updated dependencies [3ea4ffc]
- Updated dependencies [e4ea9f0]
  - @cosmicdrift/kumiko-framework@0.331.0
  - @cosmicdrift/kumiko-dev-server@0.331.0
  - @cosmicdrift/kumiko-server-runtime@0.331.0
  - @cosmicdrift/kumiko-testing@0.331.0

## 0.330.2

### Patch Changes

- Updated dependencies [32a6102]
  - @cosmicdrift/kumiko-framework@0.330.2
  - @cosmicdrift/kumiko-dev-server@0.330.2
  - @cosmicdrift/kumiko-server-runtime@0.330.2
  - @cosmicdrift/kumiko-testing@0.330.2

## 0.330.1

### Patch Changes

- Updated dependencies [63a63d6]
- Updated dependencies [39c2fbd]
- Updated dependencies [03ad4bc]
  - @cosmicdrift/kumiko-framework@0.330.1
  - @cosmicdrift/kumiko-dev-server@0.330.1
  - @cosmicdrift/kumiko-server-runtime@0.330.1
  - @cosmicdrift/kumiko-testing@0.330.1

## 0.330.0

### Patch Changes

- Updated dependencies [dc5981b]
- Updated dependencies [7a886f1]
- Updated dependencies [89e32ce]
- Updated dependencies [f19fb5c]
- Updated dependencies [1e18129]
- Updated dependencies [48f36df]
  - @cosmicdrift/kumiko-framework@0.330.0
  - @cosmicdrift/kumiko-server-runtime@0.330.0
  - @cosmicdrift/kumiko-dev-server@0.330.0
  - @cosmicdrift/kumiko-testing@0.330.0

## 0.329.0

### Patch Changes

- Updated dependencies [9bbdb64]
- Updated dependencies [9bbdb64]
  - @cosmicdrift/kumiko-testing@0.329.0
  - @cosmicdrift/kumiko-framework@0.329.0
  - @cosmicdrift/kumiko-dev-server@0.329.0
  - @cosmicdrift/kumiko-server-runtime@0.329.0

## 0.328.1

### Patch Changes

- Updated dependencies [863e8e4]
  - @cosmicdrift/kumiko-framework@0.328.1
  - @cosmicdrift/kumiko-dev-server@0.328.1
  - @cosmicdrift/kumiko-server-runtime@0.328.1
  - @cosmicdrift/kumiko-testing@0.328.1

## 0.328.0

### Patch Changes

- Updated dependencies [424f49a]
- Updated dependencies [eae8d2b]
- Updated dependencies [9cc1787]
- Updated dependencies [2a4350b]
- Updated dependencies [c3fbe54]
- Updated dependencies [822928f]
  - @cosmicdrift/kumiko-framework@0.328.0
  - @cosmicdrift/kumiko-server-runtime@0.328.0
  - @cosmicdrift/kumiko-dev-server@0.328.0
  - @cosmicdrift/kumiko-testing@0.328.0

## 0.327.0

### Patch Changes

- Updated dependencies [7341d07]
- Updated dependencies [268c3bd]
- Updated dependencies [532a197]
- Updated dependencies [eef5a2f]
- Updated dependencies [da6e569]
  - @cosmicdrift/kumiko-framework@0.327.0
  - @cosmicdrift/kumiko-server-runtime@0.327.0
  - @cosmicdrift/kumiko-dev-server@0.327.0
  - @cosmicdrift/kumiko-testing@0.327.0

## 0.326.1

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.326.1
- @cosmicdrift/kumiko-server-runtime@0.326.1
- @cosmicdrift/kumiko-testing@0.326.1
- @cosmicdrift/kumiko-framework@0.326.1

## 0.326.0

### Patch Changes

- Updated dependencies [6af6be2]
  - @cosmicdrift/kumiko-framework@0.326.0
  - @cosmicdrift/kumiko-dev-server@0.326.0
  - @cosmicdrift/kumiko-server-runtime@0.326.0
  - @cosmicdrift/kumiko-testing@0.326.0

## 0.325.2

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.325.2
- @cosmicdrift/kumiko-server-runtime@0.325.2
- @cosmicdrift/kumiko-testing@0.325.2
- @cosmicdrift/kumiko-framework@0.325.2

## 0.325.1

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.325.1
- @cosmicdrift/kumiko-server-runtime@0.325.1
- @cosmicdrift/kumiko-testing@0.325.1
- @cosmicdrift/kumiko-framework@0.325.1

## 0.325.0

### Patch Changes

- Updated dependencies [100732a]
  - @cosmicdrift/kumiko-framework@0.325.0
  - @cosmicdrift/kumiko-dev-server@0.325.0
  - @cosmicdrift/kumiko-server-runtime@0.325.0
  - @cosmicdrift/kumiko-testing@0.325.0

## 0.324.0

### Patch Changes

- Updated dependencies [efa4114]
- Updated dependencies [3c0095d]
  - @cosmicdrift/kumiko-framework@0.324.0
  - @cosmicdrift/kumiko-dev-server@0.324.0
  - @cosmicdrift/kumiko-server-runtime@0.324.0
  - @cosmicdrift/kumiko-testing@0.324.0

## 0.323.0

### Patch Changes

- Updated dependencies [c01b9be]
- Updated dependencies [5c7e422]
- Updated dependencies [d7bba26]
- Updated dependencies [60e1a1f]
- Updated dependencies [d7bba26]
- Updated dependencies [72727cd]
- Updated dependencies [d7bba26]
- Updated dependencies [1343b18]
  - @cosmicdrift/kumiko-dev-server@0.323.0
  - @cosmicdrift/kumiko-server-runtime@0.323.0
  - @cosmicdrift/kumiko-framework@0.323.0
  - @cosmicdrift/kumiko-testing@0.323.0

## 0.322.0

### Patch Changes

- Updated dependencies [d0c631a]
- Updated dependencies [9e7bedc]
  - @cosmicdrift/kumiko-framework@0.322.0
  - @cosmicdrift/kumiko-dev-server@0.322.0
  - @cosmicdrift/kumiko-server-runtime@0.322.0
  - @cosmicdrift/kumiko-testing@0.322.0

## 0.321.0

### Patch Changes

- Updated dependencies [959b3fb]
- Updated dependencies [fa27809]
- Updated dependencies [de9ee46]
- Updated dependencies [fa27809]
- Updated dependencies [8246f13]
- Updated dependencies [fa27809]
- Updated dependencies [b74db24]
- Updated dependencies [5616ad9]
- Updated dependencies [fa27809]
  - @cosmicdrift/kumiko-testing@0.321.0
  - @cosmicdrift/kumiko-dev-server@0.321.0
  - @cosmicdrift/kumiko-framework@0.321.0
  - @cosmicdrift/kumiko-server-runtime@0.321.0

## 0.320.0

### Patch Changes

- Updated dependencies [0ab9874]
- Updated dependencies [c61cc7a]
- Updated dependencies [e7cd1cb]
- Updated dependencies [c61cc7a]
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
- Updated dependencies [9907bc6]
- Updated dependencies [ef64fa9]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
  - @cosmicdrift/kumiko-framework@0.320.0
  - @cosmicdrift/kumiko-server-runtime@0.320.0
  - @cosmicdrift/kumiko-dev-server@0.320.0
  - @cosmicdrift/kumiko-testing@0.320.0

## 0.319.0

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.319.0
- @cosmicdrift/kumiko-server-runtime@0.319.0
- @cosmicdrift/kumiko-testing@0.319.0
- @cosmicdrift/kumiko-framework@0.319.0

## 0.318.0

### Patch Changes

- Updated dependencies [5d3b3e8]
- Updated dependencies [4fac08d]
- Updated dependencies [1d97d7a]
  - @cosmicdrift/kumiko-framework@0.318.0
  - @cosmicdrift/kumiko-testing@0.318.0
  - @cosmicdrift/kumiko-dev-server@0.318.0
  - @cosmicdrift/kumiko-server-runtime@0.318.0

## 0.317.0

### Patch Changes

- Updated dependencies [fd40653]
- Updated dependencies [fd40653]
- Updated dependencies [061ee8f]
- Updated dependencies [b13c820]
- Updated dependencies [94ce380]
  - @cosmicdrift/kumiko-testing@0.317.0
  - @cosmicdrift/kumiko-framework@0.317.0
  - @cosmicdrift/kumiko-dev-server@0.317.0
  - @cosmicdrift/kumiko-server-runtime@0.317.0

## 0.316.0

### Patch Changes

- Updated dependencies [146324f]
- Updated dependencies [aa32979]
- Updated dependencies [aa32979]
- Updated dependencies [aa32979]
  - @cosmicdrift/kumiko-testing@0.316.0
  - @cosmicdrift/kumiko-framework@0.316.0
  - @cosmicdrift/kumiko-dev-server@0.316.0
  - @cosmicdrift/kumiko-server-runtime@0.316.0

## 0.315.0

### Patch Changes

- Updated dependencies [0f2643d]
  - @cosmicdrift/kumiko-framework@0.315.0
  - @cosmicdrift/kumiko-dev-server@0.315.0
  - @cosmicdrift/kumiko-server-runtime@0.315.0
  - @cosmicdrift/kumiko-testing@0.315.0

## 0.314.0

### Patch Changes

- Updated dependencies [483666f]
- Updated dependencies [22d89ec]
- Updated dependencies [483666f]
- Updated dependencies [3434a94]
- Updated dependencies [3434a94]
- Updated dependencies [3434a94]
- Updated dependencies [483666f]
- Updated dependencies [3434a94]
- Updated dependencies [3434a94]
  - @cosmicdrift/kumiko-framework@0.314.0
  - @cosmicdrift/kumiko-testing@0.314.0
  - @cosmicdrift/kumiko-dev-server@0.314.0
  - @cosmicdrift/kumiko-server-runtime@0.314.0

## 0.313.0

### Patch Changes

- Updated dependencies [a14fd1f]
- Updated dependencies [42c5298]
- Updated dependencies [93d7b77]
- Updated dependencies [4dea3ec]
- Updated dependencies [b99240c]
- Updated dependencies [e7dc624]
  - @cosmicdrift/kumiko-framework@0.313.0
  - @cosmicdrift/kumiko-dev-server@0.313.0
  - @cosmicdrift/kumiko-server-runtime@0.313.0
  - @cosmicdrift/kumiko-testing@0.313.0

## 0.312.0

### Patch Changes

- Updated dependencies [f662b79]
- Updated dependencies [f662b79]
- Updated dependencies [f662b79]
  - @cosmicdrift/kumiko-framework@0.312.0
  - @cosmicdrift/kumiko-dev-server@0.312.0
  - @cosmicdrift/kumiko-server-runtime@0.312.0
  - @cosmicdrift/kumiko-testing@0.312.0

## 0.311.0

### Patch Changes

- Updated dependencies [c448d50]
  - @cosmicdrift/kumiko-testing@0.311.0
  - @cosmicdrift/kumiko-framework@0.311.0
  - @cosmicdrift/kumiko-dev-server@0.311.0
  - @cosmicdrift/kumiko-server-runtime@0.311.0

## 0.310.0

### Patch Changes

- Updated dependencies [4f36c3f]
- Updated dependencies [70fd8d6]
- Updated dependencies [da6c84f]
- Updated dependencies [ff05fae]
- Updated dependencies [9f16c3f]
  - @cosmicdrift/kumiko-framework@0.310.0
  - @cosmicdrift/kumiko-testing@0.310.0
  - @cosmicdrift/kumiko-dev-server@0.310.0
  - @cosmicdrift/kumiko-server-runtime@0.310.0

## 0.309.0

### Patch Changes

- Updated dependencies [75925be]
- Updated dependencies [cb0adcf]
- Updated dependencies [11b6f67]
- Updated dependencies [ac9bdae]
- Updated dependencies [a81c5d0]
- Updated dependencies [8f109b5]
- Updated dependencies [621c4de]
- Updated dependencies [711de11]
- Updated dependencies [621c4de]
- Updated dependencies [95a595d]
- Updated dependencies [837b712]
- Updated dependencies [711de11]
  - @cosmicdrift/kumiko-framework@0.309.0
  - @cosmicdrift/kumiko-server-runtime@0.309.0
  - @cosmicdrift/kumiko-dev-server@0.309.0
  - @cosmicdrift/kumiko-testing@0.309.0

## 0.308.0

### Patch Changes

- Updated dependencies [1b64375]
- Updated dependencies [1b64375]
- Updated dependencies [765f01b]
- Updated dependencies [49e07f5]
- Updated dependencies [ad701ed]
- Updated dependencies [6e5ed00]
- Updated dependencies [3ae4b82]
- Updated dependencies [9816d20]
- Updated dependencies [6b8b0ed]
- Updated dependencies [685ecc9]
  - @cosmicdrift/kumiko-dev-server@0.308.0
  - @cosmicdrift/kumiko-testing@0.308.0
  - @cosmicdrift/kumiko-framework@0.308.0
  - @cosmicdrift/kumiko-server-runtime@0.308.0

## 0.307.0

### Patch Changes

- Updated dependencies [a3f00b0]
- Updated dependencies [c5c5ddb]
- Updated dependencies [e682776]
- Updated dependencies [cc23d3d]
- Updated dependencies [4179f26]
- Updated dependencies [bc6fd32]
- Updated dependencies [aae3f5d]
  - @cosmicdrift/kumiko-dev-server@0.307.0
  - @cosmicdrift/kumiko-server-runtime@0.307.0
  - @cosmicdrift/kumiko-framework@0.307.0
  - @cosmicdrift/kumiko-testing@0.307.0

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
- Updated dependencies [0d5eef7]
- Updated dependencies [0d5eef7]
- Updated dependencies [7d17b0e]
  - @cosmicdrift/kumiko-framework@0.306.0
  - @cosmicdrift/kumiko-testing@0.306.0
  - @cosmicdrift/kumiko-dev-server@0.306.0
  - @cosmicdrift/kumiko-server-runtime@0.306.0

## 0.305.0

### Patch Changes

- Updated dependencies [90c5398]
- Updated dependencies [9de2cde]
- Updated dependencies [c41c201]
- Updated dependencies [05b87d7]
- Updated dependencies [0ee6000]
- Updated dependencies [0567906]
- Updated dependencies [d98d172]
- Updated dependencies [d42d76a]
  - @cosmicdrift/kumiko-framework@0.305.0
  - @cosmicdrift/kumiko-dev-server@0.305.0
  - @cosmicdrift/kumiko-testing@0.305.0
  - @cosmicdrift/kumiko-server-runtime@0.305.0

## 0.304.0

### Patch Changes

- Updated dependencies [e19227b]
  - @cosmicdrift/kumiko-testing@0.304.0
  - @cosmicdrift/kumiko-framework@0.304.0
  - @cosmicdrift/kumiko-dev-server@0.304.0
  - @cosmicdrift/kumiko-server-runtime@0.304.0

## 0.303.0

### Patch Changes

- Updated dependencies [3d28528]
  - @cosmicdrift/kumiko-framework@0.303.0
  - @cosmicdrift/kumiko-dev-server@0.303.0
  - @cosmicdrift/kumiko-server-runtime@0.303.0
  - @cosmicdrift/kumiko-testing@0.303.0

## 0.302.0

### Patch Changes

- Updated dependencies [deede20]
  - @cosmicdrift/kumiko-framework@0.302.0
  - @cosmicdrift/kumiko-dev-server@0.302.0
  - @cosmicdrift/kumiko-server-runtime@0.302.0
  - @cosmicdrift/kumiko-testing@0.302.0

## 0.301.0

### Patch Changes

- Updated dependencies [5028a6c]
- Updated dependencies [bae6958]
  - @cosmicdrift/kumiko-dev-server@0.301.0
  - @cosmicdrift/kumiko-framework@0.301.0
  - @cosmicdrift/kumiko-server-runtime@0.301.0
  - @cosmicdrift/kumiko-testing@0.301.0

## 0.300.0

### Patch Changes

- Updated dependencies [2414932]
  - @cosmicdrift/kumiko-framework@0.300.0
  - @cosmicdrift/kumiko-dev-server@0.300.0
  - @cosmicdrift/kumiko-server-runtime@0.300.0
  - @cosmicdrift/kumiko-testing@0.300.0

## 0.299.0

### Patch Changes

- Updated dependencies [aa09d45]
  - @cosmicdrift/kumiko-dev-server@0.299.0
  - @cosmicdrift/kumiko-testing@0.299.0
  - @cosmicdrift/kumiko-framework@0.299.0
  - @cosmicdrift/kumiko-server-runtime@0.299.0

## 0.298.0

### Patch Changes

- Updated dependencies [6735981]
- Updated dependencies [4ae8163]
- Updated dependencies [6735981]
- Updated dependencies [6735981]
- Updated dependencies [6735981]
  - @cosmicdrift/kumiko-dev-server@0.298.0
  - @cosmicdrift/kumiko-framework@0.298.0
  - @cosmicdrift/kumiko-server-runtime@0.298.0
  - @cosmicdrift/kumiko-testing@0.298.0

## 0.297.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.297.0
- @cosmicdrift/kumiko-dev-server@0.297.0
- @cosmicdrift/kumiko-server-runtime@0.297.0
- @cosmicdrift/kumiko-testing@0.297.0

## 0.296.0

### Patch Changes

- Updated dependencies [cb6e8a4]
- Updated dependencies [bfa7536]
- Updated dependencies [42b0562]
- Updated dependencies [f042685]
- Updated dependencies [d8cdd8a]
- Updated dependencies [3c34575]
  - @cosmicdrift/kumiko-framework@0.296.0
  - @cosmicdrift/kumiko-dev-server@0.296.0
  - @cosmicdrift/kumiko-server-runtime@0.296.0
  - @cosmicdrift/kumiko-testing@0.296.0

## 0.295.0

### Patch Changes

- Updated dependencies [294caec]
  - @cosmicdrift/kumiko-testing@0.295.0
  - @cosmicdrift/kumiko-framework@0.295.0
  - @cosmicdrift/kumiko-dev-server@0.295.0
  - @cosmicdrift/kumiko-server-runtime@0.295.0

## 0.294.1

### Patch Changes

- Updated dependencies [7f6fbc6]
  - @cosmicdrift/kumiko-framework@0.294.1
  - @cosmicdrift/kumiko-dev-server@0.294.1
  - @cosmicdrift/kumiko-server-runtime@0.294.1

## 0.294.0

### Patch Changes

- Updated dependencies [ea10c90]
  - @cosmicdrift/kumiko-framework@0.294.0
  - @cosmicdrift/kumiko-server-runtime@0.294.0
  - @cosmicdrift/kumiko-dev-server@0.294.0

## 0.293.0

### Patch Changes

- Updated dependencies [7fb8a62]
  - @cosmicdrift/kumiko-framework@0.293.0
  - @cosmicdrift/kumiko-dev-server@0.293.0
  - @cosmicdrift/kumiko-server-runtime@0.293.0

## 0.292.0

### Patch Changes

- Updated dependencies [787c572]
- Updated dependencies [fbe8ffa]
- Updated dependencies [7b5ac24]
- Updated dependencies [6d53c10]
  - @cosmicdrift/kumiko-framework@0.292.0
  - @cosmicdrift/kumiko-dev-server@0.292.0
  - @cosmicdrift/kumiko-server-runtime@0.292.0

## 0.291.0

### Patch Changes

- Updated dependencies [0fa2da2]
- Updated dependencies [c061ac9]
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
  - @cosmicdrift/kumiko-dev-server@0.291.0
  - @cosmicdrift/kumiko-server-runtime@0.291.0

## 0.290.0

### Patch Changes

- Updated dependencies [878d8b2]
- Updated dependencies [9da6b5f]
- Updated dependencies [fe23245]
  - @cosmicdrift/kumiko-framework@0.290.0
  - @cosmicdrift/kumiko-dev-server@0.290.0
  - @cosmicdrift/kumiko-server-runtime@0.290.0

## 0.289.0

### Patch Changes

- Updated dependencies [a200a5c]
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
  - @cosmicdrift/kumiko-dev-server@0.289.0
  - @cosmicdrift/kumiko-framework@0.289.0
  - @cosmicdrift/kumiko-server-runtime@0.289.0

## 0.288.0

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.288.0
- @cosmicdrift/kumiko-server-runtime@0.288.0
- @cosmicdrift/kumiko-framework@0.288.0

## 0.287.0

### Patch Changes

- Updated dependencies [3489874]
- Updated dependencies [76f2631]
  - @cosmicdrift/kumiko-framework@0.287.0
  - @cosmicdrift/kumiko-dev-server@0.287.0
  - @cosmicdrift/kumiko-server-runtime@0.287.0

## 0.286.0

### Patch Changes

- Updated dependencies [1f7ab5d]
  - @cosmicdrift/kumiko-server-runtime@0.286.0
  - @cosmicdrift/kumiko-framework@0.286.0
  - @cosmicdrift/kumiko-dev-server@0.286.0

## 0.285.2

### Patch Changes

- Updated dependencies [9c28242]
  - @cosmicdrift/kumiko-framework@0.285.2
  - @cosmicdrift/kumiko-dev-server@0.285.2
  - @cosmicdrift/kumiko-server-runtime@0.285.2

## 0.285.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.285.1
- @cosmicdrift/kumiko-dev-server@0.285.1
- @cosmicdrift/kumiko-server-runtime@0.285.1

## 0.285.0

### Patch Changes

- Updated dependencies [8ee38b3]
  - @cosmicdrift/kumiko-framework@0.285.0
  - @cosmicdrift/kumiko-dev-server@0.285.0
  - @cosmicdrift/kumiko-server-runtime@0.285.0

## 0.284.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.284.0
- @cosmicdrift/kumiko-dev-server@0.284.0
- @cosmicdrift/kumiko-server-runtime@0.284.0

## 0.283.0

### Patch Changes

- Updated dependencies [45f7641]
  - @cosmicdrift/kumiko-framework@0.283.0
  - @cosmicdrift/kumiko-dev-server@0.283.0
  - @cosmicdrift/kumiko-server-runtime@0.283.0

## 0.282.0

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.282.0
- @cosmicdrift/kumiko-server-runtime@0.282.0
- @cosmicdrift/kumiko-framework@0.282.0

## 0.281.0

### Patch Changes

- Updated dependencies [8de23a7]
- Updated dependencies [7ae9256]
- Updated dependencies [7bf2e5e]
- Updated dependencies [f1dc700]
  - @cosmicdrift/kumiko-framework@0.281.0
  - @cosmicdrift/kumiko-dev-server@0.281.0
  - @cosmicdrift/kumiko-server-runtime@0.281.0

## 0.5.10

### Patch Changes

- Updated dependencies [fae19a6]
  - @cosmicdrift/kumiko-framework@0.280.0
  - @cosmicdrift/kumiko-dev-server@0.280.0
  - @cosmicdrift/kumiko-server-runtime@0.280.0

## 0.5.9

### Patch Changes

- Updated dependencies [e55f357]
  - @cosmicdrift/kumiko-framework@0.279.0
  - @cosmicdrift/kumiko-dev-server@0.279.0
  - @cosmicdrift/kumiko-server-runtime@0.279.0

## 0.5.8

### Patch Changes

- Updated dependencies [3e1eb25]
- Updated dependencies [17dcac1]
  - @cosmicdrift/kumiko-framework@0.278.0
  - @cosmicdrift/kumiko-dev-server@0.278.0
  - @cosmicdrift/kumiko-server-runtime@0.278.0

## 0.5.7

### Patch Changes

- Updated dependencies [411e80b]
  - @cosmicdrift/kumiko-framework@0.277.0
  - @cosmicdrift/kumiko-dev-server@0.277.0
  - @cosmicdrift/kumiko-server-runtime@0.277.0

## 0.5.6

### Patch Changes

- Updated dependencies [e2312ee]
  - @cosmicdrift/kumiko-framework@0.276.0
  - @cosmicdrift/kumiko-dev-server@0.276.0
  - @cosmicdrift/kumiko-server-runtime@0.276.0

## 0.5.5

### Patch Changes

- Updated dependencies [2cb61dd]
- Updated dependencies [9d9a462]
  - @cosmicdrift/kumiko-framework@0.275.0
  - @cosmicdrift/kumiko-dev-server@0.275.0
  - @cosmicdrift/kumiko-server-runtime@0.275.0

## 0.5.4

### Patch Changes

- Updated dependencies [47070b6]
- Updated dependencies [282072a]
  - @cosmicdrift/kumiko-framework@0.274.0
  - @cosmicdrift/kumiko-dev-server@0.274.0
  - @cosmicdrift/kumiko-server-runtime@0.274.0

## 0.5.3

### Patch Changes

- Updated dependencies [e9d3944]
- Updated dependencies [01c9133]
  - @cosmicdrift/kumiko-framework@0.273.0
  - @cosmicdrift/kumiko-dev-server@0.273.0
  - @cosmicdrift/kumiko-server-runtime@0.273.0

## 0.5.2

### Patch Changes

- Updated dependencies [147fb82]
- Updated dependencies [6c55fa2]
- Updated dependencies [94812d3]
- Updated dependencies [7bf4309]
  - @cosmicdrift/kumiko-framework@0.272.0
  - @cosmicdrift/kumiko-dev-server@0.272.0
  - @cosmicdrift/kumiko-server-runtime@0.272.0

## 0.5.1

### Patch Changes

- Updated dependencies [94b9d44]
- Updated dependencies [c704c75]
- Updated dependencies [60ed7ed]
- Updated dependencies [c704c75]
- Updated dependencies [5f8be0d]
  - @cosmicdrift/kumiko-framework@0.271.0
  - @cosmicdrift/kumiko-server-runtime@0.271.0
  - @cosmicdrift/kumiko-dev-server@0.271.0

## 0.5.0

### Minor Changes

- dba0a60: `openToAll: true` is removed from `OpenToAllAccessRule` — every `openToAll` grant now requires `{ reason: string }`. `isOpenToAllGranted` denies a bare `true` reaching it from an untyped source (pattern JSON, Designer) the same way it already denied a malformed object. The boot validator rejects an untyped `openToAll: true` access declaration with an error pointing at `{ reason }`. The pattern-library Designer access field is now a required text input on `access.openToAll.reason` instead of a boolean toggle. `build-config-feature-schema.ts` synthesizes `{ openToAll: { reason: "..." } }` (instead of `{ openToAll: true }`) for a config key whose roles include `"all"`. `boot-validator/nav.ts` and `renderer-web/app/create-app.tsx` switched from `"openToAll" in access` to `isOpenToAllGranted(access)`. The feature-AST extractor now also extracts `escapeHatch: { reason }` on write/query handlers and on `r.hook` options.

  New codemod `scripts/codemod/migrate-open-to-all.ts` rewrites `openToAll: true` to `openToAll: { reason }` in test files and reports every non-test site for a manual reason.

### Patch Changes

- Updated dependencies [dba0a60]
  - @cosmicdrift/kumiko-framework@0.270.0
  - @cosmicdrift/kumiko-dev-server@0.270.0
  - @cosmicdrift/kumiko-server-runtime@0.270.0

## 0.4.314

### Patch Changes

- Updated dependencies [3d58c23]
  - @cosmicdrift/kumiko-framework@0.269.2
  - @cosmicdrift/kumiko-dev-server@0.269.2
  - @cosmicdrift/kumiko-server-runtime@0.269.2

## 0.4.313

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.269.1
- @cosmicdrift/kumiko-server-runtime@0.269.1
- @cosmicdrift/kumiko-framework@0.269.1

## 0.4.312

### Patch Changes

- Updated dependencies [ec9aaca]
- Updated dependencies [8412e09]
  - @cosmicdrift/kumiko-framework@0.269.0
  - @cosmicdrift/kumiko-dev-server@0.269.0
  - @cosmicdrift/kumiko-server-runtime@0.269.0

## 0.4.311

### Patch Changes

- Updated dependencies [b16457a]
  - @cosmicdrift/kumiko-framework@0.268.0
  - @cosmicdrift/kumiko-dev-server@0.268.0
  - @cosmicdrift/kumiko-server-runtime@0.268.0

## 0.4.310

### Patch Changes

- Updated dependencies [e87ab51]
  - @cosmicdrift/kumiko-framework@0.267.0
  - @cosmicdrift/kumiko-dev-server@0.267.0
  - @cosmicdrift/kumiko-server-runtime@0.267.0

## 0.4.309

### Patch Changes

- Updated dependencies [4d36b68]
  - @cosmicdrift/kumiko-framework@0.266.0
  - @cosmicdrift/kumiko-dev-server@0.266.0
  - @cosmicdrift/kumiko-server-runtime@0.266.0

## 0.4.308

### Patch Changes

- Updated dependencies [371a263]
  - @cosmicdrift/kumiko-framework@0.265.0
  - @cosmicdrift/kumiko-dev-server@0.265.0
  - @cosmicdrift/kumiko-server-runtime@0.265.0

## 0.4.307

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.264.1
- @cosmicdrift/kumiko-server-runtime@0.264.1
- @cosmicdrift/kumiko-framework@0.264.1

## 0.4.306

### Patch Changes

- Updated dependencies [d0184f7]
  - @cosmicdrift/kumiko-framework@0.264.0
  - @cosmicdrift/kumiko-dev-server@0.264.0
  - @cosmicdrift/kumiko-server-runtime@0.264.0

## 0.4.305

### Patch Changes

- Updated dependencies [cd255ca]
- Updated dependencies [f6732fa]
  - @cosmicdrift/kumiko-framework@0.263.0
  - @cosmicdrift/kumiko-dev-server@0.263.0
  - @cosmicdrift/kumiko-server-runtime@0.263.0

## 0.4.304

### Patch Changes

- Updated dependencies [6fbede9]
  - @cosmicdrift/kumiko-framework@0.262.0
  - @cosmicdrift/kumiko-dev-server@0.262.0
  - @cosmicdrift/kumiko-server-runtime@0.262.0

## 0.4.303

### Patch Changes

- Updated dependencies [5139a3f]
  - @cosmicdrift/kumiko-framework@0.261.0
  - @cosmicdrift/kumiko-dev-server@0.261.0
  - @cosmicdrift/kumiko-server-runtime@0.261.0

## 0.4.302

### Patch Changes

- Updated dependencies [71b9c4b]
  - @cosmicdrift/kumiko-framework@0.260.0
  - @cosmicdrift/kumiko-dev-server@0.260.0
  - @cosmicdrift/kumiko-server-runtime@0.260.0

## 0.4.301

### Patch Changes

- Updated dependencies [20dc41a]
  - @cosmicdrift/kumiko-framework@0.259.0
  - @cosmicdrift/kumiko-dev-server@0.259.0
  - @cosmicdrift/kumiko-server-runtime@0.259.0

## 0.4.300

### Patch Changes

- Updated dependencies [3c6c428]
  - @cosmicdrift/kumiko-framework@0.258.1
  - @cosmicdrift/kumiko-dev-server@0.258.1
  - @cosmicdrift/kumiko-server-runtime@0.258.1

## 0.4.299

### Patch Changes

- Updated dependencies [f2e57b4]
- Updated dependencies [c1b53a3]
- Updated dependencies [27166cb]
  - @cosmicdrift/kumiko-framework@0.258.0
  - @cosmicdrift/kumiko-dev-server@0.258.0
  - @cosmicdrift/kumiko-server-runtime@0.258.0

## 0.4.298

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.257.0
- @cosmicdrift/kumiko-server-runtime@0.257.0
- @cosmicdrift/kumiko-framework@0.257.0

## 0.4.297

### Patch Changes

- Updated dependencies [586d707]
  - @cosmicdrift/kumiko-framework@0.256.0
  - @cosmicdrift/kumiko-dev-server@0.256.0
  - @cosmicdrift/kumiko-server-runtime@0.256.0

## 0.4.296

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.255.2
- @cosmicdrift/kumiko-server-runtime@0.255.2
- @cosmicdrift/kumiko-framework@0.255.2

## 0.4.295

### Patch Changes

- Updated dependencies [5b04527]
  - @cosmicdrift/kumiko-framework@0.255.1
  - @cosmicdrift/kumiko-dev-server@0.255.1
  - @cosmicdrift/kumiko-server-runtime@0.255.1

## 0.4.294

### Patch Changes

- Updated dependencies [88530a2]
- Updated dependencies [0374846]
- Updated dependencies [1212eeb]
- Updated dependencies [7003472]
  - @cosmicdrift/kumiko-framework@0.255.0
  - @cosmicdrift/kumiko-dev-server@0.255.0
  - @cosmicdrift/kumiko-server-runtime@0.255.0

## 0.4.293

### Patch Changes

- Updated dependencies [9b74bc9]
  - @cosmicdrift/kumiko-framework@0.254.0
  - @cosmicdrift/kumiko-dev-server@0.254.0
  - @cosmicdrift/kumiko-server-runtime@0.254.0

## 0.4.292

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.253.0
- @cosmicdrift/kumiko-server-runtime@0.253.0
- @cosmicdrift/kumiko-framework@0.253.0

## 0.4.291

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.252.1
- @cosmicdrift/kumiko-server-runtime@0.252.1
- @cosmicdrift/kumiko-framework@0.252.1

## 0.4.290

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.252.0
- @cosmicdrift/kumiko-server-runtime@0.252.0
- @cosmicdrift/kumiko-framework@0.252.0

## 0.4.289

### Patch Changes

- Updated dependencies [55691fd]
- Updated dependencies [28ad1f3]
  - @cosmicdrift/kumiko-framework@0.251.0
  - @cosmicdrift/kumiko-dev-server@0.251.0
  - @cosmicdrift/kumiko-server-runtime@0.251.0

## 0.4.288

### Patch Changes

- Updated dependencies [86e18dd]
- Updated dependencies [a4a25ee]
- Updated dependencies [e349f03]
- Updated dependencies [0be08d9]
- Updated dependencies [d9f9337]
- Updated dependencies [5c1c606]
  - @cosmicdrift/kumiko-framework@0.250.0
  - @cosmicdrift/kumiko-dev-server@0.250.0
  - @cosmicdrift/kumiko-server-runtime@0.250.0

## 0.4.287

### Patch Changes

- Updated dependencies [812795d]
- Updated dependencies [14fb8a2]
  - @cosmicdrift/kumiko-framework@0.249.0
  - @cosmicdrift/kumiko-dev-server@0.249.0
  - @cosmicdrift/kumiko-server-runtime@0.249.0

## 0.4.286

### Patch Changes

- Updated dependencies [109ff0d]
  - @cosmicdrift/kumiko-framework@0.248.0
  - @cosmicdrift/kumiko-dev-server@0.248.0
  - @cosmicdrift/kumiko-server-runtime@0.248.0

## 0.4.285

### Patch Changes

- Updated dependencies [25cbdd2]
- Updated dependencies [f9f5608]
  - @cosmicdrift/kumiko-framework@0.247.0
  - @cosmicdrift/kumiko-dev-server@0.247.0
  - @cosmicdrift/kumiko-server-runtime@0.247.0

## 0.4.284

### Patch Changes

- Updated dependencies [b4d5b20]
- Updated dependencies [f2c9178]
  - @cosmicdrift/kumiko-framework@0.246.0
  - @cosmicdrift/kumiko-dev-server@0.246.0
  - @cosmicdrift/kumiko-server-runtime@0.246.0

## 0.4.283

### Patch Changes

- Updated dependencies [3359dae]
  - @cosmicdrift/kumiko-framework@0.245.0
  - @cosmicdrift/kumiko-dev-server@0.245.0
  - @cosmicdrift/kumiko-server-runtime@0.245.0

## 0.4.282

### Patch Changes

- 2cb949e: The four `agent.*` reason codes now have en/de i18n texts, so the docs generator
  stops skipping them and renders a reference page per reason instead of leaving
  the agent error pages absent. `feature-manifest.json` additionally lists
  `agent-tools`, which the use-all-bundled sample now mounts — the manifest is
  introspected from that sample, so the bundled-feature reference had no entry for
  it before.
- Updated dependencies [2cb949e]
- Updated dependencies [dc4e6a2]
  - @cosmicdrift/kumiko-framework@0.244.0
  - @cosmicdrift/kumiko-dev-server@0.244.0
  - @cosmicdrift/kumiko-server-runtime@0.244.0

## 0.4.281

### Patch Changes

- Updated dependencies [8c7b961]
  - @cosmicdrift/kumiko-dev-server@0.243.4
  - @cosmicdrift/kumiko-server-runtime@0.243.4
  - @cosmicdrift/kumiko-framework@0.243.4

## 0.4.280

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.243.3
- @cosmicdrift/kumiko-server-runtime@0.243.3
- @cosmicdrift/kumiko-framework@0.243.3

## 0.4.279

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.243.2
- @cosmicdrift/kumiko-server-runtime@0.243.2
- @cosmicdrift/kumiko-framework@0.243.2

## 0.4.278

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.243.1
- @cosmicdrift/kumiko-server-runtime@0.243.1
- @cosmicdrift/kumiko-framework@0.243.1

## 0.4.277

### Patch Changes

- Updated dependencies [349d763]
  - @cosmicdrift/kumiko-framework@0.243.0
  - @cosmicdrift/kumiko-dev-server@0.243.0
  - @cosmicdrift/kumiko-server-runtime@0.243.0

## 0.4.276

### Patch Changes

- Updated dependencies [efd5891]
  - @cosmicdrift/kumiko-framework@0.242.0
  - @cosmicdrift/kumiko-dev-server@0.242.0
  - @cosmicdrift/kumiko-server-runtime@0.242.0

## 0.4.275

### Patch Changes

- Updated dependencies [8289b69]
  - @cosmicdrift/kumiko-framework@0.241.0
  - @cosmicdrift/kumiko-dev-server@0.241.0
  - @cosmicdrift/kumiko-server-runtime@0.241.0

## 0.4.274

### Patch Changes

- Updated dependencies [db53bbc]
  - @cosmicdrift/kumiko-framework@0.240.0
  - @cosmicdrift/kumiko-dev-server@0.240.0
  - @cosmicdrift/kumiko-server-runtime@0.240.0

## 0.4.273

### Patch Changes

- Updated dependencies [2fbab3d]
  - @cosmicdrift/kumiko-framework@0.239.0
  - @cosmicdrift/kumiko-dev-server@0.239.0
  - @cosmicdrift/kumiko-server-runtime@0.239.0

## 0.4.272

### Patch Changes

- Updated dependencies [8206493]
  - @cosmicdrift/kumiko-framework@0.238.0
  - @cosmicdrift/kumiko-dev-server@0.238.0
  - @cosmicdrift/kumiko-server-runtime@0.238.0

## 0.4.271

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.237.2
- @cosmicdrift/kumiko-server-runtime@0.237.2
- @cosmicdrift/kumiko-framework@0.237.2

## 0.4.270

### Patch Changes

- Updated dependencies [da3aed4]
  - @cosmicdrift/kumiko-framework@0.237.1
  - @cosmicdrift/kumiko-dev-server@0.237.1
  - @cosmicdrift/kumiko-server-runtime@0.237.1

## 0.4.269

### Patch Changes

- 1d75c51: feature-manifest.json now lists the six auth-email-password write handlers that
  only exist when `passwordReset` / `emailVerification` / `accountUnlock` are
  configured — the use-all-bundled sample the manifest is introspected from mounts
  those branches, so `kumiko agent lint` covers them too.

## 0.4.268

### Patch Changes

- Updated dependencies [0f399c2]
- Updated dependencies [1dca3bc]
- Updated dependencies [9b2eae0]
  - @cosmicdrift/kumiko-framework@0.237.0
  - @cosmicdrift/kumiko-dev-server@0.237.0
  - @cosmicdrift/kumiko-server-runtime@0.237.0

## 0.4.267

### Patch Changes

- Updated dependencies [825acb8]
  - @cosmicdrift/kumiko-framework@0.236.1
  - @cosmicdrift/kumiko-server-runtime@0.236.1
  - @cosmicdrift/kumiko-dev-server@0.236.1

## 0.4.266

### Patch Changes

- Updated dependencies [ccad32d]
- Updated dependencies [69529cd]
- Updated dependencies [e668a62]
  - @cosmicdrift/kumiko-framework@0.236.0
  - @cosmicdrift/kumiko-dev-server@0.236.0
  - @cosmicdrift/kumiko-server-runtime@0.236.0

## 0.4.265

### Patch Changes

- Updated dependencies [c5a5dd4]
- Updated dependencies [41ef079]
  - @cosmicdrift/kumiko-framework@0.235.4
  - @cosmicdrift/kumiko-dev-server@0.235.4
  - @cosmicdrift/kumiko-server-runtime@0.235.4

## 0.4.264

### Patch Changes

- Updated dependencies [fa9a541]
  - @cosmicdrift/kumiko-framework@0.235.3
  - @cosmicdrift/kumiko-dev-server@0.235.3
  - @cosmicdrift/kumiko-server-runtime@0.235.3

## 0.4.263

### Patch Changes

- Updated dependencies [1ce74b3]
  - @cosmicdrift/kumiko-framework@0.235.2
  - @cosmicdrift/kumiko-dev-server@0.235.2
  - @cosmicdrift/kumiko-server-runtime@0.235.2

## 0.4.262

### Patch Changes

- Updated dependencies [4c83a80]
  - @cosmicdrift/kumiko-framework@0.235.1
  - @cosmicdrift/kumiko-dev-server@0.235.1
  - @cosmicdrift/kumiko-server-runtime@0.235.1

## 0.4.261

### Patch Changes

- Updated dependencies [9dc8d1c]
- Updated dependencies [38d7ffc]
- Updated dependencies [5882fb3]
  - @cosmicdrift/kumiko-framework@0.235.0
  - @cosmicdrift/kumiko-dev-server@0.235.0
  - @cosmicdrift/kumiko-server-runtime@0.235.0

## 0.4.260

### Patch Changes

- Updated dependencies [40a8143]
  - @cosmicdrift/kumiko-framework@0.234.0
  - @cosmicdrift/kumiko-dev-server@0.234.0
  - @cosmicdrift/kumiko-server-runtime@0.234.0

## 0.4.259

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.233.0
- @cosmicdrift/kumiko-server-runtime@0.233.0
- @cosmicdrift/kumiko-framework@0.233.0

## 0.4.258

### Patch Changes

- Updated dependencies [5dd1cc1]
- Updated dependencies [aeac06f]
- Updated dependencies [05bdf93]
- Updated dependencies [03a8df0]
  - @cosmicdrift/kumiko-server-runtime@0.232.0
  - @cosmicdrift/kumiko-dev-server@0.232.0
  - @cosmicdrift/kumiko-framework@0.232.0

## 0.4.257

### Patch Changes

- Updated dependencies [404d143]
- Updated dependencies [5d4c21e]
- Updated dependencies [4f4bc49]
  - @cosmicdrift/kumiko-framework@0.231.0
  - @cosmicdrift/kumiko-dev-server@0.231.0
  - @cosmicdrift/kumiko-server-runtime@0.231.0

## 0.4.256

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.230.0
- @cosmicdrift/kumiko-server-runtime@0.230.0
- @cosmicdrift/kumiko-framework@0.230.0

## 0.4.255

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.229.1
- @cosmicdrift/kumiko-server-runtime@0.229.1
- @cosmicdrift/kumiko-framework@0.229.1

## 0.4.254

### Patch Changes

- Updated dependencies [ebadd51]
  - @cosmicdrift/kumiko-framework@0.229.0
  - @cosmicdrift/kumiko-dev-server@0.229.0
  - @cosmicdrift/kumiko-server-runtime@0.229.0

## 0.4.253

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.228.0
- @cosmicdrift/kumiko-server-runtime@0.228.0
- @cosmicdrift/kumiko-framework@0.228.0

## 0.4.252

### Patch Changes

- Updated dependencies [5f157b6]
  - @cosmicdrift/kumiko-framework@0.227.0
  - @cosmicdrift/kumiko-dev-server@0.227.0
  - @cosmicdrift/kumiko-server-runtime@0.227.0

## 0.4.251

### Patch Changes

- Updated dependencies [211ff70]
- Updated dependencies [db616cb]
- Updated dependencies [bcac6f3]
- Updated dependencies [c4ed490]
  - @cosmicdrift/kumiko-framework@0.226.0
  - @cosmicdrift/kumiko-dev-server@0.226.0
  - @cosmicdrift/kumiko-server-runtime@0.226.0

## 0.4.250

### Patch Changes

- aa1a1a7: German/Spanish translations for the new `cap-overview` feature's strings, and the regenerated feature manifest (`create-kumiko-app`) that lists it as an available choice.
- Updated dependencies [aa1a1a7]
- Updated dependencies [d63b2e8]
  - @cosmicdrift/kumiko-framework@0.225.0
  - @cosmicdrift/kumiko-dev-server@0.225.0
  - @cosmicdrift/kumiko-server-runtime@0.225.0

## 0.4.249

### Patch Changes

- Updated dependencies [415ff22]
  - @cosmicdrift/kumiko-framework@0.224.2
  - @cosmicdrift/kumiko-dev-server@0.224.2
  - @cosmicdrift/kumiko-server-runtime@0.224.2

## 0.4.248

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.224.1
- @cosmicdrift/kumiko-server-runtime@0.224.1
- @cosmicdrift/kumiko-framework@0.224.1

## 0.4.247

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.224.0
- @cosmicdrift/kumiko-server-runtime@0.224.0
- @cosmicdrift/kumiko-framework@0.224.0

## 0.4.246

### Patch Changes

- Updated dependencies [c4d07f5]
  - @cosmicdrift/kumiko-framework@0.223.0
  - @cosmicdrift/kumiko-dev-server@0.223.0
  - @cosmicdrift/kumiko-server-runtime@0.223.0

## 0.4.245

### Patch Changes

- Updated dependencies [6a13c64]
- Updated dependencies [8edfaa0]
- Updated dependencies [b00604c]
- Updated dependencies [d3ec5e0]
- Updated dependencies [afceecd]
  - @cosmicdrift/kumiko-framework@0.222.0
  - @cosmicdrift/kumiko-dev-server@0.222.0
  - @cosmicdrift/kumiko-server-runtime@0.222.0

## 0.4.244

### Patch Changes

- Updated dependencies [1656ff9]
- Updated dependencies [1656ff9]
- Updated dependencies [fab31bf]
  - @cosmicdrift/kumiko-dev-server@0.221.0
  - @cosmicdrift/kumiko-framework@0.221.0
  - @cosmicdrift/kumiko-server-runtime@0.221.0

## 0.4.243

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.220.1
- @cosmicdrift/kumiko-server-runtime@0.220.1
- @cosmicdrift/kumiko-framework@0.220.1

## 0.4.242

### Patch Changes

- @cosmicdrift/kumiko-framework@0.220.0
- @cosmicdrift/kumiko-dev-server@0.220.0
- @cosmicdrift/kumiko-server-runtime@0.220.0

## 0.4.241

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.219.0
- @cosmicdrift/kumiko-server-runtime@0.219.0
- @cosmicdrift/kumiko-framework@0.219.0

## 0.4.240

### Patch Changes

- Updated dependencies [bfae2fb]
  - @cosmicdrift/kumiko-framework@0.218.0
  - @cosmicdrift/kumiko-dev-server@0.218.0
  - @cosmicdrift/kumiko-server-runtime@0.218.0

## 0.4.239

### Patch Changes

- Updated dependencies [02aadf9]
  - @cosmicdrift/kumiko-framework@0.217.0
  - @cosmicdrift/kumiko-dev-server@0.217.0
  - @cosmicdrift/kumiko-server-runtime@0.217.0

## 0.4.238

### Patch Changes

- Updated dependencies [89654bc]
  - @cosmicdrift/kumiko-framework@0.216.0
  - @cosmicdrift/kumiko-dev-server@0.216.0
  - @cosmicdrift/kumiko-server-runtime@0.216.0

## 0.4.237

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.215.7
- @cosmicdrift/kumiko-server-runtime@0.215.7
- @cosmicdrift/kumiko-framework@0.215.7

## 0.4.236

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.215.6
- @cosmicdrift/kumiko-server-runtime@0.215.6
- @cosmicdrift/kumiko-framework@0.215.6

## 0.4.235

### Patch Changes

- Updated dependencies [16454c2]
  - @cosmicdrift/kumiko-framework@0.215.5
  - @cosmicdrift/kumiko-dev-server@0.215.5
  - @cosmicdrift/kumiko-server-runtime@0.215.5

## 0.4.234

### Patch Changes

- Updated dependencies [e2a55b2]
  - @cosmicdrift/kumiko-framework@0.215.4
  - @cosmicdrift/kumiko-dev-server@0.215.4
  - @cosmicdrift/kumiko-server-runtime@0.215.4

## 0.4.233

### Patch Changes

- Updated dependencies [469ec58]
  - @cosmicdrift/kumiko-framework@0.215.3
  - @cosmicdrift/kumiko-dev-server@0.215.3
  - @cosmicdrift/kumiko-server-runtime@0.215.3

## 0.4.232

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.215.2
- @cosmicdrift/kumiko-server-runtime@0.215.2
- @cosmicdrift/kumiko-framework@0.215.2

## 0.4.231

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.215.1
- @cosmicdrift/kumiko-server-runtime@0.215.1
- @cosmicdrift/kumiko-framework@0.215.1

## 0.4.230

### Patch Changes

- Updated dependencies [5cf7f9d]
- Updated dependencies [54fa88c]
- Updated dependencies [7a7f6a9]
- Updated dependencies [2bcf3c9]
  - @cosmicdrift/kumiko-framework@0.215.0
  - @cosmicdrift/kumiko-dev-server@0.215.0
  - @cosmicdrift/kumiko-server-runtime@0.215.0

## 0.4.229

### Patch Changes

- @cosmicdrift/kumiko-framework@0.214.0
- @cosmicdrift/kumiko-dev-server@0.214.0
- @cosmicdrift/kumiko-server-runtime@0.214.0

## 0.4.228

### Patch Changes

- Updated dependencies [8e3a500]
- Updated dependencies [7ffd0f6]
- Updated dependencies [774ca7d]
  - @cosmicdrift/kumiko-server-runtime@0.213.0
  - @cosmicdrift/kumiko-framework@0.213.0
  - @cosmicdrift/kumiko-dev-server@0.213.0

## 0.4.227

### Patch Changes

- Updated dependencies [35b0005]
- Updated dependencies [d006e42]
- Updated dependencies [28fc80a]
  - @cosmicdrift/kumiko-framework@0.212.0
  - @cosmicdrift/kumiko-dev-server@0.212.0
  - @cosmicdrift/kumiko-server-runtime@0.212.0

## 0.4.226

### Patch Changes

- Updated dependencies [f38784b]
  - @cosmicdrift/kumiko-framework@0.211.0
  - @cosmicdrift/kumiko-dev-server@0.211.0
  - @cosmicdrift/kumiko-server-runtime@0.211.0

## 0.4.225

### Patch Changes

- Updated dependencies [f2e6862]
- Updated dependencies [8b4467d]
- Updated dependencies [1ba89fb]
- Updated dependencies [d85987c]
- Updated dependencies [db14e69]
  - @cosmicdrift/kumiko-framework@0.210.0
  - @cosmicdrift/kumiko-dev-server@0.210.0
  - @cosmicdrift/kumiko-server-runtime@0.210.0

## 0.4.224

### Patch Changes

- Updated dependencies [f387a20]
- Updated dependencies [2c05054]
  - @cosmicdrift/kumiko-framework@0.209.1
  - @cosmicdrift/kumiko-dev-server@0.209.1
  - @cosmicdrift/kumiko-server-runtime@0.209.1

## 0.4.223

### Patch Changes

- Updated dependencies [f707d1b]
- Updated dependencies [49662ef]
- Updated dependencies [12df48b]
- Updated dependencies [f86cf43]
- Updated dependencies [b9fdc41]
- Updated dependencies [92a5361]
  - @cosmicdrift/kumiko-framework@0.209.0
  - @cosmicdrift/kumiko-dev-server@0.209.0
  - @cosmicdrift/kumiko-server-runtime@0.209.0

## 0.4.222

### Patch Changes

- Updated dependencies [e595330]
- Updated dependencies [8087d17]
  - @cosmicdrift/kumiko-framework@0.208.3
  - @cosmicdrift/kumiko-dev-server@0.208.3
  - @cosmicdrift/kumiko-server-runtime@0.208.3

## 0.4.221

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.208.2
- @cosmicdrift/kumiko-server-runtime@0.208.2
- @cosmicdrift/kumiko-framework@0.208.2

## 0.4.220

### Patch Changes

- Updated dependencies [f538bc0]
  - @cosmicdrift/kumiko-framework@0.208.1
  - @cosmicdrift/kumiko-dev-server@0.208.1
  - @cosmicdrift/kumiko-server-runtime@0.208.1

## 0.4.219

### Patch Changes

- Updated dependencies [025c5b9]
  - @cosmicdrift/kumiko-framework@0.208.0
  - @cosmicdrift/kumiko-dev-server@0.208.0
  - @cosmicdrift/kumiko-server-runtime@0.208.0

## 0.4.218

### Patch Changes

- Updated dependencies [dec6fd7]
  - @cosmicdrift/kumiko-dev-server@0.207.0
  - @cosmicdrift/kumiko-server-runtime@0.207.0
  - @cosmicdrift/kumiko-framework@0.207.0

## 0.4.217

### Patch Changes

- Updated dependencies [d60cb15]
  - @cosmicdrift/kumiko-framework@0.206.0
  - @cosmicdrift/kumiko-dev-server@0.206.0
  - @cosmicdrift/kumiko-server-runtime@0.206.0

## 0.4.216

### Patch Changes

- Updated dependencies [6e7f20b]
  - @cosmicdrift/kumiko-framework@0.205.0
  - @cosmicdrift/kumiko-dev-server@0.205.0
  - @cosmicdrift/kumiko-server-runtime@0.205.0

## 0.4.215

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.204.1
- @cosmicdrift/kumiko-server-runtime@0.204.1
- @cosmicdrift/kumiko-framework@0.204.1

## 0.4.214

### Patch Changes

- Updated dependencies [0d53fbd]
  - @cosmicdrift/kumiko-framework@0.204.0
  - @cosmicdrift/kumiko-dev-server@0.204.0
  - @cosmicdrift/kumiko-server-runtime@0.204.0

## 0.4.213

### Patch Changes

- Updated dependencies [29e46a9]
- Updated dependencies [437d3fb]
- Updated dependencies [75a8fd7]
  - @cosmicdrift/kumiko-framework@0.203.0
  - @cosmicdrift/kumiko-dev-server@0.203.0
  - @cosmicdrift/kumiko-server-runtime@0.203.0

## 0.4.212

### Patch Changes

- Updated dependencies [b1e2e56]
- Updated dependencies [e984211]
- Updated dependencies [9d350a6]
- Updated dependencies [e91d4cb]
- Updated dependencies [d41d75c]
- Updated dependencies [40f9cfd]
  - @cosmicdrift/kumiko-framework@0.202.0
  - @cosmicdrift/kumiko-server-runtime@0.202.0
  - @cosmicdrift/kumiko-dev-server@0.202.0

## 0.4.211

### Patch Changes

- Updated dependencies [0904138]
- Updated dependencies [aa3f669]
- Updated dependencies [7d75f1b]
  - @cosmicdrift/kumiko-framework@0.201.0
  - @cosmicdrift/kumiko-dev-server@0.201.0
  - @cosmicdrift/kumiko-server-runtime@0.201.0

## 0.4.210

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.200.1
- @cosmicdrift/kumiko-server-runtime@0.200.1
- @cosmicdrift/kumiko-framework@0.200.1

## 0.4.209

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.200.0
- @cosmicdrift/kumiko-server-runtime@0.200.0
- @cosmicdrift/kumiko-framework@0.200.0

## 0.4.208

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.199.2
- @cosmicdrift/kumiko-server-runtime@0.199.2
- @cosmicdrift/kumiko-framework@0.199.2

## 0.4.207

### Patch Changes

- Updated dependencies [8e7b495]
  - @cosmicdrift/kumiko-framework@0.199.1
  - @cosmicdrift/kumiko-dev-server@0.199.1
  - @cosmicdrift/kumiko-server-runtime@0.199.1

## 0.4.206

### Patch Changes

- Updated dependencies [7dd7d05]
- Updated dependencies [df2db70]
- Updated dependencies [8485e63]
  - @cosmicdrift/kumiko-framework@0.199.0
  - @cosmicdrift/kumiko-dev-server@0.199.0
  - @cosmicdrift/kumiko-server-runtime@0.199.0

## 0.4.205

### Patch Changes

- Updated dependencies [b925dea]
- Updated dependencies [89ebe92]
- Updated dependencies [e3504b5]
- Updated dependencies [72eae1d]
- Updated dependencies [80d03ba]
  - @cosmicdrift/kumiko-framework@0.198.0
  - @cosmicdrift/kumiko-server-runtime@0.198.0
  - @cosmicdrift/kumiko-dev-server@0.198.0

## 0.4.204

### Patch Changes

- Updated dependencies [a8e33c8]
- Updated dependencies [66c1283]
  - @cosmicdrift/kumiko-framework@0.197.1
  - @cosmicdrift/kumiko-dev-server@0.197.1
  - @cosmicdrift/kumiko-server-runtime@0.197.1

## 0.4.203

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.197.0
- @cosmicdrift/kumiko-server-runtime@0.197.0
- @cosmicdrift/kumiko-framework@0.197.0

## 0.4.202

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.196.1
- @cosmicdrift/kumiko-server-runtime@0.196.1
- @cosmicdrift/kumiko-framework@0.196.1

## 0.4.201

### Patch Changes

- Updated dependencies [af7686d]
  - @cosmicdrift/kumiko-dev-server@0.196.0
  - @cosmicdrift/kumiko-server-runtime@0.196.0
  - @cosmicdrift/kumiko-framework@0.196.0

## 0.4.200

### Patch Changes

- Updated dependencies [49538eb]
- Updated dependencies [49538eb]
  - @cosmicdrift/kumiko-framework@0.195.0
  - @cosmicdrift/kumiko-server-runtime@0.195.0
  - @cosmicdrift/kumiko-dev-server@0.195.0

## 0.4.199

### Patch Changes

- 2b1b089: The generated feature manifest's `template-resolver` description now mentions the `markdown` content format, matching the upstream fix in `@cosmicdrift/kumiko-bundled-features`.
- Updated dependencies [52b0ba6]
- Updated dependencies [2b1b089]
  - @cosmicdrift/kumiko-framework@0.194.0
  - @cosmicdrift/kumiko-server-runtime@0.194.0
  - @cosmicdrift/kumiko-dev-server@0.194.0

## 0.4.198

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.193.1
- @cosmicdrift/kumiko-server-runtime@0.193.1
- @cosmicdrift/kumiko-framework@0.193.1

## 0.4.197

### Patch Changes

- Updated dependencies [181003b]
- Updated dependencies [9100e19]
  - @cosmicdrift/kumiko-framework@0.193.0
  - @cosmicdrift/kumiko-dev-server@0.193.0
  - @cosmicdrift/kumiko-server-runtime@0.193.0

## 0.4.196

### Patch Changes

- Updated dependencies [58505c6]
  - @cosmicdrift/kumiko-dev-server@0.192.0
  - @cosmicdrift/kumiko-server-runtime@0.192.0
  - @cosmicdrift/kumiko-framework@0.192.0

## 0.4.195

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.191.0
- @cosmicdrift/kumiko-server-runtime@0.191.0
- @cosmicdrift/kumiko-framework@0.191.0

## 0.4.194

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.190.0
- @cosmicdrift/kumiko-server-runtime@0.190.0
- @cosmicdrift/kumiko-framework@0.190.0

## 0.4.193

### Patch Changes

- Updated dependencies [64c5f92]
- Updated dependencies [321b375]
- Updated dependencies [5137ce5]
- Updated dependencies [833c4f7]
- Updated dependencies [cac0d04]
  - @cosmicdrift/kumiko-framework@0.189.0
  - @cosmicdrift/kumiko-dev-server@0.189.0
  - @cosmicdrift/kumiko-server-runtime@0.189.0

## 0.4.192

### Patch Changes

- Updated dependencies [e55c957]
- Updated dependencies [a9b8343]
- Updated dependencies [5ca5131]
  - @cosmicdrift/kumiko-framework@0.188.0
  - @cosmicdrift/kumiko-dev-server@0.188.0
  - @cosmicdrift/kumiko-server-runtime@0.188.0

## 0.4.191

### Patch Changes

- Updated dependencies [1246ec0]
  - @cosmicdrift/kumiko-framework@0.187.0
  - @cosmicdrift/kumiko-dev-server@0.187.0
  - @cosmicdrift/kumiko-server-runtime@0.187.0

## 0.4.190

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.186.3
- @cosmicdrift/kumiko-server-runtime@0.186.3
- @cosmicdrift/kumiko-framework@0.186.3

## 0.4.189

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.186.2
- @cosmicdrift/kumiko-server-runtime@0.186.2
- @cosmicdrift/kumiko-framework@0.186.2

## 0.4.188

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.186.1
- @cosmicdrift/kumiko-server-runtime@0.186.1
- @cosmicdrift/kumiko-framework@0.186.1

## 0.4.187

### Patch Changes

- Updated dependencies [9aeb008]
  - @cosmicdrift/kumiko-framework@0.186.0
  - @cosmicdrift/kumiko-dev-server@0.186.0
  - @cosmicdrift/kumiko-server-runtime@0.186.0

## 0.4.186

### Patch Changes

- Updated dependencies [0a059a0]
- Updated dependencies [43e0291]
- Updated dependencies [3d1a0dd]
- Updated dependencies [c57e2be]
- Updated dependencies [18c7fc1]
  - @cosmicdrift/kumiko-framework@0.185.0
  - @cosmicdrift/kumiko-dev-server@0.185.0
  - @cosmicdrift/kumiko-server-runtime@0.185.0

## 0.4.185

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.184.0
- @cosmicdrift/kumiko-server-runtime@0.184.0
- @cosmicdrift/kumiko-framework@0.184.0

## 0.4.184

### Patch Changes

- Updated dependencies [92c7948]
  - @cosmicdrift/kumiko-framework@0.183.2
  - @cosmicdrift/kumiko-dev-server@0.183.2
  - @cosmicdrift/kumiko-server-runtime@0.183.2

## 0.4.183

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.183.1
- @cosmicdrift/kumiko-server-runtime@0.183.1
- @cosmicdrift/kumiko-framework@0.183.1

## 0.4.182

### Patch Changes

- Updated dependencies [4fecbb5]
- Updated dependencies [b54a9e0]
  - @cosmicdrift/kumiko-dev-server@0.183.0
  - @cosmicdrift/kumiko-framework@0.183.0
  - @cosmicdrift/kumiko-server-runtime@0.183.0

## 0.4.181

### Patch Changes

- Updated dependencies [958df88]
  - @cosmicdrift/kumiko-framework@0.182.1
  - @cosmicdrift/kumiko-dev-server@0.182.1
  - @cosmicdrift/kumiko-server-runtime@0.182.1

## 0.4.180

### Patch Changes

- Updated dependencies [8a3b0a9]
- Updated dependencies [9344050]
- Updated dependencies [0a50d9c]
  - @cosmicdrift/kumiko-framework@0.182.0
  - @cosmicdrift/kumiko-dev-server@0.182.0
  - @cosmicdrift/kumiko-server-runtime@0.182.0

## 0.4.179

### Patch Changes

- Updated dependencies [fda4dc6]
- Updated dependencies [758cc7c]
  - @cosmicdrift/kumiko-framework@0.181.0
  - @cosmicdrift/kumiko-dev-server@0.181.0
  - @cosmicdrift/kumiko-server-runtime@0.181.0

## 0.4.178

### Patch Changes

- Updated dependencies [85102ca]
  - @cosmicdrift/kumiko-framework@0.180.0
  - @cosmicdrift/kumiko-dev-server@0.180.0
  - @cosmicdrift/kumiko-server-runtime@0.180.0

## 0.4.177

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.179.0
- @cosmicdrift/kumiko-server-runtime@0.179.0
- @cosmicdrift/kumiko-framework@0.179.0

## 0.4.176

### Patch Changes

- Updated dependencies [9400ec1]
  - @cosmicdrift/kumiko-framework@0.178.1
  - @cosmicdrift/kumiko-dev-server@0.178.1
  - @cosmicdrift/kumiko-server-runtime@0.178.1

## 0.4.175

### Patch Changes

- Updated dependencies [52753b6]
  - @cosmicdrift/kumiko-framework@0.178.0
  - @cosmicdrift/kumiko-dev-server@0.178.0
  - @cosmicdrift/kumiko-server-runtime@0.178.0

## 0.4.174

### Patch Changes

- Updated dependencies [f49afdc]
  - @cosmicdrift/kumiko-framework@0.177.0
  - @cosmicdrift/kumiko-dev-server@0.177.0
  - @cosmicdrift/kumiko-server-runtime@0.177.0

## 0.4.173

### Patch Changes

- Updated dependencies [63b6acf]
  - @cosmicdrift/kumiko-framework@0.176.2
  - @cosmicdrift/kumiko-server-runtime@0.176.2
  - @cosmicdrift/kumiko-dev-server@0.176.2

## 0.4.172

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.176.1
- @cosmicdrift/kumiko-server-runtime@0.176.1
- @cosmicdrift/kumiko-framework@0.176.1

## 0.4.171

### Patch Changes

- Updated dependencies [90ceb78]
  - @cosmicdrift/kumiko-framework@0.176.0
  - @cosmicdrift/kumiko-dev-server@0.176.0
  - @cosmicdrift/kumiko-server-runtime@0.176.0

## 0.4.170

### Patch Changes

- Updated dependencies [bc1377e]
  - @cosmicdrift/kumiko-server-runtime@0.175.0
  - @cosmicdrift/kumiko-dev-server@0.175.0
  - @cosmicdrift/kumiko-framework@0.175.0

## 0.4.169

### Patch Changes

- Updated dependencies [de0da71]
- Updated dependencies [f5da76a]
- Updated dependencies [50b7d0c]
  - @cosmicdrift/kumiko-framework@0.174.1
  - @cosmicdrift/kumiko-dev-server@0.174.1
  - @cosmicdrift/kumiko-server-runtime@0.174.1

## 0.4.168

### Patch Changes

- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
  - @cosmicdrift/kumiko-framework@0.174.0
  - @cosmicdrift/kumiko-dev-server@0.174.0
  - @cosmicdrift/kumiko-server-runtime@0.174.0

## 0.4.167

### Patch Changes

- Updated dependencies [f23aa36]
- Updated dependencies [f23aa36]
  - @cosmicdrift/kumiko-framework@0.173.1
  - @cosmicdrift/kumiko-dev-server@0.173.1
  - @cosmicdrift/kumiko-server-runtime@0.173.1

## 0.4.166

### Patch Changes

- Updated dependencies [20dfb78]
- Updated dependencies [ffce47c]
  - @cosmicdrift/kumiko-framework@0.173.0
  - @cosmicdrift/kumiko-dev-server@0.173.0
  - @cosmicdrift/kumiko-server-runtime@0.173.0

## 0.4.165

### Patch Changes

- Updated dependencies [1fcdfc5]
  - @cosmicdrift/kumiko-framework@0.172.0
  - @cosmicdrift/kumiko-dev-server@0.172.0
  - @cosmicdrift/kumiko-server-runtime@0.172.0

## 0.4.164

### Patch Changes

- @cosmicdrift/kumiko-framework@0.171.2
- @cosmicdrift/kumiko-dev-server@0.171.2
- @cosmicdrift/kumiko-server-runtime@0.171.2

## 0.4.163

### Patch Changes

- Updated dependencies [07b9c04]
- Updated dependencies [f8261c1]
- Updated dependencies [74a0fb3]
  - @cosmicdrift/kumiko-framework@0.171.1
  - @cosmicdrift/kumiko-dev-server@0.171.1
  - @cosmicdrift/kumiko-server-runtime@0.171.1

## 0.4.162

### Patch Changes

- Updated dependencies [d125a49]
- Updated dependencies [32123ff]
- Updated dependencies [716acd6]
- Updated dependencies [9cc21ed]
- Updated dependencies [c284d61]
  - @cosmicdrift/kumiko-framework@0.171.0
  - @cosmicdrift/kumiko-dev-server@0.171.0
  - @cosmicdrift/kumiko-server-runtime@0.171.0

## 0.4.161

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.170.0
- @cosmicdrift/kumiko-server-runtime@0.170.0
- @cosmicdrift/kumiko-framework@0.170.0

## 0.4.160

### Patch Changes

- Updated dependencies [644274a]
  - @cosmicdrift/kumiko-framework@0.169.0
  - @cosmicdrift/kumiko-dev-server@0.169.0
  - @cosmicdrift/kumiko-server-runtime@0.169.0

## 0.4.159

### Patch Changes

- Updated dependencies [4c7d3c9]
- Updated dependencies [fecbfe3]
- Updated dependencies [d149bab]
  - @cosmicdrift/kumiko-framework@0.168.0
  - @cosmicdrift/kumiko-dev-server@0.168.0
  - @cosmicdrift/kumiko-server-runtime@0.168.0

## 0.4.158

### Patch Changes

- Updated dependencies [49eb6df]
- Updated dependencies [cf5302a]
  - @cosmicdrift/kumiko-server-runtime@0.167.1
  - @cosmicdrift/kumiko-dev-server@0.167.1
  - @cosmicdrift/kumiko-framework@0.167.1

## 0.4.157

### Patch Changes

- Updated dependencies [57c1da2]
- Updated dependencies [ce30a2c]
- Updated dependencies [6ed2e5d]
  - @cosmicdrift/kumiko-framework@0.167.0
  - @cosmicdrift/kumiko-dev-server@0.167.0
  - @cosmicdrift/kumiko-server-runtime@0.167.0

## 0.4.156

### Patch Changes

- Updated dependencies [8b20a77]
- Updated dependencies [760b2eb]
- Updated dependencies [6679e45]
  - @cosmicdrift/kumiko-framework@0.166.0
  - @cosmicdrift/kumiko-dev-server@0.166.0
  - @cosmicdrift/kumiko-server-runtime@0.166.0

## 0.4.155

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.165.4
- @cosmicdrift/kumiko-server-runtime@0.165.4
- @cosmicdrift/kumiko-framework@0.165.4

## 0.4.154

### Patch Changes

- Updated dependencies [e4a0b9b]
  - @cosmicdrift/kumiko-framework@0.165.3
  - @cosmicdrift/kumiko-dev-server@0.165.3
  - @cosmicdrift/kumiko-server-runtime@0.165.3

## 0.4.153

### Patch Changes

- Updated dependencies [ed36555]
  - @cosmicdrift/kumiko-framework@0.165.2
  - @cosmicdrift/kumiko-dev-server@0.165.2
  - @cosmicdrift/kumiko-server-runtime@0.165.2

## 0.4.152

### Patch Changes

- Updated dependencies [4193ec6]
- Updated dependencies [e92295d]
  - @cosmicdrift/kumiko-framework@0.165.1
  - @cosmicdrift/kumiko-dev-server@0.165.1
  - @cosmicdrift/kumiko-server-runtime@0.165.1

## 0.4.151

### Patch Changes

- Updated dependencies [c58f20f]
- Updated dependencies [eb856c6]
  - @cosmicdrift/kumiko-framework@2.0.0
  - @cosmicdrift/kumiko-dev-server@2.0.0
  - @cosmicdrift/kumiko-server-runtime@2.0.0

## 0.4.150

### Patch Changes

- Updated dependencies [53f83f5]
  - @cosmicdrift/kumiko-framework@1.0.0
  - @cosmicdrift/kumiko-dev-server@1.0.0
  - @cosmicdrift/kumiko-server-runtime@1.0.0

## 0.4.149

### Patch Changes

- Updated dependencies [cf56745]
  - @cosmicdrift/kumiko-framework@0.165.0
  - @cosmicdrift/kumiko-dev-server@0.165.0
  - @cosmicdrift/kumiko-server-runtime@0.165.0

## 0.4.148

### Patch Changes

- Updated dependencies [90b4221]
  - @cosmicdrift/kumiko-framework@0.164.0
  - @cosmicdrift/kumiko-dev-server@0.164.0
  - @cosmicdrift/kumiko-server-runtime@0.164.0

## 0.4.147

### Patch Changes

- Updated dependencies [5c43259]
  - @cosmicdrift/kumiko-framework@0.163.3
  - @cosmicdrift/kumiko-dev-server@0.163.3
  - @cosmicdrift/kumiko-server-runtime@0.163.3

## 0.4.146

### Patch Changes

- Updated dependencies [5dc5290]
  - @cosmicdrift/kumiko-framework@0.163.2
  - @cosmicdrift/kumiko-dev-server@0.163.2
  - @cosmicdrift/kumiko-server-runtime@0.163.2

## 0.4.145

### Patch Changes

- Updated dependencies [75174f6]
  - @cosmicdrift/kumiko-server-runtime@0.163.1
  - @cosmicdrift/kumiko-dev-server@0.163.1
  - @cosmicdrift/kumiko-framework@0.163.1

## 0.4.144

### Patch Changes

- Updated dependencies [dc76328]
  - @cosmicdrift/kumiko-framework@0.163.0
  - @cosmicdrift/kumiko-dev-server@0.163.0
  - @cosmicdrift/kumiko-server-runtime@0.163.0

## 0.4.143

### Patch Changes

- Updated dependencies [08abac2]
  - @cosmicdrift/kumiko-framework@0.162.0
  - @cosmicdrift/kumiko-dev-server@0.162.0
  - @cosmicdrift/kumiko-server-runtime@0.162.0

## 0.4.142

### Patch Changes

- Updated dependencies [c7ac572]
- Updated dependencies [5eb3aa4]
  - @cosmicdrift/kumiko-framework@0.161.0
  - @cosmicdrift/kumiko-server-runtime@0.161.0
  - @cosmicdrift/kumiko-dev-server@0.161.0

## 0.4.141

### Patch Changes

- Updated dependencies [d3e815c]
  - @cosmicdrift/kumiko-framework@0.160.0
  - @cosmicdrift/kumiko-dev-server@0.160.0
  - @cosmicdrift/kumiko-server-runtime@0.160.0

## 0.4.140

### Patch Changes

- Updated dependencies [6d37eb5]
  - @cosmicdrift/kumiko-framework@0.159.1
  - @cosmicdrift/kumiko-dev-server@0.159.1
  - @cosmicdrift/kumiko-server-runtime@0.159.1

## 0.4.139

### Patch Changes

- Updated dependencies [9db805c]
- Updated dependencies [d0280c8]
- Updated dependencies [a997cc8]
- Updated dependencies [d97fcda]
- Updated dependencies [aa52aa1]
- Updated dependencies [2fc542b]
- Updated dependencies [6254cc8]
  - @cosmicdrift/kumiko-framework@1.0.0
  - @cosmicdrift/kumiko-server-runtime@1.0.0
  - @cosmicdrift/kumiko-dev-server@1.0.0

## 0.4.138

### Patch Changes

- Updated dependencies [c6487d0]
  - @cosmicdrift/kumiko-server-runtime@0.158.2
  - @cosmicdrift/kumiko-dev-server@0.158.2
  - @cosmicdrift/kumiko-framework@0.158.2

## 0.4.137

### Patch Changes

- Updated dependencies [da816ee]
  - @cosmicdrift/kumiko-framework@0.158.1
  - @cosmicdrift/kumiko-server-runtime@0.158.1
  - @cosmicdrift/kumiko-dev-server@0.158.1

## 0.4.136

### Patch Changes

- Updated dependencies [7d230f2]
  - @cosmicdrift/kumiko-server-runtime@0.158.0
  - @cosmicdrift/kumiko-dev-server@0.158.0
  - @cosmicdrift/kumiko-framework@0.158.0

## 0.4.135

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.157.3
- @cosmicdrift/kumiko-server-runtime@0.157.3
- @cosmicdrift/kumiko-framework@0.157.3

## 0.4.134

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.157.2
- @cosmicdrift/kumiko-server-runtime@0.157.2
- @cosmicdrift/kumiko-framework@0.157.2

## 0.4.133

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.157.1
- @cosmicdrift/kumiko-server-runtime@0.157.1
- @cosmicdrift/kumiko-framework@0.157.1

## 0.4.132

### Patch Changes

- Updated dependencies [1371d8b]
  - @cosmicdrift/kumiko-framework@0.157.0
  - @cosmicdrift/kumiko-dev-server@0.157.0
  - @cosmicdrift/kumiko-server-runtime@0.157.0

## 0.4.131

### Patch Changes

- Updated dependencies [f768c8a]
  - @cosmicdrift/kumiko-framework@0.156.3
  - @cosmicdrift/kumiko-dev-server@0.156.3
  - @cosmicdrift/kumiko-server-runtime@0.156.3

## 0.4.130

### Patch Changes

- Updated dependencies [f0a76da]
- Updated dependencies [838cd4e]
  - @cosmicdrift/kumiko-dev-server@0.156.2
  - @cosmicdrift/kumiko-framework@0.156.2
  - @cosmicdrift/kumiko-server-runtime@0.156.2

## 0.4.129

### Patch Changes

- 9ec4841: Scaffolded demo `tasks` feature ships i18n keys, client translations, and list edit rowAction so `bun dev` boots on current validators.
- Updated dependencies [9ec4841]
  - @cosmicdrift/kumiko-dev-server@0.156.1
  - @cosmicdrift/kumiko-framework@0.156.1
  - @cosmicdrift/kumiko-server-runtime@0.156.1

## 0.4.128

### Patch Changes

- Updated dependencies [c7ca222]
- Updated dependencies [77ea09f]
  - @cosmicdrift/kumiko-framework@0.156.0
  - @cosmicdrift/kumiko-dev-server@0.156.0

## 0.4.127

### Patch Changes

- Updated dependencies [36e30da]
  - @cosmicdrift/kumiko-dev-server@0.155.1
  - @cosmicdrift/kumiko-framework@0.155.1

## 0.4.126

### Patch Changes

- Updated dependencies [137f31a]
  - @cosmicdrift/kumiko-framework@0.155.0
  - @cosmicdrift/kumiko-dev-server@0.155.0

## 0.4.125

### Patch Changes

- Updated dependencies [05c3e11]
  - @cosmicdrift/kumiko-framework@0.154.2
  - @cosmicdrift/kumiko-dev-server@0.154.2

## 0.4.124

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.154.1
- @cosmicdrift/kumiko-framework@0.154.1

## 0.4.123

### Patch Changes

- Updated dependencies [0d30bf7]
- Updated dependencies [e40a980]
  - @cosmicdrift/kumiko-framework@0.154.0
  - @cosmicdrift/kumiko-dev-server@0.154.0

## 0.4.122

### Patch Changes

- Updated dependencies [caed246]
  - @cosmicdrift/kumiko-dev-server@0.153.0
  - @cosmicdrift/kumiko-framework@0.153.0

## 0.4.121

### Patch Changes

- Updated dependencies [e32807e]
- Updated dependencies [3dd1f99]
  - @cosmicdrift/kumiko-framework@0.152.0
  - @cosmicdrift/kumiko-dev-server@0.152.0

## 0.4.120

### Patch Changes

- Updated dependencies [5c1dc93]
  - @cosmicdrift/kumiko-framework@0.151.1
  - @cosmicdrift/kumiko-dev-server@0.151.1

## 0.4.119

### Patch Changes

- Updated dependencies [ca4edbf]
  - @cosmicdrift/kumiko-framework@0.151.0
  - @cosmicdrift/kumiko-dev-server@0.151.0

## 0.4.118

### Patch Changes

- Updated dependencies [0e4cec9]
- Updated dependencies [aeb79fa]
  - @cosmicdrift/kumiko-framework@0.150.0
  - @cosmicdrift/kumiko-dev-server@0.150.0

## 0.4.117

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.149.2
- @cosmicdrift/kumiko-framework@0.149.2

## 0.4.116

### Patch Changes

- Updated dependencies [637b599]
  - @cosmicdrift/kumiko-framework@0.149.1
  - @cosmicdrift/kumiko-dev-server@0.149.1

## 0.4.115

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.149.0
- @cosmicdrift/kumiko-framework@0.149.0

## 0.4.114

### Patch Changes

- Updated dependencies [cb5612d]
  - @cosmicdrift/kumiko-framework@0.148.0
  - @cosmicdrift/kumiko-dev-server@0.148.0

## 0.4.113

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.147.3
- @cosmicdrift/kumiko-framework@0.147.3

## 0.4.112

### Patch Changes

- Updated dependencies [3f121df]
- Updated dependencies [dfb3c26]
- Updated dependencies [c007b76]
  - @cosmicdrift/kumiko-framework@0.147.2
  - @cosmicdrift/kumiko-dev-server@0.147.2

## 0.4.111

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.147.1
- @cosmicdrift/kumiko-framework@0.147.1

## 0.4.110

### Patch Changes

- Updated dependencies [bdc5e27]
- Updated dependencies [c93de1a]
  - @cosmicdrift/kumiko-framework@0.147.0
  - @cosmicdrift/kumiko-dev-server@0.147.0

## 0.4.109

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.146.4
- @cosmicdrift/kumiko-framework@0.146.4

## 0.4.108

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.146.3
- @cosmicdrift/kumiko-framework@0.146.3

## 0.4.107

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.146.2
- @cosmicdrift/kumiko-framework@0.146.2

## 0.4.106

### Patch Changes

- Updated dependencies [706cea7]
  - @cosmicdrift/kumiko-framework@0.146.1
  - @cosmicdrift/kumiko-dev-server@0.146.1

## 0.4.105

### Patch Changes

- Updated dependencies [b00c3ed]
  - @cosmicdrift/kumiko-framework@0.146.0
  - @cosmicdrift/kumiko-dev-server@0.146.0

## 0.4.104

### Patch Changes

- 8367193: Scaffolded apps now typecheck cleanly out of the box.

  - Add `@types/react` + `@types/react-dom` to the generated app's devDependencies (fixes ~900 TS7xxx errors from untyped React/JSX).
  - Generated `src/client.tsx` wraps `DefaultAppShell` in a local `AppShell` that supplies the required `brand` prop, so `createKumikoApp({ shell })` typechecks against the renderer signature (fixes the TS2322 "Property 'brand' is missing" errors).
  - Post-create next-steps banner is now English.

- Updated dependencies [8367193]
  - @cosmicdrift/kumiko-dev-server@0.145.1
  - @cosmicdrift/kumiko-framework@0.145.1

## 0.4.103

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.145.0
- @cosmicdrift/kumiko-framework@0.145.0

## 0.4.102

### Patch Changes

- Updated dependencies [c7d0ef8]
  - @cosmicdrift/kumiko-framework@0.144.0
  - @cosmicdrift/kumiko-dev-server@0.144.0

## 0.4.101

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.143.1
- @cosmicdrift/kumiko-framework@0.143.1

## 0.4.100

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.143.0
- @cosmicdrift/kumiko-framework@0.143.0

## 0.4.99

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.142.0
- @cosmicdrift/kumiko-framework@0.142.0

## 0.4.98

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.141.0
- @cosmicdrift/kumiko-framework@0.141.0

## 0.4.97

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.140.0
- @cosmicdrift/kumiko-framework@0.140.0

## 0.4.96

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.139.0
- @cosmicdrift/kumiko-framework@0.139.0

## 0.4.95

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.138.0
- @cosmicdrift/kumiko-framework@0.138.0

## 0.4.94

### Patch Changes

- Updated dependencies [fdd7c40]
  - @cosmicdrift/kumiko-framework@0.137.0
  - @cosmicdrift/kumiko-dev-server@0.137.0

## 0.4.93

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.136.1
- @cosmicdrift/kumiko-framework@0.136.1

## 0.4.92

### Patch Changes

- Updated dependencies [f5a7f51]
  - @cosmicdrift/kumiko-framework@0.136.0
  - @cosmicdrift/kumiko-dev-server@0.136.0

## 0.4.91

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.135.0
- @cosmicdrift/kumiko-framework@0.135.0

## 0.4.90

### Patch Changes

- Updated dependencies [9eab762]
  - @cosmicdrift/kumiko-framework@0.134.0
  - @cosmicdrift/kumiko-dev-server@0.134.0

## 0.4.89

### Patch Changes

- Updated dependencies [9521906]
  - @cosmicdrift/kumiko-framework@0.133.0
  - @cosmicdrift/kumiko-dev-server@0.133.0

## 0.4.88

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.132.0
- @cosmicdrift/kumiko-framework@0.132.0

## 0.4.87

### Patch Changes

- Updated dependencies [99008c9]
- Updated dependencies [ce77f02]
  - @cosmicdrift/kumiko-framework@0.131.0
  - @cosmicdrift/kumiko-dev-server@0.131.0

## 0.4.86

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.130.2
- @cosmicdrift/kumiko-framework@0.130.2

## 0.4.85

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.130.1
- @cosmicdrift/kumiko-framework@0.130.1

## 0.4.84

### Patch Changes

- Updated dependencies [bb715dd]
  - @cosmicdrift/kumiko-dev-server@0.130.0
  - @cosmicdrift/kumiko-framework@0.130.0

## 0.4.83

### Patch Changes

- Updated dependencies [3247676]
  - @cosmicdrift/kumiko-framework@0.129.0
  - @cosmicdrift/kumiko-dev-server@0.129.0

## 0.4.82

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.128.0
- @cosmicdrift/kumiko-framework@0.128.0

## 0.4.81

### Patch Changes

- Updated dependencies [f5d37a1]
  - @cosmicdrift/kumiko-framework@0.127.0
  - @cosmicdrift/kumiko-dev-server@0.127.0

## 0.4.80

### Patch Changes

- Updated dependencies [0c482c3]
  - @cosmicdrift/kumiko-framework@0.126.0
  - @cosmicdrift/kumiko-dev-server@0.126.0

## 0.4.79

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.125.2
- @cosmicdrift/kumiko-framework@0.125.2

## 0.4.78

### Patch Changes

- Updated dependencies [8b21e66]
  - @cosmicdrift/kumiko-dev-server@0.125.1
  - @cosmicdrift/kumiko-framework@0.125.1

## 0.4.77

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.125.0
- @cosmicdrift/kumiko-framework@0.125.0

## 0.4.76

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.124.0
- @cosmicdrift/kumiko-framework@0.124.0

## 0.4.75

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.123.3
- @cosmicdrift/kumiko-framework@0.123.3

## 0.4.74

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.123.2
- @cosmicdrift/kumiko-framework@0.123.2

## 0.4.73

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.123.1
- @cosmicdrift/kumiko-framework@0.123.1

## 0.4.72

### Patch Changes

- Updated dependencies [b0e70a7]
  - @cosmicdrift/kumiko-dev-server@0.123.0
  - @cosmicdrift/kumiko-framework@0.123.0

## 0.4.71

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.122.5
- @cosmicdrift/kumiko-framework@0.122.5

## 0.4.70

### Patch Changes

- Updated dependencies [2dd0d9e]
  - @cosmicdrift/kumiko-framework@0.122.4
  - @cosmicdrift/kumiko-dev-server@0.122.4

## 0.4.69

### Patch Changes

- Updated dependencies [1693324]
  - @cosmicdrift/kumiko-framework@0.122.3
  - @cosmicdrift/kumiko-dev-server@0.122.3

## 0.4.68

### Patch Changes

- Updated dependencies [a9a6d80]
  - @cosmicdrift/kumiko-framework@0.122.2
  - @cosmicdrift/kumiko-dev-server@0.122.2

## 0.4.67

### Patch Changes

- Updated dependencies [8665f63]
  - @cosmicdrift/kumiko-framework@0.122.1
  - @cosmicdrift/kumiko-dev-server@0.122.1

## 0.4.66

### Patch Changes

- Updated dependencies [446f933]
- Updated dependencies [e069b64]
  - @cosmicdrift/kumiko-framework@0.122.0
  - @cosmicdrift/kumiko-dev-server@0.122.0

## 0.4.65

### Patch Changes

- Updated dependencies [0af1fe1]
  - @cosmicdrift/kumiko-framework@0.121.1
  - @cosmicdrift/kumiko-dev-server@0.121.1

## 0.4.64

### Patch Changes

- Updated dependencies [b679dc1]
  - @cosmicdrift/kumiko-framework@0.121.0
  - @cosmicdrift/kumiko-dev-server@0.121.0

## 0.4.63

### Patch Changes

- Updated dependencies [29fbdc5]
- Updated dependencies [c22b711]
  - @cosmicdrift/kumiko-framework@0.120.0
  - @cosmicdrift/kumiko-dev-server@0.120.0

## 0.4.62

### Patch Changes

- Updated dependencies [b01a4d2]
- Updated dependencies [53da660]
- Updated dependencies [6ffb71e]
- Updated dependencies [02670c9]
  - @cosmicdrift/kumiko-framework@0.119.0
  - @cosmicdrift/kumiko-dev-server@0.119.0

## 0.4.61

### Patch Changes

- Updated dependencies [c5ed4f0]
  - @cosmicdrift/kumiko-framework@0.118.0
  - @cosmicdrift/kumiko-dev-server@0.118.0

## 0.4.60

### Patch Changes

- Updated dependencies [e5bae38]
  - @cosmicdrift/kumiko-framework@0.117.0
  - @cosmicdrift/kumiko-dev-server@0.117.0

## 0.4.59

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.116.1
- @cosmicdrift/kumiko-framework@0.116.1

## 0.4.58

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.116.0
- @cosmicdrift/kumiko-framework@0.116.0

## 0.4.57

### Patch Changes

- Updated dependencies [7054c74]
  - @cosmicdrift/kumiko-framework@0.115.1
  - @cosmicdrift/kumiko-dev-server@0.115.1

## 0.4.56

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.115.0
- @cosmicdrift/kumiko-framework@0.115.0

## 0.4.55

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.114.0
- @cosmicdrift/kumiko-framework@0.114.0

## 0.4.54

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.113.1
- @cosmicdrift/kumiko-framework@0.113.1

## 0.4.53

### Patch Changes

- Updated dependencies [ba5053b]
  - @cosmicdrift/kumiko-framework@0.113.0
  - @cosmicdrift/kumiko-dev-server@0.113.0

## 0.4.52

### Patch Changes

- Updated dependencies [0b9eb9a]
  - @cosmicdrift/kumiko-framework@0.112.1
  - @cosmicdrift/kumiko-dev-server@0.112.1

## 0.4.51

### Patch Changes

- Updated dependencies [3714822]
  - @cosmicdrift/kumiko-framework@0.112.0
  - @cosmicdrift/kumiko-dev-server@0.112.0

## 0.4.50

### Patch Changes

- Updated dependencies [340acef]
  - @cosmicdrift/kumiko-framework@0.111.0
  - @cosmicdrift/kumiko-dev-server@0.111.0

## 0.4.49

### Patch Changes

- Updated dependencies [3fa4673]
  - @cosmicdrift/kumiko-framework@0.110.0
  - @cosmicdrift/kumiko-dev-server@0.110.0

## 0.4.48

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.109.0
- @cosmicdrift/kumiko-framework@0.109.0

## 0.4.47

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.108.0
- @cosmicdrift/kumiko-framework@0.108.0

## 0.4.46

### Patch Changes

- Updated dependencies [64ff082]
- Updated dependencies [3ff6025]
  - @cosmicdrift/kumiko-framework@0.107.0
  - @cosmicdrift/kumiko-dev-server@0.107.0

## 0.4.45

### Patch Changes

- Updated dependencies [7944923]
- Updated dependencies [d6fbd00]
  - @cosmicdrift/kumiko-framework@0.106.0
  - @cosmicdrift/kumiko-dev-server@0.106.0

## 0.4.44

### Patch Changes

- Updated dependencies [a305251]
  - @cosmicdrift/kumiko-framework@0.105.2
  - @cosmicdrift/kumiko-dev-server@0.105.2

## 0.4.43

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.105.1
- @cosmicdrift/kumiko-framework@0.105.1

## 0.4.42

### Patch Changes

- Updated dependencies [1918250]
  - @cosmicdrift/kumiko-framework@0.105.0
  - @cosmicdrift/kumiko-dev-server@0.105.0

## 0.4.41

### Patch Changes

- Updated dependencies [a3c973e]
  - @cosmicdrift/kumiko-framework@0.104.0
  - @cosmicdrift/kumiko-dev-server@0.104.0

## 0.4.40

### Patch Changes

- Updated dependencies [961d0bb]
  - @cosmicdrift/kumiko-framework@0.103.0
  - @cosmicdrift/kumiko-dev-server@0.103.0

## 0.4.39

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.102.2
- @cosmicdrift/kumiko-framework@0.102.2

## 0.4.38

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.102.1
- @cosmicdrift/kumiko-framework@0.102.1

## 0.4.37

### Patch Changes

- Updated dependencies [0b90d0a]
- Updated dependencies [020d5e8]
  - @cosmicdrift/kumiko-dev-server@0.102.0
  - @cosmicdrift/kumiko-framework@0.102.0

## 0.4.36

### Patch Changes

- Updated dependencies [a32f591]
- Updated dependencies [ab82597]
- Updated dependencies [a9f5b75]
  - @cosmicdrift/kumiko-dev-server@0.101.0
  - @cosmicdrift/kumiko-framework@0.101.0

## 0.4.35

### Patch Changes

- Updated dependencies [aaf890e]
- Updated dependencies [17b44b3]
  - @cosmicdrift/kumiko-framework@0.100.0
  - @cosmicdrift/kumiko-dev-server@0.100.0

## 0.4.34

### Patch Changes

- Updated dependencies [8146e5b]
  - @cosmicdrift/kumiko-framework@0.99.0
  - @cosmicdrift/kumiko-dev-server@0.99.0

## 0.4.33

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.98.0
- @cosmicdrift/kumiko-framework@0.98.0

## 0.4.32

### Patch Changes

- Updated dependencies [c5410a3]
  - @cosmicdrift/kumiko-framework@0.97.1
  - @cosmicdrift/kumiko-dev-server@0.97.1

## 0.4.31

### Patch Changes

- Updated dependencies [4e2bd72]
  - @cosmicdrift/kumiko-framework@0.97.0
  - @cosmicdrift/kumiko-dev-server@0.97.0

## 0.4.30

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.96.0
- @cosmicdrift/kumiko-framework@0.96.0

## 0.4.29

### Patch Changes

- Updated dependencies [387f259]
- Updated dependencies [da32b71]
  - @cosmicdrift/kumiko-framework@0.95.0
  - @cosmicdrift/kumiko-dev-server@0.95.0

## 0.4.28

### Patch Changes

- Updated dependencies [31a2abf]
  - @cosmicdrift/kumiko-framework@0.94.0
  - @cosmicdrift/kumiko-dev-server@0.94.0

## 0.4.27

### Patch Changes

- Updated dependencies [37d0ea4]
  - @cosmicdrift/kumiko-framework@0.93.0
  - @cosmicdrift/kumiko-dev-server@0.93.0

## 0.4.26

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.92.0
- @cosmicdrift/kumiko-framework@0.92.0

## 0.4.25

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.91.0
- @cosmicdrift/kumiko-framework@0.91.0

## 0.4.24

### Patch Changes

- Updated dependencies [9a90672]
  - @cosmicdrift/kumiko-dev-server@0.90.3
  - @cosmicdrift/kumiko-framework@0.90.3

## 0.4.23

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.90.2
- @cosmicdrift/kumiko-framework@0.90.2

## 0.4.22

### Patch Changes

- Updated dependencies [04ec020]
  - @cosmicdrift/kumiko-dev-server@0.90.1
  - @cosmicdrift/kumiko-framework@0.90.1

## 0.4.21

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.90.0
- @cosmicdrift/kumiko-framework@0.90.0

## 0.4.20

### Patch Changes

- Updated dependencies [ca33c52]
- Updated dependencies [dbc2c2d]
  - @cosmicdrift/kumiko-framework@0.89.0
  - @cosmicdrift/kumiko-dev-server@0.89.0

## 0.4.19

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.88.0
- @cosmicdrift/kumiko-framework@0.88.0

## 0.4.18

### Patch Changes

- Updated dependencies [070c032]
  - @cosmicdrift/kumiko-framework@0.87.3
  - @cosmicdrift/kumiko-dev-server@0.87.3

## 0.4.17

### Patch Changes

- Updated dependencies [b04ca86]
  - @cosmicdrift/kumiko-framework@0.87.2
  - @cosmicdrift/kumiko-dev-server@0.87.2

## 0.4.16

### Patch Changes

- Updated dependencies [cb2abcd]
  - @cosmicdrift/kumiko-framework@0.87.1
  - @cosmicdrift/kumiko-dev-server@0.87.1

## 0.4.15

### Patch Changes

- Updated dependencies [c0cbfb5]
  - @cosmicdrift/kumiko-framework@0.87.0
  - @cosmicdrift/kumiko-dev-server@0.87.0

## 0.4.14

### Patch Changes

- Updated dependencies [e9feadd]
- Updated dependencies [0a80617]
  - @cosmicdrift/kumiko-dev-server@0.86.0
  - @cosmicdrift/kumiko-framework@0.86.0

## 0.4.13

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.85.0
- @cosmicdrift/kumiko-framework@0.85.0

## 0.4.12

### Patch Changes

- Updated dependencies [189f0cb]
  - @cosmicdrift/kumiko-framework@0.84.0
  - @cosmicdrift/kumiko-dev-server@0.84.0

## 0.4.11

### Patch Changes

- Updated dependencies [c2b7154]
- Updated dependencies [e36a2b0]
  - @cosmicdrift/kumiko-framework@0.83.0
  - @cosmicdrift/kumiko-dev-server@0.83.0

## 0.4.10

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.82.0
- @cosmicdrift/kumiko-framework@0.82.0

## 0.4.9

### Patch Changes

- Updated dependencies [9a798c5]
  - @cosmicdrift/kumiko-dev-server@0.81.1
  - @cosmicdrift/kumiko-framework@0.81.1

## 0.4.8

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.81.0
- @cosmicdrift/kumiko-framework@0.81.0

## 0.4.7

### Patch Changes

- Updated dependencies [7e7e078]
  - @cosmicdrift/kumiko-dev-server@0.80.0
  - @cosmicdrift/kumiko-framework@0.80.0

## 0.4.6

### Patch Changes

- Updated dependencies [cd34ef3]
  - @cosmicdrift/kumiko-framework@0.79.3
  - @cosmicdrift/kumiko-dev-server@0.79.3

## 0.4.5

### Patch Changes

- Updated dependencies [335ffef]
  - @cosmicdrift/kumiko-framework@0.79.2
  - @cosmicdrift/kumiko-dev-server@0.79.2

## 0.4.4

### Patch Changes

- Updated dependencies [4feba2b]
  - @cosmicdrift/kumiko-dev-server@0.79.1
  - @cosmicdrift/kumiko-framework@0.79.1

## 0.4.3

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.79.0
- @cosmicdrift/kumiko-framework@0.79.0

## 0.4.2

### Patch Changes

- Updated dependencies [7d27b06]
  - @cosmicdrift/kumiko-dev-server@0.78.0
  - @cosmicdrift/kumiko-framework@0.78.0

## 0.4.1

### Patch Changes

- Updated dependencies [b91862b]
  - @cosmicdrift/kumiko-framework@0.77.1
  - @cosmicdrift/kumiko-dev-server@0.77.1

## 0.4.0

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

- Updated dependencies [452656c]
  - @cosmicdrift/kumiko-dev-server@0.77.0
  - @cosmicdrift/kumiko-framework@0.77.0

## 0.3.3

### Patch Changes

- Updated dependencies [491f034]
  - @cosmicdrift/kumiko-framework@0.76.1
  - @cosmicdrift/kumiko-dev-server@0.76.1

## 0.3.2

### Patch Changes

- 7b03587: Release-script (`scripts/publish-with-oidc.sh`) allowlist now permits unscoped
  `create-kumiko-app` (and the `create-kumiko` fallback per Plan-Doc D1).
  Previously the case-statement allowed only `@cosmicdrift/*` workspaces, so
  every release silently skipped the bun-create wrapper — `npm view
create-kumiko-app` 404'd and `https://kumiko.rocks/install.sh`
  (Phase 2b) had nothing to install.

## 0.3.1

### Patch Changes

- Updated dependencies [e7c164d]
- Updated dependencies [5828e0c]
  - @cosmicdrift/kumiko-dev-server@0.76.0
  - @cosmicdrift/kumiko-framework@0.76.0

## 0.3.0

### Minor Changes

- 3cdad53: Annotate all remaining bundled features with `r.uiHints`

  Twenty-seven features that previously had no `uiHints` block now carry a
  `displayLabel` + `category` + `recommended` flag. They show up in the
  `create-kumiko-app` picker grouped by category (identity, infrastructure,
  storage, notifications, billing, compliance, operations, content, data) —
  the picker no longer hides them as "not yet annotated".

  `create-kumiko-app`'s `FEATURE_CONSTRUCTORS` map gains an entry for every
  zero-arg constructor: 35 features total are now selectable. Features that
  need caller-supplied args (channel-email, channel-push, file-provider-s3,
  managed-pages, subscription-mollie, subscription-stripe, tier-engine)
  remain absent from the constructor map — the picker hides them because
  the scaffolder can't synthesize the required transport/provider config.
  Wire them by hand after scaffolding.

  Refreshed the vendored `feature-manifest.json` so the picker reads the
  new hints out of the box.

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.75.0
- @cosmicdrift/kumiko-framework@0.75.0

## 0.2.0

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

- Updated dependencies [6775bf9]
  - @cosmicdrift/kumiko-dev-server@0.74.0
  - @cosmicdrift/kumiko-framework@0.74.0
