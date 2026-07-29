---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`secrets`: `derivePurposeSecret(masterSecret, purpose)` — HKDF-based per-purpose secret derivation, previously copy-pasted in four apps as `deriveSubSecret`. Renamed on the way in: "sub" said nothing that "derive" did not, while the second parameter is a domain separator, not a label. `auth-mfa` gains `resolveMfaTokenSecrets`, which owns the two MFA purpose strings so a prod and a dev entrypoint cannot drift apart and invalidate each other's tokens (#1623).
