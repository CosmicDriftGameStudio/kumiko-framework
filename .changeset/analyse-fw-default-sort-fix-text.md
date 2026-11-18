---
"@cosmicdrift/kumiko-framework": patch
---

Boot-validator fix hints for a missing `defaultSort` name the real key `dir` instead of `direction`.

<!-- kumiko-changes
feature: framework
type: fix
title: defaultSort fix hint uses the key dir
detail: The boot rules that require `defaultSort` on list screens suggested `{ field, direction }`, which does not typecheck. They now suggest `{ field, dir }`.
-->
