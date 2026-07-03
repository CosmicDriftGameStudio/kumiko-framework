---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Crypto-shredding phase D: forget wire. New `crypto-shredding` bundled feature with the `forget-subject` operator command (DPO/SystemAdmin) — erases a user/tenant subject key and appends a `subject-forgotten` audit event. `user-data-rights` forget-cleanup now erases the user's subject key inside the per-user sub-tx (crash-safe, before the status flip). Fixes `list()` returning ciphertext for camelCase encrypted/pii fields and caching plaintext rows.
