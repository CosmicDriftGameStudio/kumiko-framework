# @cosmicdrift/kumiko-guards

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
- 9400d43: kumiko-http moves into kumiko-framework and kumiko-repo-manifest into kumiko-guards. The old packages stay as deprecated re-export shims until the consumer pass of wave 4. The new `package-merge` codemod rewrites imports and package.json dependencies.
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: http moved into framework
  detail: egress(), the host policy helpers and their errors are implemented in @cosmicdrift/kumiko-framework/http. @cosmicdrift/kumiko-http now only re-exports that subpath and is removed after the consumer pass of wave 4.
  migration: Run bun kumiko-upgrade --apply, or bun kumiko codemod package-merge . --write. It rewrites imports of @cosmicdrift/kumiko-http to @cosmicdrift/kumiko-framework/http and replaces the kumiko-http dependency in package.json with kumiko-framework.
  codemod: scripts/codemod/package-merge.ts
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: repo-manifest moved into guards
  detail: The kumiko.json schema and loader are exported from @cosmicdrift/kumiko-guards/repo-manifest, the app port reader from @cosmicdrift/kumiko-guards/repo-manifest/app-ports. @cosmicdrift/kumiko-repo-manifest now only re-exports them and is removed after the consumer pass of wave 4. @cosmicdrift/kumiko-framework is an optional peer for the app-ports subpath.
  migration: Run bun kumiko-upgrade --apply, or bun kumiko codemod package-merge . --write. It rewrites imports of @cosmicdrift/kumiko-repo-manifest (and its /app-ports subpath) to @cosmicdrift/kumiko-guards/repo-manifest and replaces the dependency in package.json with kumiko-guards.
  codemod: scripts/codemod/package-merge.ts
  -->
  
  <!-- kumiko-changes
  feature: http
  type: improvement
  title: kumiko-http is a deprecated shim over kumiko-framework/http
  detail: The package only re-exports @cosmicdrift/kumiko-framework/http and is removed after the consumer pass of wave 4.
  migration: Import from @cosmicdrift/kumiko-framework/http, or run bun kumiko codemod package-merge . --write.
  -->
  
  <!-- kumiko-changes
  feature: repo-manifest
  type: improvement
  title: kumiko-repo-manifest is a deprecated shim over kumiko-guards/repo-manifest
  detail: The package only re-exports @cosmicdrift/kumiko-guards/repo-manifest and its app-ports subpath and is removed after the consumer pass of wave 4.
  migration: Import from @cosmicdrift/kumiko-guards/repo-manifest, or run bun kumiko codemod package-merge . --write.
  -->
  
  <!-- kumiko-changes
  feature: cli
  type: improvement
  title: kumiko codemod lists package-merge
  detail: kumiko codemod package-merge rewrites imports and package.json dependencies of merged packages.
  -->
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

- 6a15526: Managed workflows pin the infra reusables through `package.json#kumiko.deploy.infraRef` and have a public variant. `kumiko-upgrade --apply` writes a CHANGELOG.md. The pre-push bypass is gone. The testing preload reads the Meilisearch port from the app config.
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: Managed workflows take infraRef, visibility and app-* jobs
  detail: ci.yml and release.yml render the infra reusables as @<infraRef> from package.json#kumiko.deploy.infraRef. Without it sync-managed renders @main and kumiko check managed warns; this warning becomes an error in a later release. kumiko.deploy.visibility "public" renders a self-contained ci.yml and a release.yml that only prints the gh workflow run hint for the public rollout. Jobs named app-* survive a sync and are not drift. kumiko.deploy.docStatusGuard false renders doc-status-guard false.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: The pre-push bypass is gone
  detail: PRE_PUSH_SKIP no longer skips the hook, neither in the shipped hook nor in kumiko-pre-push. KUMIKO_CHECK_WT=1 only stops the hook from re-entering a wrapping scripts/check-wt.sh. The i18n-keys guard treats keys defined by installed @cosmicdrift packages as known.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: kumiko-upgrade writes CHANGELOG.md and shows manual entries with --verbose
  detail: --apply adds one section per bump to CHANGELOG.md in the app (changed packages, breaking titles, manual migrations with status, codemods applied); a re-run of the same bump replaces its section. --verbose prints detail and migration of the open manual entries. A second --apply keeps the codemods already recorded in the marker. The biome-app preset allows console in bin and scripts. AppConfig takes an optional includeBundled flag that the managed kumiko/schema.ts uses to compose the bundled auth features.
  -->
  
  <!-- kumiko-changes
  feature: repo-manifest
  type: improvement
  title: App port reader moves to repo-manifest/app-ports
  detail: listAppPorts, findPortCollisions, scanWorkspaceApps and readStaticAppConfig are exported from @cosmicdrift/kumiko-repo-manifest/app-ports. dev-server managed-files re-exports the same names.
  -->
  
  <!-- kumiko-changes
  feature: testing
  type: fix
  title: MEILI_URL in the test preload follows the app's Meilisearch port
  detail: service-env-defaults derives MEILI_URL from ports.infra.meilisearch of the app's kumiko.config.ts when the variable is unset; without a configured port the old default stays.
  -->
  
  <!-- kumiko-changes
  feature: cli
  type: fix
  title: kumiko ports and sync-managed use the shared port reader and print managed warnings
  detail: kumiko ports reads from repo-manifest/app-ports; check managed and sync-managed print the infraRef warning.
  -->

### Patch Changes

- Updated dependencies [6a15526]
  - @cosmicdrift/kumiko-repo-manifest@0.376.0

## 0.375.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.375.0

## 0.374.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.374.0

## 0.373.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.373.0

## 0.372.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.372.0

## 0.371.1

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.371.1

## 0.371.0

### Minor Changes

- 0b5267f: test-timeouts guard covers hook timeouts, recipes and scripts/bin tests
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: test-timeouts guard flags hook timeouts and scans recipes
  detail: The test-timeouts guard now also fails on a timeout argument to beforeAll, beforeEach, afterAll and afterEach, as a number or as a { timeout } object, including renamed and namespace imports from bun:test. The samples/recipes exemption is gone, recipe tests and their e2e dirs are scanned like every other test. The kumiko.json of the framework repo scans tests under scripts and bin as well. There is no baseline.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: import-extensions guard skips imports of build output
  detail: A relative specifier with a dist/ path segment, such as a published bin importing ../dist/cli.js, is no longer reported. The .js there is the only file that exists.
  -->

### Patch Changes

- 5a822b2: Consumer findings from the second rollout wave
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: Default mail resolveEmail finds users of any tenant
  detail: The default resolveEmail of the mail boot option loads the user by id only. Rows in read_users carry the system tenant, so the former tenantId filter returned null for every real tenant.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: extraContext factories see the boot env, billing hook and new exports
  detail: The merged env, including the defaults of declarative boot options such as FILE_STORAGE_PROVIDER from fileStorage, is passed to extraContext factories as env. resolveBillingOption, parseRunMode, HostDispatchFn, buildDemoModeRoute and withDemoReadOnlyFetch are exported from the package index. The billing boot option accepts afterSync.
  -->
  
  <!-- kumiko-changes
  feature: file-provider-s3
  type: improvement
  title: S3 endpoint over http outside production
  detail: s3EndpointSchema rejects http on non-loopback hosts only when NODE_ENV=production, so compose hostnames such as minio work in smoke setups.
  -->
  
  <!-- kumiko-changes
  feature: auth-foundation
  type: improvement
  title: Boot warning when anonymous routes run without anonymousAccess
  detail: A boot warning names anonymousAccess when host-routing, managed-pages or legal-pages is mounted without it; anonymous requests get no tenant until the option is set.
  -->
  
  <!-- kumiko-changes
  feature: billing-foundation
  type: improvement
  title: Billing webhook sync exposes afterSync
  detail: The billing webhook sync calls afterSync({ tenantId, tier, changed, event }) after every webhook, with changed false when the tier stayed the same.
  -->
  
  <!-- kumiko-changes
  feature: delivery
  type: improvement
  title: Unsubscribe endpoint answers form posts with an HTML page
  detail: POST on the delivery unsubscribe route returns an HTML confirmation page for a form post and JSON for a bare POST. The behavior is unchanged; this only documents it.
  migration: Clients that post the unsubscribe form expect HTML, API clients that post without a form content type expect JSON. No code change is needed.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Dry-run env table and boot check respect required overrides and the fileStorage default
  detail: The env table of KUMIKO_DRY_RUN_ENV=boot shows a variable as required when the app schema overlays required() on an optional field, and the error says required. The schema-cli boot check applies runProdApp's fileStorage default instead of demanding FILE_STORAGE_PROVIDER.
  -->
  
  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: Scaffold test:dom passes without test files
  detail: The scaffold sets test:dom to pass without test files and adds the devDependencies @testing-library/react, @testing-library/dom and @happy-dom/global-registrator.
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Pre-push shim stops at the repo boundary, nearest kumiko.json wins, process.env guard covers bin
  detail: The pre-push shim searches upward only through ancestors up to the git root and fails with a message when nothing is found. findLocalRepo prefers the nearest kumiko.json over the git root. guard-no-direct-process-env scans bin/**/*.ts including bin/ops.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: composeGdprStack access, composePagesStack terms, migrate-step project name
  detail: composeGdprStack({ access }) is passed to compliance-profiles and composeOpsStack({ access }) to delivery as their handler roles. composePagesStack({ terms }) is passed to legal-pages. DevHostDispatch and DevHostDispatchResult are exported. The migrate-step.sh template and the managed pre-push template follow the show-pony version, with the compose project name taken from docker compose config.
  -->
  
  <!-- kumiko-changes
  feature: cli
  type: improvement
  title: kumiko codemod lists and runs codemods
  detail: kumiko codemod lists the codemods without a name. kumiko codemod <name> runs one against the current directory as a dry run and applies it with --write.
  -->
  
  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: Missing-screen page spaces title and hint like other cards
  detail: The page-not-available card renders title and hint through the Card title and subtitle slots.
  -->
  
  <!-- kumiko-changes
  feature: locale-de
  type: improvement
  title: errors.demoReadOnly translated
  detail: The read-only demo error has German copy in the informal and formal catalogs.
  -->
  
  <!-- kumiko-changes
  feature: locale-es
  type: improvement
  title: errors.demoReadOnly translated
  detail: The read-only demo error has Spanish copy.
  -->
- @cosmicdrift/kumiko-repo-manifest@0.371.0

## 0.370.0

### Minor Changes

- 4a6e151: Relative imports name the TypeScript source file
  
  <!-- kumiko-changes
  feature: framework
  type: breaking
  title: import-extensions codemod and tsconfig options for .ts import specifiers
  detail: The import-extensions codemod rewrites relative import and export specifiers that end in .js or .jsx to the .ts or .tsx file next to the importer (import, export from, import type, import() and mock.module). It leaves a specifier alone and reports it when no such file exists. The framework repo itself now imports with .ts endings; its published dist is unchanged. tsc writes .js into the dist, and the .d.ts files keep .ts specifiers, which TypeScript resolves to the sibling .d.ts. An app tsconfig needs allowImportingTsExtensions: true, because the framework packages now ship sources with .ts specifiers and tsc checks them (the preset @cosmicdrift/kumiko-framework/tsconfig.app.json sets it). A tsconfig that emits JS also needs rewriteRelativeImportExtensions (TypeScript 5.7 or newer); a project that only type-checks code from another project reference needs rewriteRelativeImportExtensions false plus emitDeclarationOnly. Consumer code with .js endings keeps running once the option is set.
  migration: Add `allowImportingTsExtensions: true` to the app tsconfig (or extend @cosmicdrift/kumiko-framework/tsconfig.app.json), then run the codemod (bun node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/import-extensions.ts . --write); the guard import-extensions reports remaining .js specifiers.
  codemod: scripts/codemod/import-extensions.ts
  -->
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: import-extensions guard reports relative .js and .jsx specifiers
  detail: The import-extensions guard fails on a relative specifier that ends in .js or .jsx in a .ts or .tsx file (import, export from, import type and import()). Declaration files and fixtures are skipped. The message points to the import-extensions codemod. There is no baseline.
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

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.370.0

## 0.369.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.369.0

## 0.368.0

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
- @cosmicdrift/kumiko-repo-manifest@0.368.0

## 0.367.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.367.0

## 0.366.0

### Minor Changes

- 7053800: New guard api-object-form flags positional registrar calls
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: kumiko-guards gains the api-object-form guard
  detail: The guard fails on a positional r.writeHandler, r.queryHandler, r.entity, r.requires or r.hook call and on registerEntityCrud, and names the object form to use. It runs with the default kumiko-guards checks. The direct-entity-writes guard now also reads entity registrations written in the object form, including a backingTable override.
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

### Patch Changes

- 3d58dea: Error boundaries keep a render error from blanking the whole page
  
  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: A throwing screen shows an error card instead of a blank page
  detail: createKumikoApp wraps the active screen in a boundary that keeps the shell and navigation visible, shows a card with the screen name and a reload action, and resets on route change. A second boundary around the whole app shows a minimal provider-free fallback. Both log the error with console.error. createKumikoApp takes an onError option for telemetry. kumiko-testing/e2e exports boundaryGuardedTest, a plain Playwright test that fails a spec when a boundary caught an error; the seeded test builds on it.
  -->
- @cosmicdrift/kumiko-repo-manifest@0.366.0

## 0.365.1

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.365.1

## 0.365.0

### Patch Changes

- 82dc9a4: public-exports-changelog: --base ratchets drops against the merge-base baseline, coverage matches whole identifiers
  
  <!-- kumiko-changes
  feature: guards
  type: fix
  title: public-exports-changelog --base=<ref> checks drops against the baseline of the merge-base and matches exported names as whole identifiers
  detail: Check mode with --base=<ref> reads .kumiko-public-exports-baseline.json from the merge-base and sends every drop against it through the changelog/changeset ratchet, so a PR can no longer hide a removal by editing or deleting the baseline. An unknown ref is an error; a base without a baseline is a bootstrap. A changelog entry or open changeset covers a drop only when every dropped name appears in it as a whole identifier (getUserById no longer covers getUser). An unparsable changes.json is reported on stderr with its path. check-wt.sh, the worktree pre-push branch and the legacy check step pass the base.
  -->
- b6b75fa: test-timeouts no longer flags identifier test bodies, push-root judges repo paths by their checkout, security baseline errors carry a readable detail
  
  <!-- kumiko-changes
  feature: guards
  type: fix
  title: guard-test-timeouts ignores identifier test bodies and timeout-free options; push-root no longer trusts a lookalike folder name
  detail: An identifier passed as a test argument only counts as a timeout when its type is a number or has a timeout property, so Playwright's test(title, details, body) and options like { retry: 2 } pass. A push root that resolves to a git repo is judged by its canonical checkout name, not by its folder name. An unexpected security baseline shape keeps the reason unexpected_baseline_shape and adds a readable detail.
  -->
- @cosmicdrift/kumiko-repo-manifest@0.365.0

## 0.364.0

### Minor Changes

- dfb2523: Agent guide and generated indexes ship in the framework package
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Agent guide and generated indexes ship in the framework package
  detail: The framework package now contains AGENTS.md plus an agents/ directory with generated feature, widget and example indexes, built from feature-manifest.json, the renderer-web exports and samples/recipes. The new agent-docs-drift guard in kumiko check fails when the committed files differ from the generator output. New apps get an AGENTS.md and a CLAUDE.md that point at the packaged guide.
  -->
- a0dcd31: Add the licenses, security and outdated dependency checks to kumiko-guards
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: kumiko-guards gains licenses, security and outdated subcommands
  detail: bunx kumiko-guards licenses classifies installed packages against a licence allow/gray/deny policy, security runs bun audit (critical and high block, exceptions expiring within 14 days block), outdated fails on deprecated direct dependencies, warns with the reason for every package the registry did not answer and fails when it answered for none. All three scan the repo cwd sits in (installed packages from node_modules of the repo, its workspace members and every ancestor directory; the repo's bun.lock or the nearest ancestor's) and fail loudly when nothing is found. Each takes --report. They are not part of the default run or the checks bundle because they use the network. Exceptions need reason, reviewer and expiry; the package ships defaults and merges dependency-license-exceptions.json from the repo root and every ancestor whose node_modules was scanned, and dependency-security-exceptions.json from the repo root and the audited lockfile directory.
  -->
- 2b255c2: kumiko-pre-push scans the pushed commits with gitleaks
  
  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: kumiko-pre-push runs a gitleaks scan of origin/main..HEAD before the checks
  detail: When the gitleaks binary is installed, the hook runs `gitleaks git --redact --log-opts=origin/main..HEAD` in the repo root and blocks the push on a finding. A `.gitleaks.toml` in the repo root is picked up by gitleaks itself. Without the binary or without origin/main the hook only prints a warning and continues (install with `brew install gitleaks`).
  -->

### Patch Changes

- cfbffba: Boot-validator and guard messages say how to fix the problem
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Boot-validator and guard messages name the fix
  detail: Boot-validator and guard messages that only described the problem now also say what to do about it. The German configEdit and retention messages are in English. Validation and guard behavior is unchanged.
  -->
- 15039ce: comment-lang: fewer false positives, division detection after keywords and non-null, push checks HEAD
  
  <!-- kumiko-changes
  feature: guards
  type: fix
  title: comment-lang needs two lower-case markers, scans HEAD in touched mode and recognises division after keywords
  detail: The short German markers now match case-sensitively in lower case and need two hits, so a licence header such as "MIT License" no longer counts; an umlaut alone still does. The scanner treats a slash after contextual keywords (from, type, get, of, ...) and after the non-null postfix as division instead of a regex, so a German comment after "width! / 2" is no longer hidden. --touched compares the diff of mergeBase to HEAD and scans the file contents from HEAD, so the pre-push hook checks the commits being pushed rather than local uncommitted edits.
  -->
- 15039ce: guard-upgrade-state keeps legacy pendingManual steps and reports malformed ones
  
  <!-- kumiko-changes
  feature: guards
  type: fix
  title: guard-upgrade-state keeps legacy pendingManual steps and reports malformed ones
  detail: Marker entries written before pendingManual carried an id were dropped silently, so a repo with open manual steps passed the guard. The guard now derives the id from version and title like kumiko-upgrade does, and a structurally broken pendingManual entry is reported instead of filtered out.
  -->
- 7e36bfe: The text-field-stance guard test only counts the guard's own warnings, so unrelated async warnings from other test files in the same run no longer fail it.
  
  <!-- kumiko-changes
  feature: guards
  type: fix
  title: text-field-stance guard test no longer fails on unrelated warnings in a shared test run
  detail: The test spied on console.warn globally and asserted zero calls. In a run that shares one process across test files, async warnings from other files (job-runner stop, mail egress) landed in the spy and turned main red. The assertion now only counts calls with the guard's own warn prefix. No change to the guard itself.
  -->
- @cosmicdrift/kumiko-repo-manifest@0.364.0

## 0.363.0

### Minor Changes

- a12e094: As-casts guard fails on baseline regressions

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: As-casts guard fails on baseline regressions
  detail: check-as-casts now returns violations for more suspect casts per file and target than the baseline, for unknown or missing @cast-boundary reasons in repo-local files (only when a baseline exists), and for a baseline with a drifted format. Repos without a baseline and sibling checkouts under ../ still only warn.
  -->

### Patch Changes

- a12e094: Remove unknown cast-boundary reasons and share propertyOf

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Remove unknown cast-boundary reasons and share propertyOf
  detail: Framework internals read untyped properties through the shared propertyOf from kumiko-types instead of private copies and casts. The as-casts guard knows four more boundary reasons (phantom-brand, third-party-type-gap, dom-event-target, feature-exports) and normalizes whitespace in cast targets so re-indenting a multi-line cast no longer counts as a regression. A stored inbound-mail cursor that is not a JSON object is now treated like a missing cursor.
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.363.0

## 0.362.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.362.0

## 0.361.0

### Patch Changes

- 828a782: comment-lang scans tooling repos, no longer rescans a division as a regex literal, and honours KUMIKO_PUSH_REPO_ROOT only when KUMIKO_CLI_SCOPE names that checkout. The scan-scope helpers scanFiles and scanRoots are exported.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: comment-lang guard scans tooling repos, handles division before a comment and ignores a stale KUMIKO_PUSH_REPO_ROOT
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.361.0

## 0.360.0

### Minor Changes

- 94abdbb: Add the public-exports-changelog guard: a dropped public export of packages/framework or packages/bundled-features fails unless a breaking changelog entry names it before the baseline is refrozen

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: New public-exports-changelog guard (kumiko-guards public-exports-changelog) ratchets the public export surface of framework and bundled-features
  -->

### Patch Changes

- cc46b78: public-exports-changelog: an open breaking changeset only covers a dropped export when its title, detail or migration names that export, and the finding hint points to a changeset block plus `--write-baseline` instead of `kumiko changes add`.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: public-exports-changelog requires the open breaking changeset to name the dropped export
  detail: Before, any open breaking kumiko-changes block of the owning feature let --write-baseline drop every export of that feature. Now the block's title, detail or migration must contain at least one dropped name, the same rule changes.json entries already follow. The finding hint and the report hint name the .changeset block and bun packages/guards/src/cli.ts public-exports-changelog --write-baseline. pendingBreakingFeaturesIn and loadPendingBreakingFeatures are renamed to pendingBreakingChangesIn and loadPendingBreakingChanges and return feature to block texts; featureFlagForCli is removed.
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.360.0

## 0.359.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.359.0

## 0.358.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.358.0

## 0.357.0

### Patch Changes

- 32ffb5a: comment-lang reports an unreadable or non-object baseline instead of crashing

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: comment-lang reports an unreadable or non-object baseline instead of crashing
  detail: |
    `kumiko-guards comment-lang` with a baseline file that is not valid JSON, is `null` or has a `null` perFile now prints a baseline-format message and exits 1 instead of throwing a TypeError. A security baseline with the wrong shape now reports the reason `unexpected_baseline_shape`.
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.357.0

## 0.356.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.356.0

## 0.355.0

### Minor Changes

- 52c16c5: Security guards ignore kumiko.json excludes beyond node_modules and dist; kind framework is reserved for kumiko-framework

  <!-- kumiko-changes
  feature: guards
  type: breaking
  title: Security guards ignore kumiko.json excludes beyond node_modules and dist; kind framework is reserved for kumiko-framework
  migration: |
    Security guards (No-Direct-Fs, Direct-Entity-Writes, Direct-Fetch, Tenant-Escalation, Admin-API, Access-Denied-Test, Open-To-All-Reason, Escape-Hatch-Declared) now scan files matched by your kumiko.json excludes; fix the findings or add a precise guard allowlist entry. A kumiko.json with kind framework outside the kumiko-framework package now fails root resolution; use library or app. Direct-Entity-Writes now sees table arguments behind casts (`table as T`, parentheses, non-null), so a cast no longer hides a direct write. i18n-Locale-Mount handles conditional spreads, alias depth and circular constants.
  -->

- 8d253d6: test-timeouts guard flags timeout arguments on test(), it() and describe()

  <!-- kumiko-changes
  feature: guards
  type: breaking
  title: test-timeouts guard flags timeout arguments on test(), it() and describe()
  migration: |
    Remove the timeout argument from test/it/describe calls (test(name, fn, 30_000), test(name, fn, { timeout }), also via .skip/.only/.if()/.each()) and fix the cause: poll with waitFor/expect.poll, shrink the data set, share expensive setup in beforeAll. setDefaultTimeout and describe.configure through renamed or namespace bun:test imports are flagged too. A justified remainder gets '// @timeout-exception: #<issue> <reason>' on the line above the call.
  -->

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.355.0

## 0.354.1

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.354.1

## 0.354.0

### Minor Changes

- beab610: Review batch H2: framework parts of consumer-app findings.

  - `file-derivatives`: the `isPublic` predicate args carry `fileRefId`, so a predicate can reject a client-spoofed FileRef that claims another entity's `entityId`/`fieldName`.
  - `sessions`: `createSessionsFeature({ adminAccess: "systemAdmin" })` narrows the admin list/detail queries and both admin screens together (default `"admin"`, unchanged).
  - `user-profile`: `change-email` is open to every signed-in user (`openToAll`), so a tenant member whose only role is `TenantAdmin` can change their own email; the handler still re-checks the password.
  - `notes-history`: composite index on `(tenantId, entityType, entityId)` for note entries. Apps run `kumiko-schema generate` after the bump.
  - guards: `// kumiko-lint-ignore a,b reason` suppresses several guards on one line (`lineHasIgnoreTag`); `primitives-discipline` and `no-custom-primitives` honour it.
  - dev-server: `kumiko-build --check` verifies `.kumiko/` is current without writing (exit 1 on drift); `runCodegen` takes `checkOnly`.

  <!-- kumiko-changes
  feature: notes-history
  type: breaking
  title: notes-history adds a composite index on (tenantId, entityType, entityId) for note entries, so the schema-drift check fails until the app regenerates
  migration: Run `kumiko-schema generate` in apps that mount notes-history and commit the generated migration.
  -->

### Patch Changes

- b0fbbd4: The Real-Provider-Isolation guard allows `test:real`, `e2e:real` and `KUMIKO_REAL_PROVIDERS` in CI workflows whose `on:` triggers are exclusively `schedule` and/or `workflow_dispatch`, so an app can run its real-provider suite weekly or by hand. Any other trigger next to them (`push`, `pull_request`, `pull_request_target`, `workflow_call`, ...) or a workflow without a parseable `on:` is still a violation.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Real-Provider-Isolation guard allows real runs in schedule- or workflow_dispatch-only workflows
  -->

- a7bbfc3: Final review batch G: guards and tooling

  The security guards (`direct-fetch`, `direct-entity-writes`, `tenant-escalation`, `unsafe-json-parse`, `html-escape`, `no-direct-fs`, `restricted-symbols`, `admin-api`, `access-denied-test`, `open-to-all-reason`, `escape-hatch-declared`) now scan a `tooling` root too. `direct-fetch` rejects a `guard-allow` marker without a specific reason. The `direct-entity-writes` canary also blocks when table declarations exist but write resolution finds nothing. `@cosmicdrift/kumiko-types` accepts the `postgres` prerelease alias in its peer range.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: Security guards scan the tooling root, direct-fetch guard-allow needs a concrete reason, types postgres peer accepts the prerelease alias
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.354.0

## 0.353.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.353.0

## 0.352.0

### Minor Changes

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

- 9fb0657: The upgrade-state guard fails while manual upgrade steps are open

  `kumiko-upgrade --apply` records breaking changes without a codemod as `pendingManual` in `.kumiko/upgrade-state.json`. The guard used to ignore them, so a repo could pass with an unhandled breaking change. It now reports one violation per open step, naming the step id and the command that closes it.

  <!-- kumiko-changes
  feature: guards
  type: breaking
  title: upgrade-state guard fails on open manual upgrade steps
  detail: Every entry in the marker's pendingManual list now produces a guard violation until it is resolved.
  migration: Run `kumiko-upgrade --resolve <id> --reason "<what you did>"` for each open step once you applied it, or add `--not-applicable` when it does not concern your repo. The guard passes when no manual step is left open.
  -->

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.352.0

## 0.351.0

### Patch Changes

- 44be746: A guard without a baseline file and without findings passes quietly

  Guards with a baseline ratchet printed the "No baseline found" warning in every consumer, even when they found nothing. A missing baseline now counts as an empty one when the current count is zero. `raw-sql` uses the same ratchet.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: A missing guard baseline with zero findings is clean instead of warning
  -->

- 44be746: `kumiko-upgrade` ships with kumiko-cli and reads the repo's own version

  Repos that depend only on `@cosmicdrift/kumiko-cli` and `@cosmicdrift/kumiko-guards` now get the `kumiko-upgrade` bin, which the upgrade-state guard runs. The installed version comes from the repo itself: its `node_modules`, the framework's package directories, then its `bun.lock`. It no longer walks up into a parent workspace, and with the isolated linker `installedVersion` is no longer `null`. Changelog entries newer than the installed version are not reported as pending, even when a parent workspace holds a newer install.

  <!-- kumiko-changes
  feature: cli
  type: fix
  title: kumiko-upgrade ships with kumiko-cli and takes the installed version from the repo's own install or bun.lock
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.351.0

## 0.350.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.350.0

## 0.349.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.349.0

## 0.348.1

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.348.1

## 0.348.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.348.0

## 0.347.0

### Minor Changes

- a35ad24: `kumiko-guards comment-lang` runs the comment-language ratchet

  The subcommand takes `--touched --base=<ref>`, `--list`, `--write-baseline` and `--no-baseline`. The pre-push hook calls it instead of the separate `kumiko-guard-comment-lang` bin.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: New kumiko-guards comment-lang subcommand replaces the kumiko-guard-comment-lang bin
  -->

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.347.0

## 0.346.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.346.0

## 0.345.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.345.0

## 0.344.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.344.0

## 0.343.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.343.0

## 0.342.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.342.0

## 0.341.0

### Minor Changes

- fcd9081: `guard-no-direct-fs` has a repo-local exception: `// kumiko-lint-ignore direct-fs <reason>` on the `node:fs` import (or the line above) suppresses the finding only while the `<file>::<reason>` pair is frozen in `.kumiko-direct-fs-baseline.json` at the repo root. It fails closed: without a baseline file, with an unreadable file, with a changed reason, or with more markers than frozen, the finding stays. A bare tag without a reason does not count. Freeze with `kumiko-guards guards --write-baseline --guard="No-Direct-Fs Guard"`. The guard hint now points to the marker, `FileStorageProvider` and `readBundledAsset`. `AstGuard.writeBaseline` receives the scanned roots as an optional second argument, and `baselineRatchet` takes an opt-in `failClosed` that treats a missing baseline file as empty.

  **Migration (breaking-ish):** the framework allowlist no longer contains `src/marketing/render-landing.ts` and `src/marketing/rebuild-pages-job.ts` for every repo. Apps that have these files (today money-horse, phronexsis, show-pony, publicstatus) put `// kumiko-lint-ignore direct-fs <reason>` above the `node:fs` import in each file and run `kumiko-guards guards --write-baseline --guard="No-Direct-Fs Guard"` once in the app repo. Commit the generated `.kumiko-direct-fs-baseline.json`.

  `@cosmicdrift/kumiko-server-runtime` can ship read-only files from an app's own build. Declare them in `package.json` under `kumiko.assets` (`[{ "name": "inter-bold.ttf", "source": "packages/site-kit/fonts/inter-bold.ttf" }]`, `source` relative to the app's `package.json`). `buildProdBundle` copies them to `dist/kumiko-bundled-assets/`, which the static file server does not serve, and fails the build on an invalid name, a duplicate, a source outside the package or a missing file. `readBundledAsset(name)` and `resolveBundledAsset(name)` read the dist copy in prod and the declared source in dev, so apps need no `node:fs` for it.

  <!-- kumiko-changes
  feature: guards
  type: breaking
  title: Repo-local direct-fs exceptions with a frozen reason, bundled read-only assets
  migration: |
    The allowlist no longer frees src/marketing/render-landing.ts and src/marketing/rebuild-pages-job.ts in every repo. Put // kumiko-lint-ignore direct-fs <reason> above the node:fs import in each such file, run kumiko-guards guards --write-baseline --guard="No-Direct-Fs Guard" once and commit .kumiko-direct-fs-baseline.json.
  -->

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.341.0

## 0.340.0

### Patch Changes

- 483bb16: A `// kumiko-lint-ignore raw-sql <reason>` marker only suppresses the raw-sql guard when its file and reason are listed in `.kumiko-raw-sql-baseline.json`, so every new or reworded exception shows up as a baseline diff in review.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Raw-sql markers must be listed in a baseline
  detail: |
    `guard-raw-sql` counts the markers that suppress a blocking hit per file and reason and compares them with `.kumiko-raw-sql-baseline.json` in the repo root. A marker without a baseline entry, or with a changed reason, fails the check. Without a baseline file the guard only warns. `kumiko-guards checks --write-baseline --guard=guard-raw-sql` writes the file.
  migration: |
    Consumer: `--write-baseline` einmal laufen lassen (`bunx kumiko-guards checks --write-baseline --guard=guard-raw-sql`) und die erzeugte `.kumiko-raw-sql-baseline.json` committen.
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.340.0

## 0.339.0

### Patch Changes

- 096abc1: Guards run inside a parent workspace (for example a `.wt/<repo>` worktree) no longer report files of neighbour repos. `buildSharedProject` keeps only source files under the local repo root, and the new `isOutsideRepoRoot` / `isExternalSourcePath` in the guard kit treat a file outside that root like a package under `node_modules`. `no-framed-extension-sections` uses it, so a workspace link that resolves into a neighbour repo is no longer followed. Local and CI runs now agree.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: Guards ignore neighbour repos of the parent workspace
  detail: |
    The root comes from `findLocalRepo`, not a path heuristic. `isOutsideRepoRoot(filePath, repoRoot?)` compares real paths, so symlinks into a neighbour repo count as outside. `buildSharedProject` drops such files and `no-framed-extension-sections` stops following imports into them.
  migration: |
    keine
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.339.0

## 0.338.0

### Patch Changes

- Updated dependencies [c331807]
  - @cosmicdrift/kumiko-repo-manifest@0.338.0

## 0.337.1

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.337.1

## 0.337.0

### Patch Changes

- d25d363: The dev server serves `public/` files from the symlink-resolved path (realpath check before the read) and works when `public/` itself is a symlink. Ephemeral dev boots delete their per-boot BullMQ keys from the shared Redis on `stop()`. `kumiko-init-deploy --out <dir>` defaults the app name from that directory's `package.json`. The generated `migrate-step.sh` with `stackNetwork: "directory"` derives the network name like Docker Compose (lowercased, sanitised, `COMPOSE_PROJECT_NAME` wins). `setupTestStackFromFeatures` with the `config` preset throws a clear error when `extraContext.configResolver` is not a resolver. The runtime-isolation guard reports each regression at its own import line, and the upgrade-state guard no longer hangs on a stuck `kumiko-upgrade` (stdin ignored, timeout).

  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: public/ served via realpath incl. symlinked public/, ephemeral dev queues cleaned on stop, init-deploy --out app name, compose-style migrate-step network name, config preset validates configResolver; guards report correct isolation lines and time out kumiko-upgrade
  -->

- d2737f9: The i18n-keys guard reads string literals with `getLiteralText()` so escaped keys match their definitions. The no-framed-extension-sections guard ignores test files when collecting component usages. The renderer-boundaries guard now also rejects a bare `fetch(` call in `packages/renderer/src`, and reports every JSX tag on a line. The `.husky/pre-push` shim only resolves `kumiko-pre-push` from the repo's own `node_modules` or the parent-workspace root, never from arbitrary ancestor directories.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: i18n-keys guard decodes escaped literals, framed-sections guard skips test usages, renderer-boundaries guard blocks bare fetch and reports all JSX tags per line, pre-push shim no longer execs binaries from shared ancestor dirs
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.337.0

## 0.336.1

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.336.1

## 0.336.0

### Patch Changes

- f0b4aa1: Guards are stricter and more consistent: `guards --guard=<name>` without `--write-baseline` is rejected instead of silently running every guard, the raw-form-HTML check also catches tags after `=`, `[` or in spaceless ternaries, the German locale check flags lowercase "organisation", `test-timeouts` flags `setDefaultTimeout` and `describe.configure({ timeout })`, the no-framed-extension-sections guard correlates registry keys and usages by resolved value, and the fake-tests helper lookup is scope-aware. UI guards report repo-relative file paths. The pre-push worktree detection compares absolute git dirs.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Guards reject --guard without --write-baseline and catch more raw-form-HTML, locale and timeout cases
  -->

- f124575: `secret-literal` now inspects every `?? "literal"` fallback on a line instead of only the first, so a hardcoded secret behind a trivial first fallback is flagged. The `as-casts` audit prints its per-site listings only when run standalone; inside the shared runner it prints just the counts and the baseline verdict.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: secret-literal checks all fallbacks on a line; as-casts audit is quiet inside the shared runner
  migration: |
    A repo with a hardcoded secret fallback hidden behind an earlier trivial fallback on the same line can now fail the secret-literal guard. Replace the literal with a hard failure on a missing env value.
  -->

- 7d5428e: New framework hook `useReportStepComplete(reportStepComplete, complete)` in `@cosmicdrift/kumiko-renderer`. Extension wizard steps report whether they hold their data without a raw `useEffect`, which the no-raw-hooks guard rejects in app screens. With `complete === null` (data still loading) it reports nothing; otherwise it reports on every change. The no-raw-hooks guard hint names the hook.

  <!-- kumiko-changes
  feature: renderer
  type: improvement
  title: useReportStepComplete reports an extension wizard step's completeness without a raw useEffect
  detail: |
    `useReportStepComplete(props.reportStepComplete, complete)` with `complete: boolean | null`. `null` reports nothing (data loading), a boolean is reported whenever it changes. Outside update-mode wizards `reportStepComplete` is undefined and the hook does nothing.
  migration: |
    Extension steps that call `reportStepComplete` from a `useEffect` should switch to `useReportStepComplete(reportStepComplete, complete)`; app repos need this to pass the no-raw-hooks guard.
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.336.0

## 0.335.0

### Patch Changes

- 75e8ae1: Stricter guard detection; app repos that carried an undetected pattern can now turn red.

  - `guard-raw-sql`: only kumiko-platform is skipped. An app repo whose declared `sourceRoots` all do not exist now fails as vacuous (0 files scanned) instead of passing.
  - `test-template-drift`: `...defineAppE2eConfig(...)` spread next to `fullyParallel`, `retries`, `timeout`, `workers` or `expect`, and shorthand `{ viewport }` / `{ deviceScaleFactor }`, are flagged.
  - `no-framed-extension-sections`: an `extensionSectionComponents` registry held in a variable, shorthand or spread is resolved.
  - `runtime-isolation`: entries declared in package.json `kumiko.clientEntry` / `kumiko.clientEntries[].sourceFile` count as browser code.
  - `test-stack-drift`: `@no-server-stack:` only opts out when it sits in a comment, not in a string literal.
  - Direct `run-guards.ts` / `run-ui-guards.ts` / `run-repo-checks.ts` invocations exit with 1 instead of the failure count.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Stricter guard detection for raw-sql, test-template-drift, framed extension sections, runtime-isolation and test-stack-drift
  migration: |
    App repos that carried a previously undetected pattern can now fail their guards. Fix the reported sites; a vacuous raw-sql scan (all declared sourceRoots missing) must declare existing source roots.
  -->

- 70aa253: The escape-hatch guards now only accept `declareEscapeHatch` and `withUnsafeRawGrant` imported from the framework itself; a local function or an import from another module with the same name no longer satisfies them. A corrupt `.kumiko-cast-baseline.json` is now an error instead of being treated as an empty baseline. Guard hints point at `kumiko-guards guards`.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: Escape-hatch guards accept only real framework imports, a corrupt cast baseline is an error, hints name kumiko-guards guards
  -->

- Updated dependencies [6fee777]
  - @cosmicdrift/kumiko-repo-manifest@0.335.0

## 0.334.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.334.0

## 0.333.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.333.0

## 0.332.0

### Patch Changes

- dcf135e: The direct-entity-writes canary counts only real table writes.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: direct-entity-writes canary counts only real table writes
  -->

- 3917e63: The package root re-exports `gitEnv` for repo scripts.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: gitEnv is exported from the package root
  -->

- dcf135e: The git fetch in the changes-json guard keeps the git transport environment.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: git transport env is kept for the changes-json fetch
  -->

- 7b67f69: Several guards resolve code more precisely: lib-test-coverage, test-stack-drift, direct-fetch, no-framed-extension-sections, thin-wrappers, and the PII and text-field scans no longer log from scan functions.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: guards resolve aliased imports, literal values, tsx lib files and entityEdit slots precisely
  migration: |
    Neue Violations moeglich: lib-test-coverage erfasst jetzt .tsx und tiefere lib-Ebenen und zaehlt Fixtures unter __tests__ ohne .test-Suffix nicht als Test; test-stack-drift loest Import-Aliase auf; direct-fetch wertet den Laufzeitwert des Literals aus; no-framed-extension-sections behandelt nur slots.header von entityEdit-Screens als Header. Betroffene Stellen mit Test, echtem Import oder Anpassung beheben.
  -->

- 563b80e: Coverage guards now see test files, the admin-API allowlist and primitives-discipline resolve repo roots correctly, and the real-provider isolation check covers chained scripts and workspace packages.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Coverage guards scan test files; admin-api, primitives-discipline and real-provider-isolation resolve roots and workspaces properly
  migration: |
    Neue Violations moeglich: access-denied-test und tenant-escalation zaehlen jetzt auch *.integration.ts und Tests ausserhalb der sourceRoots als Coverage (Scope source+tests); primitives-discipline scannt alle flat-src-App-Roots; check-real-provider-isolation flaggt Scripts, die test:real/e2e:real aufrufen, und prueft alle Workspace-package.json. Betroffene Stellen fixen oder per Security-Baseline neu einfrieren.
  -->

- 3786597: Guard review fixes: the secret-literal check finds comments via the TypeScript parser (no more skipped code after regex or template literals), matches the secret name left of the fallback, also flags literals containing hmac/private-key/signing-key, supports `kumiko-lint-ignore secret-literal`, and no longer prints the literal; `loadSecurityBaseline` returns an invalid result instead of throwing on a bad repo name; plus smaller message, scope and URL-literal fixes in the loadAllEvents, escape-hatch and process-env guards.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: secret-literal guard flags more fallbacks and no longer leaks literals
  migration: |
    Neue Violations bei `*/ code`-Zeilen, Code-Zeilen mit fuehrendem `*` und Literalen mit hmac/private-key/signing-key; die Violation-Message nennt Name und Laenge statt der Zeile. Fallbacks entfernen und das Secret hart aus dem validierten Env lesen.
  -->

- dcf135e: The html-escape guard now checks nested templates and local helpers that return input unescaped.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: html-escape guard flags unescaped intermediate templates and raw-returning local helpers
  migration: |
    Neue Violations bei ungeescapten Zwischen-Templates und lokalen Helfern, die Input roh zurueckgeben; diese per escapeHtml absichern.
  -->

- 1201fcc: The pre-push worktree branch without `scripts/check-wt.sh` also runs `kumiko-guards guards`, `kumiko-guards checks` and `kumiko-guard-comment-lang`, matching consumer CI.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: worktree pre-push runs the consumer-CI guards
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.332.0

## 0.331.0

### Minor Changes

- 069cbba: Primitives-discipline guard flags hand-built screen containers and scans client/ folders

  A className combining `mx-auto` with a `max-w-*` token now fails the guard and points to `<PageSection maxWidth>` (3xl/4xl/full); files under a `public/` segment are exempt because PublicShell is their container. Web code under a `client/` path segment (enterprise ai-foundation) is now scanned too.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Primitives-discipline guard flags hand-built mx-auto + max-w-* screen containers
  migration: Replace the hand-rolled container with `<PageSection maxWidth="3xl|4xl|full">`; a deliberate exception (e.g. a narrow centered card) carries `// kumiko-lint-ignore primitives-discipline <reason>`. Web code under `client/` folders is now scanned as well.
  -->

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.331.0

## 0.330.2

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.330.2

## 0.330.1

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.330.1

## 0.330.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.330.0

## 0.329.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.329.0

## 0.328.1

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.328.1

## 0.328.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.328.0

## 0.327.0

### Minor Changes

- 793a00a: New repo check flags nested Kumiko package copies that drift from the top-level install

  The new Single-Runtime-Instance check reads bun.lock and reports every Kumiko-scoped package resolved at more than one version unless it is marked dev/tooling/test; copies nested under a dev/tooling/test-marked package are ignored. The runtime-isolation guard also recognizes the "prod" kumiko.runtime marker.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: New repo check flags nested Kumiko package copies that drift from the top-level install
  migration: A repo whose bun.lock resolves a runtime/client/prod-marked Kumiko package at more than one version now fails `kumiko-guards checks`; align the dependency ranges or pin one version via root overrides. dev/tooling/test-marked packages (kumiko-cli, kumiko-guards, kumiko-repo-manifest) are exempt, as are copies nested under such a package (e.g. the kumiko-guards > kumiko-cli subtree).
  -->

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.327.0

## 0.326.1

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.326.1

## 0.326.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.326.0

## 0.325.2

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.325.2

## 0.325.1

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.325.1

## 0.325.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.325.0

## 0.324.0

### Patch Changes

- b99dde6: Fix lib-test-coverage guard to recognize NodeNext-style test imports ending in .js/.jsx/.mjs/.cjs as linked to their .ts/.tsx/.mts/.cts source.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: lib-test-coverage guard links NodeNext-style .js/.mjs/.cjs test imports to their .ts source
  detail: |
    Under moduleResolution NodeNext a test imports "../foo.js" while the source is foo.ts.
    The guard now strips .js/.jsx/.mjs/.cjs as well as .ts/.tsx/.mts/.cts before comparing,
    so such a test no longer triggers a false "no test imports this lib module".
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.324.0

## 0.323.0

### Minor Changes

- 30bb3b2: guard-fake-tests now also runs in app repos, counts same-file assertion helpers and the writeOk/writeErr/queryOk/queryErr test APIs as assertions; skip output distinguishes "outside guard kinds" from "target repos missing".

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: guard-fake-tests now also runs in app repos, counts same-file assertion helpers and the writeOk/writeErr/queryOk/queryErr test APIs as assertions; skip output distinguishes "outside guard kinds" from "target repos missing"
  migration: |
    A same-file helper function (or arrow/function-expression variable) whose
    body calls `expect(...)` — directly or through up to two more levels of
    same-file helpers — now counts as an assertion, same as calling `expect`
    in the test body itself. `stack.http.writeOk/writeErr` and
    `tenant.api.queryOk/queryErr` (matched on the last property name of the
    callee) count as assertions too, since they throw on the wrong outcome.
    A bare Testing Library `waitFor(() => screen.getByTestId(...))` (or any
    other `getBy*`/`getAllBy*` query call) does NOT count as an assertion —
    it still needs its own `expect(...)` to prove the wait actually found
    something. The guard now also scans `kind: "app"` repos and `.tsx` test files,
    not just framework/library `.ts`. `reportResults` now prints "skipped,
    repo kind outside guard kinds (<kinds>)" instead of "target repos not in
    checkout" when the checkout has repo roots but none match the guard's
    `kinds` — the missing-checkout case keeps its original message.
  -->

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

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.323.0

## 0.322.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.322.0

## 0.321.0

### Minor Changes

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

- 5616ad9: tenant-handover's claim handler moved event-store ownership between tenants with a raw `UPDATE kumiko_events SET tenant_id …` directly inside a bundled feature — bypassing the event store's own invariants (version-unique index, archive markers, tenant boundary) and leaving no audit trail of the move beyond the feature's own claimed-event summary.

  That responsibility now lives in the event store itself: `transferAggregateStreams`, a framework-owned primitive that moves a set of aggregates' events, drops their snapshots, carries their archive markers, and appends a `kumiko:system:aggregate.transferred` event per moved aggregate on its own fresh stream in the destination tenant.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: New event-store primitive transferAggregateStreams for tenant-to-tenant aggregate moves
  detail: |
    `transferAggregateStreams(db, { sourceTenantId, destinationTenantId,
    aggregateType, aggregateIds, transferredBy })` (event-store/transfer.ts)
    moves an aggregate's events, drops its snapshot, and carries its archive
    marker from one tenant to another, then appends one
    `kumiko:system:aggregate.transferred` system event per moved aggregate
    (own fresh stream, destination tenant, payload carries aggregateType/
    aggregateId/sourceTenantId/destinationTenantId). An id with no events
    under the given tenant/aggregateType is left untouched and gets no event.
    Backed by db/queries/event-store-transfer.ts.
  migration: |
    No action for existing consumers — this is a new, additive primitive.
  -->

  <!-- kumiko-changes
  feature: tenant-handover
  type: improvement
  title: Claim now moves event-store ownership through transferAggregateStreams instead of raw SQL
  detail: |
    move-entity-graph.ts no longer runs its own `UPDATE kumiko_events` /
    `UPDATE kumiko_snapshots` against the event store — it calls the
    framework's `transferAggregateStreams` per aggregate type, threading the
    claiming user's id as `transferredBy`. Archive markers now move with the
    stream (previously left behind under the source tenant). Each moved
    aggregate gets its own `kumiko:system:aggregate.transferred` audit event
    in the destination tenant, in addition to the existing
    `tenant-handover:event:claimed` summary event.
  migration: |
    No action needed — the claim API and its response shape are unchanged.
  -->

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: New guard blocks direct writes to the event-store tables outside the event store itself
  detail: |
    guard-event-store-writes.ts flags any UPDATE/DELETE FROM/INSERT INTO
    string or template literal naming kumiko_events, kumiko_snapshots, or
    kumiko_archived_streams outside packages/framework/src/event-store/**
    and their db/queries/event-store*.ts backing (plus the two pre-existing,
    named one-time backfill exceptions). Registered in run-guards.ts.
  migration: |
    No action needed for code that already goes through the event store's
    own primitives (append, transferAggregateStreams, archiveStream, ...).
    A direct raw-SQL write against one of these three tables from feature
    code now fails the guard; use transferAggregateStreams for a tenant
    move, or add a new event-store primitive instead.
  -->

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.321.0

## 0.320.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.320.0

## 0.319.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.319.0

## 0.318.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.318.0

## 0.317.0

### Patch Changes

- b71a8fe: `no-framed-extension-sections` no longer flags a registered component that is only ever mounted as a dashboard custom panel or an entityEdit header slot

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: no-framed-extension-sections now resolves the actual mount kind before flagging
  detail: |
    extensionSectionComponents backs three different mount shapes: a
    kind: "extension" section (framed by the host's own Card/Section), a
    dashboard kind: "custom" panel, and an entityEdit slots.header slot. Only
    the section mount is actually framed, but the guard previously flagged
    every registered component that rendered its own Card/SectionCard/
    CollapsibleSection regardless of which of the three ways it was mounted,
    producing false positives for components that only ever render as a bare
    dashboard panel or header slot.
    The guard now scans every __component: SOME_CONST usage site across the
    scanned files (extending its scan to plain .ts files, not just .tsx, so
    screens.ts/feature.ts usage sites are actually seen), classifies each by
    its enclosing mount kind, and correlates it back to the registration via
    the shared registry key both sides reference by name. A component is only
    exempted when every usage site resolves to a custom panel and/or a header
    slot; a component used as a section anywhere, or whose usage sites cannot
    be classified at all, keeps today's conservative "stays flagged"
    behavior. List-header-slot mounts and footer/titleAction slots also keep
    the conservative behavior since this fix only covers the two shapes that
    produced real false positives.
    The scan now also covers plain .ts files on both the registration and the
    usage side, not just .tsx, so a registration declared inside a
    screens.ts/feature.ts file is checked for the first time. Checked against
    publicstatus and solon, the two consumers currently registering
    extensionSectionComponents from a .ts file: the fix does not add findings
    there, since their one Card-rendering registration is mounted exclusively
    as a kind: "custom" panel, which this guard now correctly exempts.
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.317.0

## 0.316.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.316.0

## 0.315.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.315.0

## 0.314.0

### Patch Changes

- 3434a94: Tailwind-Scan-Surface Guard classifies files against the runner's roots

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: Tailwind-Scan-Surface Guard classifies files against the runner's roots
  detail: |
    The guard ignored the roots its runner passes to run() and re-derived the
    single repo of the current working directory. Under a multi-root runner,
    a file from a checkout outside cwd fell through to the packages/ marker
    fallback, which misreads a checkout path that itself contains a packages/
    segment. run() now uses the roots it is given, like the other guards.
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.314.0

## 0.313.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.313.0

## 0.312.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.312.0

## 0.311.0

### Minor Changes

- 348d60f: Three closing guards for the test-template contract (fw#3118)

  <!-- kumiko-changes
  feature: guards
  type: breaking
  title: test-timeouts is now always-enforcing, plus two new guards (test-template-drift, Real-Provider-Isolation)
  detail: |
    test-timeouts drops its transitional baseline/ratchet — any sleep loop,
    test.setTimeout/test.slow, or waitForTimeout finding fails the guard run
    directly, with no `.kumiko-test-timeouts-baseline.json` grandfathering
    pre-existing violations.
    New AST guard test-template-drift flags apps reimplementing the
    kumiko-testing e2e/screenshot template locally: a Playwright config that
    builds its own defineConfig(...) instead of calling defineAppE2eConfig(),
    a literal deviceScaleFactor override anywhere (test.use, a project's use,
    or the config's own use block), a literal viewport override in a
    playwright*.config.ts's own use or a project's use (a spec's own
    test.use({ viewport }) is not flagged — it's the documented way to assert a
    layout that only exists below the template's 1920px default; a
    `...devices["…"]` spread stays allowed everywhere), or a direct
    page.screenshot(...) call instead of captureScreenshot.
    New repo check Real-Provider-Isolation flags a CI workflow that references
    KUMIKO_REAL_PROVIDERS or invokes test:real/e2e:real, a package.json script
    other than test:real/e2e:real that leaks the real-provider env or a
    *.real. spec/test reference, and one of the template's own non-real bunfig
    files (bunfig.toml, bunfig.integration.toml, bunfig.dom.toml) missing the
    **/*.real.test.ts exclusion.
  migration: |
    Fix or mark each test-timeouts finding: replace hand-rolled poll loops with
    the shared `waitFor` from @cosmicdrift/kumiko-framework/testing, or add
    `// @timeout-exception: #<issue> <technical reason>` on the loop's own line
    or the line above for a genuine non-condition wait. Delete any committed
    `.kumiko-test-timeouts-baseline.json`.
    For test-template-drift: switch a hand-rolled Playwright/screenshot config
    to defineAppE2eConfig(), drop config-level viewport/deviceScaleFactor
    overrides (the template already sets DESKTOP_VIEWPORT and renders
    screenshot runs at SCREENSHOT_DEVICE_SCALE_FACTOR), and replace direct
    page.screenshot(...) calls with the template's captureScreenshot. Specs
    asserting a layout that only exists below 1920px set their own viewport via
    test.use({ viewport }) — no exception marker needed. A deliberate exception
    for anything else the guard flags (e.g. a handbook screenshot helper that
    needs its own viewport-growth pass) is
    `// @template-drift-exception: #<issue> <technical reason>` on the line
    above.
    For Real-Provider-Isolation: remove any KUMIKO_REAL_PROVIDERS/test:real/
    e2e:real reference from CI workflows, move real-provider env/spec
    references out of scripts other than test:real/e2e:real, and regenerate
    bunfig.toml/bunfig.integration.toml/bunfig.dom.toml via
    `kumiko-testing bunfig` instead of hand-editing pathIgnorePatterns.
  -->

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.311.0

## 0.310.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.310.0

## 0.309.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.309.0

## 0.308.0

### Minor Changes

- 6e5ed00: New guard-no-framed-extension-sections flags a registered extension-section component that renders its own Card/SectionCard/CollapsibleSection (fw#3234)

  Modeled on guard-no-custom-primitives: scans packages/bundled-features/src/** and samples/** for `extensionSectionComponents: { ... }` registrations, then checks each registered component's own render body for a nested Card/SectionCard/CollapsibleSection — the host (RenderEdit) already frames it in one card, so a second one doubles the border/padding. Registered in run-ui-guards.ts. Per-line override: `// kumiko-lint-ignore no-framed-extension-sections <reason>`.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: New guard-no-framed-extension-sections flags a registered extension-section component that renders its own Card/SectionCard/CollapsibleSection (fw#3234)
  migration: |
    New rule, no baseline — the measured backlog across bundled-features and samples is 0 (notes-section.tsx's own nested cards were dropped as part of this change).
  -->

### Patch Changes

- Updated dependencies [685ecc9]
  - @cosmicdrift/kumiko-repo-manifest@0.308.0

## 0.307.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.307.0

## 0.306.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.306.0

## 0.305.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.305.0

## 0.304.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.304.0

## 0.303.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.303.0

## 0.302.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.302.0

## 0.301.0

### Minor Changes

- 5028a6c: kumiko-pre-push runs a worktree's own package.json scripts instead of the parent check on the main checkout

  A push from a .wt/<name> worktree under the parent workspace without a tracked scripts/check-wt.sh used to fall into the parent-scoped kumiko check, which checks the main checkout of that repo, not the pushed worktree. It now runs the worktree's own typecheck, lint, test and test:dom scripts (whichever are declared) in the worktree, collects failures and refuses the push if any fail or if no test script exists. A tracked scripts/check-wt.sh still takes precedence; regular checkouts keep the parent-scoped check.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: kumiko-pre-push runs a worktree's own package.json scripts instead of the parent check on the main checkout
  -->

### Patch Changes

- 5028a6c: kumiko-pre-push refuses a standalone push without a package.json test script with a clear message

  Previously the standalone branch ran bun run test unconditionally, so a repo without a test script only saw bun's Script not found error. The hook still fails closed (exit 1) but now names the missing script and the PRE_PUSH_SKIP escape.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: kumiko-pre-push refuses a standalone push without a package.json test script with a clear message
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.301.0

## 0.300.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.300.0

## 0.299.0

### Minor Changes

- b24647f: kumiko-guards ships a kumiko-pre-push bin carrying the shared pre-push hook mechanics

  Consumer repos can replace their vendored .husky/pre-push with a thin shim; a tracked, executable scripts/pre-push-extra.sh is the per-repo extension point.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: kumiko-guards ships a kumiko-pre-push bin carrying the shared pre-push hook mechanics
  -->

- a9b29a8: kumiko-guards ships the canonical `hooks/pre-push` shim that execs the nearest `node_modules/.bin/kumiko-pre-push` and fails closed with a `bun install` / `PRE_PUSH_SKIP=1` hint when it is missing; repos copy it to `.husky/pre-push`.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: kumiko-guards ships the canonical `hooks/pre-push` shim that execs the nearest `node_modules/.bin/kumiko-pre-push` and fails closed with a `bun install` / `PRE_PUSH_SKIP=1` hint when it is missing; repos copy it to `.husky/pre-push`.
  -->

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

  - @cosmicdrift/kumiko-repo-manifest@0.299.0

## 0.298.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.298.0

## 0.297.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.297.0

## 0.296.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.296.0

## 0.295.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.295.0

## 0.294.1

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.294.1

## 0.294.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.294.0

## 0.293.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.293.0

## 0.292.0

### Minor Changes

- 2f17bcb: Export the three suite runners so a CLI can compose them in-process

  runGuardsCli, runUiGuardsCli and runRepoChecksCli (plus their flag lists and cliFlagsError) were only reachable from their own runner modules, so a caller had to spawn three subprocesses — each building its own ts-morph project. They are part of the package entry point now, which lets `kumiko check` run all three over one shared project in a single process.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Export the three suite runners so a CLI can compose them in-process
  -->

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.292.0

## 0.291.0

### Minor Changes

- 9b16fe2: New Raw section.fields Guard

  The boot-validator enforces `fields` XOR `groups` on edit sections, so a section carrying `groups` has `fields: []` — every reader that iterates `section.fields` walks an empty list there and silently sees no field at all. That same cause produced three independent regressions (kumiko-framework#2986, then the boot-guard and the E2E generator in #3042). The new guard flags for-of, spread and array reads over a section's `fields` in the layer where a section is a spec (framework engine/i18n/testing, headless, renderer app shims) and points at `sectionFieldSpecs(section)`, the one reader that unions both sources. A deliberate raw reader declares itself with `// kumiko-lint-ignore section-fields-raw <reason>` on the line or the line above — a bare tag without a reason stays a finding, so there is no silent exception list. `section.fields.length` is a known gap: the fields-XOR-groups validator itself needs it and an emptiness check is not the silent-iteration bug. Ratcheted against `.kumiko-section-fields-raw-baseline.json`, warning-only in a repo that has not frozen one yet.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: New Raw section.fields Guard
  -->

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.291.0

## 0.290.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.290.0

## 0.289.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.289.0

## 0.288.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.288.0

## 0.287.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.287.0

## 0.286.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.286.0

## 0.285.2

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.285.2

## 0.285.1

### Patch Changes

- b59f1d5: Fix false-positive BLOCK in the Direct-Entity-Writes Guard for repos with no event store

  An empty `esTables` set had one meaning: the scan lost track of ES definitions while table-write code still exists, so the guard reported a misconfiguration canary and blocked (the guard is `security: true`, so this always failed CI). That conflated two different situations: a repo with no event store at all (e.g. `kumiko-platform`, an Astro docs/marketing site) also has an empty `esTables` set, but there is nothing to guard against there. The guard now checks whether any table write is present at all before treating an empty `esTables` set as a misconfiguration; a repo with no ES and no table writes is green, while a repo with table writes but no resolvable ES tables still blocks as before.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: Fix false-positive BLOCK in the Direct-Entity-Writes Guard for repos with no event store
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.285.1

## 0.285.0

### Minor Changes

- 8ee38b3: Add a `tooling` repo kind, scoped out of guards by default

  `kumiko-repo-manifest`'s `repoKindSchema` gains a `"tooling"` value for a repo with no product code (infra, Pulumi, build tooling). `kumiko-guards`' `scanRoots` treats an omitted `ScanSpec.kinds` as "every root except tooling" instead of "every root" — only 7 of ~60 guards declare `kinds` today, so without this a tooling repo would have been silently pulled into every product-oriented guard; a guard now has to name `"tooling"` in `kinds` explicitly to scan one. Separately, `kumiko-framework`'s boot-validator now includes the implicit parent-id field in a form screen's `urlPrefillFields` when it's reached via a relatedList toolbarAction that declares no `params` of its own — the renderer already sends that field (`parentFilter.field`, else `parentParam`, else `"id"`), the boot-validator just wasn't allowlisting it.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Add a `tooling` repo kind, scoped out of guards by default
  -->

### Patch Changes

- Updated dependencies [8ee38b3]
  - @cosmicdrift/kumiko-repo-manifest@0.285.0

## 0.284.0

### Patch Changes

- 4880f4e: Fix Direct-Fetch Guard allowlist after egress moved to kumiko-http

  The ALLOWLIST regex still pointed at the old packages/framework/src/http/egress.ts path; egress() now lives in packages/http/src/egress.ts (@cosmicdrift/kumiko-http), so the guard was about to self-flag its own allowed implementation as a raw-fetch violation.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: Fix Direct-Fetch Guard allowlist after egress moved to kumiko-http
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.284.0

## 0.283.0

### Patch Changes

- 31540a6: Escape-Hatch-Declared Guard resolves module-local const reasons instead of forcing duplicate literals

  `_lib/generic-reason.ts`'s `literalReasonText` only accepted a string/template literal in place — an Identifier (even a module-local `const SOME_REASON = "..."`) fell through as "not statically judgeable" and was rejected exactly like a real placeholder. Every consumer declaring several hooks with the same justification (e.g. publicstatus's five GDPR delete hooks) had to repeat the same reason text literally in each `declareEscapeHatch({ reason })` / `escapeHatch: { reason }` / `unsafeAllTenants: { reason }` / `acknowledgeCrossTenant(reason)` call, because a shared constant made the guard fail.

  The guard now resolves an Identifier to a module-local `const` initializer (string or non-templated template literal only — no imports, no `let`, no reassignment) via a new `resolveReasonText`, used at all four call sites; `isGenericReason` is unchanged and still applies to the resolved text, so a const resolving to `"todo"` is rejected exactly as before. An import, a function call, or a template literal with substitutions still doesn't resolve, and the `unsafe-raw-outside-system-scope` / `system-identity-outside-declared-scope` findings now say why when a nearby `declareEscapeHatch` call's reason is one of those three shapes. Both R2 and R3's base messages now also name `declareEscapeHatch({ reason: "..." })` as a direct body statement of a named hook among the allowed ways to clear the finding.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: Escape-Hatch-Declared Guard resolves a module-local const reason instead of forcing duplicate literals
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.283.0

## 0.282.0

### Minor Changes

- 73b5efe: New `kumiko-guards list` subcommand prints the registration inventory (which guards/checks are registered, under which names, in which suite) as JSON, without scanning or running anything. The public package has one bin with `guards|ui|checks` subcommands instead of a bin per guard, so a consumer's CI can no longer check "does this binary exist" per guard — `list` is what it checks against instead, e.g. `bunx kumiko-guards list | jq '.suites.guards.count'`.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: kumiko-guards list prints the registration inventory as JSON
  -->

- 7681005: Port the upgrade-state and runtime-isolation guards

  guard-upgrade-state and check-runtime-isolation ported from the private infra/guards package into the public @cosmicdrift/kumiko-guards package, rebuilt onto the public RepoCheck pattern with single-repo root resolution. guard-app-dockerfile, guard-doc-status, check-licenses, and check-security stay in infra/guards as CDGS-specific house rules (private registry scope, CDGS doc taxonomy, and CDGS license/security exception files with no equivalent consumer-facing mechanism in the public package) — they were deliberately not ported, not forgotten.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Port the upgrade-state and runtime-isolation guards
  -->

### Patch Changes

- a5965ff: `kumiko-guards guards` now accepts `--explain`, `--write-security-baseline`, and `--strict-security-baseline`

  The `kumiko-guards` bin's `guards` subcommand only ran `process.argv[2]` for the subcommand name and never passed the rest of `argv` into the suite it dispatched to, so `--write-security-baseline` and the other run-guards.ts flags were silently ignored when invoked through the published bin — the only way to reach them was a direct `node_modules/@cosmicdrift/kumiko-guards/src/run-guards.ts` file-path call. Each suite's flag handling now lives in one `run*Cli(argv)` function shared by the bin and the suite's own direct-invocation block, and any argument that isn't an exact match for that subcommand's known flags — a single-dash typo, a stray positional, anything — fails with the flags that subcommand actually understands instead of being ignored.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: kumiko-guards bin now passes flags through to the guards, ui, and checks subcommands
  detail: The bin's `guards` subcommand called run-guards.ts's suite runner directly, skipping the `--explain`/`--write-security-baseline`/`--strict-security-baseline` handling that only existed in run-guards.ts's own `if (import.meta.main)` block — a consumer running `bunx @cosmicdrift/kumiko-guards guards --write-security-baseline` got a normal guard run with the flag silently dropped. Each suite (guards, ui, checks) now exports a `run*Cli(argv)` function that validates argv against that suite's known flags and applies them; both the bin and the suite's own direct-invocation entry point call the same function, so they cannot drift apart again. Validation matches each arg exactly against the known list (not just a `--`-prefix check), so a single-dash typo or a stray positional also exits 1 with the flags that subcommand accepts, rather than passing through unnoticed.
  -->

  - @cosmicdrift/kumiko-repo-manifest@0.282.0

## 0.281.0

### Patch Changes

- @cosmicdrift/kumiko-repo-manifest@0.281.0

## 0.3.0

### Minor Changes

- c74f155: `bunx @cosmicdrift/kumiko-guards` is now runnable: a new `src/cli.ts` entry runs all three suites (guards, UI guards, repo checks) in one process and exits 1 if any of them reports a violation, or runs a single suite via `kumiko-guards guards|ui|checks`. `package.json`'s `bin` field now points at this new entry instead of `run-guards.ts` alone, so a plain `bunx`/`kumiko-guards` call covers every guard, not just the AST-guard suite.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Add a consumer CLI entry so bunx @cosmicdrift/kumiko-guards runs all three suites
  -->

- 7bc2dd6: Port the last five infra/guards guards

  app-feature-structure, lib-test-coverage, i18n-locale-terminology, feature-integration-tests, and test-stack-drift ported from the private infra/guards package into the public @cosmicdrift/kumiko-guards package. The latter two were rebuilt from ad-hoc infra scripts onto the public RepoCheck pattern; the other three are literal AstGuard ports.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Port the last five infra/guards guards
  -->

- 6314249: The shared runners (run-guards, run-ui-guards, run-repo-checks) now print a one-line banner before the first guard result (version, guard count, resolved roots, and — where a shared ts-morph project exists — the scanned file count), and abort with a clear error and exit code 1 when zero repo roots resolve or the guard array is empty, instead of silently reporting green. A single guard finding no target repos still only produces its existing per-guard `skipped` line. All remaining German user-visible guard output (console messages, finding messages, remediation hints) across packages/guards/src is now English; comments were left untouched.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Add startup banner, fail-closed on zero roots/guards, and finish English output
  -->

### Patch Changes

- 989c3ba: Fix two false-positive findings in the Secret-Literal and Thin-Wrappers guards

  The Secret-Literal Guard flagged secret-fallback patterns documented inside comments: only line-start `//` comments were skipped, so a block-comment line (JSDoc-style `*`, `/*`, `*/`) explaining the rule tripped the guard on its own documentation. Block-comment lines are now recognized as comments too. The Thin-Wrappers Guard misread `/regex/.test(x)` as a call to a function literally named `test`, reporting the enclosing function as a thin wrapper around it. That misclassification no longer fires.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: Fix two false-positive findings in the Secret-Literal and Thin-Wrappers guards
  -->

## 0.2.0

### Minor Changes

- a00154f: Migrate the remaining framework-semantic guards out of the private infra/guards package: complexity, predicate-extraction, i18n-UI-strings, screen-conventions and write-handler-QN guards are now registered in the shared runners as-is, and the as-casts, secret-literal, loadAllEventsByType and table-DDL checks are rebuilt on the public AstGuard/RepoCheck architecture (roots passed as a parameter instead of resolved from a module-global, no more standalone `main()`). Consumers now get these guards from the public package; the framework repo keeps the private package as a devDependency for the maintainer-only checks that stay in infra (doc-status, comment-lang, licenses, agent-manifest and the rest).

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Migrate remaining framework-semantic guards out of infra/guards
  -->

- cb33128: Add runner parity with the private infra/guards package: broker-subscribe, error-reasons, i18n-keys, i18n-locale-mount, pii-annotations and text-field-stance guards are now registered in the shared runner, and the escape-hatch-declared guard recognizes an explicit `withUnsafeRawGrant(...)` call as a declared grant instead of flagging it.

  <!-- kumiko-changes
  feature: guards
  type: improvement
  title: Add runner parity with the private infra/guards package
  -->

## 0.1.1

### Patch Changes

- 1b83944: Spawned git calls no longer inherit GIT_DIR/GIT_WORK_TREE

  Guards that shell out to git now pass an allowlisted environment. Running inside a Husky pre-push hook, an inherited GIT_DIR pointed git at the hook's repo instead of the path being checked, so a guard could read and write the wrong repository.

  <!-- kumiko-changes
  feature: guards
  type: fix
  title: Spawned git calls no longer inherit GIT_DIR/GIT_WORK_TREE
  -->

## 0.1.0

### Minor Changes

- dceccde: Ports the remaining framework-semantic guards into `@cosmicdrift/kumiko-guards`: AST guards `pre-es-patterns`, `unsafe-json-parse`, `silent-skip`, `html-escape`, `cross-feature-imports`, `no-date-api`, `restricted-symbols`, `fake-tests`, `no-logic-in-views` (in `GUARDS`), the UI guards `raw-classname`, `no-inline-styles`, `no-custom-primitives`, `no-raw-hooks`, `tailwind-scan-surface`, `raw-interactive-elements` (`UI_GUARDS`), and `raw-sql`, `no-direct-process-env`, `renderer-boundaries`, `primitives-discipline`, `thin-wrappers` as in-process `RepoCheck`s (`REPO_CHECKS`, `runRepoChecks`) instead of standalone scripts that exit the process.
- 1e185b5: Adds `@cosmicdrift/kumiko-guards`, a public single-repo port of the infra ts-morph security guards (`admin-api`, `direct-entity-writes`, `direct-fetch`, `escape-hatch-declared`, `no-direct-fs`, `open-to-all-reason`, `tenant-escalation`, `access-denied-test`) plus the shared guard-runner, scan-scope and per-repo security-baseline machinery. `@cosmicdrift/kumiko-repo-manifest` extracts the `kumiko.json` manifest schema and loader out of `@cosmicdrift/kumiko-cli` into its own package, since `kumiko-guards` needs it independently of the CLI. `@cosmicdrift/kumiko-cli` keeps its `./repo-manifest` subpath export unchanged, now re-exporting from the new package.

### Patch Changes

- Updated dependencies [1e185b5]
  - @cosmicdrift/kumiko-repo-manifest@0.1.0
