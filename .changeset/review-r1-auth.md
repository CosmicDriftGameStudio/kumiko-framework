---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

Auth review fixes: shared login membership gate, preview-login allowlist and audit logs, invite-accept error mapping.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Login membership gate shared, malformed answers and non-uuid ids handled, invite validation errors mapped per path
detail: The password login and `sessionForVerifiedUser` now share one status-and-membership gate. A malformed membership query answer returns a structured internal error instead of an uncaught ZodError, and `sessionForVerifiedUser` answers `invalid_credentials` for a non-uuid `userId`. The invite-accept screen shows the password-rejected text for a `validation_error` only on signup-complete, otherwise the generic invalid-input text. Preview login accepts only owners in status `active`, logs a warning when the route is mounted and an info line (user and tenant id, no key or signature) per minted session. Tests cover the userId lookup path, the exact restricted-account answer and the skipped and failed results of the deletion-executed mail.
-->
