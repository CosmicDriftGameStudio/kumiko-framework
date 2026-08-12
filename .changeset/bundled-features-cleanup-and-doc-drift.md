---
"@cosmicdrift/kumiko-bundled-features": patch
---

`template-resolver`'s feature description now mentions `markdown` as a supported `contentFormat` alongside `plain`/`rich` — it was already handled at runtime but missing from the docs.

Also: `form-draft`'s empty `i18n.ts` (an unused, always-empty translation table) and its now-dead `r.translations()` registration are removed; no behavior change.
