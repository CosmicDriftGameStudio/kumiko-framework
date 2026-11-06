---
"@cosmicdrift/kumiko-bundled-features": patch
---

Documents: a split `access` without `write` keeps creating limited to the admin roles.

<!-- kumiko-changes
feature: documents
type: fix
title: Split access without write no longer lets members file invisible documents
detail: With `access: { read, delete }` and no `write`, create fell back to TenantAdmin and TenantMember, so a member could file a document they could never see. Create now stays limited to the admin roles unless a write rule is set.
-->
