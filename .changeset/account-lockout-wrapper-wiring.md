---
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

`RunProdAppAuthOptions`/`RunDevAppAuthOptions` now accept `accountLockout` (`maxFailedAttempts`, `lockoutDurationMinutes`), wired through the shared `composeFeatures`/`buildComposeAuthOptions` plumbing that already carries `accountUnlock`. Before this, both wrappers exposed `accountUnlock` — the self-service escape hatch for the lockout's failure counter — with no way to ever set the lockout it's meant to escape, so an app using either wrapper's convenience options couldn't turn on brute-force protection at all (kumiko-framework#1627).
