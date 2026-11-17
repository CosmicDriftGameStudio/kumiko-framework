---
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-feature-ast": minor
---

Guard opt-outs now use one marker syntax: `kumiko-lint-ignore <slug> <reason>` for a line and `kumiko-lint-ignore-file <slug> <reason>` for a whole file.

<!-- kumiko-changes
feature: guards
type: breaking
title: Test guard opt-outs move to kumiko-lint-ignore
detail: `// @timeout-exception: #N reason` is now `// kumiko-lint-ignore test-timeouts #N reason`, `// @template-drift-exception: #N reason` is now `// kumiko-lint-ignore test-template-drift #N reason`, and the file-wide `// @no-server-stack: reason` is now `// kumiko-lint-ignore-file test-stack-drift reason` in the leading comment of the file. The old markers are no longer read. Every reason now goes through the ignore-tag-reason check (at least three real words); the two test guards still require `#<issue>` first.
migration: Run the codemod, then rewrite any reason the ignore-tag-reason guard reports as too weak.
codemod: scripts/codemod/guard-markers-to-lint-ignore.ts
affects: @timeout-exception, @template-drift-exception, @no-server-stack
-->
