---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": patch
---

`FILE_STORAGE_PROVIDER` now selects the file provider, not just the boot gate

`file-foundation`'s `provider` config key declares `env: "FILE_STORAGE_PROVIDER"`, so the generic ENV→app-override bridge (`buildEnvConfigOverrides`) fills it at boot. An app that mounts `composeFileStack({ providers: [...] })` and sets `FILE_STORAGE_PROVIDER=s3-env` gets that provider without replacing `createConfigResolver` — the workaround three apps had copied, each of which also had to re-wire the envelope cipher for `encrypted: true` keys or lose decryption silently.

The cascade is unchanged: the ENV value sits on the app-override rung, so a tenant row written via `config:write:set` still overrides it.

`FILE_STORAGE_PROVIDER` carries a second meaning — `validateBoot` requires its presence once file/image fields are in use, and `runDevApp` sets it to `"configured"` when `options.files` already wires a provider. That placeholder names no plugin, so `createFileProviderForTenant` treats it like an unset key and raises its usual "no provider selected" error instead of looking up a provider called `configured`. Both strings are now the exported constants `FILE_STORAGE_PROVIDER_ENV` and `FILE_STORAGE_PROVIDER_BOOT_SENTINEL`.

Not breaking, but check your value before upgrading: an app on the framework's default resolver whose `FILE_STORAGE_PROVIDER` is neither a registered provider name nor the sentinel now fails with `provider "<value>" not registered` where it previously failed with `no provider selected` — an error either way, but a different one. Apps that pass their own `configResolver` never reach the bridge and are unaffected. A second consequence: `config:query:readiness` resolves the same key, so for a tenant without a row the ENV-selected provider's required keys now count as required where nothing counted before.

<!-- kumiko-changes
feature: file-foundation
type: improvement
title: FILE_STORAGE_PROVIDER selects the file provider, not just the boot gate
detail: The `provider` config key declares `env: "FILE_STORAGE_PROVIDER"`, so the ENV→app-override bridge selects the provider at boot without an app-side `createConfigResolver` rebuild. Tenant rows still override the ENV value (cascade unchanged). The boot-gate placeholder `"configured"` that `runDevApp` writes names no plugin, so `createFileProviderForTenant` treats it as unset and raises "no provider selected"; both strings are exported as `FILE_STORAGE_PROVIDER_ENV` / `FILE_STORAGE_PROVIDER_BOOT_SENTINEL`.
migration: Apps on the framework's default config resolver: make sure `FILE_STORAGE_PROVIDER` holds a registered provider name (`inmemory`, `s3`, `s3-env`) — it is now the provider selection, not only a presence check. Apps that pass their own `configResolver` are unaffected and can drop their hand-rolled `file-foundation:config:provider` app-override.
-->
