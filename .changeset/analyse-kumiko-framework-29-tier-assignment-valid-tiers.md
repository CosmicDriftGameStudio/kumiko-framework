---
"@cosmicdrift/kumiko-bundled-features": patch
---

The generic tier-assignment create and update handlers reject tier names that are not in the tierMap.

<!-- kumiko-changes
feature: tier-engine
type: fix
title: Unknown tier names are rejected on tier-assignment writes
detail: With a tierMap configured, tier-engine:write:tier-assignment:create and :update now answer validation_error (field tier or changes.tier, code invalid_value) for a tier name the tierMap does not define, the same check set-tenant-tier already makes. Before, such a row was stored and the tenant silently got only the always-on features. Storage-only mode without a tierMap is unchanged.
-->
