---
"@cosmicdrift/kumiko-bundled-features": patch
---

Review fixes: a mail sent from an IMAP mailbox reports the recipients the outgoing server refused, and reconnecting a mailbox through the owner form no longer clears the tenant's sender-check id.

<!-- kumiko-changes
feature: inbound-mail
type: fix
title: partial recipient refusal and sender-check id on reconnect
detail: `sendMailFromAccount` returns `rejectedRecipients` when the outgoing server accepts the mail for some recipients and refuses others; before, nodemailer's partial refusal was dropped and the send counted as fully delivered. `reconnect-mailbox` only writes the sender-check id when the payload carries the field, so an admin reconnecting a mailbox through the "My mail accounts" form keeps the stored id; the admin form clears it by sending an empty string.
-->
