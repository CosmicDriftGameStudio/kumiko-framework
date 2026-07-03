---
"@cosmicdrift/kumiko-bundled-features": patch
---

user-data-rights-defaults now registers EXT_USER_DATA export/delete hooks for six more bundled entities: user-session (ip/userAgent), api-token, in-app-message, tenant-invitation, notification-preference and user-scoped config-value. Hooks no-op when the source feature isn't mounted. pii annotations added on the affected schema fields.
