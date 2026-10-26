---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

A password IMAP mailbox with a sign-in error can be reconnected from the mail accounts list. The same account keeps its threads and sync cursor; only the credentials are replaced.

<!-- kumiko-changes
feature: inbound-provider-imap
type: improvement
title: IMAP mailboxes with a sign-in error can be reconnected
detail: The new write handler inbound-provider-imap:write:reconnect-mailbox (TenantAdmin, SystemAdmin, not exposed to the agent, 10 calls per tenant in 10 minutes) takes the account id plus host, port, user, password and the outgoing server, checks the IMAP and SMTP login like connect-mailbox, then overwrites the credential secret of the same account and sets it back to active in one transaction. A failed check changes nothing. It answers not found for an unknown account or one of another tenant, account_disconnected for a disconnected one and reconnect_not_password_imap for other providers. The form screen mail-account-reconnect-imap is prefilled by the query inbound-provider-imap:query:reconnect-prefill with the stored server settings, never the password. New keys in all locale packages.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: The mail account list offers Reconnect for accounts with a sign-in error
detail: A new row action Reconnect opens the screen mail-account-reconnect-imap of inbound-provider-imap. It shows for every account with status auth_error and, like the Connect mailbox button, only renders in apps that mount that provider. New export IMAP_RECONNECT_SCREEN_ID. New key in all locale packages.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Mailbox names are stored without surrounding spaces
detail: connect-account, update-account and inbound-provider-imap:write:connect-mailbox trim displayName before storing it, so a name pasted with a leading space no longer shows and sorts with it. connect-account still accepts an empty name as before; connect-mailbox still requires one. The port fields of the IMAP connect and reconnect forms show 993 or 13993 without digit grouping.
-->
