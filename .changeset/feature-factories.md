---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
"create-kumiko-app": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-types": patch
---

Bundled features are mounted through create*Feature() factories, the two S3 providers merge into createFileProviderS3Feature({ fromEnv }), and @app/define with kumiko codegen is removed

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
