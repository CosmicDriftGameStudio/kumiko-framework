---
"@cosmicdrift/kumiko-bundled-features": minor
---

Agent tool failures are classified instead of passing raw messages through

<!-- kumiko-changes
feature: agent-tools
type: improvement
title: Agent tool failures are classified instead of passing raw messages through
detail: dispatchToolCall now adds a code to failed tool results. Client errors keep their message, rate limits also set retryable and retryAfterSeconds. Server errors and unknown throws are logged with their cause and returned to the model as "Tool failed unexpectedly", so internal details such as database messages no longer reach the model. ToolCallRequest accepts an optional log.
-->
