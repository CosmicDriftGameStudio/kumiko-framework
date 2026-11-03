---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Personal IMAP mailboxes only connect the caller's own address, locked named-filter chips are hidden, orphaned notification templates are removed at seed time, and a single imported mail can be forgotten.

<!-- kumiko-changes
feature: inbound-provider-imap
type: breaking
title: A personal password mailbox only connects the caller's own account address
detail: `connect-my-mailbox` reads the email of the session user server-side and compares it case-insensitively with the submitted address before any login attempt. A different address is refused with `personal_address_not_own` (i18n `inboundMail.accounts.errors.personalAddressNotOwn`); nothing is created and the mail server is not contacted. The OAuth path needs no extra rule, its callback already binds the mailbox to the provider-authenticated account. The IMAP feature now reads the user through the user feature, which a stack must mount.
migration: |
  Members who connected a personal mailbox with an address other than their account email must have an admin connect it as a shared mailbox instead. Stacks that mount `inbound-provider-imap` need the user feature.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Named-filter chips and dashboard tiles hide filters the session roles may not use
detail: `NamedListFilterRef` gains the optional `roles`, set only by the framework from the access rule of the entity's named filter when the client schema is built (open and signed-in-only filters carry none). The list chip row skips chips whose roles do not overlap the session roles, and a dashboard stat tile whose `navigate.namedFilter` targets such a filter is not rendered and sends no count query. Refs of projection-list screens carry no roles because their entity is unknown to the schema build.
-->

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Seeding removes system templates of notifications that no longer exist
detail: `seedNotificationTemplates` deletes, through the event-based delete write, the system mail templates `<feature>:notify:<name>` whose feature is mounted but whose notification is gone, and those stored under a `renamedFrom` name. Tenant overrides of such slugs are kept and reported once per slug with a warning (slug and count only). Templates of features that are not mounted stay untouched.
-->

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: A template test mail is logged as a delivery attempt
detail: `send-test` now writes one delivery attempt per test mail (notification type `template-resolver:test-mail`, channel `email`, the caller as recipient, status and error code of the send, address masked like every attempt), also when the send fails, so test mails show up in the delivery log. The attempt is written on the outside-transaction connection through the delivery attempt log, which the delivery feature now exports as `logAttempt`.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: forget-message permanently removes one imported mail
detail: The new write `forget-message` archives the stream of one mail, deletes its read row, the stored original and the attachment files, and keeps the seen anchor so the intake does not import the mail again. The owner of a personal mailbox or, for a shared one, an admin may call it (agent risk high); a mail of another tenant or of someone else's personal mailbox is reported as not found. The retention sweep shares the purge logic.
-->

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Logout navigates once and no longer races a login redirect
detail: In the browser `logout()` leaves the session state untouched and either assigns `postLogoutUrl` or reloads the page. Before, the reload path first flipped the state to unauthenticated, which let an `AuthGate` with `loginUrl` start its own redirect against the reload (aborted navigation, flaky e2e). Without `window` (native, SSR) the state is still set to unauthenticated.
-->
