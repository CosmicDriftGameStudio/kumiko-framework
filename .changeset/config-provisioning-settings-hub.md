---
"@cosmicdrift/kumiko-framework": minor
---

config-provisioning: coherent user-scope cascade, ENV→config bridge, and a self-populating Settings-Hub

Three additive, non-breaking pieces for declarative config provisioning:

- **User-scope cascade (D8):** a `user`-scope config key now falls through to the
  system-row (`user-row → tenant-row → system-row → default`) on both the UI
  cascade and the hot `getWithSource` path, so a system-seeded default is visible
  to a user lookup. Previously the system-row was skipped for user-scope keys.

- **ENV→app-override bridge:** `env` on a config key binds an environment variable
  as the app-override layer of the cascade. `buildEnvConfigOverrides(registry, env)`
  is wired into `runProdApp`, so a key gains an ENV default by adding one field —
  no factory switch. `env`, `inheritedToTenant`, and `backing` are optional fields
  on the existing `createTenantConfig`/`createSystemConfig`/`createUserConfig`.

- **Self-populating Settings-Hub:** a config key with the new `mask` field
  (`{ title, icon?, order? }`) is automatically surfaced as a settings UI — per
  scope an audience group, per (feature × scope) a `configEdit` screen + nav,
  derived from the key type. No manual `r.screen`/`r.nav`. `buildConfigFeatureSchema`
  runs inside `buildAppSchema` (find-or-create `config` FeatureSchema); in
  workspace-mode apps a synthetic `settings` workspace is appended (skipped for
  workspace-less apps so they don't flip into nav-filter mode). Screens honor a new
  per-field `fieldLabels` override so `mask.title` flows to the label without the
  `__config-edit__` convention. The `config` bundled-feature ships the generic
  `config.settings.*` audience labels via `configClient()`
  (`@cosmicdrift/kumiko-bundled-features/config/web`).

No existing config key declares `mask`/`env`, so `buildConfigFeatureSchema` returns
empty and `buildAppSchema` output is unchanged for current apps.
