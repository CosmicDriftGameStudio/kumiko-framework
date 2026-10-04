# @cosmicdrift/kumiko-http

## 0.347.0

## 0.346.0

## 0.345.0

## 0.344.0

## 0.343.0

## 0.342.0

## 0.341.0

## 0.340.0

## 0.339.0

## 0.338.0

## 0.337.1

## 0.337.0

### Patch Changes

- 469df86: The `json` format no longer throws on BigInt or circular values and falls back to text. `resolvePublicHost` prefers an IPv4 address on dual-stack hosts. Identity-switch claim comparison no longer treats structurally equal object claims in a different key order as a different identity.

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: json format falls back to text, IPv4-first egress pin, structural claim comparison for identity switch
  -->

## 0.336.1

## 0.336.0

## 0.335.0

## 0.334.0

## 0.333.0

## 0.332.0

## 0.331.0

## 0.330.2

## 0.330.1

## 0.330.0

## 0.329.0

## 0.328.1

### Patch Changes

- 863e8e4: kumiko-framework and kumiko-http are published as compiled JavaScript plus .d.ts

  Both packages now ship `dist` (`.js` and `.d.ts`) instead of TypeScript source. Export keys are unchanged; only the targets behind them move to `dist`. `kumiko-framework` still ships `src/scripts/codemod` as source because `kumiko upgrade` runs those codemods with Bun. Runtime-only subpaths that import `bun` or `bun:*` (for example `./testing`) still need Bun.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: kumiko-framework and kumiko-http are published as compiled JavaScript plus .d.ts
  -->

## 0.328.0

## 0.327.0

## 0.326.1

## 0.326.0

## 0.325.2

## 0.325.1

## 0.325.0

## 0.324.0

## 0.323.0

## 0.322.0

## 0.321.0

## 0.320.0

### Minor Changes

- c61cc7a: Tenant-supplied SMTP and IMAP hosts must now resolve to a public address before a connect is attempted. `resolvePublicHost` in `@cosmicdrift/kumiko-http` gained a host-based sibling, `resolvePublicHostname`, used by a new shared `resolveMailConnectTarget` helper in `@cosmicdrift/kumiko-bundled-features/foundation-shared`. Both `mail-transport-smtp` and `inbound-provider-imap` now resolve the tenant-configured host once, reject a private/loopback/link-local/metadata address before connecting, and — for a real hostname — pin the connection to the resolved address while keeping the original hostname as the TLS SNI `servername`, so certificate validation still checks the right name.

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

### Patch Changes

- c61cc7a: `isBlockedIp` now recognizes more encodings of already-blocked addresses instead of only the two-trailing-group compressed form: the deprecated IPv4-compatible IPv6 form (`::a.b.c.d`), the IPv4-translated form (`::ffff:0:a.b.c.d`), and the NAT64 local-use prefix (`64:ff9b:1::/48`) each with their embedded IPv4 checked against the same range table, plus the `192.0.0.0/24` and `198.18.0.0/15` reserved IPv4 ranges. Embedded-IPv4 detection is now compression-agnostic (expands to the full 8-group form before matching), which also fixes a case the previous two-group regex missed: an embedded IPv4 with a leading zero octet, e.g. `64:ff9b::0.0.0.1`, canonicalizes to a single trailing hex group and was not being blocked.

  <!-- kumiko-changes
  feature: http
  type: fix
  title: isBlockedIp closes embedded-IPv4 and reserved-range gaps in the egress guard
  detail: |
    Adds detection for IPv4-compatible IPv6 (`::a.b.c.d`, RFC 4291), IPv4-
    translated IPv6 (`::ffff:0:a.b.c.d`, RFC 8215), and the NAT64 local-use
    prefix `64:ff9b:1::/48` (RFC 8215) — each checked against the existing
    IPv4 blocklist for its embedded address. Adds the `192.0.0.0/24` and
    `198.18.0.0/15` reserved IPv4 ranges. Replaces the previous regex-based
    embedded-IPv4 matching (which required exactly two trailing hex groups)
    with a full 8-group expansion, fixing a false negative for embedded
    IPv4 addresses with a leading zero octet that compress to fewer groups.
  migration: |
    No API change. Some addresses that previously resolved through
    `resolvePublicHost`/`resolvePublicHostname`/`isPublicHost` as "not
    blocked" are now correctly rejected as blocked. This only narrows what
    is treated as a public egress target.
  -->

- c61cc7a: `r.step.webhook.send`'s `url` is commonly wired straight from request or workflow input (see the webhook-step recipe), so `performWebhookDispatch` now resolves the target host once and rejects a private/reserved address before connecting — the same guard already applied to tenant-supplied SMTP/IMAP hosts — and pins the connect to the resolved address while keeping the original hostname as the Host header and TLS SNI `servername`.

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

## 0.319.0

## 0.318.0

## 0.317.0

## 0.316.0

## 0.315.0

## 0.314.0

## 0.313.0

## 0.312.0

## 0.311.0

## 0.310.0

## 0.309.0

## 0.308.0

## 0.307.0

## 0.306.0

## 0.305.0

## 0.304.0

## 0.303.0

## 0.302.0

## 0.301.0

## 0.300.0

## 0.299.0

## 0.298.0

## 0.297.0

## 0.296.0

## 0.295.0

## 0.294.1

## 0.294.0

## 0.293.0

## 0.292.0

## 0.291.0

## 0.290.0

## 0.289.0

## 0.288.0

## 0.287.0

### Minor Changes

- 166b2a7: `egress()` already resolves a hostname's A/AAAA records once and rejects any private/reserved/link-local address before connecting, closing the DNS-rebinding window. That check was internal to the module, so anything needing an SSRF precheck without performing a real fetch — for example validating a tenant-supplied webhook URL at registration time — had no supported way to reuse it. `isPublicHost(raw: string, lookupFn?)` now exports that same resolution as a boolean-only façade: it never throws, resolving to `false` for a non-parsable URL, a non-http(s) scheme, embedded credentials, a failed DNS lookup, or any address in a blocked range, and `true` only when every resolved address is public.

  <!-- kumiko-changes
  feature: http
  type: improvement
  title: export isPublicHost for create-time SSRF precheck without a real fetch
  detail: |
    Adds `isPublicHost(raw: string, lookupFn?: typeof lookup): Promise<boolean>` to
    `@cosmicdrift/kumiko-http` (and re-exported from `@cosmicdrift/kumiko-framework/http`).
    It runs the same range-table and DNS-rebinding-safe single-resolution check
    `egress()` uses internally via `resolvePublicHost`, but performs no connection —
    useful for validating tenant-supplied URLs (e.g. webhook registration) up front.
    Never throws: parse failures, non-http(s) schemes, embedded credentials, DNS
    failures, and blocked ranges all resolve to `false` rather than rejecting.
  -->

## 0.286.0

## 0.285.2

## 0.285.1

## 0.285.0

## 0.284.0

### Minor Changes

- 4880f4e: Split egress into a standalone @cosmicdrift/kumiko-http package

  egress() moves from packages/framework/src/http into its own zero-runtime-dependency package, @cosmicdrift/kumiko-http, so the required direct-fetch guard no longer forces slim build tools to pull the framework's 14 runtime dependencies (ioredis, meilisearch, postgres, bullmq, pino, ...). @cosmicdrift/kumiko-framework/http keeps working unchanged via a re-export; the public surface is unaffected.

  <!-- kumiko-changes
  feature: http
  type: improvement
  title: Split egress into a standalone @cosmicdrift/kumiko-http package
  -->
