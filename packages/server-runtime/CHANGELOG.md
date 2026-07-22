# @cosmicdrift/kumiko-server-runtime

## 0.161.0

### Minor Changes

- c7ac572: Auth-foundation migration (#1372–#1375): tenantResolver/tenantExistence EPs, sessionStore wiring without auth.sessions, slim AnonymousAccessConfig, recipe auth-foundation-providers.

### Patch Changes

- Updated dependencies [c7ac572]
  - @cosmicdrift/kumiko-bundled-features@0.161.0
  - @cosmicdrift/kumiko-framework@0.161.0

## 0.160.0

### Patch Changes

- Updated dependencies [d3e815c]
  - @cosmicdrift/kumiko-framework@0.160.0
  - @cosmicdrift/kumiko-bundled-features@0.160.0

## 0.159.1

### Patch Changes

- Updated dependencies [6d37eb5]
  - @cosmicdrift/kumiko-framework@0.159.1
  - @cosmicdrift/kumiko-bundled-features@0.159.1

## 1.0.0

### Patch Changes

- 9db805c: `loadJwtSecretOrKeyring` (`@cosmicdrift/kumiko-framework/api`) — env-loader for `createJwtHelper`'s keyring param, analog to `secrets`' `loadKeyring`: reads `JWT_SECRET_V<n>` + `JWT_SECRET_CURRENT_VERSION` for zero-downtime rotation, falling back to plain `JWT_SECRET` when no versioned key is set. `runProdApp` now wires it through `entrypoint`/`ServerOptions.jwtSecret` (widened to `string | JwtKeyring`) instead of the plain `JWT_SECRET` string. Without `kid`-tagged rotation (#1291), every key rotation invalidated all sessions at once (#1265, #1292).
- aa52aa1: `runProdApp` now aborts boot when auth is mounted but the `sessions` feature is not and `auth.sessions` wasn't explicitly set to `false`. Without this, an app that forgets to mount `sessions` silently falls back to stateless JWTs (no server-side revocation, valid until the 24h expiry) with no warning — the `sessions` feature is not part of the auto-mounted auth foundation (config/user/tenant/auth-email-password), so this had no gate at all (#1262, #1275). Existing apps that intentionally run stateless need to pass `{ auth: { sessions: false } }`.
- Updated dependencies [9db805c]
- Updated dependencies [d0280c8]
- Updated dependencies [a997cc8]
- Updated dependencies [114faef]
- Updated dependencies [d97fcda]
- Updated dependencies [2fc542b]
- Updated dependencies [6254cc8]
  - @cosmicdrift/kumiko-framework@1.0.0
  - @cosmicdrift/kumiko-bundled-features@1.0.0

## 0.158.2

### Patch Changes

- c6487d0: `runProdApp`'s personal-access-token rate limiter now defaults to `createRedisLoginRateLimiter` instead of `createInMemoryLoginRateLimiter` — same bug as #1274, just for PATs: an in-process counter gives each replica its own bucket in a multi-instance prod deployment, so the limit is trivially evaded by spreading requests across replicas (#1287).
  - @cosmicdrift/kumiko-framework@0.158.2
  - @cosmicdrift/kumiko-bundled-features@0.158.2

## 0.158.1

### Patch Changes

- da816ee: Add `createRedisLoginRateLimiter` (`@cosmicdrift/kumiko-framework/api`) and default `runProdApp`'s `/auth/login` + `/auth/mfa/verify` rate limiting to it instead of `createInMemoryLoginRateLimiter`. The in-memory limiter counts per process — a multi-replica prod deployment silently gave each replica its own bucket, so an attacker spread across replicas evaded the limit without any warning or error (#1262, #1274). Redis is already required infra for `runProdApp` (`REDIS_URL`), so this closes the gap with no new config.
- Updated dependencies [da816ee]
  - @cosmicdrift/kumiko-framework@0.158.1
  - @cosmicdrift/kumiko-bundled-features@0.158.1

## 0.158.0

### Minor Changes

- 7d230f2: runProdApp now sends default security headers on every response: HSTS
  (`max-age=31536000; includeSubDomains`), `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff` and `Referrer-Policy:
strict-origin-when-cross-origin`. A Content-Security-Policy default is
  opt-in via the new `securityHeaders.csp` option. Headers a response
  already set (e.g. hostDispatch's per-host CSP) are never overridden;
  `securityHeaders: false` disables the block, the object form overrides
  or disables individual headers.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.158.0
- @cosmicdrift/kumiko-bundled-features@0.158.0

## 0.157.3

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.157.3
- @cosmicdrift/kumiko-framework@0.157.3

## 0.157.2

### Patch Changes

- Updated dependencies [08c40d6]
  - @cosmicdrift/kumiko-bundled-features@0.157.2
  - @cosmicdrift/kumiko-framework@0.157.2

## 0.157.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.157.1
- @cosmicdrift/kumiko-framework@0.157.1

## 0.157.0

### Patch Changes

- Updated dependencies [1371d8b]
  - @cosmicdrift/kumiko-framework@0.157.0
  - @cosmicdrift/kumiko-bundled-features@0.157.0

## 0.156.3

### Patch Changes

- Updated dependencies [f768c8a]
  - @cosmicdrift/kumiko-framework@0.156.3
  - @cosmicdrift/kumiko-bundled-features@0.156.3

## 0.156.2

### Patch Changes

- Updated dependencies [838cd4e]
  - @cosmicdrift/kumiko-framework@0.156.2
  - @cosmicdrift/kumiko-bundled-features@0.156.2

## 0.156.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.156.1
- @cosmicdrift/kumiko-bundled-features@0.156.1

## 0.156.0

### Patch Changes

- Updated dependencies [c7ca222]
- Updated dependencies [77ea09f]
  - @cosmicdrift/kumiko-framework@0.156.0
  - @cosmicdrift/kumiko-bundled-features@0.156.0

## 0.155.1

### Patch Changes

- 69ac999: Migrate three display/build-tooling timestamp call-sites from native `Date` to `Temporal` (identical output format): `formatWhen` (operator-screen timestamps), `formatDateCell` (table-cell date/timestamp formatting, preserves the existing `dateStyle`/`timeStyle` priority order), and `build-prod-bundle`'s `builtAt` field. Surfaced by infra#286's `no-date-api` guard, which now actually scans these packages instead of silently skipping them.
  - @cosmicdrift/kumiko-bundled-features@0.155.1
  - @cosmicdrift/kumiko-framework@0.155.1

## 0.155.0

### Patch Changes

- Updated dependencies [137f31a]
  - @cosmicdrift/kumiko-framework@0.155.0
  - @cosmicdrift/kumiko-bundled-features@0.155.0

## 0.154.2

### Patch Changes

- Updated dependencies [05c3e11]
  - @cosmicdrift/kumiko-framework@0.154.2
  - @cosmicdrift/kumiko-bundled-features@0.154.2

## 0.154.1

### Patch Changes

- Updated dependencies [618be61]
  - @cosmicdrift/kumiko-bundled-features@0.154.1
  - @cosmicdrift/kumiko-framework@0.154.1

## 0.154.0

### Patch Changes

- Updated dependencies [0d30bf7]
- Updated dependencies [e40a980]
  - @cosmicdrift/kumiko-framework@0.154.0
  - @cosmicdrift/kumiko-bundled-features@0.154.0

## 0.153.0

### Minor Changes

- caed246: Extract `@cosmicdrift/kumiko-server-runtime` as a new package carrying `runProdApp` and its
  production-boot dependencies (compose-features, boot seeding/crypto/job-logger,
  extra-routes-deps, pii-boot-gate, static-file serving, prod bundle build, session-wiring).

  `@cosmicdrift/kumiko-dev-server` now depends on `kumiko-server-runtime` for these shared
  pieces instead of bundling them directly, and no longer exports `runProdApp` or
  `compose-features` from its own subpaths — apps must import those from
  `@cosmicdrift/kumiko-server-runtime` (see the package's README/exports). This is a breaking
  change for anyone importing `runProdApp`/`composeFeatures` from `@cosmicdrift/kumiko-dev-server`
  directly; `runDevApp` and the rest of `kumiko-dev-server`'s public API are unaffected.

  The net effect: a production app that only needs `runProdApp` no longer pulls `ts-morph` and
  the scaffolding/codegen toolchain into its `node_modules`.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.153.0
- @cosmicdrift/kumiko-bundled-features@0.153.0
