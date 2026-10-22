---
"@cosmicdrift/kumiko-framework": patch
---

Codemods: `testing-move` keeps side-effect and empty imports of the old paths, `feature-layout` rewrites directory imports of moved `index` files.

<!-- kumiko-changes
feature: framework
type: fix
title: Codemods no longer drop side-effect imports or miss moved index files
detail: The testing-move codemod repoints side-effect and empty imports instead of deleting them. The feature-layout codemod rewrites directory imports such as "./components" when the moved file is components/index.ts.
-->
