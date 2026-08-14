---
"@cosmicdrift/kumiko-framework": minor
---

New `@cosmicdrift/kumiko-framework/http` subpath export: `egress(policy)`, a single bound fetcher that is the only sanctioned way for framework consumers to make outbound HTTP requests. The SSRF guard for this previously existed only inside `publicstatus`, duplicated by hand at every call site; this gives it one shared home.

`egress(policy)` takes an `EgressPolicy` once, at bind time, and returns `(raw, init?) => Promise<Response>`:

- `{ kind: "external" }` — denies private/reserved/link-local IP ranges (resolved via DNS or read directly off an IP-literal host), never follows redirects.
- `{ kind: "internal", allowHosts }` — checks the hostname against an explicit allowlist; follows redirects, but re-validates every hop's host against the same allowlist (capped at 5 hops).
- `{ kind: "tenant-supplied" }` — same checks as `external` today; kept as a separate policy kind because tenant-controlled URLs are adversary input in a way a hardcoded external endpoint is not, and stricter hardening is expected to land here first.

DNS-rebinding protection (resolve-then-connect-by-IP) is explicitly out of scope for this package — see the header comment in `src/http/policy.ts` — and tracked as a separate follow-up.
