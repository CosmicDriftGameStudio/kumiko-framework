---
"@cosmicdrift/kumiko-http": patch
"@cosmicdrift/kumiko-bundled-features": minor
---

`r.step.webhook.send`'s `url` is commonly wired straight from request or workflow input (see the webhook-step recipe), so `performWebhookDispatch` now resolves the target host once and rejects a private/reserved address before connecting — the same guard already applied to tenant-supplied SMTP/IMAP hosts — and pins the connect to the resolved address while keeping the original hostname as the Host header and TLS SNI `servername`.

<!-- kumiko-changes
feature: http
type: improvement
title: resolvePublicHost and buildPinnedRequest are now exported from the package barrel
detail: |
  `resolvePublicHost(url, lookupFn?)` (the URL-based sibling of
  `resolvePublicHostname`) and `buildPinnedRequest(url, resolved, init)`
  (Host header + TLS SNI pinning) are newly exported so a caller that
  already has a full URL (not just a hostname) can build the same pinned
  request `egress()` builds internally, for a custom fetch/transport seam.
migration: |
  Purely additive — no behavior change to any existing export. New export
  surface only.
-->

<!-- kumiko-changes
feature: step-dispatcher
type: breaking
title: A webhook.send target host must resolve to a public address
migration: |
  A workflow or handler pointing `r.step.webhook.send` at an internal
  receiver or a local dev/test endpoint (localhost or a private IP) now
  gets a delivery error (step.dispatch-failed) unless that host is
  explicitly allowed. Set the operator env var (comma-separated, read at
  dispatch time — no boot-time code call needed) before starting the
  process:
    KUMIKO_WEBHOOK_ALLOWED_PRIVATE_HOSTS=webhook-receiver.internal
  This is an operator env var, not a tenant/workflow-config value — a
  workflow author cannot add their own host to this list. A DNS resolution
  failure for a genuinely unreachable host now surfaces as a distinct
  delivery error instead of only failing later inside `fetch()`.
-->
