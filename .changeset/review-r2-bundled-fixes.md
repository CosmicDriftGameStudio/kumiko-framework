---
"@cosmicdrift/kumiko-bundled-features": patch
---

Several bundled-feature fixes. The inbound-mail watch supervisor now stamps `tenantId` when it first saves a poll cursor, so cursors persist instead of failing on the NOT NULL column. The anonymous queries of managed-pages, template-resolver, seo, compliance-profiles and auth-email-password rate-limit per IP and handler, so one handler no longer drains the bucket of the others. The personal-access-token list loads up to the maximum page size without a pager that could not page. Serial host ids beyond int4 are denied as not found, and the notes forget hook resolves the tenant retention preset once.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Poll cursor is persisted with the account's tenantId
-->

<!-- kumiko-changes
feature: managed-pages
type: fix
title: Anonymous queries rate-limit per IP and handler instead of sharing one bucket
-->
