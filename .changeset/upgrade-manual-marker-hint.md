---
"@cosmicdrift/kumiko-framework": patch
---

kumiko-upgrade --apply says where the marker landed relative to manual breaking changes

<!-- kumiko-changes
feature: framework
type: improvement
title: kumiko-upgrade --apply says where the marker landed relative to manual breaking changes
detail: |
  A breaking change without a codemod was listed as "manual migration
  required", but the run never said whether the upgrade marker stopped below
  it (the guard keeps listing it until a second --apply acknowledges it) or
  already moved past it (the guard no longer lists it). --apply now prints
  which of the two happened. The marker logic itself is unchanged; the
  acknowledgement path is documented in docs/reference/stability-policy.md.
-->
