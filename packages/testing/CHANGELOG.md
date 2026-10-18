# @cosmicdrift/kumiko-testing

## 0.371.0

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
- Updated dependencies [5a822b2]
  - @cosmicdrift/kumiko-framework@0.371.0
  - @cosmicdrift/kumiko-types@0.371.0

## 0.370.0

### Minor Changes

- 8ff5d19: envSchema required, boot dry run checks the env without values
  
  <!-- kumiko-changes
  feature: server-runtime
  type: breaking
  title: runProdApp requires envSchema
  detail: envSchema on runProdApp is no longer optional. Without it the boot throws a KumikoBootError that points to composeEnvSchema. An app without its own variables passes composeEnvSchema({ core: frameworkCoreEnvSchema, features }).
  migration: Pass envSchema: composeEnvSchema({ core: frameworkCoreEnvSchema, features }) to runProdApp, with composeEnvSchema from @cosmicdrift/kumiko-framework/env and frameworkCoreEnvSchema from @cosmicdrift/kumiko-dev-server/env-schema. App-level variables go into extend. Delete hand-written env checks that ran before runProdApp; the schema covers them.
  -->
  
  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: KUMIKO_DRY_RUN_ENV=boot prints an env table and exits 0 on missing values
  detail: The boot dry run lists every variable of the composed schema with its feature, whether it is required, and whether it is set, missing or invalid. DATABASE_URL, REDIS_URL and JWT_SECRET appear with source server-runtime when the schema does not declare them, since runProdApp reads them itself. Values are never printed, and a validation message that quotes the value is replaced. A keyring the master-key provider cannot use fails the dry run. An invalid value exits 1. A missing required value exits 0 and says the feature wiring was not validated; with every variable present the dry run validates the wiring as before. NODE_ENV=production does not change this. The MFA secret binding and other env reads run after this exit, so an empty env no longer crashes the dry run.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: inspectEnv, renderEnvInspection and the dry-run mode parser
  detail: inspectEnv(schema, env, { sources }) checks each field on its own and returns its status (set, unset, missing, invalid) without the value; renderEnvInspection renders those rows as the boot table. parseDryRunEnvMode reads KUMIKO_DRY_RUN_ENV (1, true, human, json, pulumi, k8s, boot) and isDryRunEnvActive tells module-level code whether a dry run is running. DRY_RUN_ENV_VAR names the variable.
  -->
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: createEnvMasterKeyProvider defers the keyring check in a dry run
  detail: While KUMIKO_DRY_RUN_ENV is set, createEnvMasterKeyProvider no longer throws at construction on a missing or malformed keyring; the first key operation throws instead. Apps that build the provider at module load can run the boot dry run on an empty env. Outside a dry run the check still runs at construction, and the boot probe for encrypted entity fields forces it in both cases.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: runDevApp binds the MFA token secrets
  detail: When auth-mfa is mounted and JWT_SECRET is set, runDevApp binds the MFA token secrets the same way runProdApp does.
  -->
  
  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: setupTestStack binds the MFA token secrets
  detail: setupTestStack binds the auth-mfa token secrets from the stack's JWT secret, independent of the host env, so tests that mount auth-mfa without explicit secrets keep working.
  -->
- c051152: Managed files, kumiko.config.ts with defineAppConfig, script standard and port registry
  
  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: defineAppConfig in @cosmicdrift/kumiko-framework/config, plus biome and tsconfig presets for apps
  detail: kumiko.config.ts default-exports defineAppConfig({ features, prodFeatures?, client: { entries }, ports: { dev, e2e, infra? } }). defineAppConfig throws on ports outside 1..65535, a port claimed twice within the app, an empty client.entries list and entries that leave the app. allAppFeatures(config) returns features plus prodFeatures. New exports @cosmicdrift/kumiko-framework/biome (Biome 2.5.7 preset with vcs.useIgnoreFile false) and @cosmicdrift/kumiko-framework/tsconfig.app.json; an app's biome.json and tsconfig.json extend them and keep their own overrides next to extends.
  -->
  
  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: Managed files: one template source for the scaffold, kumiko check managed and kumiko sync-managed
  detail: deploy/Dockerfile, deploy/Dockerfile.dockerignore, deploy/migrate-step.sh, .husky/pre-push, .github/workflows/{ci,release,cache-cleanup}.yml, the bunfigs and kumiko/schema.ts carry a kumiko-managed marker on line 1 (line 2 after a shebang or # syntax= line). kumiko new app writes them, plus kumiko.config.ts, bin/server.ts (was bin/dev.ts), bin/env-schema.ts, e2e/_helpers and src/__tests__/_setup.ts; bunfig.ci.toml is gone. kumiko/schema.ts is generated from kumiko.config.ts. kumiko-init-deploy prints a deprecation notice and goes away in the next release. Release targets come from package.json#kumiko.deploy.namespace and .deployment (default: the app name).
  migration: Existing apps: add kumiko.config.ts with defineAppConfig, then run kumiko sync-managed (dry run), kumiko sync-managed --write --adopt for files that are identical or should follow the template, and mark deliberate deviations with "# kumiko-managed: local <reason>" on line 2. Until kumiko.config.ts calls defineAppConfig, kumiko check only warns about drift and missing scripts.
  -->
  
  <!-- kumiko-changes
  feature: cli
  type: improvement
  title: kumiko check gains the managed and scripts steps; new kumiko sync-managed and kumiko ports
  detail: kumiko check managed compares framework-owned files with the installed templates and prints a diff; files with a local marker are skipped and listed. kumiko check scripts requires dev, build, start, typecheck, lint, check, test, test:unit, test:integration, test:integration:ci, test:dom (with uiRoots), test:real, e2e, e2e:real, screenshots and prepare, and lists extras. Both steps fail only once the app calls defineAppConfig. kumiko check accepts step ids as positional filters (kumiko check managed scripts). kumiko sync-managed [--write] [--adopt] writes the templates; it never overwrites a file without marker unless --adopt is passed, never touches local files and refuses symlinked paths. kumiko ports [workspace-root] lists the ports of every app below the root and exits 1 on a collision. kumiko agent lint also checks prodFeatures.
  -->
  
  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: renderTestSetup writes the standard test scripts, bunfig.dom.toml and the helper homes
  detail: The scaffolded test setup now adds test:unit, test:integration:ci, test:dom and screenshots, writes bunfig.dom.toml (with @happy-dom/global-registrator as devDependency), e2e/_helpers/index.ts and src/__tests__/_setup.ts.
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

- Updated dependencies [8ff5d19]
- Updated dependencies [79a0aa6]
- Updated dependencies [8ff5d19]
- Updated dependencies [4a6e151]
- Updated dependencies [c051152]
- Updated dependencies [8ff5d19]
- Updated dependencies [8ff5d19]
  - @cosmicdrift/kumiko-framework@0.370.0
  - @cosmicdrift/kumiko-types@0.370.0

## 0.369.0

### Patch Changes

- Updated dependencies [57c0cff]
- Updated dependencies [57c0cff]
- Updated dependencies [a4cab24]
  - @cosmicdrift/kumiko-types@0.369.0
  - @cosmicdrift/kumiko-framework@0.369.0

## 0.368.0

### Minor Changes

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
- Updated dependencies [133ef08]
- Updated dependencies [fbc0759]
- Updated dependencies [7949df2]
- Updated dependencies [39b5de4]
- Updated dependencies [39b5de4]
- Updated dependencies [478ee1f]
- Updated dependencies [1404b33]
  - @cosmicdrift/kumiko-framework@0.368.0
  - @cosmicdrift/kumiko-types@0.368.0

## 0.367.0

### Patch Changes

- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [f6b1803]
- Updated dependencies [04bf143]
- Updated dependencies [5f2cc2f]
  - @cosmicdrift/kumiko-bundled-features@0.367.0
  - @cosmicdrift/kumiko-types@0.367.0
  - @cosmicdrift/kumiko-framework@0.367.0
  - @cosmicdrift/kumiko-dev-server@0.367.0

## 0.366.0

### Minor Changes

- 3d58dea: Error boundaries keep a render error from blanking the whole page
  
  <!-- kumiko-changes
  feature: renderer-web
  type: improvement
  title: A throwing screen shows an error card instead of a blank page
  detail: createKumikoApp wraps the active screen in a boundary that keeps the shell and navigation visible, shows a card with the screen name and a reload action, and resets on route change. A second boundary around the whole app shows a minimal provider-free fallback. Both log the error with console.error. createKumikoApp takes an onError option for telemetry. kumiko-testing/e2e exports boundaryGuardedTest, a plain Playwright test that fails a spec when a boundary caught an error; the seeded test builds on it.
  -->

### Patch Changes

- Updated dependencies [09d5344]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [a919906]
- Updated dependencies [15d76a8]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [22b7f6e]
- Updated dependencies [8a7d835]
- Updated dependencies [7053800]
- Updated dependencies [3d58dea]
- Updated dependencies [5df8e3a]
- Updated dependencies [22b7f6e]
- Updated dependencies [7053800]
  - @cosmicdrift/kumiko-bundled-features@0.366.0
  - @cosmicdrift/kumiko-framework@0.366.0
  - @cosmicdrift/kumiko-types@0.366.0
  - @cosmicdrift/kumiko-dev-server@0.366.0

## 0.365.1

### Patch Changes

- Updated dependencies [93e1a7d]
- Updated dependencies [9a8abc9]
- Updated dependencies [34530bf]
- Updated dependencies [8633239]
- Updated dependencies [34530bf]
- Updated dependencies [34530bf]
  - @cosmicdrift/kumiko-framework@0.365.1
  - @cosmicdrift/kumiko-bundled-features@0.365.1
  - @cosmicdrift/kumiko-types@0.365.1
  - @cosmicdrift/kumiko-dev-server@0.365.1

## 0.365.0

### Patch Changes

- efa6253: defineAppE2eConfig respects .env.local and .env.<NODE_ENV> as well as .env
  
  <!-- kumiko-changes
  feature: testing
  type: fix
  title: E2E webServer env no longer overrides keys from .env.local or .env.<NODE_ENV>
  detail: Keys defined in the app's .env.local or .env.<NODE_ENV> (not only .env) are now left to the server's own dotenv loading instead of being overridden by the template service defaults.
  -->
- 45abe9d: E2e helpers read links and tokens out of captured mails
  
  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: extractMailLink and extractMailLinkToken in kumiko-testing/e2e
  detail: mailLinks, extractMailLink(mail, fragment) and extractMailLinkToken(mail, fragment, param) read href values from a captured HTML mail and decode HTML entities such as &#x3D; and &amp; once, so e2e specs no longer need their own mail helper.
  -->
- Updated dependencies [eef5ff1]
- Updated dependencies [84d7f1a]
- Updated dependencies [84d7f1a]
- Updated dependencies [eef5ff1]
- Updated dependencies [cd16f29]
- Updated dependencies [84d7f1a]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [7aa3223]
- Updated dependencies [eef5ff1]
- Updated dependencies [84d7f1a]
- Updated dependencies [84d7f1a]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [7e1b974]
- Updated dependencies [e4ecaba]
- Updated dependencies [ec7d696]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [eef5ff1]
- Updated dependencies [8a59aa4]
- Updated dependencies [9424924]
- Updated dependencies [efa6253]
- Updated dependencies [45abe9d]
- Updated dependencies [72a5c9c]
- Updated dependencies [72a5c9c]
- Updated dependencies [81169ec]
- Updated dependencies [84d7f1a]
- Updated dependencies [efa6253]
- Updated dependencies [fbc6938]
- Updated dependencies [5a1cdc1]
- Updated dependencies [efa6253]
- Updated dependencies [eef5ff1]
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
- Updated dependencies [84d7f1a]
- Updated dependencies [efa6253]
- Updated dependencies [45abe9d]
- Updated dependencies [45abe9d]
- Updated dependencies [5e5d83b]
- Updated dependencies [72a5c9c]
- Updated dependencies [a546703]
- Updated dependencies [84d7f1a]
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
- Updated dependencies [72a5c9c]
- Updated dependencies [0f8bff5]
- Updated dependencies [84d7f1a]
- Updated dependencies [067aa7b]
- Updated dependencies [fbc6938]
- Updated dependencies [efa6253]
- Updated dependencies [efa6253]
- Updated dependencies [eef5ff1]
- Updated dependencies [84d7f1a]
- Updated dependencies [84d7f1a]
- Updated dependencies [cd16f29]
- Updated dependencies [72a5c9c]
- Updated dependencies [2a33c8d]
- Updated dependencies [eef5ff1]
- Updated dependencies [72a5c9c]
- Updated dependencies [efa6253]
- Updated dependencies [84d7f1a]
- Updated dependencies [82dc9a4]
- Updated dependencies [eef5ff1]
- Updated dependencies [82dc9a4]
- Updated dependencies [72a5c9c]
  - @cosmicdrift/kumiko-bundled-features@0.365.0
  - @cosmicdrift/kumiko-framework@0.365.0
  - @cosmicdrift/kumiko-types@0.365.0
  - @cosmicdrift/kumiko-dev-server@0.365.0

## 0.364.0

### Patch Changes

- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [a0dcd31]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [e9b032f]
- Updated dependencies [15039ce]
- Updated dependencies [cfbffba]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [6b1567e]
- Updated dependencies [2b255c2]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [92a9c52]
- Updated dependencies [fd5009a]
- Updated dependencies [8be3807]
- Updated dependencies [15039ce]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [c181b3f]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [15039ce]
- Updated dependencies [fd5009a]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [b13c0d4]
- Updated dependencies [fd5009a]
- Updated dependencies [dfb2523]
- Updated dependencies [8fb6aa6]
- Updated dependencies [7482ee2]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [5a39305]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [7482ee2]
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
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [7482ee2]
- Updated dependencies [8e81d73]
- Updated dependencies [baf641a]
- Updated dependencies [8e81d73]
- Updated dependencies [92a9c52]
- Updated dependencies [15039ce]
- Updated dependencies [8e81d73]
- Updated dependencies [8be3807]
- Updated dependencies [8e81d73]
- Updated dependencies [15039ce]
- Updated dependencies [68078ee]
- Updated dependencies [15039ce]
- Updated dependencies [15039ce]
- Updated dependencies [b5a6395]
- Updated dependencies [fd5009a]
- Updated dependencies [55f003d]
- Updated dependencies [8e81d73]
- Updated dependencies [fd5009a]
- Updated dependencies [8e81d73]
- Updated dependencies [8e81d73]
  - @cosmicdrift/kumiko-bundled-features@0.364.0
  - @cosmicdrift/kumiko-framework@0.364.0
  - @cosmicdrift/kumiko-types@0.364.0
  - @cosmicdrift/kumiko-dev-server@0.364.0

## 0.363.0

### Patch Changes

- 045f886: Fewer unchecked casts in bundled features, dev-server, server-runtime, testing and cli

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Fewer unchecked casts in bundled features, dev-server, server-runtime, testing and cli
  detail: Casts are replaced by shared type guards, typed query rows and direct Bun typings. Behavior stays the same, except that a tier-resolver registration without a build() factory now fails with a clear error at boot, the kumiko CLI prints the thrown value of non-Error failures instead of "undefined".
  -->

- Updated dependencies [9120f65]
- Updated dependencies [ef689d8]
- Updated dependencies [9120f65]
- Updated dependencies [045f886]
- Updated dependencies [a12e094]
- Updated dependencies [9120f65]
- Updated dependencies [b9a146d]
- Updated dependencies [9120f65]
- Updated dependencies [58452ae]
- Updated dependencies [ef689d8]
- Updated dependencies [ef689d8]
- Updated dependencies [9120f65]
- Updated dependencies [3c6b3da]
- Updated dependencies [09a4aa2]
- Updated dependencies [b022cca]
- Updated dependencies [fcd6eb4]
- Updated dependencies [2972bc2]
- Updated dependencies [ef689d8]
- Updated dependencies [4a748c3]
- Updated dependencies [0a79504]
- Updated dependencies [0a79504]
- Updated dependencies [2972bc2]
- Updated dependencies [9120f65]
- Updated dependencies [7ed530a]
- Updated dependencies [d35e9a0]
- Updated dependencies [549a6f6]
- Updated dependencies [f3fe91e]
- Updated dependencies [3c6b3da]
- Updated dependencies [2972bc2]
- Updated dependencies [3c6b3da]
- Updated dependencies [46b83b8]
- Updated dependencies [cbed66e]
- Updated dependencies [366d89f]
- Updated dependencies [a12e094]
- Updated dependencies [9120f65]
- Updated dependencies [9120f65]
  - @cosmicdrift/kumiko-bundled-features@0.363.0
  - @cosmicdrift/kumiko-framework@0.363.0
  - @cosmicdrift/kumiko-dev-server@0.363.0
  - @cosmicdrift/kumiko-types@0.363.0

## 0.362.0

### Patch Changes

- Updated dependencies [e5c2657]
- Updated dependencies [c455a6c]
- Updated dependencies [0e8fe37]
- Updated dependencies [61f7dd2]
- Updated dependencies [b6870d9]
- Updated dependencies [e5c2657]
- Updated dependencies [e5c2657]
- Updated dependencies [e5c2657]
- Updated dependencies [e5c2657]
- Updated dependencies [75d3e38]
- Updated dependencies [ef14b5a]
  - @cosmicdrift/kumiko-bundled-features@0.362.0
  - @cosmicdrift/kumiko-types@0.362.0
  - @cosmicdrift/kumiko-framework@0.362.0
  - @cosmicdrift/kumiko-dev-server@0.362.0

## 0.361.0

### Patch Changes

- Updated dependencies [33db7c0]
- Updated dependencies [a63365a]
- Updated dependencies [4bf01ba]
- Updated dependencies [a3a51aa]
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
  - @cosmicdrift/kumiko-bundled-features@0.361.0
  - @cosmicdrift/kumiko-dev-server@0.361.0
  - @cosmicdrift/kumiko-types@0.361.0
  - @cosmicdrift/kumiko-framework@0.361.0

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

### Patch Changes

- Updated dependencies [cc46b78]
- Updated dependencies [e71b639]
- Updated dependencies [b0e8bd3]
- Updated dependencies [16fe359]
  - @cosmicdrift/kumiko-framework@0.360.0
  - @cosmicdrift/kumiko-types@0.360.0
  - @cosmicdrift/kumiko-bundled-features@0.360.0
  - @cosmicdrift/kumiko-dev-server@0.360.0

## 0.359.0

### Patch Changes

- Updated dependencies [dacda2f]
  - @cosmicdrift/kumiko-framework@0.359.0
  - @cosmicdrift/kumiko-bundled-features@0.359.0
  - @cosmicdrift/kumiko-dev-server@0.359.0

## 0.358.0

### Patch Changes

- Updated dependencies [bea04fb]
- Updated dependencies [5037fe8]
- Updated dependencies [b182c6c]
- Updated dependencies [0f10302]
- Updated dependencies [067bc4c]
- Updated dependencies [eec3b6b]
- Updated dependencies [e028f23]
  - @cosmicdrift/kumiko-bundled-features@0.358.0
  - @cosmicdrift/kumiko-framework@0.358.0
  - @cosmicdrift/kumiko-dev-server@0.358.0

## 0.357.0

### Minor Changes

- 71b4f59: defineAppE2eConfig accepts permissions, launchOptions, a custom server command and Bun preloads

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: defineAppE2eConfig accepts permissions, launchOptions, a custom server command and Bun preloads
  detail: |
    Apps that need browser permissions (camera, microphone), Chromium launch flags such as fake media devices, or a preloaded module for the e2e server no longer have to hand-roll their Playwright config. permissions and launchOptions land in the shared use block. preload (one path or a list) is prefixed to serverEntry as bun run --preload flags; serverCommand replaces the whole server start command and cannot be combined with serverEntry or preload.
  -->

### Patch Changes

- Updated dependencies [03b6438]
- Updated dependencies [774c60c]
- Updated dependencies [1ed997b]
- Updated dependencies [06e8ad8]
- Updated dependencies [d7872bd]
- Updated dependencies [eb71a72]
- Updated dependencies [91501d3]
  - @cosmicdrift/kumiko-bundled-features@0.357.0
  - @cosmicdrift/kumiko-framework@0.357.0
  - @cosmicdrift/kumiko-dev-server@0.357.0

## 0.356.0

### Patch Changes

- Updated dependencies [4e110c4]
- Updated dependencies [4c06248]
- Updated dependencies [77c6851]
  - @cosmicdrift/kumiko-framework@0.356.0
  - @cosmicdrift/kumiko-bundled-features@0.356.0
  - @cosmicdrift/kumiko-dev-server@0.356.0

## 0.355.0

### Patch Changes

- Updated dependencies [17496fd]
- Updated dependencies [326bfb5]
- Updated dependencies [c40ac62]
- Updated dependencies [32d725c]
- Updated dependencies [44650be]
  - @cosmicdrift/kumiko-framework@0.355.0
  - @cosmicdrift/kumiko-bundled-features@0.355.0
  - @cosmicdrift/kumiko-dev-server@0.355.0

## 0.354.1

### Patch Changes

- Updated dependencies [a5f13a7]
- Updated dependencies [a7b381b]
  - @cosmicdrift/kumiko-framework@0.354.1
  - @cosmicdrift/kumiko-bundled-features@0.354.1
  - @cosmicdrift/kumiko-dev-server@0.354.1

## 0.354.0

### Minor Changes

- 4d058fb: Review batch H1: framework parts of consumer-app findings.

  - `auth-email-password` exports `issueSignupActivation` (invalidate, mint, store and mail an activation link; the signup-request handler now runs on it), `SIGNUP_ACTIVATION_NOTIFICATION_TYPE`, `storeSignupToken`, `invalidateExistingSignupToken`, `normalizeEmail` and `SIGNUP_TOKEN_KEY_PREFIXES`.
  - `auth-mfa` declares the master-key env slots (`KUMIKO_SECRETS_MASTER_KEY_V1`, `_CURRENT_VERSION`, the `_CIPHERTEXT` twin) as a shared fragment with `secrets`, so a rotated `V<n>` slot is unpacked even without `secrets` mounted.
  - `user-data-rights` exports `TENANT_MODEL_CONFIG_KEY`; `createTemplateResolverApi` takes a `DbRunner`.
  - The user menu's logout item carries `data-testid="user-menu-logout"`.
  - renderer-web: a `Field` description is linked to its text input via `aria-describedby`; the facet filter dropdown is capped to the available viewport height and scrolls; `createBrowserLocaleResolver` takes `normalizeLocale` and the default storage key is exported as `BROWSER_LOCALE_STORAGE_KEY`.
  - testing: `loginViaApi(request, credentials, { bucketKey })`, `CLIENT_IP_HEADER` from `@cosmicdrift/kumiko-testing/e2e`, and a Playwright-free `@cosmicdrift/kumiko-testing/e2e/constants` subpath (`KUMIKO_SECRETS_MASTER_KEY_V1`).

  <!-- kumiko-changes
  feature: auth-mfa
  type: breaking
  title: auth-mfa declares the master-key env slots, so composeEnvSchema requires KUMIKO_SECRETS_MASTER_KEY_V1 when auth-mfa is mounted
  migration: Apps that bring their own masterKey provider instead of the env KEK add "auth-mfa" to composeEnvSchema's optionalFeatures, like they already do for "secrets". Required wins as soon as auth-mfa is not in optionalFeatures, even when `secrets` is listed there.
  -->

### Patch Changes

- 15e6930: Export trackInFlightRequests(page) so captureScreenshot counts requests from the initial load; the first untracked call waits for network idle, and a pushState during a delayed navigation no longer drops in-flight requests

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: trackInFlightRequests(page) export for captureScreenshot
  -->

- Updated dependencies [8f1ab07]
- Updated dependencies [a734025]
- Updated dependencies [8f1ab07]
- Updated dependencies [36a08aa]
- Updated dependencies [81153cb]
- Updated dependencies [fde53b0]
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
- Updated dependencies [6265371]
- Updated dependencies [c10805f]
- Updated dependencies [fc80bb4]
- Updated dependencies [fde53b0]
- Updated dependencies [edcb2d0]
- Updated dependencies [2873c76]
- Updated dependencies [357f33d]
- Updated dependencies [8307320]
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
- Updated dependencies [fde53b0]
- Updated dependencies [f1a576b]
- Updated dependencies [13f6b6f]
  - @cosmicdrift/kumiko-bundled-features@0.354.0
  - @cosmicdrift/kumiko-framework@0.354.0
  - @cosmicdrift/kumiko-dev-server@0.354.0

## 0.353.0

### Patch Changes

- 1d1ff03: E2E webServer infra defaults no longer override keys defined in the app's `.env`; precedence is shell environment, then `.env`, then the template default

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: E2E webServer infra defaults no longer override keys defined in the app's .env
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

- Updated dependencies [4d6ce00]
- Updated dependencies [e1862ae]
- Updated dependencies [e1862ae]
- Updated dependencies [3932e47]
- Updated dependencies [f05c4e7]
- Updated dependencies [8310091]
- Updated dependencies [4ec1c59]
- Updated dependencies [4ec1c59]
- Updated dependencies [0609d09]
- Updated dependencies [649b512]
- Updated dependencies [d32c9b3]
- Updated dependencies [a9ab2be]
- Updated dependencies [b5466a7]
  - @cosmicdrift/kumiko-bundled-features@0.353.0
  - @cosmicdrift/kumiko-framework@0.353.0
  - @cosmicdrift/kumiko-dev-server@0.353.0

## 0.352.0

### Patch Changes

- Updated dependencies [9fb0657]
- Updated dependencies [c0be608]
- Updated dependencies [9fb0657]
- Updated dependencies [b905d4b]
- Updated dependencies [9fb0657]
- Updated dependencies [fd0a878]
- Updated dependencies [9fb0657]
- Updated dependencies [9fb0657]
- Updated dependencies [9fb0657]
- Updated dependencies [9fb0657]
  - @cosmicdrift/kumiko-framework@0.352.0
  - @cosmicdrift/kumiko-bundled-features@0.352.0
  - @cosmicdrift/kumiko-dev-server@0.352.0

## 0.351.0

### Minor Changes

- 44be746: The e2e seed route returns the plain-text part of captured mails

  `CapturedMail` in the seed contract has an optional `text`, filled from the mail's text part, so e2e flows can assert on it.

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: CapturedMail.text in the e2e seed route carries the mail's plain-text part
  -->

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
  - @cosmicdrift/kumiko-dev-server@0.351.0
  - @cosmicdrift/kumiko-framework@0.351.0
  - @cosmicdrift/kumiko-bundled-features@0.351.0

## 0.350.0

### Patch Changes

- Updated dependencies [80ca7d3]
  - @cosmicdrift/kumiko-bundled-features@0.350.0
  - @cosmicdrift/kumiko-dev-server@0.350.0
  - @cosmicdrift/kumiko-framework@0.350.0

## 0.349.0

### Patch Changes

- Updated dependencies [6e850b8]
- Updated dependencies [6e850b8]
- Updated dependencies [6e850b8]
- Updated dependencies [6e850b8]
  - @cosmicdrift/kumiko-framework@0.349.0
  - @cosmicdrift/kumiko-dev-server@0.349.0
  - @cosmicdrift/kumiko-bundled-features@0.349.0

## 0.348.1

### Patch Changes

- Updated dependencies [f047a97]
  - @cosmicdrift/kumiko-bundled-features@0.348.1
  - @cosmicdrift/kumiko-dev-server@0.348.1
  - @cosmicdrift/kumiko-framework@0.348.1

## 0.348.0

### Minor Changes

- d7fd7e0: runSeedWritesAt: regular writes with a caller-set event time for E2E and demo seeds

  `runSeedWritesAt(createdAt, fn)` from `@cosmicdrift/kumiko-framework/event-store` runs `fn` so that every event appended inside it is stored with `createdAt` instead of the database `now()`. The writes still go through the normal path (handler, validation, event append, projections), so projections that read the event time, such as entity `insertedAt`/`modifiedAt`, see the back-dated value. The helper only works with `KUMIKO_TEST_SEED=1` and `NODE_ENV` other than `production`; otherwise it throws `SeedModeDisabledError` before `fn` runs. `buildServer` now refuses to boot when `KUMIKO_TEST_SEED=1` is set together with `NODE_ENV=production`. Nothing from a request (payload, headers, seed-route body) can set the time; call the helper from an in-process seeder such as an `extraSeeders` entry or a `runDevApp` seed function. Events keep their global id order, so back-dated events are still delivered to consumers; only `created_at` order differs. A seed write dated before its stream predecessor is rejected, because `loadAggregateAsOf` and projection rebuilds order by `created_at`. Events written by async consumers or jobs in reaction to a seeded event are not back-dated; the seeder has to write those itself inside the scope. Await everything inside `fn`.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: runSeedWritesAt runs regular writes with a caller-set event time, only in seed mode
  migration: |
    Seeders that need history (for example 90 days of status changes) wrap their dispatcher or ctx.write calls in `runSeedWritesAt(createdAt, async () => { ... })` instead of writing events or projection rows directly. Boot the server with `KUMIKO_TEST_SEED=1` and a non-production `NODE_ENV`; a boot with both the flag and `NODE_ENV=production` now fails. Within one aggregate stream, write the events in ascending time.
  -->

### Patch Changes

- Updated dependencies [400490e]
- Updated dependencies [400490e]
- Updated dependencies [d7fd7e0]
  - @cosmicdrift/kumiko-bundled-features@0.348.0
  - @cosmicdrift/kumiko-framework@0.348.0
  - @cosmicdrift/kumiko-dev-server@0.348.0

## 0.347.0

### Patch Changes

- Updated dependencies [a35ad24]
- Updated dependencies [69c182c]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [69c182c]
- Updated dependencies [69c182c]
  - @cosmicdrift/kumiko-bundled-features@0.347.0
  - @cosmicdrift/kumiko-dev-server@0.347.0
  - @cosmicdrift/kumiko-framework@0.347.0

## 0.346.0

### Patch Changes

- Updated dependencies [7bade44]
- Updated dependencies [c4a4bba]
- Updated dependencies [d83aa55]
- Updated dependencies [695d47c]
- Updated dependencies [0207a6e]
- Updated dependencies [6b8dde4]
  - @cosmicdrift/kumiko-bundled-features@0.346.0
  - @cosmicdrift/kumiko-framework@0.346.0
  - @cosmicdrift/kumiko-dev-server@0.346.0

## 0.345.0

### Minor Changes

- 07495cf: The e2e kit now works against apps that enforce MFA. `seedTenant({ mfa: "totp" })` enrolls the seeded admin with a confirmed TOTP factor through the real auth-mfa endpoints and returns the base32 secret as `admin.mfaTotpSecret`. `loginViaApi` and `loginViaUi` answer the MFA challenge with that secret when the credentials carry `mfaTotpSecret`; without it they behave as before for accounts that need no MFA. `seedTenant()` also enrolls the admin when the app policy demands MFA (the login answers with a required setup), without the option; the option forces enrollment when no policy does. `enrollTotpViaApi(request, credentials)` is exported for enrolling other users, and `addUser(roles, { mfa: "totp" })` enrolls a seeded user (returned as `mfaTotpSecret`) on a separate request context, so the admin session stays logged in. `loginViaApi` now throws when the account answers with an MFA challenge or a required MFA setup but the credentials carry no `mfaTotpSecret`, instead of returning without a session. It also throws when the credentials carry a secret but the server answers with a required MFA setup, since the account then has no enrolled factor. Repeated logins in one 30 s window use the next valid TOTP step, because the server burns an accepted code.

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: e2e kit seeds an MFA factor and answers the MFA challenge on login
  -->

### Patch Changes

- Updated dependencies [cef5fa0]
- Updated dependencies [c325eb2]
- Updated dependencies [07495cf]
- Updated dependencies [c325eb2]
- Updated dependencies [07495cf]
- Updated dependencies [07495cf]
- Updated dependencies [07495cf]
- Updated dependencies [c325eb2]
- Updated dependencies [c325eb2]
- Updated dependencies [db68d67]
  - @cosmicdrift/kumiko-framework@0.345.0
  - @cosmicdrift/kumiko-bundled-features@0.345.0
  - @cosmicdrift/kumiko-dev-server@0.345.0

## 0.344.0

### Patch Changes

- Updated dependencies [2a07102]
- Updated dependencies [2a07102]
- Updated dependencies [2a07102]
  - @cosmicdrift/kumiko-bundled-features@0.344.0
  - @cosmicdrift/kumiko-dev-server@0.344.0
  - @cosmicdrift/kumiko-framework@0.344.0

## 0.343.0

### Patch Changes

- Updated dependencies [23b0bec]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [75cb7c0]
- Updated dependencies [cf6d31b]
- Updated dependencies [cf6d31b]
- Updated dependencies [75cb7c0]
- Updated dependencies [cf6d31b]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [d32e123]
- Updated dependencies [6adca33]
- Updated dependencies [cf6d31b]
- Updated dependencies [cf6d31b]
- Updated dependencies [446b714]
  - @cosmicdrift/kumiko-framework@0.343.0
  - @cosmicdrift/kumiko-bundled-features@0.343.0
  - @cosmicdrift/kumiko-dev-server@0.343.0

## 0.342.0

### Minor Changes

- e7f2d36: channel-email: fromName sets the display name of the From header

  `EmailMessage` gets an optional `fromName`, and the email channel passes `data.fromName` through like `replyTo`. The SMTP transport combines it with the address of `message.from` or the transport default, so `from: "App <noreply@x>"` plus `fromName: "Tenant via veridom"` sends from `noreply@x` under the new name. Control characters in the name are replaced by spaces before sending, and an empty name behaves like no name. The PII ciphertext guard refuses a ciphertext `fromName`.

  <!-- kumiko-changes
  feature: channel-email
  type: improvement
  title: EmailMessage.fromName sets the From display name
  -->

### Patch Changes

- Updated dependencies [e7f2d36]
- Updated dependencies [5733150]
- Updated dependencies [e7f2d36]
- Updated dependencies [e7f2d36]
- Updated dependencies [0978e85]
- Updated dependencies [e7f2d36]
- Updated dependencies [0978e85]
- Updated dependencies [0978e85]
- Updated dependencies [bb89ab6]
  - @cosmicdrift/kumiko-bundled-features@0.342.0
  - @cosmicdrift/kumiko-dev-server@0.342.0
  - @cosmicdrift/kumiko-framework@0.342.0

## 0.341.0

### Patch Changes

- Updated dependencies [9bc1069]
- Updated dependencies [e7dbdb6]
- Updated dependencies [37c0974]
- Updated dependencies [e7dbdb6]
- Updated dependencies [610201f]
- Updated dependencies [c5a7dc2]
- Updated dependencies [82309a5]
- Updated dependencies [9bc1069]
- Updated dependencies [465e14c]
- Updated dependencies [1feae69]
- Updated dependencies [c2c7862]
- Updated dependencies [1feae69]
- Updated dependencies [1feae69]
- Updated dependencies [610201f]
- Updated dependencies [37c0974]
- Updated dependencies [e7dbdb6]
- Updated dependencies [1feae69]
- Updated dependencies [dba5100]
- Updated dependencies [c5e6814]
- Updated dependencies [8443f22]
- Updated dependencies [1f0a63b]
- Updated dependencies [0600763]
- Updated dependencies [e0c2320]
- Updated dependencies [4b01c83]
- Updated dependencies [37c0974]
  - @cosmicdrift/kumiko-bundled-features@0.341.0
  - @cosmicdrift/kumiko-framework@0.341.0
  - @cosmicdrift/kumiko-dev-server@0.341.0

## 0.340.0

### Patch Changes

- Updated dependencies [483bb16]
- Updated dependencies [483bb16]
- Updated dependencies [b71234a]
  - @cosmicdrift/kumiko-framework@0.340.0
  - @cosmicdrift/kumiko-bundled-features@0.340.0
  - @cosmicdrift/kumiko-dev-server@0.340.0

## 0.339.0

### Patch Changes

- dc3a61e: The generated `bunfig.integration.toml` now ignores `**/*.test.tsx`. Calling `bun test --config=bunfig.integration.toml <dir>` directly no longer picks up DOM tests, which failed there without the DOM preload. The runner and `test:dom` collect the same tests as before.

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: Generated integration bunfig ignores *.test.tsx
  migration: |
    Regenerate with `kumiko-testing bunfig` after the bump to pick up the new ignore pattern.
  -->

- Updated dependencies [8b3228a]
- Updated dependencies [d4872a8]
- Updated dependencies [0e065d2]
- Updated dependencies [80ecf93]
- Updated dependencies [5b6e5f7]
- Updated dependencies [4495f98]
- Updated dependencies [c1e6186]
- Updated dependencies [58dd1cb]
- Updated dependencies [fcbf184]
- Updated dependencies [e3adda3]
- Updated dependencies [1954386]
- Updated dependencies [b040ca7]
- Updated dependencies [252f749]
  - @cosmicdrift/kumiko-bundled-features@0.339.0
  - @cosmicdrift/kumiko-framework@0.339.0
  - @cosmicdrift/kumiko-dev-server@0.339.0

## 0.338.0

### Patch Changes

- Updated dependencies [e5c62d2]
- Updated dependencies [e5c62d2]
- Updated dependencies [e234ce6]
- Updated dependencies [9fa543d]
- Updated dependencies [6016fa6]
- Updated dependencies [fcaebd3]
- Updated dependencies [81bafe8]
- Updated dependencies [39b8cd4]
- Updated dependencies [6c1c880]
- Updated dependencies [6c1c880]
- Updated dependencies [421334d]
- Updated dependencies [c710f1e]
- Updated dependencies [1522b9e]
- Updated dependencies [3613e5a]
- Updated dependencies [ca99e95]
- Updated dependencies [916c6c0]
- Updated dependencies [c8ca453]
- Updated dependencies [3451156]
- Updated dependencies [4a13a0e]
- Updated dependencies [7042edb]
- Updated dependencies [57467b5]
- Updated dependencies [a71189f]
- Updated dependencies [43dfcf4]
- Updated dependencies [e8e5e2f]
- Updated dependencies [bac056f]
- Updated dependencies [f4f3d4a]
- Updated dependencies [b036209]
- Updated dependencies [87938e0]
- Updated dependencies [51b4867]
- Updated dependencies [4c168d6]
- Updated dependencies [d1bba78]
  - @cosmicdrift/kumiko-bundled-features@0.338.0
  - @cosmicdrift/kumiko-framework@0.338.0
  - @cosmicdrift/kumiko-dev-server@0.338.0

## 0.337.1

### Patch Changes

- Updated dependencies [b1b01b8]
- Updated dependencies [9074b71]
- Updated dependencies [6c1c1d4]
  - @cosmicdrift/kumiko-framework@0.337.1
  - @cosmicdrift/kumiko-dev-server@0.337.1
  - @cosmicdrift/kumiko-bundled-features@0.337.1

## 0.337.0

### Patch Changes

- 7bd2624: `kumiko-testing bunfig` now reports dotted and quoted keys as unknown and keeps `[[array-of-tables]]` blocks instead of folding them into `[test]`, and drops the superseded `./test-setup/dom.preload.ts` only when the DOM preload is generated. The schema-env-defaults preload treats empty values like unset ones for every key. `kumiko-testing integration <dir>` skips `node_modules`, `dist` and `e2e` while expanding a directory. `seedTenant` returns `unsubscribeSse` to detach the tenant's SSE client from `events.sse`. A real-provider scenario `waitFor` now times out after `E2E_TIMEOUT_MS.realWait` (180 s), before the 240 s test timeout.

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: bunfig merge reports dotted/quoted keys and keeps array tables, empty schema env defaults are replaced, integration dir expansion prunes node_modules, seedTenant gains unsubscribeSse
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
- Updated dependencies [b402850]
- Updated dependencies [7735806]
- Updated dependencies [615109d]
- Updated dependencies [8a4feff]
- Updated dependencies [d25d363]
- Updated dependencies [acde687]
- Updated dependencies [e889f3f]
  - @cosmicdrift/kumiko-framework@0.337.0
  - @cosmicdrift/kumiko-bundled-features@0.337.0
  - @cosmicdrift/kumiko-dev-server@0.337.0

## 0.336.1

### Patch Changes

- c4a1155: The DOM preload's bounded print of nodes now covers SVG elements too. Before, printing an `<svg>` in a failed assertion dumped the whole happy-dom object graph (about 10 MB).

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: DOM preload bounds the printed output of SVG elements as well
  -->

- c4a1155: The scaffolded `test:real` script now filters on `.real.test.ts` instead of `real.test.ts`, so files such as `unreal.test.ts` no longer run under the real-provider environment.

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: Scaffolded test:real only matches *.real.test.ts files
  -->

- Updated dependencies [ad3999e]
- Updated dependencies [0dd3b1e]
- Updated dependencies [4554270]
  - @cosmicdrift/kumiko-framework@0.336.1
  - @cosmicdrift/kumiko-bundled-features@0.336.1
  - @cosmicdrift/kumiko-dev-server@0.336.1

## 0.336.0

### Patch Changes

- Updated dependencies [e91de78]
- Updated dependencies [e19453a]
- Updated dependencies [d850929]
- Updated dependencies [c2e04a4]
- Updated dependencies [63f7b52]
- Updated dependencies [83378b1]
- Updated dependencies [c95f017]
- Updated dependencies [58154f0]
- Updated dependencies [b83c348]
- Updated dependencies [4618e1d]
  - @cosmicdrift/kumiko-framework@0.336.0
  - @cosmicdrift/kumiko-bundled-features@0.336.0
  - @cosmicdrift/kumiko-dev-server@0.336.0

## 0.335.0

### Patch Changes

- 173a581: Screenshot runner fixes: a desktop project whose viewports are all covered by device projects is now skipped with a reason instead of running empty. Locales that already carry a region (`pt-BR`, `en-GB`) keep their tag instead of becoming `pt-BR-BR`. `captureScreenshot` with `presentIdentities` restores the original DOM text and field values after the capture, so later assertions and form submits in the same spec see real data.

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: Screenshot runner skips empty desktop passes, keeps regional locale tags and restores presented identities
  -->

- 1e25ae5: `kumiko-testing bunfig` drops ignore patterns the template owns but omits for the variant (such as `**/*.test.tsx` in a DOM bunfig) instead of keeping them as app extras, which silently skipped the whole suite. `@testing-library/dom` is declared as an optional peer dependency, since `@testing-library/react` needs it for `preload/dom`; apps using `--dom` install it alongside `@testing-library/react`.

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: bunfig merge drops stale template-owned ignore patterns; @testing-library/dom declared as optional peer
  -->

- a8c0abd: `captureScreenshot(..., { fit: "content" })` ignores scroll containers whose overflow does not shrink when the viewport grows (textareas, fixed-height panes) instead of failing to converge. `kumiko-testing integration` no longer walks `node_modules` while discovering test files, and the seeded-tenant `apiAs` retries a failed login on the next call instead of replaying the cached error. The privacy-center and profile `cancel-deletion` actions declare the `x` icon instead of resolving to the destructive trash icon.

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: captureScreenshot fit content ignores non-shrinking scroll containers, integration discovery skips node_modules, apiAs retries a failed login
  -->

  <!-- kumiko-changes
  feature: user-data-rights
  type: fix
  title: cancel-deletion actions declare the x icon instead of resolving to the destructive trash icon
  -->

- Updated dependencies [ff1dea2]
- Updated dependencies [d973444]
- Updated dependencies [a4fa088]
- Updated dependencies [ed072dc]
- Updated dependencies [ddb0101]
- Updated dependencies [eb04da6]
- Updated dependencies [44c5898]
- Updated dependencies [07ddc7e]
- Updated dependencies [2477f3b]
- Updated dependencies [c97a39a]
- Updated dependencies [bf12ac5]
- Updated dependencies [6d4068f]
- Updated dependencies [736dade]
- Updated dependencies [561cec5]
- Updated dependencies [2477f3b]
- Updated dependencies [1e9cc86]
- Updated dependencies [099f406]
- Updated dependencies [0ae79d4]
- Updated dependencies [6fee777]
- Updated dependencies [1da9e2c]
- Updated dependencies [57f0e78]
- Updated dependencies [9061d9e]
- Updated dependencies [f63b179]
- Updated dependencies [57f0e78]
- Updated dependencies [099f406]
- Updated dependencies [a86aa83]
- Updated dependencies [692718f]
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
- Updated dependencies [9222a01]
- Updated dependencies [4805c38]
- Updated dependencies [c791abd]
- Updated dependencies [782fdea]
- Updated dependencies [0191e3e]
- Updated dependencies [b18daf9]
- Updated dependencies [c791abd]
- Updated dependencies [04d0ae3]
- Updated dependencies [4b2c300]
- Updated dependencies [ff29a06]
- Updated dependencies [dae5a21]
- Updated dependencies [67703a0]
- Updated dependencies [e810c7d]
- Updated dependencies [567a4bd]
- Updated dependencies [e0e09b0]
- Updated dependencies [f5ff653]
- Updated dependencies [5bca19c]
- Updated dependencies [85dead2]
- Updated dependencies [9acf185]
- Updated dependencies [d7d5bd7]
- Updated dependencies [6990b9b]
- Updated dependencies [57f0e78]
- Updated dependencies [4b2c300]
- Updated dependencies [5e9cc10]
- Updated dependencies [4b2c300]
- Updated dependencies [a86aa83]
- Updated dependencies [a39d8a6]
- Updated dependencies [9061d9e]
- Updated dependencies [e550021]
- Updated dependencies [6fee777]
- Updated dependencies [a8c0abd]
- Updated dependencies [8a49831]
- Updated dependencies [4e617da]
- Updated dependencies [3d37d50]
- Updated dependencies [f65697d]
- Updated dependencies [7cdc623]
  - @cosmicdrift/kumiko-framework@0.335.0
  - @cosmicdrift/kumiko-bundled-features@0.335.0
  - @cosmicdrift/kumiko-dev-server@0.335.0

## 0.334.0

### Patch Changes

- Updated dependencies [6633f59]
- Updated dependencies [6633f59]
- Updated dependencies [bc0172a]
  - @cosmicdrift/kumiko-framework@0.334.0
  - @cosmicdrift/kumiko-bundled-features@0.334.0
  - @cosmicdrift/kumiko-dev-server@0.334.0

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

- Updated dependencies [2d7f76f]
- Updated dependencies [90420cb]
  - @cosmicdrift/kumiko-framework@0.333.0
  - @cosmicdrift/kumiko-bundled-features@0.333.0
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
- Updated dependencies [dcf135e]
- Updated dependencies [dcf135e]
- Updated dependencies [dcf135e]
  - @cosmicdrift/kumiko-framework@0.332.0
  - @cosmicdrift/kumiko-bundled-features@0.332.0
  - @cosmicdrift/kumiko-dev-server@0.332.0

## 0.331.0

### Patch Changes

- Updated dependencies [16797a4]
- Updated dependencies [6b95958]
- Updated dependencies [e6b971c]
- Updated dependencies [3ea4ffc]
- Updated dependencies [e4ea9f0]
  - @cosmicdrift/kumiko-framework@0.331.0
  - @cosmicdrift/kumiko-bundled-features@0.331.0
  - @cosmicdrift/kumiko-dev-server@0.331.0

## 0.330.2

### Patch Changes

- Updated dependencies [32a6102]
  - @cosmicdrift/kumiko-framework@0.330.2
  - @cosmicdrift/kumiko-bundled-features@0.330.2
  - @cosmicdrift/kumiko-dev-server@0.330.2

## 0.330.1

### Patch Changes

- Updated dependencies [63a63d6]
- Updated dependencies [39c2fbd]
- Updated dependencies [03ad4bc]
  - @cosmicdrift/kumiko-framework@0.330.1
  - @cosmicdrift/kumiko-bundled-features@0.330.1
  - @cosmicdrift/kumiko-dev-server@0.330.1

## 0.330.0

### Patch Changes

- Updated dependencies [7a886f1]
- Updated dependencies [dc5981b]
- Updated dependencies [89e32ce]
- Updated dependencies [7a886f1]
- Updated dependencies [89e32ce]
- Updated dependencies [89e32ce]
- Updated dependencies [7a886f1]
- Updated dependencies [f19fb5c]
- Updated dependencies [1e18129]
- Updated dependencies [1e18129]
- Updated dependencies [48f36df]
- Updated dependencies [89e32ce]
  - @cosmicdrift/kumiko-bundled-features@0.330.0
  - @cosmicdrift/kumiko-framework@0.330.0
  - @cosmicdrift/kumiko-dev-server@0.330.0

## 0.329.0

### Patch Changes

- 9bbdb64: `kumiko-testing integration <dir>` runs only `*.integration.test.ts` files

  A directory argument used to reach `bun test` as a path filter, which also picked up `*.test.tsx` files. It now expands to the integration test files below it.

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: kumiko-testing integration with a directory runs only *.integration.test.ts files
  -->

- Updated dependencies [80ccc38]
- Updated dependencies [9bbdb64]
  - @cosmicdrift/kumiko-bundled-features@0.329.0
  - @cosmicdrift/kumiko-framework@0.329.0
  - @cosmicdrift/kumiko-dev-server@0.329.0

## 0.328.1

### Patch Changes

- Updated dependencies [863e8e4]
- Updated dependencies [86451dd]
  - @cosmicdrift/kumiko-framework@0.328.1
  - @cosmicdrift/kumiko-bundled-features@0.328.1
  - @cosmicdrift/kumiko-dev-server@0.328.1

## 0.328.0

### Patch Changes

- Updated dependencies [424f49a]
- Updated dependencies [eae8d2b]
- Updated dependencies [9cc1787]
- Updated dependencies [2a4350b]
- Updated dependencies [c3fbe54]
- Updated dependencies [822928f]
  - @cosmicdrift/kumiko-framework@0.328.0
  - @cosmicdrift/kumiko-bundled-features@0.328.0
  - @cosmicdrift/kumiko-dev-server@0.328.0

## 0.327.0

### Patch Changes

- Updated dependencies [7341d07]
- Updated dependencies [268c3bd]
- Updated dependencies [532a197]
- Updated dependencies [eef5a2f]
- Updated dependencies [da6e569]
  - @cosmicdrift/kumiko-framework@0.327.0
  - @cosmicdrift/kumiko-dev-server@0.327.0
  - @cosmicdrift/kumiko-bundled-features@0.327.0

## 0.326.1

### Patch Changes

- Updated dependencies [a5e987e]
  - @cosmicdrift/kumiko-bundled-features@0.326.1
  - @cosmicdrift/kumiko-dev-server@0.326.1
  - @cosmicdrift/kumiko-framework@0.326.1

## 0.326.0

### Patch Changes

- Updated dependencies [6af6be2]
  - @cosmicdrift/kumiko-framework@0.326.0
  - @cosmicdrift/kumiko-bundled-features@0.326.0
  - @cosmicdrift/kumiko-dev-server@0.326.0

## 0.325.2

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.325.2
- @cosmicdrift/kumiko-dev-server@0.325.2
- @cosmicdrift/kumiko-framework@0.325.2

## 0.325.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.325.1
- @cosmicdrift/kumiko-dev-server@0.325.1
- @cosmicdrift/kumiko-framework@0.325.1

## 0.325.0

### Patch Changes

- Updated dependencies [100732a]
  - @cosmicdrift/kumiko-framework@0.325.0
  - @cosmicdrift/kumiko-bundled-features@0.325.0
  - @cosmicdrift/kumiko-dev-server@0.325.0

## 0.324.0

### Patch Changes

- Updated dependencies [efa4114]
- Updated dependencies [3c0095d]
  - @cosmicdrift/kumiko-framework@0.324.0
  - @cosmicdrift/kumiko-bundled-features@0.324.0
  - @cosmicdrift/kumiko-dev-server@0.324.0

## 0.323.0

### Patch Changes

- Updated dependencies [d7bba26]
- Updated dependencies [d7bba26]
- Updated dependencies [c01b9be]
- Updated dependencies [5c7e422]
- Updated dependencies [d7bba26]
- Updated dependencies [60e1a1f]
- Updated dependencies [d7bba26]
- Updated dependencies [72727cd]
- Updated dependencies [1343b18]
  - @cosmicdrift/kumiko-bundled-features@0.323.0
  - @cosmicdrift/kumiko-dev-server@0.323.0
  - @cosmicdrift/kumiko-framework@0.323.0

## 0.322.0

### Patch Changes

- Updated dependencies [d0c631a]
- Updated dependencies [9e7bedc]
  - @cosmicdrift/kumiko-framework@0.322.0
  - @cosmicdrift/kumiko-bundled-features@0.322.0
  - @cosmicdrift/kumiko-dev-server@0.322.0

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

### Patch Changes

- fa27809: E2e logins started 429ing after the client-IP resolver landed (kumiko-framework#3323): every Playwright client is on `::1`, so the default `trustedProxyHops` (0, socket-only) collapsed every seeded user's login into one shared rate-limit bucket instead of one per user

  `defineAppE2eConfig`'s `webServer` now sets `KUMIKO_TRUSTED_PROXY_HOPS=1` (template-owned, added to `RESERVED_ENV_KEYS`), and `loginViaApi` sends a deterministic per-email `X-Forwarded-For` so each seeded user gets their own bucket, the same way a real client behind one trusted reverse-proxy hop would.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: parseTrustedProxyHopsEnv/TRUSTED_PROXY_HOPS_ENV factored out of runProdApp for runDevApp and consumer tooling to share
  detail: |
    `packages/framework/src/api/client-ip.ts` gained
    `parseTrustedProxyHopsEnv(raw, context)` and the
    `TRUSTED_PROXY_HOPS_ENV = "KUMIKO_TRUSTED_PROXY_HOPS"` constant (both
    exported via the `api` barrel), moved out of `runProdApp`'s inline
    parsing. Same validation and error message as before.
  migration: |
    No action needed; runProdApp's behavior and error message are unchanged.
  -->

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: runDevApp now also honors KUMIKO_TRUSTED_PROXY_HOPS as an env fallback, symmetric to runProdApp
  detail: |
    Precedence: `options.trustedProxyHops ?? effectiveAuth?.trustedProxyHops
    ?? parseTrustedProxyHopsEnv(envSource[TRUSTED_PROXY_HOPS_ENV], "runDevApp")`.
  migration: |
    No action needed for the default (unproxied) dev setup.
  -->

  <!-- kumiko-changes
  feature: server-runtime
  type: improvement
  title: runProdApp's KUMIKO_TRUSTED_PROXY_HOPS parsing now shares framework's parseTrustedProxyHopsEnv
  detail: |
    The inline digits-only + non-negative-integer validation moved out of
    `run-prod-app.ts` into `parseTrustedProxyHopsEnv`
    (`@cosmicdrift/kumiko-framework/api`); same validation and error message
    as before, no behavioral change.
  migration: |
    No action needed.
  -->

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: defineAppE2eConfig reserves KUMIKO_TRUSTED_PROXY_HOPS; loginViaApi sends a synthetic per-user X-Forwarded-For
  detail: |
    `defineAppE2eConfig`'s `webServer.env` now sets
    `KUMIKO_TRUSTED_PROXY_HOPS=1` and rejects that key in a consumer's own
    `env` (template-owned, added to `RESERVED_ENV_KEYS`). `loginViaApi` sends
    `x-forwarded-for: syntheticClientIpFor(credentials.email)`, a new
    exported helper deriving a deterministic private-range IP from
    `sha256(email)`, so each seeded user's login lands in its own
    rate-limit bucket instead of every ::1 client sharing one.
    `loginViaUi` is unchanged.
  migration: |
    Consumers using `defineAppE2eConfig` + `loginViaApi` (incl. the
    `seedTenant` fixture) need no changes — each seeded user now logs in
    from its own bucket. Browser logins (`loginViaUi`, raw `fetch` to
    `/api/auth/login` from a page) still share the `::1` bucket. A consumer
    with its own e2e login helper (bypassing `loginViaApi`) should send
    `x-forwarded-for: syntheticClientIpFor(email)` (exported from
    `@cosmicdrift/kumiko-testing`) themselves, and must not set
    `KUMIKO_TRUSTED_PROXY_HOPS` in `defineAppE2eConfig`'s `env` — it's now
    reserved.
  -->

- de9ee46: Browser requests in e2e shared one `per: "ip"` rate-limit bucket

  Every Playwright client connects from `::1`. Since the client-IP resolver counts requests without `X-Forwarded-For` instead of skipping them, all browser pages of a parallel e2e run shared one `ip`/`ip+handler` bucket and hit load-dependent 429s on `/api/query`. The kumiko-testing `test` fixture now routes the browser context's same-origin `/api/**` requests through a synthetic `X-Forwarded-For` per test (run token + test id + repeat and retry index), so every test gets its own client IP, including browser logins. The per-user API contexts of `seedTenant` send their user's IP. The e2e webServer trusts exactly one hop (`defineAppE2eConfig`), and production is unchanged.

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: e2e test fixture gives every test its own synthetic client IP
  detail: |
    `test` from `@cosmicdrift/kumiko-testing/e2e` overrides the `context`
    fixture with a `context.route("**/api/**")` that adds
    `x-forwarded-for: syntheticClientIpFor(perTestClientIpKey(testInfo))` to
    same-origin requests; an explicit `x-forwarded-for` wins. Cross-origin
    requests stay untouched because an extra header would force a CORS
    preflight. Routing disables the HTTP cache of the test's context.
    `seedTenant`'s per-user API contexts send
    `syntheticClientIpFor(user.email)`. The built-in `request` fixture is not
    covered.
  migration: |
    Specs that import `test` from `@cosmicdrift/kumiko-testing/e2e` need no
    change. Specs importing `test` straight from `@playwright/test` keep
    sharing the `::1` bucket; switch their import to kumiko-testing.
  -->

- Updated dependencies [959b3fb]
- Updated dependencies [c8c629f]
- Updated dependencies [fa27809]
- Updated dependencies [fa27809]
- Updated dependencies [8246f13]
- Updated dependencies [b74db24]
- Updated dependencies [5616ad9]
- Updated dependencies [fa27809]
  - @cosmicdrift/kumiko-bundled-features@0.321.0
  - @cosmicdrift/kumiko-dev-server@0.321.0
  - @cosmicdrift/kumiko-framework@0.321.0

## 0.320.0

### Minor Changes

- 9907bc6: `requireRealProviders()` is importable from `@cosmicdrift/kumiko-testing/e2e`, and `seedTenant()` tenants receive SSE events on `stack.events.sse`

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Real-provider helpers under the import-free subpath testing/real-providers
  detail: |
    `@cosmicdrift/kumiko-framework/testing/real-providers` exports `requireRealProviders`, `isRealProviderRun` and `REAL_PROVIDERS_ENV` without pulling in the `./testing` barrel and its Bun-only dependencies, so code that loads under Node can use them.
  -->

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: requireRealProviders from kumiko-testing/e2e, SSE events for seedTenant tenants
  detail: |
    `@cosmicdrift/kumiko-testing/e2e` re-exports `requireRealProviders`, `isRealProviderRun` and `REAL_PROVIDERS_ENV` from the framework's `testing/real-providers` subpath instead of keeping its own copy. Playwright specs and configs, which load under Node, no longer have to avoid the framework's `./testing` barrel.

    `seedTenant(stack, …)` subscribes `stack.events.sse` to the seeded tenant's SSE channel. Before, `setupTestStack` only listened on test tenant 1, so writes in a seeded tenant never showed up on `events.sse` and tests had to call `stack.sseBroker.addClient(tenantChannel(id), …)` themselves; that manual call can go. Events from `persist: true` seeding (tenant, user, membership) now also land on `events.sse` after the next drain.
  -->

- ef64fa9: `SCHEMA_ENV_DEFAULTS` (`JWT_SECRET`, `KUMIKO_SECRETS_MASTER_KEY_V1`, `KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION`) is now preloaded by every `kumiko-testing bunfig` variant — unit and DOM via the new `preload/schema-env-defaults`, integration via `preload/env`, real via `preload/real` — each filled with `??=` so an app's own value wins — except a `JWT_SECRET` shorter than 32 characters, which is replaced like the app-local preloads did. Previously only integration and real got a `JWT_SECRET` default (from `SERVICE_ENV_DEFAULTS`, which no longer carries it — `SCHEMA_ENV_DEFAULTS` is now its single source), and no variant defaulted the secrets master key, forcing every app with the secrets/field-encryption/auth-mfa features to hand-roll its own test preload for these framework-schema keys. Unit and DOM still get no service-endpoint defaults (`DATABASE_URL`, `REDIS_URL`, …) — an accidental infra call in a unit test still fails instead of silently connecting. Regenerate with `kumiko-testing bunfig` to pick up the new preload entry.

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: Schema-required test env keys (JWT_SECRET, secrets master key) now default in every bunfig variant
  detail: |
    Apps with the secrets, field-encryption or auth-mfa features previously had
    to hand-roll a `test-setup/env.preload.ts` to satisfy the env schema's
    `JWT_SECRET` and `KUMIKO_SECRETS_MASTER_KEY_*` in unit and DOM tests, since
    only `SERVICE_ENV_DEFAULTS` (integration/real only) carried a `JWT_SECRET`
    default and no map carried the master key. The new `SCHEMA_ENV_DEFAULTS`
    map lives next to `SERVICE_ENV_DEFAULTS` and is preloaded in all four bunfig
    variants (unit, DOM, integration, real) via a new `preload/schema-env-defaults`
    module, filled with `??=` so an app's own value is kept; only a
    `JWT_SECRET` shorter than 32 characters is replaced.
    `SERVICE_ENV_DEFAULTS` no longer duplicates `JWT_SECRET` — it has one home
    now. Unit and DOM still carry no service-endpoint defaults.
  -->

### Patch Changes

- Updated dependencies [c61cc7a]
- Updated dependencies [0ab9874]
- Updated dependencies [c61cc7a]
- Updated dependencies [e7cd1cb]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [519261d]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [3a99ac1]
- Updated dependencies [fe36eeb]
- Updated dependencies [02cc7b3]
- Updated dependencies [c498565]
- Updated dependencies [9c6173d]
- Updated dependencies [9907bc6]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
  - @cosmicdrift/kumiko-bundled-features@0.320.0
  - @cosmicdrift/kumiko-framework@0.320.0
  - @cosmicdrift/kumiko-dev-server@0.320.0

## 0.319.0

### Patch Changes

- Updated dependencies [53c5206]
- Updated dependencies [53c5206]
- Updated dependencies [53c5206]
- Updated dependencies [53c5206]
- Updated dependencies [53c5206]
- Updated dependencies [53c5206]
  - @cosmicdrift/kumiko-bundled-features@0.319.0
  - @cosmicdrift/kumiko-dev-server@0.319.0
  - @cosmicdrift/kumiko-framework@0.319.0

## 0.318.0

### Minor Changes

- 1d97d7a: Export `buildIntegrationTestArgs`/`selectIntegrationFiles` from a new `@cosmicdrift/kumiko-testing/integration-runner` subpath

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: integration-runner exports a dedicated subpath
  detail: |
    `buildIntegrationTestArgs` and `selectIntegrationFiles` previously reached
    consumers only through `kumiko-testing`'s own CLI (`kumiko-testing
    integration --parallel N`), with no package subpath a caller outside the
    CLI could import them from. kumiko-framework's own
    `scripts/run-integration-tests.ts` needed exactly that: the same
    `--parallel N --no-isolate` invocation the app template already runs,
    reused instead of reimplemented, while still discovering its own file
    list and running a separate bulk/perf mode split the CLI doesn't have.
    The new `./integration-runner` export makes that reuse
    possible without duplicating the arg-building logic; no existing export
    changed.
  -->

### Patch Changes

- Updated dependencies [4c5152f]
- Updated dependencies [4c5152f]
- Updated dependencies [4c5152f]
- Updated dependencies [5d3b3e8]
- Updated dependencies [5d3b3e8]
- Updated dependencies [4fac08d]
- Updated dependencies [4c5152f]
- Updated dependencies [4c5152f]
- Updated dependencies [4c5152f]
- Updated dependencies [4c5152f]
  - @cosmicdrift/kumiko-bundled-features@0.318.0
  - @cosmicdrift/kumiko-framework@0.318.0
  - @cosmicdrift/kumiko-dev-server@0.318.0

## 0.317.0

### Minor Changes

- 061ee8f: kumiko-testing bunfig --dom now preloads a package-owned DOM preload instead of requiring an app-local ./test-setup/dom.preload.ts

  <!-- kumiko-changes
  feature: testing
  type: breaking
  title: bunfig --dom preloads the package's own DOM setup instead of an app-local file
  detail: |
    The package now exports `./preload/dom`, the happy-dom GlobalRegistrator
    setup (IS_REACT_ACT_ENVIRONMENT, Bun's native fetch/Request/Response
    preserved over happy-dom's broken cookie header, testing-library/react
    cleanup, Radix pointer-capture/scrollIntoView stubs, the inspect-size
    limit for waitFor) that each app using --dom previously copied into its
    own ./test-setup/dom.preload.ts. `kumiko-testing bunfig --dom` now generates
    bunfig.dom.toml with @cosmicdrift/kumiko-testing/preload/dom instead of
    the app-local path. @happy-dom/global-registrator and
    @testing-library/react are optional peer dependencies, same as
    @playwright/test for ./e2e. This reverses kumiko-framework#3128, which
    kept the file as an app-local copy because at the time it was
    workspace-internal, not a published contract. In practice the copies
    never diverged on purpose, only by drift: publicstatus, phronexsis and
    kumiko-enterprise carried older, partial copies of the framework's own
    test-setup/dom.preload.ts (missing the inspect-size fix for #3082), and
    only offlot-app matched the framework's code (comments reworded, no
    functional diff). The framework's own copy is now deleted; the
    framework runs the same package preload it ships.
  migration: |
    In every bunfig file that lists "./test-setup/dom.preload.ts"
    (publicstatus, phronexsis, offlot-app and kumiko-enterprise each have
    exactly one, their bunfig.dom.toml), replace that line with
    "@cosmicdrift/kumiko-testing/preload/dom", then delete the now-
    unreferenced ./test-setup/dom.preload.ts. Ensure
    @happy-dom/global-registrator and @testing-library/react are in the
    app's devDependencies (all four already have both). Running
    `kumiko-testing bunfig --dom` instead also works: mergeBunfig now keeps
    an app-local extra preload (publicstatus's
    env.preload.ts/codegen.preload.ts) across the regen instead of dropping
    it, and treats an existing "./test-setup/dom.preload.ts" entry as
    superseded rather than an extra, so it doesn't end up preloaded twice
    alongside the new package path. The generated preload array's own
    entries stay first; a carried-over extra lands after them, which can
    move it relative to entries that used to sit between the template's
    preloads and the app's own (publicstatus: dom.preload.ts used to run
    last, after env/codegen; the package preload now runs before them).
  -->

### Patch Changes

- fd40653: `kumiko-testing bunfig` no longer drops entries an app appended to its own preload/pathIgnorePatterns arrays on disk

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: mergeBunfig keeps app-local array extras instead of overwriting them
  detail: |
    mergeBunfig only checked whether a key such as `preload` existed on both
    sides of the merge, not whether its array value matched. Regenerating a
    bunfig therefore silently replaced an app's `[test].preload`,
    `pathIgnorePatterns` or `coveragePathIgnorePatterns` array with the
    generated one, dropping any entry the app had appended by hand (measured
    against publicstatus's real bunfig.toml, which carries exactly this case
    for env.preload.ts/codegen.preload.ts and says so in a comment).
    mergeBunfig now diffs the parsed array for each of these three keys and
    appends entries only present on disk after the generated ones, so
    `kumiko-testing bunfig` is safe to rerun on an app that extended one of
    them. A `./test-setup/dom.preload.ts` entry left over from before the
    DOM preload became a package export (see the DOM-preload-package
    changeset in this same release) is not carried forward as an extra,
    since keeping it would preload the same DOM setup twice.
    A package preload an app deliberately adds from another variant (say
    `preload/env` in its unit bunfig) is kept; an unrecognized or superseded
    package preload path is dropped instead of kept as an extra, so a rename
    inside the package doesn't leave both the old and new path preloaded. A
    preload written as a single string rather than an array is read the same
    as a one-item array.
    Two known limits: a comment attached to an extra in the source bunfig is
    not preserved, only the value; and the template can no longer remove a
    `pathIgnorePatterns`/`coveragePathIgnorePatterns` entry from a consumer,
    since either key has no equivalent to preload's exclusion list, so a
    pattern it stops emitting stays in every consumer's bunfig until removed
    by hand. Unlike an unknown key, which blocks the merge, a stale array
    entry is kept silently rather than failing loudly.
  -->

- Updated dependencies [94ce380]
- Updated dependencies [fd40653]
- Updated dependencies [b13c820]
- Updated dependencies [94ce380]
  - @cosmicdrift/kumiko-bundled-features@0.317.0
  - @cosmicdrift/kumiko-framework@0.317.0
  - @cosmicdrift/kumiko-dev-server@0.317.0

## 0.316.0

### Minor Changes

- aa32979: tenant.addUser accepts a displayName/email identity; seedTenant's auto-login is documented on the fixture type

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: tenant.addUser accepts an optional displayName/email identity
  detail: |
    seedTenant()'s admin already accepted `admin: { displayName, email }`, but
    `tenant.addUser(roles)` (the seed-user route and the in-process seedTenant
    alike) had no such parameter and always fell back to `Seed <hash>` /
    `user-<uuid>@example.test`, which then leaked into screenshots and docs
    (solon, money-horse). `addUser(roles, { displayName, email })` now threads
    an optional identity through to the created user row, the same
    `SeedAdminIdentity` shape the admin already uses. Also: the seedTenant
    fixture logging the shared Playwright `context` in as the tenant admin was
    previously documented only in a code comment in auth-kit.ts — it is now on
    the `SeedTenantFixture` type's own JSDoc.
  -->

### Patch Changes

- 146324f: kumiko-testing integration --parallel now also passes --no-isolate, so parallel integration workers no longer grow until they are OOM-killed

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: Parallel integration runs no longer OOM-kill their workers
  detail: |
    bun 1.4.0's --parallel implies --isolate, which leaks native memory per
    test file while the JS heap stays flat: about 4 MB per file for a bare
    setupTestStack, about 40 MB with bundled-features. In publicstatus
    (--parallel 4) each worker grew from ~290 to ~1000 MiB and the run died
    with exit 137 on the 3 GiB CI runner. With --no-isolate the same run
    peaks at 380 MiB and finishes in 28.9 s instead of 49.9 s, with no new
    failures. Without --parallel bun never isolated files, so the tests
    already isolate through data (seedTenant per flow, queue prefix per
    stack), not through processes.
  -->

- aa32979: defineAppE2eConfig fails fast with a clear message when a dedicated screenshots config runs without SCREENSHOT_DIR

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: A dedicated screenshots Playwright config without SCREENSHOT_DIR now fails with a clear message
  detail: |
    A dedicated screenshots config (testDir: "./e2e/screenshots", used by
    phronexsis and publicstatus) had its entire testDir excluded by
    screenshotSpecsIgnore()'s "**/screenshots/**" pattern whenever
    SCREENSHOT_DIR was unset, so Playwright reported the generic "No tests
    found" with no mention of the missing env var — even though
    requireScreenshotDir() already existed with a clear message, just never
    called on this path. defineAppE2eConfig now calls it up front for any
    testDir ending in "screenshots" outside a screenshot run.
  -->

- Updated dependencies [aa32979]
  - @cosmicdrift/kumiko-framework@0.316.0
  - @cosmicdrift/kumiko-bundled-features@0.316.0
  - @cosmicdrift/kumiko-dev-server@0.316.0

## 0.315.0

### Patch Changes

- Updated dependencies [55b8505]
- Updated dependencies [4cc60bf]
- Updated dependencies [9635e86]
- Updated dependencies [0f2643d]
  - @cosmicdrift/kumiko-bundled-features@0.315.0
  - @cosmicdrift/kumiko-framework@0.315.0
  - @cosmicdrift/kumiko-dev-server@0.315.0

## 0.314.0

### Minor Changes

- 3434a94: Screenshot runner replaces generated seed identities with presentable values

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: Screenshot runner replaces generated seed identities with presentable values
  detail: |
    Seeded identities are unique per run (admin-<tenantId>@…), so screenshots
    showed a different address on every run. A scenario flow now calls
    `presentIdentities([{ from: tenant.admin.email, to: "anna@example.com" }])`
    from its fixtures, and runScreenshots/runMatrix replace `from` with `to` in
    the page's text nodes and input/textarea values right before every capture,
    again after each theme and viewport change. captureScreenshot takes the same
    list as `opts.presentIdentities`. Only the rendered page changes: the seeded
    data, the seed routes and the app UI stay untouched. Code that builds a
    `ScenarioFixtures` object itself (instead of receiving it in a flow) now has
    to pass `presentIdentities` too.
  -->

- 3434a94: Seed routes: SystemAdmin is seedable, and apps can register their own seeders

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: Seed routes seed a SystemAdmin and run app-owned seeders
  detail: |
    SystemAdmin is now one of the built-in seedable roles. This reverses the
    earlier "SystemAdmin is never seedable" rule: the seed gate
    (KUMIKO_TEST_SEED=1, never under NODE_ENV=production, per-run token) is now
    the only boundary around the seed routes. `tenant.addUser(["SystemAdmin"])`
    (seed-user route and in-process seedTenant alike) stores SystemAdmin as a
    global user role, never as a membership role; without a tenant role the user
    joins the tenant as Member so the login has a membership.
    `createE2eSeedRoutes({ extraRoles: ["SystemAdmin"] })` no longer throws.
    `createE2eSeedRoutes({ extraSeeders: { name: (ctx, tenantId, body) => … } })`
    mounts POST /__test/seed behind the same gate; the flow calls
    `tenant.seed(name, body)` on the seedTenant fixture. Only tenants seeded by
    that server's seed-tenant route are accepted (403 otherwise), unknown names
    are a 404, `body` arrives as `unknown` and a ZodError from the seeder becomes
    a 400. `ctx.write`/`ctx.query` run as the tenant's system user (SystemAdmin)
    and are bound to that tenant, so the target handler must admit SystemAdmin;
    there is no raw DB access.
  -->

- 483666f: seed-user only reaches a tenant this server's seed-tenant route created

  <!-- kumiko-changes
  feature: testing
  type: breaking
  title: seed-user only reaches a tenant this server's seed-tenant route created
  detail: |
    seed-user looked the tenant up via tenant:query:me and only rejected a tenant
    id that did not exist at all, so a tenant seeded by another server or
    in-process without this route's seed-tenant still got a user added. seed-user
    now checks the same seededTenantIds set as /__test/seed and rejects any other
    tenant with the same 403.
  migration: Create the tenant via `seedTenant()` (the seed-tenant route) before adding users with `tenant.addUser`.
  -->

### Patch Changes

- 3434a94: captureScreenshot, runScreenshots and runMatrix settle after a reload or cross-document navigation

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: captureScreenshot, runScreenshots and runMatrix settle after a reload or cross-document navigation
  detail: |
    Chromium drops the old document's fetch/XHR requests on a reload, goto or
    location change without firing requestfinished or requestfailed. The
    in-flight tracker kept those requests forever, so a flow that reloaded
    while a data request was still open failed with "page never settled".
    The tracker now clears its in-flight set when the main frame commits a new
    document (a main-frame navigation request followed by framenavigated).
    A same-document navigation (pushState) still waits for its requests, and
    a navigation that never commits (204, download) keeps them too.
  -->

- Updated dependencies [483666f]
- Updated dependencies [22d89ec]
- Updated dependencies [483666f]
- Updated dependencies [c3df63c]
- Updated dependencies [3434a94]
- Updated dependencies [3434a94]
  - @cosmicdrift/kumiko-framework@0.314.0
  - @cosmicdrift/kumiko-bundled-features@0.314.0
  - @cosmicdrift/kumiko-dev-server@0.314.0

## 0.313.0

### Patch Changes

- Updated dependencies [773c52f]
- Updated dependencies [a14fd1f]
- Updated dependencies [4aa0c98]
- Updated dependencies [42c5298]
- Updated dependencies [16c81b9]
- Updated dependencies [f0c1ef1]
- Updated dependencies [93d7b77]
- Updated dependencies [4dea3ec]
- Updated dependencies [09a9148]
- Updated dependencies [b99240c]
- Updated dependencies [e7dc624]
  - @cosmicdrift/kumiko-bundled-features@0.313.0
  - @cosmicdrift/kumiko-framework@0.313.0
  - @cosmicdrift/kumiko-dev-server@0.313.0

## 0.312.0

### Patch Changes

- Updated dependencies [f662b79]
- Updated dependencies [b2d00cf]
- Updated dependencies [1799c20]
- Updated dependencies [f662b79]
- Updated dependencies [f662b79]
- Updated dependencies [f662b79]
  - @cosmicdrift/kumiko-bundled-features@0.312.0
  - @cosmicdrift/kumiko-framework@0.312.0
  - @cosmicdrift/kumiko-dev-server@0.312.0

## 0.311.0

### Minor Changes

- c448d50: Screenshot runs render at deviceScaleFactor 2 (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: breaking
  title: defineAppE2eConfig's chromium project renders screenshot runs at deviceScaleFactor 2
  detail: |
    With SCREENSHOT_DIR set, the chromium project renders at 2x so runMatrix and
    captureScreenshot images stay sharp on HiDPI displays (desktop files are
    3840×2160). Plain e2e runs stay at 1x. Device projects keep their own scale.
  migration: |
    Drop app-level deviceScaleFactor overrides (test.use or project use).
    Committed screenshots taken in the chromium project regenerate at 2x.
  -->

### Patch Changes

- @cosmicdrift/kumiko-framework@0.311.0
- @cosmicdrift/kumiko-bundled-features@0.311.0
- @cosmicdrift/kumiko-dev-server@0.311.0

## 0.310.0

### Minor Changes

- da6c84f: E2E default viewport is 1920×1080 (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: breaking
  title: defineAppE2eConfig's chromium project runs at 1920×1080 instead of Desktop Chrome's 1280×720
  detail: |
    The template took Playwright's "Desktop Chrome" device unchanged, so every
    e2e run and every inline captureScreenshot rendered at 1280×720 while
    runMatrix's desktop screenshots used 1920×1080. Both now share
    DESKTOP_VIEWPORT (1920×1080). A root `use.viewport` override in an app's
    playwright config never reached the chromium project anyway (project `use`
    wins), so solon's 1920 override was silently ineffective.
  migration: |
    Drop app-level desktop viewport overrides. Specs asserting a layout that
    only exists below 1920px (collapsed sidebar, stacked panes) set their own
    viewport via test.use({ viewport }). Committed inline screenshots taken
    in the chromium project regenerate at 1920 width.
  -->

### Patch Changes

- 70fd8d6: `captureScreenshot(page, name, { fit })` (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: captureScreenshot accepts fit viewport, fullPage or content
  detail: |
    `fit: "viewport"` (default) keeps the previous behaviour. `fit: "fullPage"`
    captures the whole document, so offlot's inline mid-flow shots
    (channel-request, channel-prompts, vehicle-channel-texts) can move to
    captureScreenshot. `fit: "content"` grows the viewport until neither the
    document nor a visible overflow-auto/scroll container (WorkspaceShell's
    inner scroll area) overflows, captures, and restores the viewport; it
    throws instead of writing a cropped image when growth does not converge
    within 4 rounds. A 1px container overflow counts as sub-pixel rounding
    (overflow-x-auto table wrappers), not content. This replaces solon's own `e2e/_helpers/shot.ts`; its
    images pick up the `reducedMotion: "reduce"` default on the switch, so a
    one-time pixel drift in the handbook PNGs is expected.
  -->

- ff05fae: `defineAppE2eConfig`'s webServer env no longer defaults `MEILI_URL`/`MEILI_MASTER_KEY`

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: defineAppE2eConfig's webServer env no longer defaults MEILI_URL and MEILI_MASTER_KEY
  detail: |
    Since the infra env defaults landed, every e2e webServer got
    MEILI_URL=http://localhost:17700. Apps that choose Meilisearch over
    their in-memory search adapter when MEILI_URL is set then pointed at an
    unreachable host in CI without a Meili service. Meili is opt-in again:
    the two vars reach the webServer only when the environment sets them or
    the app passes them via `env`. All other infra defaults are unchanged.
    Migration: an app whose e2e needs Meilisearch sets MEILI_URL (and
    MEILI_MASTER_KEY) in `defineAppE2eConfig({ env })` or in the CI env; an
    app that worked around it with `MEILI_URL: ""` can drop that override.
  -->

- 9f16c3f: Screenshot scenario `waitFor` uses the template timeout budget (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: Screenshot scenario waitFor uses the template timeout budget instead of a fixed 10s
  detail: |
    runScreenshots/runMatrix wait for a scenario's `waitFor` selector with
    `E2E_TIMEOUT_MS.navigation`, or `E2E_TIMEOUT_MS.real` under
    KUMIKO_REAL_PROVIDERS=1, so real-provider screenshot scenarios no longer
    time out on LLM/OCR latency and apps don't need their own wait timeouts.
  -->

- Updated dependencies [a2c9e30]
- Updated dependencies [4f36c3f]
  - @cosmicdrift/kumiko-bundled-features@0.310.0
  - @cosmicdrift/kumiko-framework@0.310.0
  - @cosmicdrift/kumiko-dev-server@0.310.0

## 0.309.0

### Minor Changes

- 621c4de: `captureScreenshot(page, name)` for mid-flow E2E screenshots; `reducedMotion: "reduce"` is now the default (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: breaking
  title: reducedMotion defaults to "reduce" in runScreenshots/runMatrix/captureScreenshot; captureScreenshot(page, name) added
  detail: |
    rAF-driven chart/tween animations were invisible to the settle-detection
    wait, so screenshots sometimes captured a mid-animation frame. Both matrix
    helpers now call page.emulateMedia({ reducedMotion: "reduce" }) at test
    start, before the first navigation. The new captureScreenshot(page, name,
    opts?) applies the same media emulation at capture time, so it only affects
    animations started after that point; set reducedMotion via test.use() for
    mid-flow shots of charts that animate on mount. captureScreenshot reuses the
    matrix runner's settle logic, writes $SCREENSHOT_DIR/<name>.png, and is a
    no-op when SCREENSHOT_DIR is unset, for solon's mid-flow shot(page, id) and
    offlot's inline page.screenshot writes into docs/screenshots/e2e/.
  migration: |
    Pass `reducedMotion: "no-preference"` in runScreenshots/runMatrix's
    options, or as captureScreenshot's third argument, for a scenario that
    must keep real motion.
  -->

- 621c4de: `runMatrix` locales are app-injectable, and it gains a named-device project mode (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: runMatrix locales are app-injectable via localeTags, and gains a namedDevice mode for phone-style device projects
  detail: |
    runMatrix's locale list was fixed to en/de with hardcoded BCP47 tags.
    opts.localeTags lets an app supply its own locale -> tag map (e.g. "es" ->
    "es-ES"); locales with neither an app override nor the en/de default fall
    back to Intl.Locale(locale).maximize().region derivation, throwing only
    when no tag is derivable. A Playwright project whose name isn't a
    ViewportId but is a mobile/device project (offlot's "phone" project) now
    gets its own namedDevice output subtree
    (<dir>/<outputPrefix>/<name>/<locale>/<theme>/<viewport>.png) fixed to the mobile
    viewport, instead of incorrectly falling through to the desktop pass.
  -->

- 95a595d: Screenshot scenarios get the matrix locale in `flow` and a screenshot-only `captureStyle` (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: Scenario flow receives runMatrix's locale; Scenario.captureStyle for screenshot-only CSS
  detail: |
    runMatrix passes the current locale to `flow(page, { seedTenant, locale })`,
    so apps whose routes carry the locale in the path (offlot's public vehicle
    page) can build the URL per locale. `captureStyle` is handed to Playwright's
    screenshot `style` option in runScreenshots and runMatrix: the CSS applies
    to the capture only and does not leak into the next theme × viewport shot.
  -->

- 837b712: `seedTenant` accepts an admin identity (displayName/email) for demo and screenshot tenants (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: seedTenant accepts an admin identity (displayName/email) for demo and screenshot tenants
  detail: |
    SeedTenantOptions gained an optional `admin: { displayName?, email? }`.
    email supports a `{tenantId}` placeholder, substituted per call, so a
    fixed template (e.g. `admin+{tenantId}@example.test`) stays unique across
    the global `read_users_email_unique` index instead of colliding across
    per-scenario tenants. Threaded through both the plain seed-tenant.ts path
    and the HTTP seed route/fixture.
  -->

### Patch Changes

- 711de11: `test:real` now filters to `*.real.test.ts`, and real-provider runs share one 240s timeout budget (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: test:real now filters to *.real.test.ts, and real-provider runs share one 240s timeout budget
  detail: |
    bunfig.real.toml's pathIgnorePatterns is blacklist-only (no gitignore-style
    negation), so an unfiltered `bun test --config=bunfig.real.toml` still ran
    the whole unit suite under the real-provider env. The generated `test:real`
    script now passes a positional `real.test.ts` filter. TEST_TIMEOUT_MS.real
    (bun --timeout) and E2E_TIMEOUT_MS.real (the Playwright real-run path via
    defineAppE2eConfig) now both come from the same 240_000 template constant
    instead of a separately hardcoded 120s, covering solon's real-provider
    document-onboarding flow. `isRealProviderRun(env?)` is exported next to
    `REAL_PROVIDERS_ENV`/`requireRealProviders` so apps stop duplicating the
    `KUMIKO_REAL_PROVIDERS === "1"` literal.
  -->

- 711de11: `defineAppE2eConfig`'s webServer env now defaults the infra service vars, environment wins (fw#3118)

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: defineAppE2eConfig's webServer env now defaults the infra service vars, environment wins
  detail: |
    webServer.env is now built as `{ ...infraEnvDefaults(), ...PLAYWRIGHT_DEMO_ENV, ...env }`,
    where infraEnvDefaults() reads the same SERVICE_ENV_DEFAULTS the app's own
    preload uses (DATABASE_URL, REDIS_URL, MEILI_URL, MINIO_*, ...), falling
    back to each default only when process.env doesn't already carry a value.
    A CI/shell-set env var still wins over the template default. No
    `--env-file` is loaded here.
  -->

- Updated dependencies [75925be]
- Updated dependencies [cb0adcf]
- Updated dependencies [11b6f67]
- Updated dependencies [ac9bdae]
- Updated dependencies [a81c5d0]
- Updated dependencies [8f109b5]
- Updated dependencies [711de11]
  - @cosmicdrift/kumiko-framework@0.309.0
  - @cosmicdrift/kumiko-bundled-features@0.309.0
  - @cosmicdrift/kumiko-dev-server@0.309.0

## 0.308.0

### Patch Changes

- 1b64375: `createKumikoServer` can now build its client bundle prod-shaped (splitting, no sourcemap, `NODE_ENV=production`) behind the opt-in `KUMIKO_DEV_PROD_BUNDLES` env var — `bun dev` is unaffected. `defineAppE2eConfig` sets it for the Playwright web server, so E2E now exercises the bundle shape that actually ships instead of a single dev bundle with React's development build, every lazy chunk inlined and a regenerated sourcemap per boot (publicstatus admin: 2.2 MB + 9.2 MB map → 0.87 MB entry; E2E suite −15 % on a 1.5 CPU runner).

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: Dev server can build prod-shaped client bundles, E2E uses them
  -->

- 1b64375: `resolveE2eWorkers` defaulted to a minimum of 2 workers. On a 1.5 CPU CI pod (publicstatus, 59 E2E tests) 1/2/4 workers measured 2.6/2.6/2.7 minutes — the runner is already CPU-saturated at 1 worker, so a higher minimum only adds scheduling overhead. The floor is now 1.

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: E2E default worker count no longer floors at 2
  -->

- 765f01b: `defineAppE2eConfig` derived its default worker count from `os.cpus()`, which reports the host's cores inside a CPU-limited container. CI runner pods capped at 1.5 CPU therefore started 4 Playwright workers, so heavier apps hit the 30s test timeout. The default now uses `os.availableParallelism()`, which honours the cgroup CPU quota.

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: E2E worker default respects the container CPU limit
  -->

- 685ecc9: `import { z } from "zod"` pulled the whole zod namespace — including all 63 locales and the json-schema module — into every client bundle that imported it (359 KB in a publicstatus admin bundle). All framework packages now use `import * as z from "zod"`, which Bun.build can tree-shake (a probe bundle went from 264 KB to 67 KB). A new Biome rule (`noRestrictedImports` on `packages/*/src/**`) keeps `{ z }` from coming back.

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: zod namespace import lets client bundles tree-shake unused locales
  -->

- Updated dependencies [1b64375]
- Updated dependencies [49e07f5]
- Updated dependencies [ad701ed]
- Updated dependencies [6e5ed00]
- Updated dependencies [6e5ed00]
- Updated dependencies [3ae4b82]
- Updated dependencies [9816d20]
- Updated dependencies [6b8b0ed]
- Updated dependencies [6e5ed00]
- Updated dependencies [685ecc9]
  - @cosmicdrift/kumiko-dev-server@0.308.0
  - @cosmicdrift/kumiko-framework@0.308.0
  - @cosmicdrift/kumiko-bundled-features@0.308.0

## 0.307.0

### Patch Changes

- bc6fd32: `seedTenant().loginAs` now switches users via `clearSession(page)` instead of a bare `clearCookies()`, so the page still open on the previous session can no longer redirect to `/login?next=…` and race the new login.

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: seedTenant loginAs switches users via clearSession
  -->

- Updated dependencies [cc23d3d]
- Updated dependencies [0ce171d]
- Updated dependencies [a3f00b0]
- Updated dependencies [c5c5ddb]
- Updated dependencies [e682776]
- Updated dependencies [cc23d3d]
- Updated dependencies [4179f26]
- Updated dependencies [aae3f5d]
  - @cosmicdrift/kumiko-bundled-features@0.307.0
  - @cosmicdrift/kumiko-dev-server@0.307.0
  - @cosmicdrift/kumiko-framework@0.307.0

## 0.306.0

### Minor Changes

- 0d5eef7: `GET /__test/inbox` and `mailCapture` now read tenantless mail (signup, forgot-password, magic-link) from an app's raw `createInMemoryTransport()` outbox, not just `mailTransportInMemoryFeature`'s per-tenant buffer.

  `inboxQuerySchema`'s `tenantId` is now optional (`to` stays required). `createE2eSeedRoutes({ mailOutbox })` accepts `{ readonly sent: readonly EmailMessage[] }` — an app's raw transport passed through as-is. The route reads both sources when both are configured, filters each by `to` (case-insensitive), and returns the tenant buffer before the outbox, each **newest first**; two mails to the same address no longer come back oldest-first. With neither `mailTransportInMemoryFeature`+`tenantId` nor `mailOutbox` available, the route now names both ways to fix it in its 501.

  `mailCapture(request, tenantId, to)` returning `Promise<CapturedMail[]>` is now `mailCapture(request, to, { tenantId?, match? })` returning `Promise<CapturedMail>` — the first mail in that order matching `to` (and `match`, if given), i.e. the newest one per source.

  <!-- kumiko-changes
  feature: testing
  type: breaking
  title: mailCapture and the /__test/inbox route read tenantless mail via a new mailOutbox option
  detail: |
    Apps sending Dev/E2E mail through a raw createInMemoryTransport() (signup,
    forgot-password, magic-link — flows with no tenant) had no way to read it
    through the seed inbox route, which required tenantId and only checked
    mailTransportInMemoryFeature's per-tenant buffer. createE2eSeedRoutes()
    now accepts mailOutbox: { sent: readonly EmailMessage[] } (the raw
    transport's own array); inboxQuerySchema's tenantId is optional. The route
    reads whichever source(s) are configured, filters by to, and returns each
    source newest-first instead of oldest-first.
  migration: |
    mailCapture(request, tenantId, to) -> mailCapture(request, to, { tenantId }),
    and it now resolves to a single CapturedMail (the newest match) instead of
    a readonly CapturedMail[]. Pass match: (mail) => boolean to pick a mail
    other than the newest at that address. Apps with their own ungated debug
    route for a raw transport (e.g. /_debug/mails.json) pass that transport as
    createE2eSeedRoutes({ mailOutbox: transport }) and delete the app-local
    route; tenantId becomes optional wherever only mailOutbox is used. Any
    direct reader of GET /__test/inbox must expect newest-first ordering.
  -->

- 7d17b0e: `runMatrix` now supports real device emulation: a Playwright project named after a viewport id (`desktop`, `tablet`, `mobile`) with `use.isMobile: true` captures exactly `<name>.png` at the device's native size instead of looping `setViewportSize`, which would destroy the emulation. Any other project still runs the desktop pass, skipping the viewport ids a device project already covers. Without device projects, nothing changes. `SCREENSHOT_VIEWPORTS` filters both — a filtered-out device project's test is skipped with a reason, not run empty. Device projects using a WebKit device need `bunx playwright install webkit` in CI.

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: runMatrix supports device-emulation Playwright projects for real native-size screenshots
  -->

### Patch Changes

- 0d5eef7: New `clearSession(page)` in `@cosmicdrift/kumiko-testing/e2e`: navigates to `about:blank` before clearing cookies. Clearing cookies while an app page is still open lets that page redirect itself to `/login?next=…` on its next request, racing the test's next navigation (flaky session switches at 4 workers). `loginViaUi` now uses it. Apps replace `page.context().clearCookies()` with `clearSession(page)`.

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: clearSession(page) for race-free session switches in E2E
  -->

- Updated dependencies [b43fe63]
- Updated dependencies [8b4d672]
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
- Updated dependencies [b43fe63]
- Updated dependencies [659c575]
- Updated dependencies [946f7e7]
  - @cosmicdrift/kumiko-bundled-features@0.306.0
  - @cosmicdrift/kumiko-framework@0.306.0
  - @cosmicdrift/kumiko-dev-server@0.306.0

## 0.305.0

### Patch Changes

- c41c201: E2E webserver builds Tailwind CSS once instead of running a `--watch` process

  `defineAppE2eConfig` sets `KUMIKO_DEV_STYLESHEET_WATCH=0`, so the dev-server it boots builds CSS once and stops instead of keeping a Tailwind `--watch` process alive. Tailwind v4's watcher subscribes to the whole app cwd recursively with no gitignore filter, so every Playwright artifact write under `test-results/` previously counted as a rebuild trigger.

  <!-- kumiko-changes
  feature: dev-server
  type: improvement
  title: createKumikoServer/runDevApp gain stylesheetWatch (env KUMIKO_DEV_STYLESHEET_WATCH=0) to build Tailwind CSS once without a --watch process
  -->

  <!-- kumiko-changes
  feature: testing
  type: fix
  title: defineAppE2eConfig starts the E2E web server without a Tailwind --watch process, so Playwright artifact writes no longer trigger hundreds of CSS rebuilds
  -->

- Updated dependencies [90c5398]
- Updated dependencies [9de2cde]
- Updated dependencies [c41c201]
- Updated dependencies [05b87d7]
- Updated dependencies [0ee6000]
- Updated dependencies [0567906]
- Updated dependencies [d98d172]
- Updated dependencies [d42d76a]
  - @cosmicdrift/kumiko-framework@0.305.0
  - @cosmicdrift/kumiko-bundled-features@0.305.0
  - @cosmicdrift/kumiko-dev-server@0.305.0

## 0.304.0

### Minor Changes

- e19227b: Screenshot scenarios can now seed their own tenant and run a `beforeCapture` hook, so apps no longer have to hardcode screenshots against a shared fixture tenant.

  `runScreenshots`/`runMatrix` register their tests on the same `test` as `@cosmicdrift/kumiko-testing/e2e`'s seeded-tenant fixture, so `Scenario.flow` now receives `(page, { seedTenant })` — existing single-parameter `flow(page)` scenarios keep working unchanged. `Scenario.beforeCapture?: (page) => Promise<void>` runs after the viewport is set and the page has settled, right before each screenshot. `seedTenant()`'s "no baseURL" error now only fires when a scenario actually calls it, not for every screenshot spec's fixture setup.

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: Screenshot scenarios get { seedTenant } in flow and a beforeCapture hook; the README no longer recommends a postSave hook on tenant for test defaults
  -->

### Patch Changes

- @cosmicdrift/kumiko-framework@0.304.0
- @cosmicdrift/kumiko-bundled-features@0.304.0
- @cosmicdrift/kumiko-dev-server@0.304.0

## 0.303.0

### Patch Changes

- Updated dependencies [3d28528]
  - @cosmicdrift/kumiko-framework@0.303.0
  - @cosmicdrift/kumiko-bundled-features@0.303.0
  - @cosmicdrift/kumiko-dev-server@0.303.0

## 0.302.0

### Patch Changes

- Updated dependencies [deede20]
  - @cosmicdrift/kumiko-framework@0.302.0
  - @cosmicdrift/kumiko-bundled-features@0.302.0
  - @cosmicdrift/kumiko-dev-server@0.302.0

## 0.301.0

### Patch Changes

- Updated dependencies [cf629d8]
- Updated dependencies [5028a6c]
- Updated dependencies [bae6958]
  - @cosmicdrift/kumiko-bundled-features@0.301.0
  - @cosmicdrift/kumiko-dev-server@0.301.0
  - @cosmicdrift/kumiko-framework@0.301.0

## 0.300.0

### Patch Changes

- Updated dependencies [2414932]
- Updated dependencies [2414932]
  - @cosmicdrift/kumiko-bundled-features@0.300.0
  - @cosmicdrift/kumiko-framework@0.300.0
  - @cosmicdrift/kumiko-dev-server@0.300.0

## 0.299.0

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

- Updated dependencies [aa09d45]
  - @cosmicdrift/kumiko-dev-server@0.299.0
  - @cosmicdrift/kumiko-framework@0.299.0
  - @cosmicdrift/kumiko-bundled-features@0.299.0

## 0.298.0

### Minor Changes

- 6735981: createE2eSeedRoutes() returns ExtraRouteDefinition[] instead of an extraRoutes callback

  <!-- kumiko-changes
  feature: testing
  type: breaking
  title: createE2eSeedRoutes() returns ExtraRouteDefinition[] instead of an extraRoutes callback
  migration: |
    createE2eSeedRoutes() now returns readonly ExtraRouteDefinition[] instead of an (app, deps) => void callback. The call site extraRoutes: createE2eSeedRoutes() in setupTestStack is unchanged, but any code that imported createE2eSeedRoutes() to invoke it directly against app (rather than passing it through extraRoutes) must instead treat the result as a route list, e.g. register each entry through the framework's ExtraRouteDefinition handling.
  -->

### Patch Changes

- Updated dependencies [6735981]
- Updated dependencies [6735981]
- Updated dependencies [4ae8163]
- Updated dependencies [6735981]
- Updated dependencies [6735981]
  - @cosmicdrift/kumiko-bundled-features@0.298.0
  - @cosmicdrift/kumiko-dev-server@0.298.0
  - @cosmicdrift/kumiko-framework@0.298.0

## 0.297.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.297.0
- @cosmicdrift/kumiko-framework@0.297.0
- @cosmicdrift/kumiko-dev-server@0.297.0

## 0.296.0

### Patch Changes

- Updated dependencies [bfa7536]
- Updated dependencies [cb6e8a4]
- Updated dependencies [bfa7536]
- Updated dependencies [42b0562]
- Updated dependencies [f042685]
- Updated dependencies [d8cdd8a]
- Updated dependencies [3c34575]
  - @cosmicdrift/kumiko-bundled-features@0.296.0
  - @cosmicdrift/kumiko-framework@0.296.0
  - @cosmicdrift/kumiko-dev-server@0.296.0

## 0.295.0

### Minor Changes

- 294caec: New package: test template for Kumiko apps

  seedTenant gives each test its own tenant (light by default, persist: true writes real rows through the dispatcher), setupAppTestStack mounts the bundled features and the entity projection tables, the preload subpaths (temporal, ci-log, scrub-env, env, real) replace the per-repo test-setup copies and scrub provider API keys, renderBunfig generates the bunfig variants, and kumiko-testing integration runs the integration files with the 15s budget and opt-in parallelism.

  The `./e2e` subpath is the Playwright core: defineAppE2eConfig fixes parallelism, retries, timeouts and workers centrally, the test fixture seeds a tenant per test through the token-gated `./e2e/seed-route` routes and logs the admin in, and the auth kit (loginViaApi, csrfFetch, createHttpApi, totpCode, waitForProjection) replaces the per-app copies. A SeedPart runs unchanged against the in-process stack and over HTTP.

  The screenshot runner (runScreenshots, runMatrix, pinEnglishLocale) moves in from the samples: `SCREENSHOT_DIR` is required with no default path, so a run can never overwrite the committed docs images, and `screenshotSpecsIgnore()` keeps screenshot specs out of every normal e2e run. Scenarios no longer take `settleMs`; the runner waits until no data request is in flight and the page layout stops changing.

  <!-- kumiko-changes
  feature: testing
  type: improvement
  title: New kumiko-testing package with seedTenant, preloads, bunfig generator and integration runner
  -->

### Patch Changes

- @cosmicdrift/kumiko-framework@0.295.0
- @cosmicdrift/kumiko-bundled-features@0.295.0
- @cosmicdrift/kumiko-dev-server@0.295.0
