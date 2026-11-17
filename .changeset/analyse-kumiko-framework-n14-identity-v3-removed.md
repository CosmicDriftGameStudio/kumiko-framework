---
"@cosmicdrift/kumiko-bundled-features": minor
---

`verifyPassword` only accepts argon2id hashes; the ASP.NET Core Identity V3 verifier is removed.

<!-- kumiko-changes
feature: auth-email-password
type: breaking
title: Identity-V3 password hashes no longer log in
detail: The verify-only path for ASP.NET Core Identity V3 hashes was built for a migration that is no longer planned, and it never rehashed, so imported users would have stayed on PBKDF2. A stored V3 hash now answers like a wrong password. The internal helpers `isIdentityV3Hash` and `verifyIdentityV3Hash` are removed.
migration: An app that imported users with Identity-V3 hashes sends them through password reset, or ships an import tool that rehashes to argon2id.
affects: all
-->
