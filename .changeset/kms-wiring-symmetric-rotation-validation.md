---
"@cosmicdrift/kumiko-framework": patch
---

`buildPgKmsOptions` now throws when `PLATFORM_KEK_PREVIOUS_VERSION` is set without `PLATFORM_KEK_PREVIOUS`, mirroring the existing check in the other direction. Previously this half-set rotation pair silently dropped the version instead of failing loud.
