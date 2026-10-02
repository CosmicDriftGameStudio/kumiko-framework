---
"@cosmicdrift/kumiko-bundled-features": patch
---

Several bundled-feature fixes. `tenant:remove-member` no longer fails with an internal error when it removes a TenantAdmin: the last-admin check now runs on the raw runner like `update-member-roles`, and the last admin is refused with a conflict. The `member-directory` query accepts `search` so the `user:user` reference combobox finds members beyond the first page. One-off Stripe payment checkouts without a known customer create one, so the paid payment is no longer ignored by the webhook. A throwing secrets lookup in the webhook step now becomes a `dispatch-failed` event instead of dead-lettering the step-dispatcher consumer. The row-bound grant validates an `unsafeSkip` reason before verifying the token. The session list loads one maximum-size page without a pager that could not page. The public user-data-rights handlers rate-limit per IP and handler.

<!-- kumiko-changes
feature: tenant
type: fix
title: remove-member no longer fails with an internal error when removing a TenantAdmin
-->

<!-- kumiko-changes
feature: tenant
type: fix
title: member-directory supports search for the user reference combobox
-->

<!-- kumiko-changes
feature: subscription-stripe
type: fix
title: One-off payment checkouts create a customer when none is passed
-->

<!-- kumiko-changes
feature: step-dispatcher
type: fix
title: Webhook auth secret lookup failures become dispatch-failed events
-->

<!-- kumiko-changes
feature: sessions
type: fix
title: Session list loads one max-size page and renders no pager
-->

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: Public deletion and download handlers rate-limit per IP and handler
-->
