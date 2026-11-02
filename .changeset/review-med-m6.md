---
"@cosmicdrift/kumiko-bundled-features": patch
---

Agent manifest labels resolve regional locales, the system check run is rate limited, and managed-pages no longer pulls tiptap into its client bundle.

<!-- kumiko-changes
feature: agent-tools
type: fix
title: agent manifest labels resolve regional locales
detail: `pickLabel` only matched the exact locale key, so a caller passing `de-DE` got English labels for every entity, field, nav and screen. It now tries the base language (`de`) before the English fallback.
-->

<!-- kumiko-changes
feature: readiness
type: fix
title: system check runs are rate limited per user
detail: `readiness:write:run-probes` sends a real test mail and logs in to every mailbox per run; the single-active-run lock only bounded concurrency. It now allows 10 runs per user and hour.
-->

<!-- kumiko-changes
feature: managed-pages
type: fix
title: managed-pages client bundle no longer loads tiptap at start
detail: The link policy helpers moved from `document-schema.ts` into the tiptap-free `document-link-policy.ts` (re-exported from `document-schema.ts`), so `markdown-to-document.ts` stays out of the editor chunk. A test guards the static import closure.
-->
