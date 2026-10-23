---
status: reference
verified: 2026-10-23
evidence: "packages/server-runtime/src/security-headers.ts, csp-hashes.ts, rate-limit-defaults.ts; packages/server-runtime/src/__tests__/security-headers.test.ts, csp-hashes.test.ts, run-prod-app.integration.test.ts; packages/framework/src/db/render-rls-ddl.ts, row-level-security-connection.ts, row-level-security-boot-check.ts; packages/framework/src/db/__tests__/row-level-security-scope.integration.test.ts, row-level-security-boot-check.integration.test.ts"
---

# Security defaults: CSP, rate limits and row level security

An app that passes neither `securityHeaders` nor `rateLimit` to `runProdApp` still ships with a Content-Security-Policy and with the L1/L2 rate limits. Opting out is explicit. Row level security is a second tenant-isolation layer in Postgres and is on by default; `rowLevelSecurity: "off"` turns it off explicitly and logs a boot warning.

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

## Row level security

The tenant filter of TenantDb is the first isolation layer. Row level security in Postgres is the second: it also stops raw SQL and a forgotten filter from reading or writing another tenant's rows. One value in `kumiko.config.ts` sets it for every tool and runner:

| `rowLevelSecurity` | Effect |
|---|---|
| `"on"` (default) | every table with `tenant_id` gets ENABLE and FORCE ROW LEVEL SECURITY and the policies `kumiko_tenant_isolation` and `kumiko_system_tenant_read`; every transaction sets `kumiko.tenant_id` or `kumiko.scope = 'system'` |
| `"off"` | no policies; boot fails while a table still has row level security enabled, and runProdApp and runWorkerApp log a warning |

`setupTestStack` and the dev server connect as the role `kumiko_app` (NOSUPERUSER NOBYPASSRLS), which owns the database. `"off"` in their options restores the superuser setup without policies.

With `"on"`, a statement that runs without a scope sees no tenant rows, and an insert for another tenant fails with SQLSTATE 42501. Rows of the system tenant stay readable from every tenant scope. Requests, TenantDb, jobs, the event dispatcher, migrations, seeds and projection rebuilds set the scope themselves; app code that reads tenant tables outside these paths works through a TenantDb, a job, a system-scoped handler or a granted `unsafeRaw`. A projection write keeps the tenant scope of the command, so a row for another tenant needs `ctx.systemDb` in an `r.systemScope()` feature. A system scope always names a reason (`runInSystemRowLevelSecurityScope(reason, fn)`, `systemScopedRunner(runner, reason)`); an empty reason throws. The functions that set a scope are not on the public `db` subpath: framework packages import them from `@cosmicdrift/kumiko-framework/internal/row-level-security`, and tests get them from `@cosmicdrift/kumiko-testing/helpers`. The guard `internal-subpath-imports` rejects `internal/*` imports outside the framework repo, the scope setters from `testing/helpers` outside test files and a system scope without a literal reason.

`kumiko-schema generate`, `validate` and `apply` read the value through the managed `kumiko/schema.ts`; pass `appConfig.rowLevelSecurity` to `runProdApp` (the scaffolded server entry does). The schema apply, in production the migrate init container, creates the policies; there is no manual step. To go back, set `"off"` and run `kumiko-schema generate`: the migration disables row level security and drops the policies. With `"on"`, boot fails when the database role has SUPERUSER or BYPASSRLS, because Postgres then skips every policy, and when a tenant table lacks ENABLE, FORCE or one of the two policies. The framework does not change owners or grants in production: create the app role with NOSUPERUSER NOBYPASSRLS as part of the database setup. FORCE makes the policies apply to the table owner as well.

Check it on a database: `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = '<table>'` shows the flags, `SELECT policyname, permissive, cmd FROM pg_policies WHERE tablename = '<table>'` the policies, and `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user` the role.
