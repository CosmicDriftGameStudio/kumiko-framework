---
"@cosmicdrift/kumiko-guards": patch
---

Guards: cheap text prefilters before the AST walks of Pre-ES-Patterns, API-Object-Form, Escape-Hatch-Declared and Direct-Entity-Writes. Findings are unchanged; the guard run drops from about 67 s and 10 GB RSS to about 28 s and 7.7 GB.

<!-- kumiko-changes
feature: guards
type: improvement
title: Faster, leaner guard run
detail: Four AST guards skip files that cannot contain their anchor names before walking every node, and Direct-Entity-Writes only resolves symbols for table arguments named like an event-sourced table. Findings are identical.
-->
