---
"@cosmicdrift/kumiko-renderer-web": patch
---

`createKumikoApp`'s fallback landing-route selection (`firstOpenScreenQn`) now also requires the candidate screen be reachable via `r.nav`, not just free of a role restriction. Previously a dormant `type: "custom"` screen a feature registers only for manual app-side placement (e.g. `auth-mfa`'s enable screen) could win the fallback by declaration order alone, landing apps without an explicit `screenQn` on a screen nobody wired a client component for (#1258). Apps that rely on the implicit fallback and have no open, nav-placed screen now get a clear boot-time error instead of a silent broken render.
