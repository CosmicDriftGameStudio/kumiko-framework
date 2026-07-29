---
"@cosmicdrift/kumiko-framework": minor
---

`crypto`: `resolveKmsWiring`/`requireKmsWiring`/`buildPgKmsOptions` — boot-time validation of the subject-keys KMS env trio, previously copy-pasted in four apps. The copies had drifted: only one parsed `PLATFORM_KEK_VERSION` strictly, so `"1e21"`/`"0x10"`/`"-1"` were accepted and silently produced an unreachable rotation slot. Ordering of previous vs. active version stays enforced by `PgKmsAdapter` (#1617).
