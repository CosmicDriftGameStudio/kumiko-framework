---
"@cosmicdrift/kumiko-bundled-features": patch
---

Signature: an empty signature is rejected even when one corner of the image differs from the background, a blank `linkSecret` is refused together with `authorizeSubject`, and the tenant-in-subject encoding of link grants is a shared helper (`shared/tenant-scoped-subject`).

<!-- kumiko-changes
feature: signature
type: fix
title: Empty signature images are rejected on any background
detail: The background of a signature image is now the dominant opaque colour of its border (within a small tolerance) instead of four identical corners, so an opaque blank image with one differing corner pixel no longer passes as signed. A `linkSecret` of only whitespace is refused when `authorizeSubject` is set. The tenant-scoped subject of the signing link is available as `tenantScopedSubject`, `parseTenantScopedSubject` and `peekTenantScopedSubject` in `@cosmicdrift/kumiko-bundled-features/shared/tenant-scoped-subject`.
-->
