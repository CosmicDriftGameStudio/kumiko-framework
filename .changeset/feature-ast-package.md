---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-feature-ast": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-cli": minor
"@cosmicdrift/kumiko-guards": minor
---

Feature AST, pattern library and codemods moved to the new package @cosmicdrift/kumiko-feature-ast; kumiko-upgrade heals stale open lines in CHANGELOG.md

<!-- kumiko-changes
feature: framework
type: breaking
title: Feature AST, pattern library and codemods moved to @cosmicdrift/kumiko-feature-ast
codemod: scripts/codemod/feature-ast-package.ts
migration: |
  Import these names from @cosmicdrift/kumiko-feature-ast instead of @cosmicdrift/kumiko-framework/engine: AddEntityArgs, AddHookArgs, AddRelationArgs, AddWriteHandlerArgs, FeaturePatcher, FeaturePattern, FeaturePatternKind, FormFieldLabel, FormFieldSpec, FormInputType, HandlerHeaderUpdate, ParseError, ParseResult, PatternCategory, PatternChange, PatternChangeIssue, PatternChangesParseResult, PatternFormSchema, PatternId, RenderFeatureFileInput, SourceLocation, PATTERN_LIBRARY, VERSION_HEADER, addPattern, applyChanges, createFeaturePatcher, getPatternSchema, groupByCategory, parseFeatureFile, parsePatternChanges, parseSourceFile, removePattern, renderFeatureFile, renderPattern, replacePattern, updatePattern. Import CodemodOptions, CodemodReport, CodemodResult, FileAnalysis, ParsedHandlerInfo, analyzeFile, analyzeHandlerArrow, convertFile, generatePerformBlock, runCodemod, scanForCandidates from @cosmicdrift/kumiko-feature-ast/codemod instead of @cosmicdrift/kumiko-framework/engine/codemod. Add @cosmicdrift/kumiko-feature-ast to the dependencies of the importing package; the codemod does both. @cosmicdrift/kumiko-framework no longer installs ts-morph.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: kumiko-upgrade --apply and --resolve heal stale open lines in CHANGELOG.md
migration: |
  Every manual migration the upgrade marker lists as resolved gets its status in CHANGELOG.md, including `- [open]` lines in older sections left behind by a resolve with an older CLI.
-->

<!-- kumiko-changes
feature: feature-ast
type: improvement
title: New package @cosmicdrift/kumiko-feature-ast
-->

The feature-file AST (parse, patch, render), the pattern library and the upgrade codemods now live in their own package, so the framework and its production images no longer carry ts-morph. The package publishes `.` and the Bun-only `./codemod`.
