---
"@cosmicdrift/kumiko-framework": patch
---

List filters on a `reference` field with `multiple: true` use jsonb containment like `multiSelect`, so eq, ne and in match rows whose id array contains the value.

<!-- kumiko-changes
feature: framework
type: fix
title: List filter on multiple references matches array contents
detail: eq, ne and in on a multi-reference field now check jsonb containment instead of scalar equality, and screen filters on such fields allow the equality operators. Consumers no longer need a full scan.
-->
