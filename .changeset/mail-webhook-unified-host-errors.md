---
"@cosmicdrift/kumiko-bundled-features": patch
---

IMAP, SMTP, and webhook-dispatch host-egress failures now surface one generic tenant-visible message per channel regardless of whether the target host was blocked (private/reserved range) or simply failed to resolve. Previously the message text (and, for webhooks, the event payload) differed between the two cases and could embed the configured host — sometimes alongside the private address it resolved to. The distinguishing detail and the host are now logged server-side only; retry semantics are unchanged (IMAP: `InboundAuthError` no-retry for a blocked host vs `InboundTransientError` retry for a resolution failure; SMTP: `UnconfiguredError` for a blocked host vs `HostResolutionError` for a resolution failure, still distinct classes).

<!-- kumiko-changes
feature: inbound-provider-imap
type: fix
title: IMAP connect failures no longer distinguish a blocked host from a DNS failure in the thrown message
detail: |
  `createImapClient` throws the same generic message
  ("IMAP host is not reachable or not allowed") for both a blocked host
  (`InboundAuthError`) and a DNS resolution failure (`InboundTransientError`).
  The configured host and the underlying error are now logged via the
  feature's own logger instead of being embedded in the thrown message.
  Error class (and therefore retry behavior) is unchanged.
-->

<!-- kumiko-changes
feature: mail-transport-smtp
type: fix
title: SMTP connect failures no longer distinguish a blocked host from a DNS failure in the thrown message
detail: |
  `buildSmtpTransport` throws an `UnconfiguredError` for a blocked host and
  a `HostResolutionError` for a DNS failure — both classes unchanged for
  retry semantics — but the `.message` text is now byte-identical between
  the two ("... host is not reachable or not allowed"). The configured
  host and the underlying error are now logged via the feature's own
  logger instead of being embedded in the thrown message.
-->

<!-- kumiko-changes
feature: step-dispatcher
type: fix
title: webhook dispatch failures no longer distinguish a blocked host from a DNS failure
detail: |
  `performWebhookDispatch` returns the same generic error
  ("webhook host is not reachable or not allowed") for both a blocked
  host and a DNS resolution failure, instead of two distinguishable
  strings that also embedded the target hostname in the delivery-attempt
  event payload. The hostname and the underlying error are now logged via
  the feature's own logger instead of being included in the result.
-->
