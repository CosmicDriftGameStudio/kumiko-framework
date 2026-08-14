---
"@cosmicdrift/kumiko-bundled-features": patch
---

`user-data-rights`'s `tenantModel` system config now declares `env: "TENANT_MODEL"`, so a consuming app can bridge `process.env.TENANT_MODEL` into `appOverrides` via `buildEnvConfigOverrides` at boot instead of only via a hand-written `appOverrides` map. Purely additive: the default (`"multi-user"`) and every existing resolution path are unchanged, and nothing bridges automatically — an app must still call `buildEnvConfigOverrides(registry, process.env)` and pass the result into its `appOverrides` for the var to take effect.
