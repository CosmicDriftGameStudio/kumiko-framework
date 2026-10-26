---
"@cosmicdrift/kumiko-bundled-features": minor
---

A poison mail no longer blocks the mailbox, quarantined mails get a way back, and attachments are uploaded before the transaction.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Failing ingests are counted and a poison mail is quarantined after three intervals
detail: The supervisor counts an ingest failure once per poll interval in the unmanaged table store_mail_ingest_failures; at three it quarantines the mail with reason ingest_failed and moves the cursor on, before that the batch stops and nothing behind it is skipped. A file storage outage counts nothing and keeps the cursor. Every quarantined mail also gets a header-only entry (contentState unavailable, contentUnavailableReason quarantined).
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Quarantined mails can be retried
detail: The write handler retry-quarantined-message (mailbox owner or admin) flags a quarantine entry; the next successful sync loads the mail again, attaches the content to the header entry or ingests it in full, and removes the entry.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: breaking
title: inbound-message-received is v3 and inbound-message-content-fetched is v2
detail: Both events carry contentUnavailableReason (null for older events through upcasters). The read table read_inbound_messages gets content_unavailable_reason, store_mail_quarantine gets retry_requested_at, and store_mail_ingest_failures is new; generate and apply a migration with `kumiko-schema generate`. ingest-message and attach-message-content upload files before their transaction when called at top level; inside a wrapper handler's transaction they upload in it, as before. RejectedInboundMessage may carry rawMime and headers, and an inbound provider's fetch may take filterUnknownMessageIds to skip mails that are already known.
-->

<!-- kumiko-changes
feature: inbound-provider-imap
type: improvement
title: The IMAP cursor follows UIDs and skips known mails
detail: lastUid is derived from the fetched UIDs, so a quarantined or already known mail at the end of a full batch no longer holds the cursor back or gets fetched again; the envelope is read so a mail the parser throws on still gets its header entry. A forwarded mail that cannot be parsed is kept as an attachment instead of failing the whole mail.
-->
