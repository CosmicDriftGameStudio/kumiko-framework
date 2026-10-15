---
"@cosmicdrift/kumiko-dispatcher-live": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

dispatcher-live validates server envelopes with Zod

<!-- kumiko-changes
feature: dispatcher-live
type: improvement
title: dispatcher-live validates server envelopes with Zod
detail: Query, write, batch and stream responses are parsed against Zod schemas for the envelope (isSuccess, error, failedIndex, results); the data payload stays typed by the caller. A malformed envelope now yields the network_error fallback ("unexpected response shape") instead of passing wrongly typed fields through; bare gate errors ({ error } from csrf, origin, auth or rate limits) keep their code, and a missing i18nKey defaults to errors.unknown; a malformed SSE error frame yields stream_error, and failing batch items get httpStatus filled from the response like top-level errors. renderer-web types CSS custom properties on React's CSSProperties instead of casting style objects.
-->
