---
"@cosmicdrift/kumiko-bundled-features": patch
---

Removed unused AuthHandlers.inviteCancel constant

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Removed unused AuthHandlers.inviteCancel constant
detail: AuthHandlers.inviteCancel pointed at auth-email-password:write:invite-cancel, a handler that never existed. The constant is removed.
migration: If you referenced AuthHandlers.inviteCancel, use tenant:write:cancel-invitation.
-->
