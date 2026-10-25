---
"@cosmicdrift/kumiko-bundled-features": patch
---

The tier-engine resolver reads tier assignments and tenant creation times in system scope, so tenants keep their assigned tier when row-level security is on.

<!-- kumiko-changes
feature: tier-engine
type: fix
title: Tier fallback to the default tier under row-level security
detail: With row-level security enabled (the default since 0.390) the boot preload, the bus-driven reloads and the trial gate of the tier-engine resolver ran on the enforcing pool without a tenant scope, read zero rows and dropped every tenant to the default tier, so toggleable features of paying tenants answered 403 feature_disabled. These reads now run in system scope; no app change is needed.
-->
