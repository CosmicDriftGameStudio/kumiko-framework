---
"@cosmicdrift/kumiko-guards": patch
---

Close several guard bypasses and false positives found in review.

<!-- kumiko-changes
feature: guards
type: fix
title: Guard hardening: test titles, ignore-tag reasons, schema CLI, unsafe array params, RLS settings, internal imports
detail: test-title no longer lets English apostrophes hide German words and no longer flags hex colours or row positions as issue references. ignore-tag-reason also checks tags preceded by text and counts lines in linear time. schema-cli-features accepts .js specifiers and namespace imports. unsafe-array-param sees through non-null and angle-bracket assertions. rls-session-settings splits SQL only at top-level semicolons, ignoring comments, strings and dollar-quoted bodies, and skips build, coverage and .turbo directories. internal-subpath-imports flags export-star re-exports of the testing helpers and import-equals require of internal subpaths.
-->
