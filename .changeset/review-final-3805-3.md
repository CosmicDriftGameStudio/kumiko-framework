---
"@cosmicdrift/kumiko-bundled-features": patch
---

Every failed agent tool result now carries a `code`. Bad arguments and a missing handler or screen return `invalid_tool_call`, a tool name that is not in the table returns `unknown_tool`; both are exported as `TOOL_CALL_ERROR_CODES` so an agent loop can branch on them like on a handler code.

<!-- kumiko-changes
feature: agent-tools
type: improvement
title: Local agent tool errors carry a code
detail: dispatchToolCall returns code invalid_tool_call for validation errors and unknown_tool for an unknown tool name, instead of a result without code. TOOL_CALL_ERROR_CODES names both.
-->
