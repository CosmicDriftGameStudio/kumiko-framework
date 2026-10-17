---
"@cosmicdrift/kumiko-bundled-features": patch
---

A mail whose file attachment is missing fails at once instead of retrying

<!-- kumiko-changes
feature: channel-email
type: fix
title: A mail whose file attachment is missing fails at once instead of retrying
detail: A missing or foreign-tenant file ref ends the delivery attempt as failed (send_failed) without a retry. The send job no longer throws, so the idempotency key is released and the caller can resend. A template test mail whose template file is missing now answers not_sent instead of channel_error.
-->
