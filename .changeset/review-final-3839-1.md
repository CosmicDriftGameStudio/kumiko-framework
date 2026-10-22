---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

`BootOptionName` shrinks to the options a stack actually requires: `mail`, `kmsMode`, `fileStorage`, `billing`, `featureToggles` and `rateLimit`.

<!-- kumiko-changes
feature: server-runtime
type: breaking
title: BootOptionName drops demoMode, seeds and signals
detail: No stack declared them in bootRequires, so their boot checks never ran. A name returns together with its check and a test once a stack needs it.
migration: no known callers; remove "demoMode", "seeds" and "signals" from bootRequires options
-->
