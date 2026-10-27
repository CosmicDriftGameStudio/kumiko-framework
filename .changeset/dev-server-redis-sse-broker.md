---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-testing": patch
---

Live updates from a separate worker process now reach the dev-server browser.

<!-- kumiko-changes
feature: dev-server
type: fix
title: Live updates from a separate worker process reach the dev-server browser
detail: The dev server always used an in-memory SSE broker, so it never subscribed to Redis. When a separate worker process won the shared event cursor it published live signals to Redis, and they never reached the browser. The dev server now uses the Redis-backed broker when REDIS_URL is set, and setupTestStack accepts an optional sseBroker. Its channels are prefixed per boot (KUMIKO_REDIS_CHANNEL_PREFIX if set, otherwise derived from the dev DB mode), so parallel dev servers on one Redis stay apart; a separate worker must set the same KUMIKO_REDIS_CHANNEL_PREFIX (the handle exposes it as sseChannelPrefix).
-->
