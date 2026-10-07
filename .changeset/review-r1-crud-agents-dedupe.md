---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

`r.crud` takes per-verb `agents` hints, and same-named features only dedupe when their registered surface matches

`registerEntityCrud` accepts `agents: { delete: { risk: "high" } }` so one irreversible verb can be raised without raising create/update. `dedupeFeatures` additionally requires equal entity and handler key sets before collapsing two same-named features with equal `dedupeOptions`; otherwise it throws the existing duplicate-feature error instead of silently dropping the second one. `i18nKey()` marks live on a `globalThis` registry so two installed framework copies agree.

<!-- kumiko-changes
feature: framework
type: improvement
title: r.crud accepts per-verb agent hints and dedupeFeatures no longer drops a same-named feature that registers different handlers
-->
