---
"@cosmicdrift/kumiko-framework": patch
---

API handler rejections (4xx) now leave a log line instead of being silently dropped

`logServerFault` returned early for every `httpStatus < 500`, so a failing request (validation, unprocessable, rate-limited) left no log trace at all — a paid external call that 422'd was invisible end to end (offlot#117). 4xx now log on `warn` via the same fallback logger 5xx already used, with status, error code and duration only — no message, details, stack or cause, so submitted values never reach the log line. 5xx behavior on the `error` level is unchanged.

Consumers that set `LOG_LEVEL=error`, `fatal` or `silent` suppress the new 4xx lines; anything else (including the default) now logs them. Expect more log volume on routes with frequent client-side validation failures.

<!-- kumiko-changes
feature: framework
type: fix
title: API handler rejections (4xx) now leave a log line instead of being silently dropped
-->
