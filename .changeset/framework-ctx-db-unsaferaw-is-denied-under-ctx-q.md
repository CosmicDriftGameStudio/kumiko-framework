---
"@cosmicdrift/kumiko-framework": minor
---

ctx.db.unsafeRaw is denied under ctx.queryAsMember

<!-- kumiko-changes
feature: framework
type: breaking
title: ctx.db.unsafeRaw is denied under ctx.queryAsMember
migration: |
  Query handlers reached through ctx.queryAsMember can no longer call ctx.db.unsafeRaw — not even for reads. Move them to the ctx.db query APIs, or stop calling them via queryAsMember. Consequence for kumiko-enterprise: ai-call provenance writes under queryAsMember now fail closed; withProvenance swallows the error and counts provenance_drop_total.
-->
