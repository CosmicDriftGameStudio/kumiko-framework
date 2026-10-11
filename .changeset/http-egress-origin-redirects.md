---
"@cosmicdrift/kumiko-http": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": minor
---

Internal egress redirects no longer forward credential headers to another scheme or port, and internal policies can pin full origins

<!-- kumiko-changes
feature: http
type: fix
title: Internal egress redirects no longer forward credential headers to another scheme or port
detail: |
  egress({ kind: "internal" }) compared only hostnames, so a redirect from https to http or to another port on an allowlisted host replayed Authorization, Cookie and other headers verbatim. Once a redirect leaves the original origin, only content-type, accept, accept-encoding, accept-language and user-agent are kept for the rest of the chain. The new allowOrigins option (http(s)://host[:port]) pins scheme, host and port and rejects such redirects before any request goes out. The chat webhook sender now uses it.
migration: |
  Internal redirects to a different scheme or port on the same host lose all headers except content-type/accept/accept-encoding/accept-language/user-agent. To pin scheme and port, use allowOrigins: [new URL(target).origin]. allowHosts entries containing a port, path or scheme now throw when egress() is bound; at least one of allowHosts or allowOrigins is required.
-->
