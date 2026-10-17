---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

Template preview size budget and draft scope

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Template preview counts encoding overhead and reports missing attachments
detail: The mail size estimate counts base64 size plus a fixed per-part overhead, an attachment whose file reference is missing fails the resources_resolved check, and the document draft scope is derived once per request.
-->
