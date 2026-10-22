---
"@cosmicdrift/kumiko-framework": patch
---

The feature AST matches pattern ids, classifies editability and renders patterns through one typed table per kind instead of long switch statements. Rendered source, editability and id matching are unchanged.

<!-- kumiko-changes
feature: framework
type: improvement
title: Per-kind tables for feature-AST id matching, editability and rendering
detail: callMatchesId() looks up one matcher per PatternId kind in a typed table in feature-ast/pattern-id-matchers.ts next to patch.ts. getEditability() reads a table keyed by pattern kind, and renderPattern() dispatches through one renderer per pattern kind. All three tables are typed over their kind union, so a new kind does not compile until it has an entry. The feature-ast barrel exports the same names as before.
-->
