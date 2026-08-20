---
"@cosmicdrift/kumiko-framework": patch
---

Fix `UnprocessableError` (and `failUnprocessable`) so the positional `reason` slug always wins over a same-named `reason` key inside `opts.details`. Previously a caller passing `details: { reason: ... }` — e.g. to attach a cause message — silently overwrote the stable reason slug, corrupting `reasonSlug`/`docsUrl` and leaking raw error text as `details.reason` in the wire response. Callers that want to attach a cause message should use `opts.cause` instead of `details.reason`.
