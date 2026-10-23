# @cosmicdrift/kumiko-feature-ast

Feature-file AST for Kumiko: parse, patch and render feature definitions, plus the pattern library that describes every feature pattern.

## Entry points

- `@cosmicdrift/kumiko-feature-ast` - `parseFeatureFile`, `renderFeatureFile`, the patcher and `PATTERN_LIBRARY`.
- `@cosmicdrift/kumiko-feature-ast/codemod` - the pipeline codemod (Bun only, uses ts-morph).

## Codemods

The upgrade codemods live in `src/scripts/codemod/`. They run through `kumiko-upgrade` or `kumiko codemod`; you rarely call them directly.
