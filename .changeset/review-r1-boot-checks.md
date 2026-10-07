---
"@cosmicdrift/kumiko-framework": patch
---

Boot validation rejects `personalData: "public-intake"` handlers with `rateLimit: { disabled: true }` and unmanaged `idType: "serial"` entities with `recordOwned` fields

Both combinations were silently accepted before: the first left an anonymous personal-data write without its only abuse protection, the second produced record-owned ciphertext that `forgetSubject` can never shred.

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot validation rejects public-intake handlers without rate limit and serial-id unmanaged entities with recordOwned fields
-->
