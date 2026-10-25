---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

The paid system check run gets its own button next to "Start check", the mail probe tests the platform sender when a tenant has no own mail provider, and tenant admins can connect an IMAP mailbox from the mail account list, which can then also send replies from its own address.

<!-- kumiko-changes
feature: types
type: improvement
title: projectionDetail takes inlineActions
detail: ProjectionDetailScreenDefinition.inlineActions lists action ids that stay visible buttons next to the primary action in the page header instead of folding into the "More actions" menu. Without it the header behaves as before. The phone header keeps its single icon button.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: The boot check validates inlineActions
detail: Every id in a projectionDetail inlineActions list must name a declared action (or edit when the screen has an edit target), the same rule as primaryAction; an unknown id fails the boot.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: The detail header keeps inlineActions as buttons
detail: HeaderActionsBar takes inlineActionIds and renders those actions as buttons after the primary action; only the remaining actions go into the overflow menu, and no menu is shown when none remain.
-->

<!-- kumiko-changes
feature: readiness
type: improvement
title: The paid run is a button next to Start check
detail: The system check screen declares run-paid-check as an inline action, so "Test AI extraction" shows as a button beside "Start check" instead of in the "More actions" menu. It stays hidden while the app has no paid probes.
-->

<!-- kumiko-changes
feature: channel-email
type: improvement
title: channel-email publishes its app transport
detail: channel-email declares the emailAppTransport extension and registers its app transport under it; findEmailAppTransport(registry) returns that transport, or null when the app has none or does not mount channel-email.
-->

<!-- kumiko-changes
feature: mail-foundation
type: improvement
title: The mail probe tests the platform sender
detail: A tenant without its own mail provider now gets the test mail through the channel-email app transport, the sender its tenant-transport notifications fall back to. The probe reports mail-foundation.probe.send-test-mail.platform-accepted on success and mail-foundation.probe.platform-send-rejected when the platform server rejects it; it is skipped only when neither an own provider nor an app transport exists, and mail-foundation.probe.not-configured now reads "No email sending set up". New keys in all locale packages.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: The mail account list links to the IMAP connect form
detail: mailAccountListScreen gets a "Connect mailbox" toolbar action that opens the screen mail-account-connect-imap. The button shows only when the app mounts inbound-provider-imap, which registers that screen. The Systemcheck fix link for inbound mail now leads to a list where a mailbox can be added.
-->

<!-- kumiko-changes
feature: inbound-provider-imap
type: improvement
title: IMAP mailboxes can be connected from a form
detail: The new write handler inbound-provider-imap:write:connect-mailbox (TenantAdmin, SystemAdmin, not exposed to the agent, 10 calls per tenant in 10 minutes) checks the IMAP login before the transaction, then creates a shared mail account and stores host, port, user and password in its credential secret in the same transaction. It always connects with implicit TLS (default port 993); there is no plaintext option, and a secure:false in the payload is ignored. A failed check stores nothing and answers with one of four texts: host not reachable or not allowed, login rejected, TLS failed, no connection. The form screen mail-account-connect-imap has a masked password field and no TLS toggle. New keys in all locale packages.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Apps can send from a connected mailbox
detail: The provider contract gets an optional send(ctx, account, message). The new server function sendMailFromAccount(ctx, { accountId, message }) is called from an app's own write handler and sends through the provider of the mailbox, with the mailbox address as From and In-Reply-To and References for replies. It returns WriteResult<{ messageIdHeader }>; failures are typed UnprocessableErrors with the reasons mail_send_not_configured, mail_send_login_rejected, mail_send_server_unreachable, mail_send_rejected and mail_send_invalid_message (i18n keys inboundMail.send.errors.*). A missing, disconnected or someone else's personal mailbox answers not found. There is no fallback to the app sender. New exports: sendMailFromAccount, MAIL_SEND_ERRORS, outboundMailMessageSchema, OutboundMailMessage, OutboundMailSent, MailSendNotConfiguredError, MailSendRejectedError. New keys in all locale packages.
-->

<!-- kumiko-changes
feature: inbound-provider-imap
type: improvement
title: IMAP mailboxes send over their own SMTP server
detail: The connect form gets an optional field "Outgoing server (SMTP)". Left empty, the IMAP host is used, with smtp. in place of a leading imap.. connect-mailbox now also checks the SMTP login on port 465 (implicit TLS, same user and password, same host guard) and answers a failure with its own text ("Receiving works, but sending does not: ..."). The credential document gains smtpHost and smtpPort (default 465). The provider implements send: it sends over SMTP with From = the mailbox address and display name, then stores the same message in the sent folder (special use \Sent, else Sent, Gesendet or INBOX.Sent); a failed copy is only logged. Accounts stored without smtpHost answer mail_send_not_configured. New keys in all locale packages.
-->

<!-- kumiko-changes
feature: foundation-shared
type: improvement
title: sanitizeMailDisplayName is shared
detail: The display-name sanitizer from channel-email moved to foundation-shared as sanitizeMailDisplayName, so the IMAP sender uses the same rule. No behavior change.
-->
