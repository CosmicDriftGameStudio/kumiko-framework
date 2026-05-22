---
"@cosmicdrift/kumiko-bundled-features": patch
---

`user-data-rights` declares `r.requires("sessions")` for the `sessions.revokeAllForUser` API it uses.

The feature called `r.usesApi("sessions.revokeAllForUser")` but didn't list `sessions` in `r.requires(...)`. The framework's `validateApiExposureMatching` boot-check rejects that as inconsistent (any feature exposed by another must be in requires/optionalRequires). Surfaced in studio's production-bundle boot.
