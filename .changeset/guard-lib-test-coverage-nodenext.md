---
"@cosmicdrift/kumiko-guards": patch
---

Fix lib-test-coverage guard to recognize NodeNext-style test imports ending in .js/.jsx/.mjs/.cjs as linked to their .ts/.tsx/.mts/.cts source.

<!-- kumiko-changes
feature: guards
type: fix
title: lib-test-coverage guard links NodeNext-style .js/.mjs/.cjs test imports to their .ts source
detail: |
  Under moduleResolution NodeNext a test imports "../foo.js" while the source is foo.ts.
  The guard now strips .js/.jsx/.mjs/.cjs as well as .ts/.tsx/.mts/.cts before comparing,
  so such a test no longer triggers a false "no test imports this lib module".
-->
