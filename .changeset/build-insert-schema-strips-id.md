---
"@cosmicdrift/kumiko-framework": patch
---

buildInsertSchema strips `id` from the insert payload again. A new 4th parameter `{ allowCallerId }` opts in to a caller-chosen id.

<!-- kumiko-changes
feature: framework
type: breaking
title: buildInsertSchema strips id again; caller-chosen ids need { allowCallerId: true }
migration: |
  Custom-Create-Handler, die eine caller-gewaehlte id brauchen, uebergeben { allowCallerId: true } und erlauben sie nur System-Identities.
-->
