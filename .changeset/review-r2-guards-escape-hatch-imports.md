---
"@cosmicdrift/kumiko-guards": patch
---

The escape-hatch guards now only accept `declareEscapeHatch` and `withUnsafeRawGrant` imported from the framework itself; a local function or an import from another module with the same name no longer satisfies them. A corrupt `.kumiko-cast-baseline.json` is now an error instead of being treated as an empty baseline. Guard hints point at `kumiko-guards guards`.

<!-- kumiko-changes
feature: guards
type: fix
title: Escape-hatch guards accept only real framework imports, a corrupt cast baseline is an error, hints name kumiko-guards guards
-->
