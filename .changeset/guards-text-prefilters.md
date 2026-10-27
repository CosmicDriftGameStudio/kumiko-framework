---
"@cosmicdrift/kumiko-guards": patch
---

Four AST guards skip the syntax-tree walk for files that cannot contain what they look for, which cuts the guard suite run roughly in half without changing a finding.

<!-- kumiko-changes
feature: guards
type: improvement
title: Faster guard suite through text prefilters
detail: RLS-Session-Settings, Internal-Subpath-Imports, Test-ES-Fixtures and Test-ES-Row-Writes walked every node of every scanned file. Each now first checks the file text for the tokens its rules need (for example kumiko. or set_config, createTenantDb, kumiko_events, DELETE FROM or UPDATE) and skips the walk when none appears; Internal-Subpath-Imports keeps walking any file with a unicode escape, which could spell a name without its plain text. Findings are unchanged: the suites report the same results on kumiko-framework, kumiko-enterprise and publicstatus before and after.
-->
