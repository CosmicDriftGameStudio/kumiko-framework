---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

crossTenant removed from entity convention handlers; write handlers with escapeHatch need SystemAdmin-only access

<!-- kumiko-changes
feature: framework
type: breaking
title: crossTenant removed from entity convention handlers; write handlers with escapeHatch need SystemAdmin-only access
migration: |
  Replace crossTenant: true with escapeHatch: { reason } (run bun node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/migrate-cross-tenant.ts, then replace its placeholder reason, which is rejected otherwise). A create/update/delete/restore handler with escapeHatch must declare access: { roles: ["SystemAdmin"] }; list and detail handlers keep their access.
-->
