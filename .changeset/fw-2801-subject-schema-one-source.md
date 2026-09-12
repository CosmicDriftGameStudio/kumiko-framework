---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

fw#2801: `subjectIdSchema` (the zod validator `forgetSubject` uses to check what can be crypto-shredded) moved from `@cosmicdrift/kumiko-bundled-features/crypto-shredding` to `@cosmicdrift/kumiko-framework/crypto`, next to `subjectKeyForRecord`/`RECORD_ENTITY_PATTERN`, and is now `satisfies z.ZodType<SubjectId>` — a future `SubjectId` variant that the schema doesn't cover fails to compile instead of silently diverging at runtime (the root cause behind fw#2809). Non-breaking for consumers: `@cosmicdrift/kumiko-bundled-features/crypto-shredding` still re-exports `subjectIdSchema` from the same public entry point.
