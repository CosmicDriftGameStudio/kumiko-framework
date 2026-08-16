---
"@cosmicdrift/kumiko-framework": patch
---

`egress({ kind: "external" | "tenant-supplied" })` now closes the DNS-rebinding TOCTOU window that `src/http/policy.ts` previously documented as out of scope: the host is resolved via DNS exactly once, every returned address is checked against the private/reserved/link-local ranges, and the actual connection is then pinned to that validated IP address instead of letting `fetch()` resolve the hostname a second time (which a rebinding DNS server could answer differently). The original hostname is preserved in the `Host` header and in TLS SNI (`tls.servername`), so certificate validation still checks the real hostname rather than the IP dialed. `kind: "internal"` is unaffected.
