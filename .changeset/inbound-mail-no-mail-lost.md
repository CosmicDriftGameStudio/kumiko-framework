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

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: A watch that starts during a sync catches up on mail that arrived before it opened
detail: After a successful watch start the supervisor runs one catch-up poll (after a running sync finished), and a tick also starts the watch while the account is still syncing. Mail delivered between the last poll and the watch opening is imported without waiting for the poll interval. The watch start is idempotent per account.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Exports for consumers of content events and attachment names
detail: INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_QN, its payload type and schema, and readableFileName({ id, fileName }) are exported from the feature index, so an app can react to fetched content and show decrypted attachment names.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Reactivate a disconnected mailbox from the mailbox list
detail: The mailbox list has a row action Reactivate for a disconnected mailbox (list-accounts returns canReactivate: the owner for a personal mailbox, any admin for a shared one); Reconnect is shown only for sign-in errors. The connect-mailbox form reopens a disconnected shared IMAP mailbox of the same address under its old account id with the new password. For anything else connect-account answers with a text pointing to Reactivate, and credential_required from reactivate-account is a plain-text message. A new i18n key set (de, en, fr, es, it) is part of the locale packages.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Quarantined mails are listed with sender and subject and handled one by one
detail: The query quarantine:list and the dormant screen mail-quarantine show the open entries of the mailboxes the caller may manage, with sender and subject from the header-only import (empty without one), reason and date; row actions fetch a mail again or confirm it. acknowledge-quarantine takes an optional providerMessageId (without it all entries of the mailbox as before) and now also admits the owner of a personal mailbox (role User). The mailbox list gets a row action Quarantine for mailboxes with open entries.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Mail attachments are bound to the mail and follow its visibility
detail: The attachment fileRefs of an imported mail are bound to the inbound-message record (field attachmentFileIds). GET /files/:id answers with the mail's visibility: owner and admins for a personal mailbox, whoever may see the mail for a shared one. The new query inbound-message:detail ({ id }) backs that check and is not exposed to agents. Outbound attachments use the same rule (canCallerReadFileRef). Retention now also removes the attachment files of a purged mail. read_inbound_messages.attachment_file_ids is jsonb; the migration 0056 carries a table rebuild marker, so the read table is rebuilt from the events. InboundMessageContent.attachmentFileIds stays string[].
-->
