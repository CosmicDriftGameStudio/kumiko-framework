---
"@cosmicdrift/kumiko-bundled-features": patch
---

file-derivatives fileRef mode now 404s a disabled/destroy-lifecycle tenant like an unknown fileRef

<!-- kumiko-changes
feature: file-derivatives
type: fix
title: file-derivatives fileRef mode now 404s a disabled/destroy-lifecycle tenant like an unknown fileRef
detail: |
  publicTenantResolution:"fileRef" resolved a variant's tenant straight off
  the FileRef row, without checking whether that tenant was still enabled or
  past `active` in its destroy lifecycle — a disabled or destroy-requested
  tenant's public variants stayed reachable through the shared host. The
  by-fileRef handler now also loads the FileRef-tenant's row and, via the
  new `isTenantServingPublicContent` predicate (isEnabled && status ===
  "active"), 404s identically to an unknown fileRef when it isn't serving.
  `publicTenantResolution: "fileRef"` now requires the `tenant` feature to
  be mounted (fails boot otherwise) — no migration needed for apps that
  already mount `tenant`, which every fileRef-mode consumer does today.
-->
