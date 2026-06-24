---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

HTTP-cache hardening + load reduction for the public-page caches (follow-up to the cache helpers in #630).

- **`cachedResponse`: `If-None-Match` now decides alone.** Per RFC 7232 §3.3 a present `If-None-Match` makes `If-Modified-Since` irrelevant. Previously a mismatching ETag fell through to the `If-Modified-Since` branch and could still return a stale `304`. Benign in the current call sites (static ETags are mtime+size based, revision routes carry no `last-modified`), but now correct: ETag present → ETag alone.
- **Multi-tenant `index.html` is served with `Vary: Host`.** `runProdApp`'s `hostDispatch` path picks the HTML file per Host and serves it `public`. Without `Vary: Host` a shared cache could key only on the URL; only the `max-age=0, must-revalidate` + per-Host ETag kept it from leaking one tenant's schema-injected shell to another. `Vary: Host` makes the isolation explicit instead of incidental, matching `managed-pages`.
- **`legal-pages` / `managed-pages` cache for 60s.** Both served `public, max-age=0, must-revalidate`, so every request hit the origin to revalidate — and each `304` re-ran the content (and branding) query just to recompute the revision ETag. They now use `public, max-age=60, must-revalidate`: CDN/browser serve fresh for 60s without an origin round-trip, edits go live within 60s.
