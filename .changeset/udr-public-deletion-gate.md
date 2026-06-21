---
"@cosmicdrift/kumiko-bundled-features": minor
---

user-data-rights: `userDataRightsClient({ publicDeletion })` mounts the anonymous account-deletion flow as gates

The login-free deletion screens (`RequestAccountDeletionScreen` + `ConfirmAccountDeletionScreen`) previously had to be wired by each app via a hand-rolled `createPublicSurface`/path-gate. `userDataRightsClient` now accepts an optional `publicDeletion: { requestPath, confirmPath, shell? }`: when set, it registers a `makePublicDeletionGate(...)` that matches `window.location.pathname` and renders the request screen on `requestPath`, the token-confirm screen on `confirmPath`, else passes through. Apps list the client before their auth client (so an anonymous visitor reaches the deletion mask, not the login mask), configure the matching server opts (`deletionTokenSecret`, `deletionVerifyUrl`, `sendDeletionVerificationEmail`), and add the navigation — no per-app deletion screen. `makePublicDeletionGate` + `PublicDeletionRoutes` are exported from `.../user-data-rights/web`. Additive — omitting `publicDeletion` keeps the prior behaviour (privacy-center screen only).
