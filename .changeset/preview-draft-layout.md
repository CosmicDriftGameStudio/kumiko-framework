---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

Previews of an unsaved PDF template now show a tenant letterhead (also the tenant default letterhead) in its working version, so a layout that is still a draft (or has an open draft) is no longer replaced by the system layout. Sending and rendering stored templates are unchanged.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: PDF preview shows a draft letterhead
detail: A preview that carries draft content resolves the tenant's own PDF layout in its working version, including layouts that were never published, instead of falling back to the system layout. `resolveLayout` takes an optional `working` flag for this; system layouts always resolve to their active version and real renders are unchanged.
-->
