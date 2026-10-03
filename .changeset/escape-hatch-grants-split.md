---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

escapeHatch: new optional `grants` (`systemIdentity`, `globalWrites`, `unsafeRaw`) narrows what a declaration unlocks. Without `grants` the declaration keeps unlocking all three. An empty or unknown `grants` list is a boot error. Bundled handlers that only needed the raw runner now declare `grants: ["unsafeRaw"]`, so they no longer gain the SYSTEM identity switch.

<!-- kumiko-changes
feature: framework
type: improvement
title: escapeHatch grants split the SYSTEM identity switch from raw access
migration: |
  No action needed: `grants` is additive and an escapeHatch without it behaves as before.
  Declare `grants: ["unsafeRaw"]` on handlers that only call ctx.db.unsafeRaw to drop the SYSTEM identity switch.
-->
