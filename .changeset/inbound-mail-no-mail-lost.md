---
"@cosmicdrift/kumiko-bundled-features": minor
---

A poison mail no longer blocks the mailbox, quarantined mails get a way back, and attachments are uploaded before the transaction.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Failing ingests are counted and a poison mail is quarantined after three intervals
detail: The supervisor counts an ingest failure once per poll interval in the unmanaged table store_mail_ingest_failures, but only when another mail of the account went through in the same poll (for a storage failure another storage write); at three it quarantines the mail with reason ingest_failed and moves the cursor on, before that the batch stops and nothing behind it is skipped. A failure nothing proves to be the mail's (KMS, file storage, the app's storeBody hook, the ingest handler or projection failing for every mail) counts nothing (a mail counted before as a storage or ingest failure keeps counting when it is the only failure), keeps the cursor and sets the account to degraded with lastError encryption_unavailable, file_storage_unavailable or ingest_unavailable; the next interval retries. A requested quarantine retry also runs while the cursor is held. Every quarantined mail also gets a header-only entry (contentState unavailable, contentUnavailableReason quarantined).
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
detail: Both events carry contentUnavailableReason (null for older events through upcasters). The read table read_inbound_messages gets content_unavailable_reason, store_mail_quarantine gets retry_requested_at, and store_mail_ingest_failures is new; generate and apply a migration with `kumiko-schema generate`. ingest-message and attach-message-content upload files before their transaction when called at top level, and attach-message-content skips the upload when the mail already shows its content; inside a wrapper handler's transaction they upload in it, as before. RejectedInboundMessage may carry rawMime and headers, and an inbound provider's fetch may take filterUnknownMessageIds to skip mails that are already known.
migration: |
  Run `kumiko-schema generate` and apply the migration; read_inbound_messages is rebuilt from events because attachment_file_ids becomes jsonb. Consumers that read the event payloads type them against the new versions (upcasters fill contentUnavailableReason with null). To get the pre-transaction upload, trigger on inbound-message-received or inbound-message-content-fetched instead of wrapping ingest-message in an own write handler.
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
detail: list-accounts returns reactivateVia per mailbox (password_form, oauth_flow or null) for a disconnected mailbox or one with a sign-in error, set only for the owner of a personal mailbox and for admins of a shared one. The mailbox list shows Reactivate for password_form; the new dormant screen my-mail-accounts (MY_MAIL_ACCOUNT_LIST_SCREEN_ID, role User) and the admin list show Reactivate for oauth_flow as the client action inbound-mail-foundation:reconnect-oauth, which goes through GET /api/inbound-mail/connect and the callback again and reopens the mailbox under its old id; apps mount it with inboundMailFoundationClient() from inbound-mail-foundation/web. The callback also reopens an OAuth mailbox with a sign-in error. reactivate-account admits role User, gated by the owner rule for personal mailboxes, and requires a credential for disconnected, auth_error and degraded alike. set-trusted-authserv-id is a tenant security policy: only SystemAdmin and TenantAdmin change it, on every mailbox of the tenant including personal ones. The connect route answers 403 shared_mailbox_requires_admin when a user without admin role starts the shared flow. The row action Reconnect is folded into Reactivate (see the breaking entry). The connect-mailbox form reopens a disconnected shared IMAP mailbox of the same address under its old account id with the new password. For anything else connect-account answers with a text pointing to Reactivate, and credential_required from reactivate-account is a plain-text message. A new i18n key set (de, en, fr, es, it) is part of the locale packages.
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
