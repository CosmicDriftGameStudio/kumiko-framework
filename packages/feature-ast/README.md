# @cosmicdrift/kumiko-feature-ast

Feature-file AST for Kumiko: parse, patch and render feature definitions, plus the pattern library that describes every feature pattern.

## Entry points

- `@cosmicdrift/kumiko-feature-ast` - `parseFeatureFile`, `renderFeatureFile`, the patcher and `PATTERN_LIBRARY`.
- `@cosmicdrift/kumiko-feature-ast/codemod` - the pipeline codemod (Bun only, uses ts-morph).

## Codemods

The codemods a guard points to (`import-extensions`, `feature-layout`) live in `src/scripts/codemod/` and run through `kumiko codemod`; `kumiko-upgrade --apply` runs the codemod a release names in its changes.json.
