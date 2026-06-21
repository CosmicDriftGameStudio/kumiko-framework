---
"@cosmicdrift/kumiko-dev-server": minor
"create-kumiko-app": minor
---

`bun create kumiko-app <name>` — interactive feature picker

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
