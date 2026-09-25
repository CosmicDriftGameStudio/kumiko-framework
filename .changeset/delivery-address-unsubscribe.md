---
"@cosmicdrift/kumiko-bundled-features": minor
---

delivery direct sends to a route address can now be unsubscribed via a signed link

<!-- kumiko-changes
feature: delivery
type: breaking
title: delivery direct sends to a route address can now be unsubscribed via a signed link
detail: |
  ctx.notify(type, { route: { email } }) direct sends had no unsubscribe
  path: only sends to a user account with a notification-preference row
  could opt out, so a recipient with no account could never stop the mail.
  Added hashUnsubscribeAddress (keyed blind-index hash of the trimmed,
  lowercased address — the plaintext address never reaches the token or
  the opt-out table), signAddressUnsubscribeToken (HS256 JWT, issuer
  "kumiko:unsubscribe", no expiry — a leaked link can only opt one
  address out of one notificationType/channel, and there is no signed-in
  flow to request a fresh one), and a new notification-address-opt-out
  event-sourced entity/table. createUnsubscribeRoute now accepts both the
  existing user token and the new address token on the same route; the
  existing signUnsubscribeToken and its JWT shape are unchanged. deliverDirect
  now skips a channel (logDelivery status "skipped", error "unsubscribed", recipientAddress null)
  when the destination address has an opt-out row for that tenant/
  notificationType/channel, unless priority is "critical" — the same rule
  user-preference suppression already follows. The lookup is skipped
  entirely when no blind-index key is configured.
migration: |
  Run `kumiko migrate generate` to add the notification address opt-out table.
-->
