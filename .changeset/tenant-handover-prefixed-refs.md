---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

tenant-handover transfer graph now resolves feature-prefixed reference targets

<!-- kumiko-changes
feature: tenant-handover
type: fix
title: tenant-handover transfer graph now resolves feature-prefixed reference targets
detail: |
  ReferenceFieldDef.entity may carry a feature prefix
  ("<feature>:<entity>") for cross-feature refs. The tenant-handover
  transfer graph and the framework boot validator's depth check both took
  that value raw, so a prefixed reference never formed an edge: the claim
  handler silently moved only the root row, leaving every entity reachable
  solely through a prefixed reference behind in the source tenant. Both
  now resolve the target through the shared parseRefTargetEntityName.
  Consumer-visible: an entity reachable only via a prefixed reference that
  has rows and is not declared `transferable: true` now fails the claim
  with `entity_not_transferable` instead of being left behind, and the
  boot-time MAX_TRANSFER_DEPTH check now counts prefixed chains too. No
  migration needed; declare `transferable: true` on a newly caught entity
  or flatten a newly caught over-deep chain.
-->
