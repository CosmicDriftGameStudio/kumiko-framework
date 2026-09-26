# @cosmicdrift/kumiko-guards

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
