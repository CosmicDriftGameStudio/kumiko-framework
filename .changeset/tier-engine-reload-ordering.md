---
"@cosmicdrift/kumiko-bundled-features": patch
---

Tier assignment changes no longer reload the publishing process twice and stale reloads cannot overwrite a resync

<!-- kumiko-changes
feature: tier-engine
type: fix
title: Tier cache: stale single reload cannot overwrite a newer full resync
detail: A single-tenant reload that started before a full resync and resolved after it could restore an outdated tier. The resync now advances the per-tenant ticket for deleted and adopted tenants too, and assignment changes are published remote-only.
-->
