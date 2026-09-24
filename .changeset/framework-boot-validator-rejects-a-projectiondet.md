---
"@cosmicdrift/kumiko-framework": minor
---

Boot validator rejects a projectionDetail screen/section/emptyState action with no resolvable icon (fw#3234)

<!-- kumiko-changes
feature: framework
type: breaking
title: Boot validator rejects a projectionDetail screen/section/emptyState action with no resolvable icon (fw#3234)
migration: |
  Every screen.actions / section.actions / section.emptyState.action entry on a projectionDetail screen, and every section.actions entry on an entityEdit screen, must resolve an icon: either an explicit `icon` on the action, or an id the shared action-icon map (@cosmicdrift/kumiko-types resolveActionIcon) already derives from the full id or its last/first kebab segment. entityEdit's own screen-level `actions` are not checked (unchanged, out of scope for this rule). An action that fails this now fails boot instead of rendering without an icon; give it an explicit `icon` or rename it to an id the map covers.
-->
