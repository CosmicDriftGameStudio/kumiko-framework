# @cosmicdrift/kumiko-feature-ast

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
