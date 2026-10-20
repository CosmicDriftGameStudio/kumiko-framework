---
status: reference
verified: 2026-10-18
evidence: "packages/server-runtime/src/security-headers.ts, csp-hashes.ts, rate-limit-defaults.ts; packages/server-runtime/src/__tests__/security-headers.test.ts, csp-hashes.test.ts, run-prod-app.integration.test.ts"
---

# Security defaults: CSP and rate limits in `runProdApp`

An app that passes neither `securityHeaders` nor `rateLimit` to `runProdApp` still ships with a Content-Security-Policy and with the L1/L2 rate limits. Opting out is explicit.

## Content-Security-Policy

Default value, with the inline-script hashes of the build appended to `script-src`:

```
default-src 'self'; script-src 'self' 'sha256-…'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
```

`kumiko build` hashes every inline `<script>` (no `src`, executable type) of every HTML file in `dist/` and writes the result to `dist/csp-hashes.json`. `runProdApp` reads that file from `staticDir` at boot. Hashes come only from the build output, never from request data. If the file is missing or malformed, the CSP carries no hashes, inline scripts are blocked and boot logs a warning.

| `securityHeaders.csp` | Effect |
|---|---|
| omitted | default CSP with build hashes |
| `false` | no CSP header |
| `"…"` | this string replaces the default (no hashes added) |
| `{ extend: { "connect-src": ["https://api.stripe.com"] } }` | adds sources to default directives or adds new directives |

```ts illustration
await runProdApp({
  securityHeaders: {
    csp: {
      extend: {
        "connect-src": ["https://api.stripe.com"],
        "frame-src": ["https://js.stripe.com"],
      },
    },
  },
});
```

`extend` values must be single tokens without whitespace, `;` or `,`; boot fails otherwise. `'none'` (only `frame-ancestors`) is replaced when extended.

A `hostDispatch` result with `csp` (kinds `html` and `not-found`) wins over the default for that response. It replaces the whole policy, so include your own hashes.

Check it on a running app: `curl -sI https://host/ | grep -i content-security-policy` shows the header with the `sha256-` entries. In the browser, the console reports `Refused to execute inline script` for a script whose hash is missing; the message includes the hash to compare with `dist/csp-hashes.json`.

## Rate limits

| Layer | Default | Scope |
|---|---|---|
| L1 `global` | 600 requests / 60 s | every `/api/*` request per client IP |
| L2 `auth` | 30 requests / 60 s | `/api/auth/*` per client IP |

`rateLimit: false` disables both. `rateLimit: { global: { limit: 100 } }` changes only that field; the window and the other layer keep their defaults. `global: false` or `auth: false` disables a single layer. The limiter is a token bucket in Redis, so a burst may exceed the limit by what refilled during the burst.

A handler adds its own L3 limit with `rateLimit: { per, limit, windowSeconds }`. A list such as `rateLimit: [{ per: "user", ... }, { per: "tenant+handler", ... }]` enforces several buckets together: every bucket must have a token, and a rejected request charges none of them. See [`samples/recipes/rate-limiting`](https://github.com/CosmicDriftGameStudio/kumiko-framework/tree/main/samples/recipes/rate-limiting).

## Client IP behind a proxy

The limits are keyed on the client IP. Behind an ingress or load balancer set `trustedProxyHops` (or `KUMIKO_TRUSTED_PROXY_HOPS`) to the number of trusted hops. Without it every request carries the proxy's address, all clients share one bucket and the default limits throttle the whole site at once. In production `runProdApp` refuses to boot when neither is set; pass `0` when the app is exposed directly. Set it to the real hop count only: a higher value lets a client choose its own bucket through `X-Forwarded-For`.
