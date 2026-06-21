---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-framework": patch
---

fix(user-data-rights): logged-in export download no longer returns 403 csrf_token_mismatch

The privacy-center download was a plain `<a href>` to the `by-job` httpRoute, which
re-dispatched an internal `POST /api/query` carrying only the auth cookie (no
`X-CSRF-Token` header) — so the CSRF double-submit check rejected it with 403. The
download now goes through the dispatcher via a new `postWithDownload` helper
(`@cosmicdrift/kumiko-renderer-web`), which carries the CSRF token like every other
authenticated request and navigates to the returned signed URL. The `by-job`
httpRoute and its header-forwarding are removed; `download-by-job` reads the audit
IP from the server-trusted request context instead of a client-supplied payload.
