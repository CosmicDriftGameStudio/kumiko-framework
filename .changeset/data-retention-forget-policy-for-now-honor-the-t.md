---
"@cosmicdrift/kumiko-bundled-features": minor
---

forget/policy-for now honor the tenant retention preset

<!-- kumiko-changes
feature: data-retention
type: breaking
title: forget/policy-for now honor the tenant retention preset
migration: |
  ResolveForTenantArgs.tenantPreset was renamed to preloadedTenantPreset (mirrors preloadedOverride): omitting it now makes the resolver load the tenant's retention preset itself instead of skipping it. Behavior change: forget (Art. 17) and the policy-for query now honor the tenant's compliance-profile-derived retention preset, not just entity defaults and per-tenant overrides. For tenants with a mapped compliance profile (e.g. de-hr-dsgvo-hgb), forget now keeps invoice/booking/contract rows via blockDelete and anonymizes order rows instead of hard-deleting them; notes-history mentions on such hosts are no longer shredded when the mentioned note's host entity is preset-protected. policy-for (data-retention:query:policy-for) now returns source: "preset" where it previously returned "none" for these entities.
-->
