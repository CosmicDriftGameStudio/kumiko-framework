---
"@cosmicdrift/kumiko-renderer-web": patch
---

`styles.css`'s Tailwind `@source` scan was missing `bundled-features` entirely, so any app that only imports `@cosmicdrift/kumiko-renderer-web/styles.css` (without its own extra `@source` lines, the workaround `publicstatus` already had to add) shipped unstyled utility classes for every bundled-features web component — `LoginScreen`, the admin shell, MFA and PAT screens, and others. The pre-existing `renderer` scan line was also silently broken for real (non-workspace) consumer installs, since it targeted the unscoped package name (`renderer`) instead of the registry name (`kumiko-renderer`) that actually exists under `node_modules/@cosmicdrift/`.

Both sibling packages are now scanned with two `@source` variants each — one for the workspace layout (bun-symlinked, resolves via realpath to the unscoped package dir) and one for a real standalone consumer install (scoped registry name) — so classes from `bundled-features` and `renderer` are generated in both layouts without app-side workarounds. Apps that added their own `@source` lines for `bundled-features` (e.g. `publicstatus`) can drop them; the scan now happens once here.
