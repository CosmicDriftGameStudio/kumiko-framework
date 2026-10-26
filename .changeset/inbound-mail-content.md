---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
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

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Outgoing mail carries attachments
detail: sendMailFromAccount takes attachmentFileIds (at most 10 file references of the caller's tenant, at most 18 MB together, duplicates dropped). The bytes are read through file storage and sent over SMTP and stored in the sent folder unchanged; an unknown or foreign file gives mail_send_attachment_invalid, too many bytes mail_send_attachments_too_large, and nothing is sent. The plugin method send now receives the resolved attachments as a fourth argument and returns ProviderSentMail. New keys in all locale packages.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: A hanging mailbox no longer blocks the others
detail: The supervisor syncs up to 4 accounts at the same time (pollConcurrency), skips an account whose previous sync is still running, and abandons a sync after 10 minutes (accountPollDeadlineMs) as one failed poll; plugin.fetch and plugin.fetchContent receive an AbortSignal, and an abandoned sync stores nothing and moves no cursor. The IMAP client sets connection (20 s) and greeting (16 s) timeouts explicitly.
-->

<!-- kumiko-changes
feature: jobs
type: improvement
title: r.job event triggers can catch up on stored events
detail: trigger { on, catchUp: true } gives the job its own event consumer job:<jobQn> that starts at the beginning of the event store, so events from before the job existed run it too, once per event (job id derived from job QN and event id). Every "on" entry must be an r.defineEvent event, otherwise boot fails. The job is no longer fired by the shared job-trigger consumer. JobRunner gains handleCatchUpEvent.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Sender authentication (SPF, DKIM, DMARC) of imported mails
detail: inbound-message-received v2 carries senderAuthentication ({ authservId, spf, dkim, dkimDomains, dmarc, fromDomain } or null; verdicts pass, fail, none, unknown; dkimDomains at most 10), stored as JSON text in read_inbound_messages.sender_authentication and returned by message:content and loadInboundMessageContent; isSenderAuthenticated is true only for a dmarc pass. The mail account has a new optional trustedAuthservId (events mail-account-* v2, read_mail_accounts.trusted_authserv_id, input of connect-account, update-account, reactivate-account and the IMAP connect and reconnect forms). Only the first Authentication-Results header from the top whose authserv-id equals it counts; without an id, without such a header or when its header.from domain differs from the From domain the result is null, and a dmarc result without header.from is unknown. Headers below the trusted one are ignored, so a sender cannot inject a pass. Mails imported before, and content refetched later, have null. New keys in all locale packages.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: breaking
title: Mail account handlers are stricter and the trusted authserv-id has its own handler
detail: trustedAuthservId is no longer accepted by connect-account, update-account and reactivate-account (strict schemas reject unknown keys); set it with the new set-trusted-authserv-id (SystemAdmin, TenantAdmin, not model-callable). update-account accepts status, lastError, watchState and reason only from the system identity; connect-account is no longer exposed to agents. reactivate-account checks the account owner (unless the OAuth override is set), fails with credential_required when a password account has no stored credential, and reopens an account in place only with that override; disconnect-account deletes the stored secret. Outgoing attachments must pass the file read check of the sender, and SendMailFromAccountContext needs dispatch. New screen "Absenderprüfung" edits the id. The watch supervisor and the IMAP forms use mapWithConcurrency and implicit TLS on port 465 for SMTPS.
-->
