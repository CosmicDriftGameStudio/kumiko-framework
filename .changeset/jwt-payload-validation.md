---
"@cosmicdrift/kumiko-framework": patch
---

Harden JWT verification: `verify()` now validates the payload claim shape — a
well-formed RFC-4122 `tenantId` and a `roles` string array — after the signature check,
and rejects malformed or hand-crafted tokens instead of casting the claims blindly. Tokens
minted by `sign()` are unaffected; a token whose `tenantId`/`roles` claims are missing or
of the wrong type is now rejected (verify throws → 401) instead of flowing into the
pipeline with junk claims.
