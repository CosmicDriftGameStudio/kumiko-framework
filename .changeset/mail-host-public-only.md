---
"@cosmicdrift/kumiko-http": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Tenant-supplied SMTP and IMAP hosts must now resolve to a public address before a connect is attempted. `resolvePublicHost` in `@cosmicdrift/kumiko-http` gained a host-based sibling, `resolvePublicHostname`, used by a new shared `resolveMailConnectTarget` helper in `@cosmicdrift/kumiko-bundled-features/foundation-shared`. Both `mail-transport-smtp` and `inbound-provider-imap` now resolve the tenant-configured host once, reject a private/loopback/link-local/metadata address before connecting, and — for a real hostname — pin the connection to the resolved address while keeping the original hostname as the TLS SNI `servername`, so certificate validation still checks the right name.

<!-- kumiko-changes
feature: http
type: improvement
title: resolvePublicHost's DNS-pinning is now also available for a bare hostname
detail: |
  `resolvePublicHostname(host, lookupFn?)` exposes the same resolve-once,
  reject-non-public-addresses check `resolvePublicHost` already does for a
  URL, for callers that only have a hostname (no scheme/path). Also newly
  exported: `BlockedHostError`, `HostResolutionError`, `isPublicHost`,
  `resolvePublicHostname`, and `type EgressPolicy`/`ResolvedHost`.
migration: |
  Purely additive for existing `resolvePublicHost`/`isBlockedIp` callers —
  no behavior change to the URL-based API. New export surface only.
-->

<!-- kumiko-changes
feature: mail-transport-smtp
type: breaking
title: The tenant-configured SMTP host must resolve to a public address
migration: |
  An operator relying on an internal SMTP relay or a local dev/test server
  (mailpit, MailHog on localhost or a private IP) now gets a build-time
  422 (code "unconfigured", naming the "host" config-key) unless that host
  is explicitly allowed. Set the operator env var (comma-separated, read
  at connect time — no boot-time code call needed) before starting the
  process:
    KUMIKO_MAIL_ALLOWED_PRIVATE_HOSTS=mailpit.internal
  This is an operator env var, not a tenant config value — a tenant cannot
  add their own host to this list. Shared with inbound-provider-imap: one
  env var covers both SMTP and IMAP allowlisting. A DNS resolution failure
  for a genuinely unreachable host now surfaces distinctly (not as
  "unconfigured") instead of only failing later at first-send time.
-->

<!-- kumiko-changes
feature: inbound-provider-imap
type: breaking
title: The tenant-configured IMAP host must resolve to a public address
migration: |
  An operator relying on an internal IMAP server or a local dev/test server
  (greenmail on localhost or a private IP) now gets an InboundAuthError
  (account marked auth_error) unless that host is explicitly allowed. Set
  the same operator env var mail-transport-smtp reads (comma-separated, no
  boot-time code call needed) before starting the process:
    KUMIKO_MAIL_ALLOWED_PRIVATE_HOSTS=greenmail.internal
  This is an operator env var, not a tenant config value — a tenant cannot
  add their own host to this list. A DNS resolution failure for a
  genuinely unreachable host now surfaces as InboundTransientError (job
  retry) instead of reaching imapflow at all.
-->
