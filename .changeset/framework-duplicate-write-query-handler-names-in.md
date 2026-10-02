---
"@cosmicdrift/kumiko-framework": minor
---

Duplicate write/query handler names in one feature fail at definition time

<!-- kumiko-changes
feature: framework
type: breaking
title: Duplicate write/query handler names in one feature fail at definition time
migration: |
  Rename a custom handler that shares its name with another handler of the same feature, including names r.crud registers (<entity>:list, <entity>:detail, <entity>:create, <entity>:update, <entity>:delete, <entity>:restore). Before, the later registration replaced the earlier one silently.
-->
