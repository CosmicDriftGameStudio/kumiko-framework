---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Remove the dead `allowPerRequest` config key option and its three boot rules.

<!-- kumiko-changes
feature: framework
type: breaking
title: Remove dead allowPerRequest config key option
detail: Since resolveConfigOrParam is gone nothing reads `allowPerRequest`, yet the type, the create*Config options and three boot rules (config-key/per-request-text, config-key/per-request-encrypted, config-key/options-query-per-request) still guarded it, suggesting per-request overrides that never happen. The option and the rules are removed; passing `allowPerRequest` is now a type error.
migration: Remove `allowPerRequest` from config key definitions (create*Config options); it had no runtime effect.
-->
