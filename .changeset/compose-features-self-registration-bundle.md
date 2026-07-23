---
"@cosmicdrift/kumiko-server-runtime": patch
---

`composeFeatures` now mounts `createAuthSelfRegistrationToggleFeature()` alongside `authOptions.signup`. The self-registration toggle shipped in a recent minor gates `signup-request` on `ctx.hasFeature("auth-self-registration")`, but `composeFeatures`'s `includeBundled` convenience wiring was never updated to mount it — any app relying on that wiring (rather than hand-mounting `createAuthEmailPasswordFeature` itself) got self-signup silently broken: the handler no-ops and returns its always-200 anti-enumeration success response, so no activation mail ever goes out and nothing looks wrong until a user notices the mail never arrives.
