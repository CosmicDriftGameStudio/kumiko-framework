---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

Imported mails keep their full text, the original and their attachments. A mail the provider cannot parse no longer blocks a mailbox, a mailbox that stops syncing says so, a disconnected mailbox can come back without duplicates, and a new or reactivated mailbox syncs right away.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Imported mails store full text, original and attachments
detail: ingest-message now takes bodyText (at most 32,000 characters, cut with bodyTextTruncated set; 32,000 keeps a long mail readable while one event, one projection row and the PII-encrypted column stay small, the original keeps everything), rawMime, bodyHtml, attachments (at most 50) and skippedAttachments (at most 200). The original is stored as .eml (or .html for HTML-only mails) and each attachment as a file reference through file storage; apps without a file provider still import the mail, mark contentState unavailable and show the mailbox as interrupted. The event inbound-message-received is now v2 with an upcast that defaults the new fields; bodyText is personal tenant data. The new query inbound-mail-foundation:query:message:content returns text, original reference and attachments of one mail; message:list never carries the body. Retention removes the mail row but keeps attachment files. RawInboundMessage gains text, html, attachments and skippedAttachments.
-->

<!-- kumiko-changes
feature: inbound-provider-imap
type: improvement
title: The IMAP provider reads text, HTML and attachments
detail: The provider parses full mails. Inline images are skipped, forwarded message/rfc822 mails are unpacked up to depth 3, and the limits are 25 MB per attachment, 50 MB per mail and 50 attachments; everything skipped is reported in skippedAttachments with its reason. The new plugin method fetchContent reloads the content of a mail by provider id.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: A mail that cannot be parsed is quarantined instead of blocking the mailbox
detail: A mail the provider reports as rejected, or whose ingest fails, is normalized where possible and otherwise stored in the unmanaged table store_mail_quarantine; every message is isolated in the supervisor, so the rest of the batch imports and the sync cursor moves on. An ingest failure only counts against a mail once a later mail of the batch succeeded, and the third counted failure quarantines it as ingest_failed; an outage of the database, KMS or file storage never quarantines good mail and never moves the cursor past an unhandled mail. The account list shows quarantinedCount and lastError, the new handler acknowledge-quarantine confirms the entries, acknowledged entries are purged by retention after 90 days, and the tenant-destroy hook removes them.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: A mailbox that stops syncing shows as interrupted with a reason
detail: The account events mail-account-connected and mail-account-updated are v2 with lastError (connection_failed, rate_limited, message_quarantined, file_storage_unavailable). Three failed polls in a row set the status degraded, shown as Unterbrochen in German; the next successful poll sets it back to active. New key in all locale packages.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: A disconnected mailbox is reactivated under the same account
detail: The new handler reactivate-account puts a disconnected mailbox back to active with its stream and sync cursor, so no mail is imported twice. connect-account refuses an address that is already connected (address_already_connected) or disconnected (address_disconnected) and reopens a disconnected OAuth mailbox in place; connect-routes answers 409 with the reason. reconnect-mailbox now also accepts a disconnected account.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Snippet-only mails get their content reloaded
detail: Mails imported before this change carry only a snippet. The supervisor asks the provider for their content through fetchContent and stores it with attach-message-content (event inbound-message-content-fetched v1); a mail the server no longer has becomes unavailable and is not asked for again.
-->

<!-- kumiko-changes
feature: inbound-provider-imap
type: fix
title: IMAP and SMTP hosts given as IP addresses connect over TLS
detail: imapflow passes servername false for an IP literal, which Bun's TLS rejects, so such mailboxes could not connect. The IMAP client now sets an undefined servername; nodemailer already omits it for SMTP.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Connected, reconnected and reactivated mailboxes sync immediately
detail: A per-instance event consumer wakes the supervisor on a new or active-again mailbox, which syncs once right away instead of waiting for the next poll. A sync of one account never runs twice at the same time. A woken sync that finds the credential not stored yet (the OAuth secret is written after the account) sets no status and leaves it to the next tick; stop() waits for running syncs.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: The first sync after an OAuth connect no longer waits for the next poll
detail: The OAuth callback now dispatches the internal handler mark-credential-stored once the refresh token is saved, so the sync that the account commit triggers earlier than the token is repeated as soon as the credential exists. Originals above 50 MB are not stored; they are listed in skippedAttachments as message/rfc822 with reason too_large while text and attachments are kept. attach-message-content no longer accepts a caller-supplied bodyRef.
-->
