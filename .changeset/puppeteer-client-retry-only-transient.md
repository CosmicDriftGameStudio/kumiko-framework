---
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

Render requests retry only network errors, 502 and 503, and the timeout covers the body

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: fix
title: Render requests retry only network errors, 502 and 503, and the timeout covers the body
detail: A 500 or 504 from puppeteer-service is a final RendererError with code other instead of being retried up to maxRetries times, and a client timeout abort is final too, so a failing or slow render no longer starts parallel renders on the service. The request timer now runs until the response body is read, so a service that stalls after the headers cannot block the caller forever.
-->
