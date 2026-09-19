---
"@cosmicdrift/kumiko-framework": minor
---

PLATFORM_KEK can now be resolved from a Key Manager ciphertext at boot

New `resolvePlatformKeks` (packages/framework/src/crypto/kek-source.ts) decrypts `PLATFORM_KEK_CIPHERTEXT` / `PLATFORM_KEK_PREVIOUS_CIPHERTEXT` through Scaleway Key Manager when the matching plaintext (`PLATFORM_KEK` / `PLATFORM_KEK_PREVIOUS`) is absent, so the KEK no longer has to sit in the pod env in the clear. Each slot resolves independently: a plaintext value always wins over its ciphertext sibling with no request made, which keeps a KEK rollback bootable without a network call. `resolveKmsWiringAsync` and `requireKmsWiringAsync` wrap the existing sync `resolveKmsWiring` / `requireKmsWiring` with this resolution step; the sync functions and every other exported signature are unchanged. `PLATFORM_KEK` plaintext stays fully valid and keeps precedence — this is purely additive.

<!-- kumiko-changes
feature: framework
type: improvement
title: PLATFORM_KEK can now be resolved from a Key Manager ciphertext at boot
-->
