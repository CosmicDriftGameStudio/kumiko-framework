---
"@cosmicdrift/kumiko-bundled-features": patch
---

Server-rendered public pages forbid form submissions to other origins.

<!-- kumiko-changes
feature: page-render
type: improvement
title: Public page CSP adds form-action 'self'
detail: The content security policy of legal pages, managed pages and the contract termination pages now ends with `form-action 'self'`. Markup that slips into a page can no longer post a form to a foreign site; the termination forms post to their own path and keep working.
-->
