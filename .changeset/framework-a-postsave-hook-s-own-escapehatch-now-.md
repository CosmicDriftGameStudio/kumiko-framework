---
"@cosmicdrift/kumiko-framework": minor
---

A lifecycle hook's own escapeHatch now gates ctx.systemDb.unsafeRaw (fw#3198)

<!-- kumiko-changes
feature: framework
type: breaking
title: A lifecycle hook's own escapeHatch now gates ctx.systemDb.unsafeRaw (fw#3198)
migration: |
  Hooks, die in r.systemScope()-Handlern ctx.systemDb.unsafeRaw nutzen, deklarieren escapeHatch: { reason } in den r.hook-Optionen
-->
