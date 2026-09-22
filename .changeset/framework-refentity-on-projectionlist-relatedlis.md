---
"@cosmicdrift/kumiko-framework": minor
---

refEntity on projectionList/relatedList columns and projectionDetail fields is boot-checked against registered entities

<!-- kumiko-changes
feature: framework
type: breaking
title: refEntity on projectionList/relatedList columns and projectionDetail fields is boot-checked against registered entities
migration: |
  A refEntity that does not resolve to a registered entity now fails boot with the target and the known entities of the target feature (same message as a reference facet). Fix the typo, or mount and r.requires() the target feature; test stacks booting a feature without its refEntity target feature must add it.
-->
