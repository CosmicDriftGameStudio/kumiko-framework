---
"@cosmicdrift/kumiko-framework": patch
---

Inside an agent tool call, handlers no longer get `unsafeRaw` or `globalWrites` grants, and `r.systemScope()` handlers are refused before they run.

<!-- kumiko-changes
feature: agent-tools
type: fix
title: agent tool calls lose unsafeRaw, globalWrites and system-scope handlers
detail: Only `crossTenantReads` was withheld in the agent tool call scope, so a tool handler declaring `unsafeRaw` or `globalWrites` could still run raw or global SQL against the LLM context, and a `r.systemScope()` handler got the cross-tenant system db. `buildTenantScopedDb` now drops both grants in that scope, and resolving the handler context for a system-scope handler throws `access_denied` (reason `agent.tool_not_allowed`) while the scope is marked.
-->
