---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-samples": patch
---

The helpdesk recipe shows the browser client as a same-origin script and lists `notes-history` among the required features.

<!-- kumiko-changes
feature: helpdesk
type: fix
title: helpdesk recipe: client script same-origin, notes-history listed as required
detail: The recipe comment embedded `/helpdesk/client.js` from another origin, but the client posts to the relative paths `/api/query` and `/api/write` without cookies, so the page has to share the app's origin or forward `/api` to the app on its own origin. The recipe and its README now say so and list `notes-history` with `config`, `delivery`, `user-data-rights` and `files` as required features.
-->
