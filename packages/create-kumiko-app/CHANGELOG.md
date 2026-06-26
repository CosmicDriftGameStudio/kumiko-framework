# create-kumiko-app

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
