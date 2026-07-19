---
"@cosmicdrift/kumiko-server-runtime": minor
---

runProdApp now sends default security headers on every response: HSTS
(`max-age=31536000; includeSubDomains`), `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff` and `Referrer-Policy:
strict-origin-when-cross-origin`. A Content-Security-Policy default is
opt-in via the new `securityHeaders.csp` option. Headers a response
already set (e.g. hostDispatch's per-host CSP) are never overridden;
`securityHeaders: false` disables the block, the object form overrides
or disables individual headers.
