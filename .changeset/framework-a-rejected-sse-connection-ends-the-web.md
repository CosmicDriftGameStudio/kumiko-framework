---
"@cosmicdrift/kumiko-renderer-web": patch
---

A rejected SSE connection ends the web session

When the server refuses the live-events EventSource with a session 401, createKumikoApp now raises the same session-ended signal as a 401 from the dispatcher, so the user sees the session-end notice instead of silently losing live updates.

<!-- kumiko-changes
feature: framework
type: fix
title: A rejected SSE connection ends the web session
-->
