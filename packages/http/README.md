# @cosmicdrift/kumiko-http

SSRF-safe egress fetch for Kumiko. `egress(policy)` is the single exported
way for server code to speak outward, enforcing an `external` /
`internal` / `tenant-supplied` host policy at the call site: private,
reserved and link-local ranges are denied, the DNS-rebinding TOCTOU window
is closed by resolving the host once and pinning the connection to that
address, and `internal` redirects are followed only within an explicit host
allowlist.

No runtime dependencies — only `node:dns/promises` and `node:net`.

```ts
import { egress } from "@cosmicdrift/kumiko-http";

const fetchExternal = egress({ kind: "external" });
const res = await fetchExternal("https://api.example.com/resource");
```

Re-exported from `@cosmicdrift/kumiko-framework/http` for framework
consumers — this package is the implementation.
