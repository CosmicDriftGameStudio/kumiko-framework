# @cosmicdrift/kumiko-guards

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
