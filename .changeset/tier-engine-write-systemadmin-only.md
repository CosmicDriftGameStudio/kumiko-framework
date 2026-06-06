---
"@cosmicdrift/kumiko-bundled-features": minor
---

fix(tier-engine): tier-assignment create/update are now SystemAdmin-only (was `TenantAdmin | SystemAdmin`). A tenant admin could previously write their own tier-assignment — a free self-upgrade to a higher plan. Tier changes are a platform/billing concern; reads (list, get-active-tier) stay TenantAdmin-visible, and the auto-default-tier hook + billing both write as system, so neither is affected. **Breaking** only for callers that invoked tier-assignment writes as a plain TenantAdmin — switch them to SystemAdmin.
