---
"@cosmicdrift/kumiko-dev-server": patch
---

Auto-wired `secrets` no longer crashes boot when no KEK is available

`buildBootExtraContext` now only auto-wires `ctx.secrets` when the `secrets` feature is mounted AND a key is actually available — either a `masterKey` override or a `KUMIKO_SECRETS_MASTER_KEY_V<n>` env var. Without one it skips the wiring instead of eagerly constructing an env master-key provider that throws. This unblocks dev servers that supply their own DEV key via explicit `extraContext.secrets` (the env KEK isn't set in dev); their explicit wiring wins. Production with a configured KEK is unchanged, and a genuinely missing prod KEK is still caught by `secretsEnvSchema` at boot.
