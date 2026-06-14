---
"@cosmicdrift/kumiko-bundled-features": patch
---

auth-email-password: self-signup rejects an already-registered email instead of logging into the existing account (#365)

`provisionSignupAccount` was silently idempotent — for an email that already
had a user (seeding or a prior signup) it reused the existing user and minted
a session for them, plus created an orphan tenant. Anyone able to receive the
magic link at a reachable inbox could thereby be logged into the existing
account (e.g. a seeded SystemAdmin). It is now create-only: it throws
`ConflictError` before any tenant is created, and `signup-confirm` translates
that into a clean `signup_email_already_registered` error without minting a
session. The matching JSDoc/comment drift (which claimed the throw already
happened) is corrected.
