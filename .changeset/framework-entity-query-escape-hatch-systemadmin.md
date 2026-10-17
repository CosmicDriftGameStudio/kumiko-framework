---
"@cosmicdrift/kumiko-framework": patch
---

Entity list and detail handlers with escapeHatch require SystemAdmin-only access

<!-- kumiko-changes
feature: framework
type: breaking
title: Entity list and detail handlers with escapeHatch must declare SystemAdmin-only access
detail: defineEntityListHandler, defineEntityDetailHandler and registerEntityCrud read options with escapeHatch now throw at definition unless access is { roles: ["SystemAdmin"] }, like write handlers already did. A cross-tenant read reachable by any tenant role leaked foreign rows.
migration: Give every list/detail handler that declares escapeHatch access: { roles: ["SystemAdmin"] }, or drop the escapeHatch if the handler should stay tenant-scoped.
-->
