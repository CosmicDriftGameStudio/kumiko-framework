---
"@cosmicdrift/kumiko-bundled-features": patch
---

config:query:values and config:query:cascade accept an optional read scope.

<!-- kumiko-changes
feature: config
type: improvement
title: config:query:values and config:query:cascade accept a read scope
detail: Both queries take an optional scope (system, tenant, user). With scope system the cascade of a tenant or user key is evaluated at system level, so the system row is returned even when the caller's own tenant has a row for the key. Inherited-value redaction still applies. Without scope the behavior is unchanged.
-->
