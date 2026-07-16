---
"@cosmicdrift/kumiko-framework": patch
---

Fix `buildManifestFromRegistry` reporting `encrypted: false` for config keys with `backing: "secrets"` (e.g. `subscription-stripe`'s `api-key`/`webhook-secret`) when no explicit `encrypted` flag was set. The values were always envelope-encrypted in the secrets store — only the generated feature-manifest/docs mislabeled them as plaintext. `backing: "secrets"` now implies `encrypted: true` unless an explicit `encrypted` flag says otherwise.
