---
"@cosmicdrift/kumiko-framework": patch
---

Codemods that add an import now place it after the last existing import instead of inside a file's header comment block.

<!-- kumiko-changes
feature: framework
type: fix
title: Codemod imports no longer land inside header comments
detail: ensureNamedImport appends the new import after the last existing import, so a file with a header comment block keeps the comment intact.
-->
