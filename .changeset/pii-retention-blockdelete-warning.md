---
"@cosmicdrift/kumiko-framework": patch
---

The boot warning for `retention.strategy: "blockDelete"` without a field `anonymize` now names the real risk: once keepFor expires, the data-retention cron anonymizes nothing and the row keeps its PII

<!-- kumiko-changes
feature: framework
type: fix
title: The blockDelete-without-anonymize boot warning names the retention-cron risk instead of a Forget error
-->
