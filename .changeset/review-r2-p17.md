---
"@cosmicdrift/kumiko-framework": patch
---

Review fixes: codemods report re-exports, namespace destructuring and ambiguous `requires` arguments instead of silently passing, `schema validate` names the violated FeatureDefinition key, and handler-context construction takes an options object.

<!-- kumiko-changes
feature: codemods
type: fix
title: Codemods stop miscompiling or skipping ambiguous sites
detail: testing-injection rewrites named re-exports of moved names and reports export-star, testing-move reports namespace destructuring and qualified type references of split names, and object-form no longer rewrites r.requires(identifier) but reports it for a manual check.
-->

<!-- kumiko-changes
feature: schema-cli
type: fix
title: schema validate names the violated FeatureDefinition key
detail: A malformed FEATURES entry now reports the first key that is missing or has the wrong type instead of always pointing at the name.
-->
