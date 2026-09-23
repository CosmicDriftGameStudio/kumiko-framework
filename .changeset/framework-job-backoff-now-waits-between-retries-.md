---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Job backoff now waits between retries: backoff defaults to a 1000 ms base delay and accepts { type, delayMs } (fw#3167)

Previously, jobs with backoff set retried immediately: BullMQ received only { type } with no delay, and its fixed/exponential strategies compute NaN/undefined without one (falsy, so no wait). Now "fixed" waits a constant 1000 ms and "exponential" waits 1000/2000/4000 ms... between attempts by default. Jobs with a high retries count will therefore take noticeably longer to reach their final failure. A new object form, backoff: { type, delayMs }, lets a job configure its own base delay instead of the 1000 ms default.

<!-- kumiko-changes
feature: framework
type: fix
title: Job backoff now waits between retries: backoff defaults to a 1000 ms base delay and accepts { type, delayMs } (fw#3167)
-->
