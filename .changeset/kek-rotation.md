---
"@cosmicdrift/kumiko-framework": minor
---

Zero-downtime platform-KEK rotation (#818 step 7). `PgKmsAdapter` now understands KEK generations along the existing `kek_version` column: `kekVersion` names the active KEK's generation (new wraps carry it), `previousKeks: { <version>: <base64Kek> }` keeps not-yet-rewrapped rows readable during the rotation window. A row wrapped with an unconfigured generation fails loud as a CONFIG error — never mistaken for a shredded subject. New `rewrapSubjectKeys({ databaseUrl, fromKeks, toKek, toKekVersion, batchSize?, dryRun? })` migrates the estate: unwrap with the old generation's KEK, wrap with the new one, bump `kek_version` — idempotent, erased tombstones untouched, the UPDATE is guarded on the old version so concurrent fresh writes on the new generation are never clobbered. Rotation procedure: runbook `kek-rotation.md` (kumiko-platform).
