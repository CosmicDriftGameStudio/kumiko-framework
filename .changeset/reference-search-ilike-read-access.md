---
"@cosmicdrift/kumiko-framework": patch
---

Searching a list by a reference field's label now respects the target entity's row-level `access.read` and the label field's own `access.read` on the plaintext (ILIKE) path. Before, a viewer who could not read the target row or its label could probe names through the match results.

<!-- kumiko-changes
feature: framework
type: fix
title: reference label search applies target read access on the plaintext path
-->
