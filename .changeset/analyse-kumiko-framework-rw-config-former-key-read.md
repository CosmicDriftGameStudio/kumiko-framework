---
"@cosmicdrift/kumiko-bundled-features": patch
---

`config` exports `readStoredTextOfFormerKey` for reading the stored value of a renamed or moved key.

<!-- kumiko-changes
feature: config
type: improvement
title: readStoredTextOfFormerKey reads the stored text of a former config key
detail: `readStoredTextOfFormerKey(db, key, tenantId, userId)` returns the stored text of a key that is no longer registered: the tenant row, else the system row, else undefined. Registered keys keep going through the resolver; the helper serves a `computed` rung that keeps the value of a former key readable. The branding keys use it to show values stored under the old managed-pages keys.
-->
