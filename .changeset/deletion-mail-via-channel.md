---
"@cosmicdrift/kumiko-bundled-features": patch
---

The deletion-executed mail goes through the email channel

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: The "account deleted" mail is sent through channel-email when delivery is mounted
detail: The default mailer for the Art. 17 deletion confirmation called createTransportForTenant directly, which threw for a tenant without its own mail provider. With delivery and channel-email mounted it now sends through the email channel like the other GDPR mails, over the app transport, without writing a delivery-attempt row for the already erased user. Without channel-email the previous path stays.
-->
