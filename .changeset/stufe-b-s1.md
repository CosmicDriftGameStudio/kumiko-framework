---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Production logging and shutdown hardening: one process logger with redaction and request context, a client-error endpoint, a required trusted-proxy setting, fatal-error handlers, a graceful server stop, fail-open rate limits during a Redis outage and masked delivery-log addresses.

<!-- kumiko-changes
feature: logging
type: improvement
title: Process logger, request context fields and redaction
detail: runProdApp and runWorkerApp install a pino process logger (JSON in production) that every createFallbackLogger without an explicit logger resolves lazily, with a component field. Log lines carry requestId, correlationId, tenantId, userId, feature and handler from the request context; jobs carry tenantId and userId too. Keys such as password, token, secret, apiKey, authorization, cookie, iban and email are redacted to [redacted] up to depth 2. New scrubLogText masks e-mail addresses and Postgres key details in server-fault, job-failure and client-error logs.
-->

<!-- kumiko-changes
feature: api
type: improvement
title: POST /api/client-errors collects browser error reports
detail: Anonymous endpoint with a strict body (errorId, kind, message, stack, screen, path, buildVersion), an 8 KB cap (413), 400 without echo, a per-IP limit of 10 per minute (429) and 204 on success. The report is logged as a scrubbed warning; the query and hash of the path are cut. With a session the report carries tenantId and userId.
-->

<!-- kumiko-changes
feature: server-runtime
type: breaking
title: runProdApp requires trustedProxyHops in production
detail: In production runProdApp refuses to boot when neither the trustedProxyHops option, the auth option nor KUMIKO_TRUSTED_PROXY_HOPS is set. An explicit 0 is allowed. create-kumiko-app templates write KUMIKO_TRUSTED_PROXY_HOPS=0 into .env.example.
migration: set KUMIKO_TRUSTED_PROXY_HOPS=<hops> (0 when the app is exposed directly) or pass trustedProxyHops
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Fatal-error handlers and graceful server stop
detail: New installFatalErrorHandlers logs uncaughtException and unhandledRejection, stops the app and exits 1 (hard exit after 10 s). runProdApp and runWorkerApp install it. The HTTP server stop is awaited against a 10 s grace period and then forced before the database closes.
-->

<!-- kumiko-changes
feature: rate-limit
type: improvement
title: Global IP and http-route limits fail open when Redis is down
detail: The l1-global-ip and http-route limits let the request through on a Redis error instead of answering 503, count it in kumiko_rate_limit_fail_open_total{label} and log a warning at most every 30 s. The l2-auth-endpoints and login/MFA limits stay fail-closed. A Redis client that is not ready fails fast instead of waiting for the command timeout. Redis connection loss and recovery are logged once per state change. The option onFailClosed of globalIpRateLimit and httpRouteRateLimit is now onFailOpen (plus meter).
-->

<!-- kumiko-changes
feature: auth
type: improvement
title: Warning when the login limiter falls back to memory in production
detail: The in-memory login and MFA rate limiter logs one warning per process in production, because its limits are per replica.
-->

<!-- kumiko-changes
feature: delivery
type: fix
title: delivery-log projection masks the recipient address
detail: The inline projection now masks the address with the same helper as the write path, also on rebuild, so legacy events with a full address no longer reach the attempt log. Already masked addresses and connection-name channels stay unchanged. Swallowed errors in the snapshot save, queue-depth poll and channel pre-resolve now log a scrubbed warning.
-->
