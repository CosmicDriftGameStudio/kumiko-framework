---
"@cosmicdrift/kumiko-bundled-features": patch
---

forget-subject now gracefully handles missing user rows during lifecycle update (PAT revocation + status set). Email-subscribers and other non-user entities using user-style subject keys no longer cause a `not_found` error — key erase is the important part for GDPR compliance; the lifecycle update is best-effort for real users.
