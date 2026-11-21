# @cosmicdrift/kumiko-feature-ast

## 0.427.0

### Patch Changes

- Updated dependencies [7789ce5]
- Updated dependencies [a316ed9]
- Updated dependencies [e5e2407]
- Updated dependencies [b1eb9f1]
  - @cosmicdrift/kumiko-framework@0.427.0
  - @cosmicdrift/kumiko-types@0.427.0

## 0.426.1

### Patch Changes

- Updated dependencies [56161fd]
- Updated dependencies [ac3d140]
- Updated dependencies [c1387f3]
- Updated dependencies [70b9411]
- Updated dependencies [70345d9]
- Updated dependencies [86afac6]
- Updated dependencies [2377b8b]
- Updated dependencies [35806b4]
  - @cosmicdrift/kumiko-framework@0.426.1
  - @cosmicdrift/kumiko-types@0.426.1

## 0.426.0

### Patch Changes

- Updated dependencies [2e9782d]
- Updated dependencies [1f0d1da]
  - @cosmicdrift/kumiko-types@0.426.0
  - @cosmicdrift/kumiko-framework@0.426.0

## 0.425.1

### Patch Changes

- Updated dependencies [e960a41]
  - @cosmicdrift/kumiko-framework@0.425.1
  - @cosmicdrift/kumiko-types@0.425.1

## 0.425.0

### Minor Changes

- 34cf35e: Bundled handlers are built with `defineWriteHandler`/`defineQueryHandler`, so their payloads are typed from the schema and the engine-payload casts are gone; a codemod moves app handlers the same way.
  
  <!-- kumiko-changes
  feature: feature-ast
  type: breaking
  title: Handlers are defined with defineWriteHandler/defineQueryHandler
  detail: The bundled features no longer annotate handlers with the erased `WriteHandlerDef`/`QueryHandlerDef`. Factories such as `createEnsureAccountsHandler`, `createSubjectTotalsHandler`, `createScheduleActualsHandler`, `createBalancesReportHandler`, `createIncomeStatementHandler` and `createBalanceSheetHandler` return the typed `WriteHandlerDefinition`/`QueryHandlerDefinition`, which is not assignable to `WriteHandlerDef`. `withCapEnforcement` keeps the wrapped handler's type and still accepts a `WriteHandlerDef`. Two guards cover what is left: the As-Casts Audit (`check-as-casts`) counts a cast with `@cast-boundary engine-payload` on `event.payload`/`query.payload` inside `handlers/*.write.ts`/`*.query.ts` as suspect; it does not see casts outside `handlers/`, other parameter names, destructured payloads, other marker reasons or `schema.parse(event.payload)` re-parses. The Handler Definitions ratchet (`guard-handler-definitions`) counts every literal annotated, `satisfies`- or `as`-typed with `WriteHandlerDef`/`QueryHandlerDef` and every function returning such a literal, anywhere in the scanned tree, against `.kumiko-handler-definitions-baseline.json`; it does not see a returned identifier, aliases of the erased types or test files.
  migration: Run the codemod. It wraps literals annotated with `WriteHandlerDef`/`QueryHandlerDef` (variables and factory returns) in `defineWriteHandler`/`defineQueryHandler`, drops the annotation, removes `event.payload as z.infer<typeof schema>` casts and `schema.parse(event.payload)` re-parses on the handler's own schema and fixes the imports. It checks every use across the project and converts a handler only when all uses are `r.writeHandler`/`r.queryHandler` arguments, re-exports, property reads or `withCapEnforcement`/`withStockCap`. Listed as manual: handlers spreading another handler, dynamic schemas, `satisfies`/`as` forms and handlers used anywhere else, for example passed to an app wrapper typed `WriteHandlerDef`, put into an array or stored in an annotated variable. Give such a wrapper the two overloads of `withCapEnforcement` (erased and typed) or keep the handler erased and freeze it with `kumiko-guards guards --write-baseline --guard="Handler Definitions"`. Code that stored a bundled factory result in a `WriteHandlerDef`/`QueryHandlerDef` variable drops that annotation.
  affects: WriteHandlerDef, QueryHandlerDef, withCapEnforcement, createEnsureAccountsHandler, createSubjectTotalsHandler, createScheduleActualsHandler, createBalancesReportHandler, createIncomeStatementHandler, createBalanceSheetHandler
  codemod: scripts/codemod/define-handler.ts
  manualAfterCodemod: true
  -->
- 34cf35e: The workflow engine is removed: `defineWorkflow`, the bundled features `workflow-runner` and `step-dispatcher`, the steps `wait`, `waitForEvent`, `retry`, `webhook.send` and `mail.send`, and the `kumiko:system:workflow.*` and `kumiko:system:step.*` system events.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Workflow engine, workflow-runner and step-dispatcher removed
  detail: `defineWorkflow`, `computeDefinitionFingerprint`, `WorkflowDefinition`, `WorkflowStepError`, `unwrapWorkflowStepError`, `describeWorkflowStepError`, `evaluateEventMatch`, `WORKFLOW_SYSTEM_EVENT_DEFS`, the `STEP_DISPATCH_*` and `WORKFLOW_*` constants (`STEP_DISPATCHED_TYPE`, `STEP_DISPATCH_AGGREGATE_TYPE`, `STEP_DISPATCH_FAILED_TYPE`, `STEP_DISPATCH_REQUESTED_TYPE`, `WORKFLOW_AGGREGATE_TYPE`, `WORKFLOW_RESUMED_TYPE`, `WORKFLOW_RETRY_SCHEDULED_TYPE`, `WORKFLOW_RUN_COMPLETED_TYPE`, `WORKFLOW_RUN_FAILED_TYPE`, `WORKFLOW_RUN_STARTED_TYPE`, `WORKFLOW_WAITING_FOR_EVENT_TYPE`, `WORKFLOW_WAITING_TYPE`) and the type `AwaitedEventType` are no longer exported. `r.step.wait`, `r.step.waitForEvent`, `r.step.retry`, `r.step.webhook.send` and `r.step.mail.send` are gone; `PipelineCtx.workflow`, `PipelineDef.awaits` and step tier 3 are removed, and `runPipeline`/`runStepList` no longer take `workflow`/`resumeFrom`. The subpaths `@cosmicdrift/kumiko-bundled-features/workflow-runner` and `/step-dispatcher` are removed, and so is the irreversible-operation case `per-dispatch-record-key`. feature-ast no longer extracts `ai.generate`/`ai.extract`/`ai.classify` patterns from `defineWorkflow` step arrays. `stepsPipeline`, `defineStep`, `r.step.callFeature` and all synchronous steps stay.
  migration: Build multi-step flows as jobs triggered by events (`r.job({ trigger: { on } })`), send mail through `channel-email`/`delivery` and call webhooks from a job. Apps that mounted `createWorkflowRunnerFeature()` or `createStepDispatcherFeature()` remove the mount and run `kumiko-schema generate` to drop their tables.
  affects: defineWorkflow, workflow-runner, step-dispatcher, createWorkflowRunnerFeature, createStepDispatcherFeature, step.wait, step.retry, step.webhook, step.mail, WorkflowDefinition, WorkflowStepError, evaluateEventMatch, computeDefinitionFingerprint, WORKFLOW_, STEP_DISPATCH_, AwaitedEventType, PipelineDef, ctx.workflow, resumeFrom, per-dispatch-record-key
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: step-dispatcher feature removed
  detail: The subpath @cosmicdrift/kumiko-bundled-features/step-dispatcher is gone with all its exports: `createStepDispatcherFeature`, `STEP_DISPATCH_AGGREGATE_TYPE`, `MailSpec`, `mailSpecSchema`, `MailDispatchResult`, `performMailDispatch`, `setMailRunner`, `WebhookSpec`, `webhookSpecSchema`, `WebhookDispatchDeps`, `WebhookDispatchResult`, `performWebhookDispatch`, `setWebhookFetch`, `setWebhookHostLookup`, `webhookAuthSecretKey`, `WEBHOOK_AUTH_SECRET_KEY_PREFIX`, `WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR`, `readAllowedPrivateWebhookHostsFromEnv` and `stepDispatcherEnvSchema`. It only served the removed `webhook.send` and `mail.send` workflow steps.
  migration: There is no replacement feature. Send mail through channel-email or delivery and call webhooks from a job; remove the createStepDispatcherFeature mount.
  affects: step-dispatcher, createStepDispatcherFeature, performMailDispatch, performWebhookDispatch, setMailRunner, setWebhookFetch, setWebhookHostLookup, stepDispatcherEnvSchema
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: workflow-runner feature removed
  detail: The subpath @cosmicdrift/kumiko-bundled-features/workflow-runner is gone with all its exports: `createWorkflowRunnerFeature`, `startAndRunWorkflow`, `registerEventTrigger`, `workflowRunAggregateId`, `WorkflowSuspensionUnsupportedError`, `WorkflowRunStartedPayload`, `WorkflowRunCompletedPayload` and `WorkflowRunFailedPayload`.
  migration: There is no replacement feature. Build multi-step flows as jobs triggered by events (`r.job({ trigger: { on } })`); remove the createWorkflowRunnerFeature mount.
  affects: workflow-runner, createWorkflowRunnerFeature, startAndRunWorkflow, registerEventTrigger
  -->
- 34cf35e: Remove the upgrade codemods of releases up to 0.420.0; kumiko codemod lists import-extensions and feature-layout.
  
  <!-- kumiko-changes
  feature: cli
  type: breaking
  title: Upgrade codemods up to 0.420.0 removed
  detail: Every app is past 0.420.0, so the upgrade codemods of earlier releases are gone from @cosmicdrift/kumiko-feature-ast (src/scripts/codemod), among them package-merge, feature-factory, s3-imports, migrate-db-raw, migrate-cross-tenant, migrate-open-to-all, object-form, db-factory, tenant-db-options, testing-move, testing-injection, ctx-namespaces, pii-personal-migration and scaffold-kms-mode. import-extensions and feature-layout, the two codemods a guard points to, stay next to the upgrade codemods of later releases, and `kumiko codemod` lists those two; feature-layout was missing from that list, so the hint of the app-feature-structure guard failed.
  migration: An app whose .kumiko/upgrade-state.json is below 0.420.0 first runs `kumiko-upgrade --apply` with a framework release up to 0.420.0, then upgrades to this one.
  affects: all
  -->
- 34cf35e: Guard opt-outs now use one marker syntax: `kumiko-lint-ignore <slug> <reason>` for a line and `kumiko-lint-ignore-file <slug> <reason>` for a whole file.
  
  <!-- kumiko-changes
  feature: guards
  type: breaking
  title: Test guard opt-outs move to kumiko-lint-ignore
  detail: `// @timeout-exception: #N reason` is now `// kumiko-lint-ignore test-timeouts #N reason`, `// @template-drift-exception: #N reason` is now `// kumiko-lint-ignore test-template-drift #N reason`, and the file-wide `// @no-server-stack: reason` is now `// kumiko-lint-ignore-file test-stack-drift reason` in the leading comment of the file. The old markers are no longer read. Every reason now goes through the ignore-tag-reason check (at least three real words); the two test guards still require `#<issue>` first.
  migration: Run the codemod, then rewrite any reason the ignore-tag-reason guard reports as too weak.
  codemod: scripts/codemod/guard-markers-to-lint-ignore.ts
  affects: @timeout-exception, @template-drift-exception, @no-server-stack
  -->
- 34cf35e: `bundledLists` becomes `listDefaults` and reaches the lists of every composed feature; `r.adoptsBundledLists()` is removed.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: listDefaults replaces bundledLists, adoptsBundledLists removed
  detail: The app-wide table block is named `listDefaults` (AppConfig, `ListDefaultsOptions`, `validateListDefaultsOptions`) and applies to every entityList, projectionList and relatedList of every composed feature, app features included. `r.adoptsBundledLists()`, `FeatureDefinition.adoptsBundledLists` and the `adoptsBundledLists` field in feature-manifest.json are removed. The boot rules are renamed from `bundled-lists/*` to `list-defaults/*`.
  migration: Rename `bundledLists` to `listDefaults` in kumiko.config.ts and the bin runner options, `BundledListsOptions` to `ListDefaultsOptions`, `validateBundledListsOptions` to `validateListDefaultsOptions`, and delete every `r.adoptsBundledLists()` call. App lists now get the block too; a screen that must differ sets its own `table` keys (`export: undefined`, `pinning: false`, `resizing: false`).
  affects: bundledLists, BundledListsOptions, adoptsBundledLists, bundled-lists/
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: breaking
  title: composeFeatures listDefaults applies to all features
  detail: `composeFeatures`, `runProdApp`, `runWorkerApp` and `composeAppFeatures` take `listDefaults` instead of `bundledLists`. The block no longer skips features without a marker; a screen's own `table` keys still win per key, and relatedList sections never get `export`.
  migration: Rename the option to `listDefaults`. Remove per-screen wrappers that only repeated the app's table standard.
  affects: bundledLists
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: breaking
  title: Managed kumiko/schema.ts and kumiko check read listDefaults
  detail: The managed `kumiko/schema.ts` passes `appConfig.listDefaults` to `composeFeatures`, and `kumiko check` reports bin runners that leave out `listDefaults` while kumiko.config.ts sets it. `runDevApp` and `setupTestStackFromFeatures` take `listDefaults`.
  migration: Run `kumiko sync-managed` to refresh kumiko/schema.ts, then rename the runner option in bin/.
  affects: bundledLists
  -->
  
  <!-- kumiko-changes
  feature: feature-ast
  type: breaking
  title: adoptsBundledLists pattern removed
  detail: The parser, renderer, patch kinds, pattern-id and pattern-change schemas and the pattern library no longer know `adoptsBundledLists`; `AdoptsBundledListsPattern` and `adoptsBundledListsSchema` are no longer exported.
  migration: Drop references to the `adoptsBundledLists` pattern kind.
  affects: adoptsBundledLists, AdoptsBundledListsPattern, adoptsBundledListsSchema
  -->
- 34cf35e: An entity carries its name: `createEntity({ name, ... })`, and `r.entity`, `r.crud`, `createEntityExecutor`, `buildEntityTable` and `deriveEntityTableMeta` take the entity without a separate name.
  
  <!-- kumiko-changes
  feature: framework-core
  type: breaking
  title: Entities carry their name
  detail: `createEntity` requires `name`, and `EntityDefinition` has `name`. `r.entity(entity)` or `r.entity({ ...entity, backingTable })`, `r.crud(entity, options?)`, `createEntityExecutor(entity)`, `buildEntityTable(entity, options?)` and `deriveEntityTableMeta(entity, options?)` read it from the entity, so the name given at registration and the one given to the executor can no longer differ.
  migration: Run the codemod. It moves the name from `r.entity({ name, ...entity })`, `r.crud("name", entity)`, `createEntityExecutor("name", entity)`, `buildEntityTable("name", entity)` and `deriveEntityTableMeta("name", entity)` into the entity's `createEntity` call and drops the name argument. An entity used under a second name becomes `{ ...entity, name: "other" }` at that site. Entities it cannot resolve are listed as manual; add `name` there by hand.
  affects: createEntity, r.entity, r.crud, buildEntityTable, deriveEntityTableMeta, EntityDefinition
  codemod: scripts/codemod/entity-name.ts
  manualAfterCodemod: true
  -->
- 34cf35e: `escapeHatch` requires `grants`; a declaration without them no longer unlocks all four grants.
  
  <!-- kumiko-changes
  feature: framework-core
  type: breaking
  title: escapeHatch names its grants
  detail: `escapeHatch` on write and query handlers, hooks and jobs requires `grants`, a non-empty list of `systemIdentity`, `globalWrites`, `unsafeRaw` and `crossTenantReads`. A declaration without `grants` used to unlock all four; it now fails at boot with "grants is required". `defineProjectionQueryHandler` with `unsafeAllTenants: { reason }` declares `grants: ["systemIdentity"]`. An `escapeHatch` in `r.applyExtension` options takes `{ reason }` only and always means `unsafeRaw`; `grants` there fails at boot.
  migration: Run the codemod. It adds the grants it can read from the definition (`unsafeRaw(` for unsafeRaw, `.global(` for globalWrites, `crossTenantReads` for crossTenantReads, `queryAs(`, `writeAs(`, `createSystemUser(`, `unsafeAllTenants` or `runAs` with SystemAdmin for systemIdentity) and lists every other declaration as manual. Add grants to the manual sites by hand and run the integration tests of the touched features: a missing grant only fails when that code path runs. Remove `grants` from `escapeHatch` in `r.applyExtension` options.
  affects: escapeHatch
  codemod: scripts/codemod/escape-hatch-grants.ts
  manualAfterCodemod: true
  -->
- 34cf35e: Every registrar verb takes one options object, and `r.useExtension` is now `r.applyExtension`.
  
  <!-- kumiko-changes
  feature: framework-core
  type: breaking
  title: Registrar verbs take one options object; r.useExtension becomes r.applyExtension
  detail: The positional overloads of `r.optionalRequires`, `r.relation`, `r.config`, `r.job`, `r.notification`, `r.readsConfig`, `r.referenceData`, `r.useExtension`, `r.metric`, `r.secret`, `r.secretNamespace`, `r.claimKey` and `r.streamHandler` are removed; each keeps the object form it already had. `r.useExtension` is renamed to `r.applyExtension`, so React lint rules no longer treat it as a hook. The runtime check that rejects positional calls to `r.entity`, `r.writeHandler`, `r.queryHandler`, `r.hook`, `r.requires` and `r.defineWebhookEvent` stays (boot rule `registrar/options-object-required`); only `registrar/argument-missing` is removed with the positional overloads. The boot rule `extension/use-escape-hatch-invalid` is now `extension/apply-escape-hatch-invalid`.
  migration: Run the codemod. It rewrites positional calls into the object form, renames `r.useExtension` to `r.applyExtension` and removes the `biome-ignore lint/correctness/useHookAtTopLevel` comment above it. `r.config("key", def)` becomes `r.config({ keys: { key: def } }).key`. Rewrite the sites it lists as manual by hand, and rename `r.useExtension(` in strings and Markdown by hand.
  affects: optionalRequires, readsConfig, referenceData, useExtension, secretNamespace, claimKey, streamHandler, .relation(, .config(, .job(, .notification(, .metric(, .secret(, registrar/argument-missing, extension/use-escape-hatch-invalid
  codemod: scripts/codemod/registrar-single-form.ts
  manualAfterCodemod: true
  -->

### Patch Changes

- 34cf35e: Write handlers can declare `dispatchOnly: true` so only server code reaches them.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Dispatch-only write handlers
  detail: A write handler with `dispatchOnly: true` runs only through ctx.dispatch, jobs and server routes, with the calling user kept. POST /api/write, /api/batch and /api/command answer it with the 404 of an unknown handler, and the agent manifest leaves it out. Boot rejects it together with `agent.expose: true` or `tenantlessAnonymous`. Use it for the sub-steps of a perCommand handler.
  -->
- 34cf35e: New ratchet guards `Handler Definitions` and `Feature Import Cycles`; the feature-layout codemod moves root-level `<name>.write.ts`/`<name>.query.ts` into `handlers/`.
  
  <!-- kumiko-changes
  feature: guards
  type: breaking
  title: Handler layout and feature import cycles are guarded
  detail: `kumiko-guards guards` now runs `Handler Definitions` (handler definitions outside `<feature>/handlers/`, several handlers per file, a wrong `.write`/`.query` suffix, object literals typed `WriteHandlerDef`/`QueryHandlerDef`) and `Feature Import Cycles` (static, non-type-only imports outside test files that close a cycle between features). Both freeze existing hits per file in `.kumiko-handler-definitions-baseline.json` and `.kumiko-feature-import-cycles-baseline.json`. A missing baseline counts as empty, so every existing hit fails until the baseline is written. The feature-layout codemod now also moves `<name>.write.ts` and `<name>.query.ts` from a feature root into `handlers/` and rewrites their imports.
  migration: Run the codemod, then `kumiko-guards guards --write-baseline --guard="Handler Definitions"` and `kumiko-guards guards --write-baseline --guard="Feature Import Cycles"` and commit both baseline files.
  affects: kumiko-guards
  codemod: scripts/codemod/feature-layout.ts
  -->
- cdbf386: Query handlers accept `dispatchOnly: true`: server code still dispatches them, the HTTP entry answers 404.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: dispatchOnly query handlers
  detail: `r.queryHandler`, `defineQueryHandler` and `definePagedQueryHandler` take `dispatchOnly?: boolean`, with the same meaning as on write handlers. POST /api/query and the xlsx screen export answer a dispatch-only query with the 404 of an unknown handler; `ctx.dispatch.query` and `queryAs`, jobs and server routes still run it with the calling user. Such a query is never an agent tool (also not as a registry-derived list/get tool), grants no `/api/sse` live signals, and boot rejects it together with `agent.expose: true`. Boot also rejects every query reference the browser loads when it names a dispatch-only query (rule `query/dispatch-only-on-screen`): the query of a screen or dashboard panel, an `optionsQuery` on a form, config-key or reference field, the list query of a reference field or reference facet target, a select `optionsAvailabilityQuery` and a `table.summaryRow` query. `/api/schema` leaves it out of the live entities. `dispatchOnly` closes the HTTP entry only: its access rule still counts as a read grant on the entity for linked lists (parentRef rows) and derived values. The API docs for personal access tokens leave out dispatch-only queries and writes, since a token can never call them. `expectRoleRestrictedHandlersDenyForeignRole` expects 404 `not_found` for a dispatch-only query.
  migration: A query that only a server flow may run (for example one that returns decrypted personal data after the flow checked a token) declares `dispatchOnly: true`. Clients that call it over /api/query get 404 afterwards.
  -->
- 34cf35e: `ctx.db.unsafeRaw()` keeps the tenant's row level security scope; `ctx.db.unsafeRawAllTenants()` reaches every tenant.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: ctx.db.unsafeRaw() stays in the caller's tenant
  detail: A granted `ctx.db.unsafeRaw()` used to run in the system scope of row level security, so raw SQL with a forgotten tenant_id filter read and wrote rows of every tenant. It now runs in the scope of its TenantDb: the caller's tenant (plus system tenant rows on tables that allow reading them) in tenant mode, the system scope in system mode. The new `ctx.db.unsafeRawAllTenants()` returns the old all-tenants runner under the same `unsafeRaw` grant and audit. `ctx.systemDb.unsafeRaw(reason)` is unchanged. `ConnectionTenantDb` has both methods.
  migration: Run kumiko-upgrade --apply; the unsafe-raw-all-tenants codemod renames every `.unsafeRaw()` call without arguments to `.unsafeRawAllTenants()`, which keeps today's behaviour. Hand-written TenantDb stubs it lists need an `unsafeRawAllTenants` member. Switch a call back to `unsafeRaw()` where its SQL only touches the caller's own tenant.
  affects: unsafeRaw, TenantDb
  codemod: scripts/codemod/unsafe-raw-all-tenants.ts
  -->
- 34cf35e: The feature-layout codemod also moves root jobs, entities and the client entry into their folders.
  <!-- kumiko-changes
  feature: feature-ast
  type: improvement
  title: feature-layout moves jobs, entities and client.ts
  detail: `kumiko codemod feature-layout` now moves `<name>.job.ts` from the feature root to `handlers/`, `entity.ts` and `<name>.entity.ts` to `schema/`, and a root `client.ts` that defines a `ClientFeatureDefinition` to `web/index.ts`, rewriting every import. A `write.ts` or `queries.ts` with several handlers is reported for a manual split into one file per handler. `--check` now also fails while a move is pending. Baselines keyed by file path have to be frozen again after the moves.
  migration: After running `kumiko codemod feature-layout`, freeze the baselines keyed by file path again.
  -->
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [cdbf386]
- Updated dependencies [cdbf386]
- Updated dependencies [cdbf386]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [f144056]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [f144056]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [4bc40f3]
- Updated dependencies [4bc40f3]
- Updated dependencies [4bc40f3]
- Updated dependencies [6f043fa]
- Updated dependencies [a44b984]
- Updated dependencies [007d227]
- Updated dependencies [a44b984]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [34cf35e]
- Updated dependencies [3f3bb46]
  - @cosmicdrift/kumiko-framework@0.425.0
  - @cosmicdrift/kumiko-types@0.425.0

## 0.424.1

### Patch Changes

- Updated dependencies [557fd97]
- Updated dependencies [3bcef0e]
  - @cosmicdrift/kumiko-types@0.424.1
  - @cosmicdrift/kumiko-framework@0.424.1

## 0.424.0

### Patch Changes

- Updated dependencies [acd7c43]
  - @cosmicdrift/kumiko-framework@0.424.0
  - @cosmicdrift/kumiko-types@0.424.0

## 0.423.0

### Patch Changes

- Updated dependencies [ed97ac9]
- Updated dependencies [900d7b0]
  - @cosmicdrift/kumiko-framework@0.423.0
  - @cosmicdrift/kumiko-types@0.423.0

## 0.422.0

### Patch Changes

- Updated dependencies [8231064]
  - @cosmicdrift/kumiko-types@0.422.0
  - @cosmicdrift/kumiko-framework@0.422.0

## 0.421.0

### Patch Changes

- Updated dependencies [94ce33c]
  - @cosmicdrift/kumiko-framework@0.421.0
  - @cosmicdrift/kumiko-types@0.421.0

## 0.420.0

### Patch Changes

- Updated dependencies [ac5f57f]
- Updated dependencies [cc4aeb4]
- Updated dependencies [cb56293]
- Updated dependencies [cce0ca1]
- Updated dependencies [253b33a]
  - @cosmicdrift/kumiko-types@0.420.0
  - @cosmicdrift/kumiko-framework@0.420.0

## 0.419.0

### Patch Changes

- Updated dependencies [9d30dab]
  - @cosmicdrift/kumiko-framework@0.419.0
  - @cosmicdrift/kumiko-types@0.419.0

## 0.418.0

### Patch Changes

- 11bc811: Review fixes: signature ink check and signer email, field AI assist, shell accessibility and PWA scope, video setup tools, monotonic ingest progress, feature-ast parse errors, kms codemod hints, plural and formal-address checks, and tests.
  
  <!-- kumiko-changes
  feature: document-ingest-foundation
  type: fix
  title: Ingest progress only moves forward
  detail: Parallel `reportIngestProgress` calls for one file can land in any order; the progress row now keeps the highest `pagesDone`, a report whose progress is already stored stops early, and after 10 version conflicts the call throws instead of returning silently.
  -->
  
  <!-- kumiko-changes
  feature: signature
  type: fix
  title: Empty signatures are rejected on every background
  detail: The ink check treats an image as having a solid background only when all four corners are opaque and identical; a lone opaque pixel no longer counts the whole image as ink, and signer emails must be valid addresses.
  -->
- Updated dependencies [e9a7d69]
- Updated dependencies [d7d1009]
- Updated dependencies [11bc811]
- Updated dependencies [aa8ee93]
- Updated dependencies [01224e7]
  - @cosmicdrift/kumiko-framework@0.418.0
  - @cosmicdrift/kumiko-types@0.418.0

## 0.417.0

### Patch Changes

- b13dd37: `kumiko-upgrade --apply` now switches `bin/main.ts` and `bin/kumiko.ts` of apps scaffolded before 0.416.0 to the Key Manager ciphertext wiring.
  
  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: kumiko-upgrade migrates older scaffolds to Key Manager ciphertext keys
  detail: The `scaffold-kms-mode` codemod replaces `requireKmsWiring` in the production branch of `bin/main.ts` with `{ kmsMode: "required" as const }` and lets `schema apply` in `bin/kumiko.ts` also resolve the slots of `kmsEnvSchema`. It only rewrites the exact scaffold form; a hand-edited file is left as it is and reported as manual.
  codemod: scripts/codemod/scaffold-kms-mode.ts
  -->
- Updated dependencies [b969c3e]
- Updated dependencies [6d80f27]
  - @cosmicdrift/kumiko-types@0.417.0
  - @cosmicdrift/kumiko-framework@0.417.0

## 0.416.0

### Patch Changes

- Updated dependencies [934172f]
- Updated dependencies [add54f1]
- Updated dependencies [add54f1]
- Updated dependencies [d147995]
- Updated dependencies [add54f1]
- Updated dependencies [add54f1]
- Updated dependencies [add54f1]
  - @cosmicdrift/kumiko-types@0.416.0
  - @cosmicdrift/kumiko-framework@0.416.0

## 0.415.0

### Minor Changes

- 6f8efad: The irreversible-operation gate now refuses `executor.forget`, hard deletes, `kms.eraseKey` and writes to `readAsInstruction` fields in any request scope without a write-handler entry. Jobs and multi-stream projections can declare `irreversibleWithoutEntryHandler`; afterCommit and afterRollback hooks, HTTP routes, WebSocket handlers and agent tool calls cannot and never inherit the declaration.
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Irreversible operations without a write-handler entry need a declared exception
  detail: A job (`r.job`) or multi-stream projection that runs an irreversible operation without a write-handler entry now throws AccessDeniedError (`irreversible_operation_without_entry_handler`) instead of passing silently. Declare `irreversibleWithoutEntryHandler` with one of `rebuildable-derived-data`, `high-risk-or-cron-pipeline` or `per-dispatch-record-key`. The declaration covers only the job's or consumer's own code; afterCommit hooks, nested dispatches and agent tool calls inside it are still gated. Any other request scope without a write-handler entry is refused too: an afterCommit or afterRollback hook of an HTTP write, an HTTP route, a WebSocket handler. A refused job goes red and a refused consumer goes to the dead letter, while a refused hook is only logged, so its delete does not happen and only the log shows it.
  migration: Add `irreversibleWithoutEntryHandler: "<case>"` to each job or multi-stream projection that calls executor.forget, a hard delete, kms.eraseKey or writes a readAsInstruction field. Pick the case that names why no entry handler exists; if none fits, route the operation through a write handler with `agent: { risk: "high" }`. Hooks and routes that call one of these primitives directly must dispatch such a handler or a job instead.
  -->

### Patch Changes

- e701e18: The `lint-ignore-to-biome` codemod leaves `no-raw-hooks` markers outside the plugin's scope alone.
  
  <!-- kumiko-changes
  feature: feature-ast
  type: fix
  title: lint-ignore-to-biome skips no-raw-hooks markers outside the plugin scope
  detail: The no-raw-hooks Biome plugin only scans .tsx files under web/ and public/, without tests, renderer, document-designer and samples. Converting a marker elsewhere produced a `biome-ignore` that suppresses nothing. The codemod now keeps such markers as they are.
  -->
- cabb8f3: Review fixes for the Biome guard move: temporal-polyfill is blocked as a whole, `no-date-api` and `unsafe-json-parse` close their gaps, the codemod judges scope by project-relative path, and the e2e Meilisearch teardown reads the app's `.env`.
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: Biome preset closes temporal-polyfill completely and tightens plugin gaps
  detail: noRestrictedImports now blocks every import from temporal-polyfill and temporal-polyfill/*, not only the Temporal name. no-date-api also flags optional calls (x?.toISOString(), x?.getTime()). unsafe-json-parse accepts JSON.parse in the try block of try/catch/finally. The allowlists of unsafe-json-parse, error-reasons and admin-api name the framework files by full path, so an app file with the same name no longer inherits the exception. lint-ignore-to-biome matches no-raw-hooks scope against the project-relative path from the plugin's own includes, lists trailing markers instead of converting them, and covers the remaining deleted guard slugs. The e2e Meilisearch teardown resolves MEILI_URL and MEILI_MASTER_KEY from webServer.env, then the app's .env files, then the default.
  -->
- Updated dependencies [7d4d98b]
- Updated dependencies [936c2fa]
- Updated dependencies [9e86e17]
- Updated dependencies [0dde660]
- Updated dependencies [6f8efad]
- Updated dependencies [b56f27a]
- Updated dependencies [175e232]
- Updated dependencies [0c06c90]
- Updated dependencies [98e82ff]
- Updated dependencies [4e4a883]
- Updated dependencies [36c874d]
- Updated dependencies [b018a5d]
- Updated dependencies [939c0cb]
- Updated dependencies [cabb8f3]
- Updated dependencies [2891f68]
- Updated dependencies [34e38a0]
- Updated dependencies [a4e9adf]
  - @cosmicdrift/kumiko-framework@0.415.0
  - @cosmicdrift/kumiko-types@0.415.0

## 0.414.0

### Minor Changes

- f89bed5: Guards that only inspect one file move to Biome builtins and GritQL plugins behind one shared preset, `@cosmicdrift/kumiko-framework/biome-rules`.
  
  <!-- kumiko-changes
  feature: guards
  type: breaking
  title: Single-file guards are replaced by the Biome preset biome-rules
  detail: The guards admin-api, direct-fetch, error-reasons, event-store-writes (es-literal-writes), i18n-locale-terminology, no-custom-primitives, no-date-api, no-direct-fs, no-direct-process-env, no-inline-styles, no-raw-hooks, no-temporal-polyfill-import, primitives-discipline, raw-classname, raw-interactive-elements, restricted-symbols, test-es-fixtures, test-title and unsafe-json-parse are deleted together with their baselines. Their checks run as Biome builtins or GritQL plugins from `packages/framework/presets/biome-plugins/*.grit`. New checks cover createTestDispatcher, barrel imports from the same folder, external font CDNs (also in CSS), skipped or retried tests and CSSProperties types. The guards silent-skip, thin-wrappers and check-predicates are removed without replacement (the `// @wrapper-known` and silent-skip markers are dead and can be deleted). `kumiko check` gains a `lint` step (`biome lint` in the app repo) and an `agent` step (kumiko agent lint) for apps with a kumiko.config.ts.
  migration: Extend the preset in your `biome.json`, replacing your own linter rules for these checks - `"extends": ["@cosmicdrift/kumiko-framework/biome-rules"]` (apps that already extend `biome-app` get it through that preset). Delete `.kumiko-direct-fs-baseline.json`, `.kumiko-test-title-baseline.json`, `.kumiko-no-custom-primitives-baseline.json` and `.kumiko-test-timeouts-baseline.json`. `bun kumiko-upgrade --apply` runs the codemod lint-ignore-to-biome, which turns `kumiko-lint-ignore <slug> <reason>` markers of the deleted guards into `biome-ignore lint/plugin: <reason>` (`lint/style/noInlineStyles` for no-inline-styles), keeps the comment form and the reason, and lists markers without a reason of at least three words. Biome applies a suppression only to the next line or node, so a marker that sat several lines above its hit moves by hand (CSS - `biome-ignore lint/plugin: <reason>` inside a comment). Remove deleted guard names from your `kumiko.json` and security baseline. Enterprise and platform extend the same preset.
  codemod: scripts/codemod/lint-ignore-to-biome.ts
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Biome preset biome-rules with GritQL plugins
  detail: `@cosmicdrift/kumiko-framework/biome-rules` bundles the linter rules and the GritQL plugins that replace the deleted guards, plus the new builtins noNestedComponentDefinitions, noMisusedPromises, useExhaustiveSwitchCases and noTsIgnore. `biome-app` now extends it. Suppress a plugin finding with `biome-ignore lint/plugin: <reason>`. `test-title` and the raw interactive element rule (`a`, `details`, `summary` in `raw-ui-in-app`) only warn, in the framework too, because the replaced guards only warned in repos without a baseline; every other plugin rule is an error. The screen container rule (`mx-auto` + `max-w-*`) is its own plugin `no-screen-container-classes` and does not apply under `public/`. `biome lint` takes about 3.2x as long with the plugins (every regex sits behind a cheap prefilter). The server-side plugins also scan `bin/` and `scripts/`. noImportCycles stays off (253 findings in the framework repo). noRestrictedImports flags type imports of temporal-polyfill too (the old guard allowed them); use `@cosmicdrift/kumiko-types/temporal`. The scaffold main.ts starts with `biome-ignore-all lint/style/noProcessEnv`, since it wires KMS from the environment before runProdApp parses the env contract.
  migration: Apps on `biome-app` get the preset automatically; fix new findings or suppress them with a reason. Repos with their own biome.json add `"extends": ["@cosmicdrift/kumiko-framework/biome-rules"]`.
  -->
  
  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: seedRowsViaEventStore seeds several rows through the event store
  detail: `@cosmicdrift/kumiko-testing/helpers` exports `seedRowsViaEventStore(db, table, rows)`, the event store counterpart of `seedRows`. Each row becomes its own event stream.
  -->

### Patch Changes

- 2fc6e19: Boot validation reports bootCheck crashes, unknown screen types and column widths more precisely, and `kumiko-schema validate --json` matches its exit code.
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: boot validator and schema CLI report crashes, unknown screen types and drift correctly
  detail: A runtime crash (TypeError and the like) inside `r.bootCheck` now surfaces as itself instead of a `boot-check/failed` finding, and a nested `BootValidationError` keeps its own violations. An unknown screen `type` is reported as such before the nav check can mask it. entityList rowActions share the list-action target validation, so navigate resolution lives in one place. Column `width` and `minWidth` above `LIST_COLUMN_MAX_WIDTH_PX` (2000, now in kumiko-types and shared with the renderer clamp) are rejected at boot. SQL derived fields reject `bigInt` fields, which a number valueType would round above 2^53. `kumiko-schema validate --json` adds a top-level `ok` plus `schemaDrift`, `migrations` and `rowLevelSecurity` results next to `boot`, and flags `boot.importAborted` when a runtime crash stopped the schema.ts import after violations were collected (human output warns too). The definition collector treats a crash as a follow-up only when the same feature already has a violation. `findEntity` ignores Object.prototype member names. `toEntityWebhookPayload` throws on a contract without a verb and covers all three verbs. `WEBHOOK_ENTITY_VERBS` is exported. The personal-access-token scope check names the actual reason (no opt-in, unknown entity, internal event) in its error.
  -->
- d49f073: The dev server measures file changes against the filesystem clock, drops closed reload clients and kills the Tailwind watcher when boot fails; the feature-ast codemods report the forms they cannot rewrite and skip needless work.
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: dev-server watcher, reload and boot cleanup; feature-ast codemod coverage
  detail: The dev-server file watcher takes its restart baseline from a probe file's mtime instead of Date.now(), so coarse or skewed filesystem clocks no longer swallow real schema edits. A cancelled /_reload stream removes its own client from the hub. A failed createKumikoServer boot kills the Tailwind --watch child it already started. The feature-ast-package codemod reports `export *`, element-access and destructuring reads of the old engine namespace, and dynamic import or import-type of the old module as manual sites, and skips the source walk for packages that already declare feature-ast. The ctx-namespaces codemod reports a structural context type that other parameters, mocks or references also use instead of rewriting it half way, and caches the per-parameter analysis. collectSourceFiles keeps honouring .gitignore per file when a submodule path makes the batch `git check-ignore` fail. The probe file sits in the watched directory, and a failed dev-server boot after the stop function exists tears the server down through it.
  -->
- 99bca8f: The server bundle lists `meilisearch` as a runtime dependency when only a subpath such as `meilisearch/token` is imported, the ctx-namespaces codemod respects job contexts in structural context types, the type-aware codemod project passes redirect references and module mode to module resolution, and a job that uses the whole shutdown budget no longer starves the shutdown steps after it.
  
  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: subpath imports of an optional runtime external count as an import
  detail: The server bundle only detected `import "meilisearch"`, so an app that imported just `meilisearch/token` and did not list `meilisearch` in its dependencies shipped a `dist-server/package.json` without it and crashed in production with `Cannot find package 'meilisearch'`. Subpath imports are detected now.
  -->
  
  <!-- kumiko-changes
  feature: feature-ast
  type: fix
  title: ctx-namespaces codemod reads the context kind a structural parameter receives
  detail: A structural context type that only a job context reaches kept being rewritten with the handler namespaces, for example `tracer` into `obs.tracer`, which `JobContext` does not carry. The codemod now collects the context kinds that reach the parameter: members that move the same way for all kinds are rewritten, members that move for one kind only are reported as manual. The type-aware project also forwards the redirected project reference and the module mode of the importing file to module resolution.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: fix
  title: job drain leaves a tail reserve of the shutdown budget
  detail: The SIGTERM timer and the job drain in `stop()` used the same budget, so a job that ran the whole time ended the process with exit code 1 before the HTTP shutdown, the escape-hatch audit flush and the connection close ran. The job drain now gets the budget minus a 5 s reserve (at least 1 s). `KUMIKO_SHUTDOWN_DRAIN_TIMEOUT_MS` is the budget for both.
  -->
  
  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: e2e fixture client ip header also overrides a per-fetch x-forwarded-for
  detail: The per-test client ip goes through `context.setExtraHTTPHeaders`, so an `x-forwarded-for` set in a single `fetch(..., { headers })` is replaced by it; only `page.setExtraHTTPHeaders` or a separate `browser.newContext()` with its own header changes the IP. This is now covered by `e2e/client-ip.spec.ts`.
  migration: Specs that simulate other client IPs per request (rate limit, audit IP, geo) must set the header with `page.setExtraHTTPHeaders` or on their own `browser.newContext()`; a per-fetch `x-forwarded-for` is overwritten. A cross-origin `fetch`/XHR from the page now carries `x-forwarded-for` and therefore forces a CORS preflight; route third-party endpoints that send no `Access-Control-Allow-Headers` through a same-origin proxy or mock them with `page.route`.
  -->
- Updated dependencies [d205705]
- Updated dependencies [9d88ba0]
- Updated dependencies [f0c33c6]
- Updated dependencies [896dc21]
- Updated dependencies [3aef6a9]
- Updated dependencies [f89bed5]
- Updated dependencies [92fe274]
- Updated dependencies [49c6fc0]
- Updated dependencies [e1893c9]
- Updated dependencies [1911d8d]
- Updated dependencies [48cfcd4]
- Updated dependencies [cc4c9a5]
- Updated dependencies [faecf4c]
- Updated dependencies [9e871cc]
- Updated dependencies [e979518]
- Updated dependencies [f47a9aa]
- Updated dependencies [3f340ae]
- Updated dependencies [e0ec0b6]
- Updated dependencies [c7fd68e]
- Updated dependencies [5ee88f6]
- Updated dependencies [b766f7b]
- Updated dependencies [9d88ba0]
- Updated dependencies [15412c7]
- Updated dependencies [227c31e]
- Updated dependencies [ba9a383]
- Updated dependencies [b1379a6]
- Updated dependencies [e4ca30c]
- Updated dependencies [25cc04c]
- Updated dependencies [ff40dff]
- Updated dependencies [f385601]
- Updated dependencies [ce5c846]
- Updated dependencies [44b87b5]
- Updated dependencies [740085b]
- Updated dependencies [2fc6e19]
- Updated dependencies [7c1c49b]
- Updated dependencies [29180e2]
- Updated dependencies [a3f60e9]
- Updated dependencies [37e950e]
- Updated dependencies [298da75]
- Updated dependencies [f504e08]
- Updated dependencies [a24a7e3]
- Updated dependencies [9708601]
- Updated dependencies [c0353fd]
- Updated dependencies [d49f073]
- Updated dependencies [713af52]
- Updated dependencies [a5da9b5]
- Updated dependencies [9afe1cb]
- Updated dependencies [dbe6689]
- Updated dependencies [7e147b4]
- Updated dependencies [29282f0]
- Updated dependencies [a27b14f]
- Updated dependencies [1368a58]
- Updated dependencies [f2eed7e]
- Updated dependencies [61b460a]
- Updated dependencies [44080a5]
- Updated dependencies [2fc3d53]
- Updated dependencies [81b9c1a]
- Updated dependencies [52a2969]
- Updated dependencies [f152b8f]
- Updated dependencies [b6f57e0]
- Updated dependencies [9bff1f2]
- Updated dependencies [911d5de]
- Updated dependencies [283f9a5]
- Updated dependencies [5406d5d]
- Updated dependencies [c4c28b5]
- Updated dependencies [9d88ba0]
- Updated dependencies [b27b2c7]
- Updated dependencies [ae7f685]
- Updated dependencies [dc3cde7]
  - @cosmicdrift/kumiko-framework@0.414.0
  - @cosmicdrift/kumiko-types@0.414.0

## 0.413.1

### Patch Changes

- Updated dependencies [cd65eb5]
  - @cosmicdrift/kumiko-types@0.413.1
  - @cosmicdrift/kumiko-framework@0.413.1

## 0.413.0

### Patch Changes

- Updated dependencies [06dfdb4]
- Updated dependencies [bc3aea0]
- Updated dependencies [0626fb7]
  - @cosmicdrift/kumiko-framework@0.413.0
  - @cosmicdrift/kumiko-types@0.413.0

## 0.412.0

### Patch Changes

- Updated dependencies [5d9b870]
- Updated dependencies [93aba34]
- Updated dependencies [348275a]
- Updated dependencies [84dd88f]
- Updated dependencies [f6a8fa7]
  - @cosmicdrift/kumiko-types@0.412.0
  - @cosmicdrift/kumiko-framework@0.412.0

## 0.411.0

### Patch Changes

- Updated dependencies [7985ab1]
- Updated dependencies [2ade68f]
  - @cosmicdrift/kumiko-types@0.411.0
  - @cosmicdrift/kumiko-framework@0.411.0

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

### Patch Changes

- Updated dependencies [f51a369]
  - @cosmicdrift/kumiko-types@0.410.0
  - @cosmicdrift/kumiko-framework@0.410.0

## 0.409.0

### Patch Changes

- 61cb538: Entity list queries take `onlyDeleted: true` and return just the soft-deleted rows, the list a trash screen needs next to `<entity>:restore`.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: List payload flag onlyDeleted for trash lists
  detail: The entity list query accepts onlyDeleted: true and returns only is_deleted rows. Tenant, ownership and read scopes, filter, search, totalCount and aggregate apply unchanged, with the same access rule as includeDeleted. onlyDeleted together with includeDeleted is a validation error, as is onlyDeleted on an entity without softDelete. Custom query handlers read it as ctx.onlyDeleted; export payloads drop it like includeDeleted.
  -->
- Updated dependencies [1eecc1d]
- Updated dependencies [4161aa8]
- Updated dependencies [dcca36c]
- Updated dependencies [a8e08cf]
- Updated dependencies [fb68269]
- Updated dependencies [61cb538]
- Updated dependencies [86e7f73]
- Updated dependencies [ef46965]
- Updated dependencies [41c8953]
- Updated dependencies [a9c8650]
- Updated dependencies [d680b38]
  - @cosmicdrift/kumiko-types@0.409.0
  - @cosmicdrift/kumiko-framework@0.409.0

## 0.408.0

### Patch Changes

- Updated dependencies [d7a16a4]
  - @cosmicdrift/kumiko-framework@0.408.0
  - @cosmicdrift/kumiko-types@0.408.0

## 0.407.0

### Patch Changes

- Updated dependencies [0929505]
- Updated dependencies [5da2b15]
- Updated dependencies [452d7fa]
  - @cosmicdrift/kumiko-framework@0.407.0
  - @cosmicdrift/kumiko-types@0.407.0

## 0.406.0

### Patch Changes

- Updated dependencies [bba71a9]
- Updated dependencies [bba71a9]
  - @cosmicdrift/kumiko-framework@0.406.0
  - @cosmicdrift/kumiko-types@0.406.0

## 0.405.0

### Patch Changes

- Updated dependencies [c0b5f51]
- Updated dependencies [403f98c]
- Updated dependencies [5f46e2b]
- Updated dependencies [6a35c7c]
- Updated dependencies [b3c8bc5]
  - @cosmicdrift/kumiko-framework@0.405.0
  - @cosmicdrift/kumiko-types@0.405.0

## 0.404.1

### Patch Changes

- Updated dependencies [a4a43c2]
  - @cosmicdrift/kumiko-framework@0.404.1
  - @cosmicdrift/kumiko-types@0.404.1

## 0.404.0

### Patch Changes

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
- Updated dependencies [7123167]
- Updated dependencies [7123167]
  - @cosmicdrift/kumiko-types@0.404.0
  - @cosmicdrift/kumiko-framework@0.404.0

## 0.403.0

### Patch Changes

- Updated dependencies [28ffdc2]
  - @cosmicdrift/kumiko-types@0.403.0
  - @cosmicdrift/kumiko-framework@0.403.0

## 0.402.0

### Patch Changes

- Updated dependencies [6fd7cbc]
- Updated dependencies [7822446]
- Updated dependencies [ba148ac]
  - @cosmicdrift/kumiko-framework@0.402.0
  - @cosmicdrift/kumiko-types@0.402.0

## 0.401.0

### Patch Changes

- Updated dependencies [a11ae25]
- Updated dependencies [2ee38e5]
  - @cosmicdrift/kumiko-framework@0.401.0
  - @cosmicdrift/kumiko-types@0.401.0

## 0.400.0

### Patch Changes

- Updated dependencies [5e5fa91]
- Updated dependencies [4bf242b]
- Updated dependencies [fa62e07]
- Updated dependencies [d8c43e7]
- Updated dependencies [10ee71d]
- Updated dependencies [e742383]
- Updated dependencies [10ee71d]
  - @cosmicdrift/kumiko-framework@0.400.0
  - @cosmicdrift/kumiko-types@0.400.0

## 0.399.0

### Patch Changes

- Updated dependencies [f6a0ca5]
- Updated dependencies [8cb9276]
- Updated dependencies [13a9366]
- Updated dependencies [13a9366]
- Updated dependencies [13a9366]
  - @cosmicdrift/kumiko-framework@0.399.0
  - @cosmicdrift/kumiko-types@0.399.0

## 0.398.0

### Patch Changes

- Updated dependencies [1b96c8c]
- Updated dependencies [0fe069a]
  - @cosmicdrift/kumiko-types@0.398.0
  - @cosmicdrift/kumiko-framework@0.398.0

## 0.397.0

### Patch Changes

- Updated dependencies [e771b3d]
- Updated dependencies [390025c]
- Updated dependencies [9be3d0d]
- Updated dependencies [e771b3d]
- Updated dependencies [390025c]
- Updated dependencies [390025c]
  - @cosmicdrift/kumiko-framework@0.397.0
  - @cosmicdrift/kumiko-types@0.397.0

## 0.396.0

### Patch Changes

- Updated dependencies [dd12c0d]
  - @cosmicdrift/kumiko-framework@0.396.0
  - @cosmicdrift/kumiko-types@0.396.0

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

### Patch Changes

- Updated dependencies [6599341]
- Updated dependencies [373a722]
  - @cosmicdrift/kumiko-types@0.395.0
  - @cosmicdrift/kumiko-framework@0.395.0

## 0.394.0

### Patch Changes

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
- Updated dependencies [6effc06]
- Updated dependencies [307f9cb]
- Updated dependencies [6831978]
- Updated dependencies [a91f814]
- Updated dependencies [9638cd4]
- Updated dependencies [9c4e277]
- Updated dependencies [d24b405]
- Updated dependencies [eecf6fa]
- Updated dependencies [9638cd4]
- Updated dependencies [a91f814]
  - @cosmicdrift/kumiko-framework@0.394.0
  - @cosmicdrift/kumiko-types@0.394.0

## 0.393.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.393.0
  - @cosmicdrift/kumiko-types@0.393.0

## 0.392.2

### Patch Changes

- Updated dependencies [970a751]
  - @cosmicdrift/kumiko-framework@0.392.2
  - @cosmicdrift/kumiko-types@0.392.2

## 0.392.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.392.1
  - @cosmicdrift/kumiko-types@0.392.1

## 0.392.0

### Patch Changes

- 383b6a8: The `kumiko-testing` bin and the feature-ast codemods now expose a `main(argv)` that returns the exit code, so their logic can run in-process. Command-line behavior and exit codes are unchanged.
  
  <!-- kumiko-changes
  feature: feature-ast
  type: improvement
  title: Codemod entries return their exit code
  detail: The feature-ast codemods export main(argv) and runCodemod next to runCodemodCli; they return an exit code instead of calling process.exit, so callers can run them in-process. Invocation from the shell is unchanged.
  -->
  
  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: kumiko-testing exports main(argv, io)
  detail: The kumiko-testing bin exports main(argv, io), which returns the exit code and writes through the given io, so its commands can run in-process. Invocation from the shell is unchanged.
  -->
- Updated dependencies [383b6a8]
- Updated dependencies [99eea8a]
- Updated dependencies [3cfb343]
- Updated dependencies [3d7f455]
- Updated dependencies [c22ca75]
- Updated dependencies [05c9bef]
- Updated dependencies [c639de3]
  - @cosmicdrift/kumiko-framework@0.392.0
  - @cosmicdrift/kumiko-types@0.392.0

## 0.391.1

### Patch Changes

- 3e81444: The type-aware codemods (ctx-namespaces, remove-engine-payload-casts) resolve every zod import from the app root. An app that pins a different zod than the framework packages gets one nested zod per package, and the type checker then compared the app's schemas structurally against that copy at every framework call taking one. On a small app this took ctx-namespaces, run by kumiko-upgrade --apply, to 17 GB and 36 s. It now needs 1.1 GB and 3 s with the same rewrites.
  
  <!-- kumiko-changes
  feature: feature-ast
  type: fix
  title: Type-aware codemods no longer exhaust memory when the app pins another zod
  detail: ctx-namespaces and remove-engine-payload-casts build their ts-morph project with a resolution host that resolves zod and its subpaths from the app root, so the program holds one zod copy even when bun nests a second version under each framework package. Without zod at the app root, resolution is unchanged. A small app with zod 4.6.6 next to framework packages on 4.6.7 went from 17 GB and 36 s to 1.1 GB and 3 s for ctx-namespaces, with the same rewrites.
  -->
- Updated dependencies [70ceb25]
  - @cosmicdrift/kumiko-framework@0.391.1
  - @cosmicdrift/kumiko-types@0.391.1

## 0.391.0

### Patch Changes

- 37dfda5: Codemods run on machines without git, such as the customer-app builder image.
  
  <!-- kumiko-changes
  feature: feature-ast
  type: fix
  title: Codemods no longer fail when git is not installed
  detail: collectSourceFiles asks git check-ignore which files the repository's .gitignore excludes. Without a git executable Bun.spawnSync threw ENOENT and kumiko-upgrade --apply aborted at the first codemod, for example ctx-namespaces in the customer-app builder image. A missing git is now treated like a directory outside a repository: no file is filtered.
  -->
- Updated dependencies [8e6d41e]
- Updated dependencies [c823c6f]
- Updated dependencies [6629d51]
- Updated dependencies [ffe0424]
  - @cosmicdrift/kumiko-framework@0.391.0
  - @cosmicdrift/kumiko-types@0.391.0

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
- Updated dependencies [8297c01]
  - @cosmicdrift/kumiko-framework@0.390.1
  - @cosmicdrift/kumiko-types@0.390.1

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
- 454b49d: Feature AST, pattern library and codemods moved to the new package @cosmicdrift/kumiko-feature-ast; kumiko-upgrade heals stale open lines in CHANGELOG.md
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: Feature AST, pattern library and codemods moved to @cosmicdrift/kumiko-feature-ast
  codemod: scripts/codemod/feature-ast-package.ts
  migration: |
    Import these names from @cosmicdrift/kumiko-feature-ast instead of @cosmicdrift/kumiko-framework/engine: AddEntityArgs, AddHookArgs, AddRelationArgs, AddWriteHandlerArgs, FeaturePatcher, FeaturePattern, FeaturePatternKind, FormFieldLabel, FormFieldSpec, FormInputType, HandlerHeaderUpdate, ParseError, ParseResult, PatternCategory, PatternChange, PatternChangeIssue, PatternChangesParseResult, PatternFormSchema, PatternId, RenderFeatureFileInput, SourceLocation, PATTERN_LIBRARY, VERSION_HEADER, addPattern, applyChanges, createFeaturePatcher, getPatternSchema, groupByCategory, parseFeatureFile, parsePatternChanges, parseSourceFile, removePattern, renderFeatureFile, renderPattern, replacePattern, updatePattern. Import CodemodOptions, CodemodReport, CodemodResult, FileAnalysis, ParsedHandlerInfo, analyzeFile, analyzeHandlerArrow, convertFile, generatePerformBlock, runCodemod, scanForCandidates from @cosmicdrift/kumiko-feature-ast/codemod instead of @cosmicdrift/kumiko-framework/engine/codemod. Add @cosmicdrift/kumiko-feature-ast to the dependencies of the importing package; the codemod does both. @cosmicdrift/kumiko-framework no longer installs ts-morph.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: fix
  title: kumiko-upgrade --apply and --resolve heal stale open lines in CHANGELOG.md
  migration: |
    Every manual migration the upgrade marker lists as resolved gets its status in CHANGELOG.md, including `- [open]` lines in older sections left behind by a resolve with an older CLI.
  -->
  
  <!-- kumiko-changes
  feature: feature-ast
  type: improvement
  title: New package @cosmicdrift/kumiko-feature-ast
  -->
  
  The feature-file AST (parse, patch, render), the pattern library and the upgrade codemods now live in their own package, so the framework and its production images no longer carry ts-morph. The package publishes `.` and the Bun-only `./codemod`.

### Patch Changes

- 4d004e0: The ctx-namespaces codemod rewrites hand-written structural context types declared as a type alias, an interface or an intersection, not only inline ones.
  
  <!-- kumiko-changes
  feature: feature-ast
  type: fix
  title: ctx-namespaces codemod follows structural context types through aliases and intersections
  codemod: scripts/codemod/ctx-namespaces.ts
  detail: A parameter named ctx or context typed by a hand-written structural type such as type PatternQueryContext = { readonly query: ... } was left alone, so the type kept the flat member and every ctx.query call failed to type-check after the context namespaces landed. The codemod now nests the moved members of such an alias, interface, inline literal or intersection of them (readonly query becomes readonly dispatch: { readonly query }) and rewrites the calls in the body, when a handler or job context is passed to that parameter anywhere in the project. A structural type declared in another file is reported as manual.
  migration: |
    Run kumiko-upgrade --apply again; the ctx-namespaces codemod now picks up structural context parameter types. Types it reports as manual (declared in another file) get their moved members nested by hand.
  -->
- Updated dependencies [1a7eebe]
- Updated dependencies [5d7dfe1]
- Updated dependencies [a01d30a]
- Updated dependencies [454b49d]
- Updated dependencies [21b70ba]
- Updated dependencies [be576a7]
- Updated dependencies [5ee91c6]
- Updated dependencies [febcd93]
- Updated dependencies [abef0e6]
- Updated dependencies [01a611f]
- Updated dependencies [c2fd4b3]
- Updated dependencies [3131c5c]
- Updated dependencies [8d06990]
- Updated dependencies [c2fd4b3]
- Updated dependencies [6d20414]
- Updated dependencies [f6d230f]
- Updated dependencies [e0e2dfe]
- Updated dependencies [22f9f23]
- Updated dependencies [6c1151a]
- Updated dependencies [54cda5b]
- Updated dependencies [9e6de88]
  - @cosmicdrift/kumiko-framework@0.390.0
  - @cosmicdrift/kumiko-types@0.390.0
