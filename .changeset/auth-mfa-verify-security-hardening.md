---
"@cosmicdrift/kumiko-bundled-features": patch
---

Fix `auth-mfa`'s two-step verify + enroll flow re-checking stale state and
skipping replay protection that `login.write.ts` already enforces:

- `verify.write.ts` minted a session from a challenge token alone, without
  re-checking account status or tenant membership. A user restricted/deleted,
  or removed from the tenant, in the ~10-minute window between password
  login and MFA verify still got a full session — membership loss even
  silently fell back to global-only roles instead of refusing. Both gates
  now mirror `login.write.ts`.
- `enable-confirm.write.ts` never burned the setup token on success: the
  same token could re-enable MFA with an old secret after a `disable`
  (replay), and two parallel confirms both hit the executor instead of the
  second seeing `mfa_already_enabled`. The token is now single-use, the
  same as `login.write.ts`'s magic-link tokens.
- `auth-mfa` was missing `r.requires("tenant")` despite `verify.write.ts`
  dispatching `tenant:query:memberships` — a mount without `tenant` now
  fails at boot instead of 500ing on first login.
- Recovery codes are now normalized (uppercased, punctuation-stripped)
  before hashing and verifying, so a code retyped lowercase or without the
  dash still matches — this changes the stored hash format, safe because
  `auth-mfa` has no deployed consumer with enrolled users yet.

Also fixes `samples/apps/user-data-rights-demo`'s forget-cleanup test, which
asserted on the manual `runForgetCleanup` helper instead of driving the
actually-registered cron job through its real `JobContext` wrapper.
