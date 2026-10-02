---
"@cosmicdrift/kumiko-framework": patch
---

The httpRoute guard chain no longer includes the PAT rate-limit guard. PATs are rejected on httpRoutes before it could count, so behavior is unchanged.

<!-- kumiko-changes
feature: framework
type: fix
title: Removed unreachable PAT rate-limit guard from the httpRoute chain
-->
