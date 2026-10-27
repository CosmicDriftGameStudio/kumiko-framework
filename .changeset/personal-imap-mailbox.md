---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

Members connect a personal IMAP mailbox themselves.

<!-- kumiko-changes
feature: inbound-provider-imap
type: improvement
title: Members connect a personal IMAP mailbox from "My mail accounts"
detail: The new write handler inbound-provider-imap:write:connect-my-mailbox (every mail member role, not exposed to the agent, 10 calls per user in 10 minutes) takes the connect-mailbox fields without trustedAuthservId, checks the IMAP and SMTP login first and creates a mailbox owned by the caller. A disconnected personal mailbox of the caller with the same address is reactivated under its old account id; an address that belongs to another user or to a shared mailbox is refused with the usual conflict answer. connect-account stays admin-only; the handler creates the personal account through the system identity with the owner taken from the caller session, never from the payload. The dormant screen my-mail-account-connect-imap (exported as MY_IMAP_CONNECT_SCREEN_ID) is reached from the new "Connect mailbox" toolbar action of my-mail-accounts; it has no sender-check field, that policy stays with the admin form. New keys in all locale packages.
-->

<!-- kumiko-changes
feature: inbound-provider-imap
type: fix
title: The IMAP watch quarantines an unparseable mail right away
detail: A mail the MIME parser cannot handle used to be dropped by the live watch and reached the quarantine only with the next reconciliation poll, up to five minutes later. The provider watch handler now passes such mails to `handlers.onMessages(messages, rejected)` and the supervisor quarantines them through the same ingest path as the poll. `onMessages` takes an optional second argument, so existing providers are unaffected. A failed account health update after a quarantine now logs the error code of the rejected write.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Supervisor and OAuth callback writes work when the app roles leave out SystemAdmin
detail: `update-account`, `connect-account` and `reactivate-account` are dispatched as the system user by the watch supervisor, the account health and the OAuth callback, but their access list held only the configured `adminRoles`/`memberRoles`. An app whose roles exclude SystemAdmin saw every health, watch-state and callback write refused ("health update was rejected"), so mailboxes never showed `degraded`. These three handlers now also accept SystemAdmin (the list is `SYSTEM_DISPATCHED_MAIL_HANDLERS`). `isMailAdmin`, screens and what real users may do stay on the configured roles.
-->
