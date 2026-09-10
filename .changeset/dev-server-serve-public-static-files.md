---
"@cosmicdrift/kumiko-dev-server": patch
---

Fix `createKumikoServer` 404ing on static assets under `public/` (e.g. `/marketing/hero.png`). The dev-server's SPA catch-all only handled dot-less paths, so any dotted request that wasn't the client bundle fell straight through to the API stack and 404ed — this worked in prod (`buildStaticFallback`'s disk lookup) but not dev.

Dotted GET/HEAD requests outside `/api/` and `/sse` now try the Hono app first (an `r.httpRoute` can still own a dotted path), then fall back to a file under `<cwd>/public/`, then the router-miss 404 — mirroring the SPA branch's Hono-first order. The path is decoded and resolved against `publicDir` with a containment check (blocks both literal `..` and the `%2e%2e%2f` encoded-slash vector, which `new URL()` doesn't normalize on its own), plus a `realpath`-based check after the read so a symlink inside `public/` can't point outside it.
