# create-kumiko-app

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
