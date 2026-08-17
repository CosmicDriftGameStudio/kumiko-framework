---
"@cosmicdrift/kumiko-bundled-features": minor
---

Resending a signup or invite mail now invalidates the previous link and mints a fresh one, instead of resending the same token — the old link stops working as soon as a new one is requested. This is a behavior change for any consumer that told users "either mail works" or relied on a resend being safe to click twice.

The reason: signup and invite magic-link tokens are now stored in Redis as sha256 hashes instead of plaintext (#2174), closing an exposure via Redis key names, `MONITOR` output, replica traffic, and backup/memory dumps. Storing only the hash makes it structurally impossible to recover the original token for resend, which is the point of the fix.

Reset and email-verification tokens are unaffected — they're HMAC-signed and stateless, never stored in Redis.
