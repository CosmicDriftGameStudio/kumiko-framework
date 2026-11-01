---
"@cosmicdrift/kumiko-bundled-features": patch
---

IMAP mailboxes on a host name connect again: the pinned address no longer blanks the TLS server name.

<!-- kumiko-changes
feature: inbound-provider-imap
type: fix
title: IMAP polling works again for mailboxes given as a host name
detail: Since 0.393 the host guard resolves every host name to its IP, and the IMAP client then overrode the TLS `servername` with undefined, so the certificate was checked against the IP and every poll ended in InboundTransientError. The pinned host name now goes to tls as the servername; IP-literal hosts still connect without SNI. SMTP was not affected: nodemailer receives the original name as `servername`.
-->
