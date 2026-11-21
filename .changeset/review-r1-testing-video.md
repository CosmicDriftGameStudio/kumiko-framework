---
"@cosmicdrift/kumiko-testing": patch
---

Fix video stage CSS broken by a rename codemod, caret and generic highlighting in the editor stage.

<!-- kumiko-changes
feature: testing
type: fix
title: video stages render valid CSS again
detail: justify-content and box-sizing were damaged to contentHtml variants, so the terminal body was not bottom-anchored. The editor stage keeps its caret when the last typed line is whitespace and colours generics like Array<string> as types. Regression tests cover the stage CSS.
-->
