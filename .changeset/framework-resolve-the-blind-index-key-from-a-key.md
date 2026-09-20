---
"@cosmicdrift/kumiko-framework": minor
---

Resolve the blind-index key from a Key Manager ciphertext

resolvePlatformKeks walks an allowlist of slots (PLATFORM_KEK, PLATFORM_KEK_PREVIOUS, KUMIKO_BLIND_INDEX_KEY) instead of two hardcoded KEK slots, so each slot's <SLOT>_CIPHERTEXT is unwrapped at boot. The blind-index key can leave the pod env in the clear with no app-code change, because resolveKmsWiringAsync already resolves before its trio check. Ciphertexts outside the allowlist are ignored rather than resolved: a foreign *_CIPHERTEXT must never fail boot.

<!-- kumiko-changes
feature: framework
type: improvement
title: Resolve the blind-index key from a Key Manager ciphertext
-->
