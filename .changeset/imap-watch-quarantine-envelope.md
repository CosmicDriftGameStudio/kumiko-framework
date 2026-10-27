---
"@cosmicdrift/kumiko-bundled-features": patch
---

A mail the IMAP watch quarantines keeps its sender and subject.

<!-- kumiko-changes
feature: inbound-provider-imap
type: fix
title: A mail the IMAP watch quarantines keeps its sender and subject
detail: The live watch fetched new mails without the IMAP envelope, so an unparseable mail it quarantined showed no sender and no subject in the quarantine list. The watch now fetches the envelope like the poll does.
-->
