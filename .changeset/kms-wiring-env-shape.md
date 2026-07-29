---
"@cosmicdrift/kumiko-framework": patch
---

`crypto`: `KmsWiringEnv` accepts `process.env` directly. All members being optional made TypeScript's weak-type detection reject `ProcessEnv` for having no properties in common, which forced every consumer into a cast or a six-key mapping — the boilerplate #1617 set out to remove (#1618 follow-up).
