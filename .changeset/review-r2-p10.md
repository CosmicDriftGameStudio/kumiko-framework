---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-framework": minor
---

Review fixes: seeded layout titles resolve in the PDF editor and mail rail, the client-error rate limiter evicts the least recently seen IPs instead of resetting every window, the SSE heartbeat ping counts towards stalled-client detection, and the `__Host-` session cookies are expired even with `secureCookies:false`. The exported `runAsDirectCallEntry` is now `runAsAgentToolCallEntry`.

<!-- kumiko-changes
feature: document-designer
type: fix
title: Seeded layout titles show translated in the PDF editor and mail rail
detail: A layout seeded with a title i18n key now shows its translated name in the PDF editor header and the mail editor properties rail instead of the raw key.
-->

<!-- kumiko-changes
feature: client-errors
type: fix
title: Client-error rate limit survives address rotation
detail: Without Redis, the per-process limiter now drops the least recently seen IPs when more than 10000 are tracked, so a flood of fresh addresses no longer resets the window of every other IP.
-->

<!-- kumiko-changes
feature: sse
type: fix
title: Stalled SSE clients are dropped without further broadcasts
detail: The heartbeat ping is written and tracked like entity frames instead of awaited, so a client that stopped reading is aborted at the next heartbeat after the stall timeout and releases its broker slot.
-->

<!-- kumiko-changes
feature: session-cookies
type: fix
title: Leftover __Host- cookies are expired with secureCookies:false too
detail: Clearing the session cookies now always sends the Secure delete for the __Host- auth and csrf variants when the configured names are unprefixed, so an app switched to secureCookies:false behind a TLS proxy no longer keeps a stale __Host- csrf cookie.
-->

<!-- kumiko-changes
feature: agent-tools
type: breaking
title: runAsDirectCallEntry renamed to runAsAgentToolCallEntry
detail: The internal request-context helper also marks its scope as an agent tool call, so the name now says so; it stays reserved for dispatchToolCall.
migration: replace imports of runAsDirectCallEntry from @cosmicdrift/kumiko-framework with runAsAgentToolCallEntry; the signature is unchanged
-->
