---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

`deps`: hono range raised to `^4.12.27` — the floor that carries the fixes for three advisories on the production HTTP layer: cross-request data disclosure in `hono/jsx` (context not isolated per request), server-side XSS via a JSX escaping bypass in `cx()`, and a dropped repeated request header in the API-Gateway v1 adapter. The old `^4.12.18` allowed the patched versions but the lockfile sat on 4.12.25, so the range now states the security floor instead of relying on resolution luck.
