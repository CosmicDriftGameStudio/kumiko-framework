---
"@cosmicdrift/kumiko-framework": patch
---

The job runner passes the credentials and TLS setting from REDIS_URL to its queue and lock connections.

<!-- kumiko-changes
feature: framework
type: fix
title: Job runner connects to a password-protected Redis
detail: parseRedisOpts kept only host, port and db of REDIS_URL, so BullMQ queues and the sequential lock connected without the password and the app stopped at boot with "Redis not reachable" against a Redis that requires auth. Username, URL-encoded password and rediss:// TLS are now carried over.
-->
