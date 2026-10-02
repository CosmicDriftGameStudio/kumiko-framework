---
"@cosmicdrift/kumiko-guards": patch
---

`secret-literal` now inspects every `?? "literal"` fallback on a line instead of only the first, so a hardcoded secret behind a trivial first fallback is flagged. The `as-casts` audit prints its per-site listings only when run standalone; inside the shared runner it prints just the counts and the baseline verdict.

<!-- kumiko-changes
feature: guards
type: improvement
title: secret-literal checks all fallbacks on a line; as-casts audit is quiet inside the shared runner
migration: |
  A repo with a hardcoded secret fallback hidden behind an earlier trivial fallback on the same line can now fail the secret-literal guard. Replace the literal with a hard failure on a missing env value.
-->
