# @cosmicdrift/kumiko-server-runtime

## 0.185.0

### Patch Changes

- Updated dependencies [0a059a0]
- Updated dependencies [43e0291]
- Updated dependencies [3d1a0dd]
- Updated dependencies [c57e2be]
- Updated dependencies [18c7fc1]
  - @cosmicdrift/kumiko-framework@0.185.0
  - @cosmicdrift/kumiko-bundled-features@0.185.0

## 0.184.0

### Patch Changes

- Updated dependencies [9171858]
  - @cosmicdrift/kumiko-bundled-features@0.184.0
  - @cosmicdrift/kumiko-framework@0.184.0

## 0.183.2

### Patch Changes

- Updated dependencies [92c7948]
  - @cosmicdrift/kumiko-framework@0.183.2
  - @cosmicdrift/kumiko-bundled-features@0.183.2

## 0.183.1

### Patch Changes

- Updated dependencies [a6a3c42]
  - @cosmicdrift/kumiko-bundled-features@0.183.1
  - @cosmicdrift/kumiko-framework@0.183.1

## 0.183.0

### Patch Changes

- Updated dependencies [08c5c8c]
- Updated dependencies [14853d9]
- Updated dependencies [b54a9e0]
- Updated dependencies [28c03cd]
  - @cosmicdrift/kumiko-bundled-features@0.183.0
  - @cosmicdrift/kumiko-framework@0.183.0

## 0.182.1

### Patch Changes

- Updated dependencies [958df88]
  - @cosmicdrift/kumiko-framework@0.182.1
  - @cosmicdrift/kumiko-bundled-features@0.182.1

## 0.182.0

### Patch Changes

- Updated dependencies [8a3b0a9]
- Updated dependencies [9c62bc8]
- Updated dependencies [9344050]
- Updated dependencies [0a50d9c]
- Updated dependencies [d722db8]
  - @cosmicdrift/kumiko-framework@0.182.0
  - @cosmicdrift/kumiko-bundled-features@0.182.0

## 0.181.0

### Patch Changes

- Updated dependencies [fda4dc6]
- Updated dependencies [758cc7c]
  - @cosmicdrift/kumiko-framework@0.181.0
  - @cosmicdrift/kumiko-bundled-features@0.181.0

## 0.180.0

### Patch Changes

- Updated dependencies [85102ca]
  - @cosmicdrift/kumiko-framework@0.180.0
  - @cosmicdrift/kumiko-bundled-features@0.180.0

## 0.179.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.179.0
- @cosmicdrift/kumiko-framework@0.179.0

## 0.178.1

### Patch Changes

- Updated dependencies [9400ec1]
  - @cosmicdrift/kumiko-framework@0.178.1
  - @cosmicdrift/kumiko-bundled-features@0.178.1

## 0.178.0

### Patch Changes

- Updated dependencies [52753b6]
  - @cosmicdrift/kumiko-framework@0.178.0
  - @cosmicdrift/kumiko-bundled-features@0.178.0

## 0.177.0

### Patch Changes

- Updated dependencies [f49afdc]
  - @cosmicdrift/kumiko-framework@0.177.0
  - @cosmicdrift/kumiko-bundled-features@0.177.0

## 0.176.2

### Patch Changes

- 63b6acf: PR-review fix batch (low-severity findings):

  - `FIELD_ICONS`/`NAV_ICONS` lookups now check `Object.hasOwn` — a `icon: "constructor"`/`"toString"` key no longer resolves through the prototype chain into a render crash.
  - `subjectRef` narrowed to `?: true` (no observed `false` usage) — matches the sibling `lookupable?: true` idiom.
  - `sse-broker`'s access-invalidation listener Set now documents its callback-reference dedup contract.
  - `date-parse.ts`'s `toIso` passes `calendarName: "never"` so a future non-ISO `PlainDate` can't leak a `[u-ca=...]` suffix onto the wire.
  - `runRunner` (gen-feature-screenshots) wipes each scenario's output dir before a fresh Playwright run — a renamed/removed scenario no longer leaves a stale preview behind.
  - `screenshots.ts`'s `axis()` throws instead of silently registering zero tests when an env filter matches nothing.
  - `run-prod-app`'s `extraRoutes` now mount before seeds/seed-migrations (previously after `entrypoint.start()`), matching the dev-server's ordering — a seed that dispatches through the Hono matcher no longer blocks a later `extraRoutes` route registration.
  - `job-runs-screen`'s job selector now resets payload/error/success state on job change, instead of validating stale payload text against the newly selected job's schema.
  - `render-field`'s create-then-refetch clears the stale search term first and logs (instead of swallowing) a refetch failure.
  - `purge-subject.ts`'s per-entity SELECT is now paged (batch 500, like `reindexEntity`) instead of pulling a whole tenant table into memory.
  - `login.write.ts`'s `gateResolveAuthUser`/`gateVerifyPassword` now share a narrowed `AuthenticatableUserRow` type — removes a redundant, differently-timed second `passwordHash` miss path.
  - `dispatch-shared.ts`'s `tenant:config:timezone` literal is now a named constant, with a new integration test booting the real `createTenantFeature()` to catch drift (previously only a standalone probe feature exercised it).
  - `NotifyOptions.recipientId`'s JSDoc now states it's ignored on the `to` path.
  - Test fixes: `access-roles`/`boot-validator` tests silence `console.warn` instead of letting it print during the run; `tz-resolution.integration.test.ts`'s third case sets its own tenant-config precondition instead of relying on test order; `jobs-catalog.integration.test.ts` now uses `setupTestStack` + real HTTP like its sibling suite instead of hand-rolled fetch helpers; a `styleguide`/`renderer` test-only `as unknown as` cast replaced with a typed optional + `delete`.

- Updated dependencies [3b5983a]
- Updated dependencies [63b6acf]
  - @cosmicdrift/kumiko-bundled-features@0.176.2
  - @cosmicdrift/kumiko-framework@0.176.2

## 0.176.1

### Patch Changes

- Updated dependencies [c7c4260]
  - @cosmicdrift/kumiko-bundled-features@0.176.1
  - @cosmicdrift/kumiko-framework@0.176.1

## 0.176.0

### Patch Changes

- Updated dependencies [90ceb78]
  - @cosmicdrift/kumiko-framework@0.176.0
  - @cosmicdrift/kumiko-bundled-features@0.176.0

## 0.175.0

### Minor Changes

- bc1377e: **BREAKING: `text-content` merged into `template-resolver`.**

  The `text-content` feature is gone. Its text blocks now live in
  `template-resolver` as `kind: "text-block"` rows of `read_template_resources`,
  which gains a nullable `title` and `folder` column. `ai-prompt` joins the kind
  set. `RENDER_KINDS` is unchanged (renderer plugins keep their exact domain);
  the full entity domain is the new `TEMPLATE_KINDS`.

  Migration for consuming apps:

  | before                                                    | after                                                                                                    |
  | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
  | `createTextContentFeature()`                              | `createTemplateResolverFeature()`                                                                        |
  | `@cosmicdrift/kumiko-bundled-features/text-content`       | `.../template-resolver`                                                                                  |
  | `.../text-content/seeding` → `seedTextBlock`              | `.../template-resolver/seeding` → `seedTextBlock`                                                        |
  | `.../text-content/web` → `textContentClient()`            | `.../template-resolver/web` → `textBlocksClient()`                                                       |
  | `extraContext: { textContent: createTextContentApi(db) }` | `extraContext: { templateResolver: createTemplateResolverApi(db) }` (auto-wired by runProdApp/runDevApp) |
  | `textContent.getBlock({ tenantId, slug, lang })`          | `templateResolver.findExact({ tenantId, slug, kind: "text-block", locale })`                             |
  | `text-content:write:set` `{ slug, lang, title, body }`    | `template-resolver:write:set` `{ slug, locale, title, content }`                                         |
  | `text-content:query:by-slug` `{ slug, lang }`             | `template-resolver:query:by-slug` `{ slug, locale }`                                                     |
  | `text-content:query:by-tenant`                            | `template-resolver:query:by-tenant`                                                                      |
  | `TestStackPreset "text-content"`                          | `TestStackPreset "template-resolver"`                                                                    |

  `composePagesStack()` no longer mounts the content foundation — it now returns
  `legal-pages` only, because `template-resolver` ships in `composeRendererStack()`
  and `createRegistry` rejects duplicate features. Apps composing pages without
  the renderer stack add `createTemplateResolverFeature()` themselves.

  DB migration per app: add `title` + `folder` to `read_template_resources`, copy
  `read_text_blocks` rows over as `kind = 'text-block'` (`lang` → `locale`,
  `body` → `content`, `scope` = `'system'` for `SYSTEM_TENANT_ID` else
  `'tenant'`, `status` = `'active'`), then drop `read_text_blocks`.

### Patch Changes

- Updated dependencies [bc1377e]
  - @cosmicdrift/kumiko-bundled-features@0.175.0
  - @cosmicdrift/kumiko-framework@0.175.0

## 0.174.1

### Patch Changes

- Updated dependencies [de0da71]
- Updated dependencies [f5da76a]
- Updated dependencies [50b7d0c]
  - @cosmicdrift/kumiko-framework@0.174.1
  - @cosmicdrift/kumiko-bundled-features@0.174.1

## 0.174.0

### Patch Changes

- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
- Updated dependencies [f4dc0d9]
  - @cosmicdrift/kumiko-framework@0.174.0
  - @cosmicdrift/kumiko-bundled-features@0.174.0

## 0.173.1

### Patch Changes

- Updated dependencies [f23aa36]
- Updated dependencies [f23aa36]
  - @cosmicdrift/kumiko-framework@0.173.1
  - @cosmicdrift/kumiko-bundled-features@0.173.1

## 0.173.0

### Minor Changes

- bca8b46: Add `runWorkerApp` — the worker-shaped counterpart to `runProdApp`. It shares the same boot core (feature composition, PII boot gate, KMS health check, crypto wiring, schema-drift gate, `ensureTemporalPolyfill`) and ends in `createWorkerEntrypoint` instead of `createApiEntrypoint`, plus a `wireComponents` hook for app-wired co-running pieces (analysis runners, IMAP supervisors) that need the system-write dispatcher. Apps deploying a dedicated worker no longer hand-rebuild that boot — a missing polyfill there breaks every job with "Temporal is not defined" in a silent retry loop.

### Patch Changes

- Updated dependencies [20dfb78]
- Updated dependencies [ffce47c]
  - @cosmicdrift/kumiko-framework@0.173.0
  - @cosmicdrift/kumiko-bundled-features@0.173.0

## 0.172.0

### Patch Changes

- Updated dependencies [1fcdfc5]
  - @cosmicdrift/kumiko-framework@0.172.0
  - @cosmicdrift/kumiko-bundled-features@0.172.0

## 0.171.2

### Patch Changes

- Updated dependencies [c717af3]
  - @cosmicdrift/kumiko-bundled-features@0.171.2
  - @cosmicdrift/kumiko-framework@0.171.2

## 0.171.1

### Patch Changes

- Updated dependencies [07b9c04]
- Updated dependencies [f8261c1]
- Updated dependencies [74a0fb3]
  - @cosmicdrift/kumiko-framework@0.171.1
  - @cosmicdrift/kumiko-bundled-features@0.171.1

## 0.171.0

### Patch Changes

- Updated dependencies [d125a49]
- Updated dependencies [32123ff]
- Updated dependencies [716acd6]
- Updated dependencies [9cc21ed]
- Updated dependencies [c284d61]
  - @cosmicdrift/kumiko-framework@0.171.0
  - @cosmicdrift/kumiko-bundled-features@0.171.0

## 0.170.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.170.0
- @cosmicdrift/kumiko-framework@0.170.0

## 0.169.0

### Patch Changes

- Updated dependencies [63157c0]
- Updated dependencies [74e97f3]
- Updated dependencies [644274a]
  - @cosmicdrift/kumiko-bundled-features@0.169.0
  - @cosmicdrift/kumiko-framework@0.169.0

## 0.168.0

### Patch Changes

- Updated dependencies [4c7d3c9]
- Updated dependencies [d149bab]
- Updated dependencies [136bc02]
  - @cosmicdrift/kumiko-framework@0.168.0
  - @cosmicdrift/kumiko-bundled-features@0.168.0

## 0.167.1

### Patch Changes

- 49eb6df: `RunProdAppAuthOptions`/`RunDevAppAuthOptions` now accept `accountLockout` (`maxFailedAttempts`, `lockoutDurationMinutes`), wired through the shared `composeFeatures`/`buildComposeAuthOptions` plumbing that already carries `accountUnlock`. Before this, both wrappers exposed `accountUnlock` — the self-service escape hatch for the lockout's failure counter — with no way to ever set the lockout it's meant to escape, so an app using either wrapper's convenience options couldn't turn on brute-force protection at all (kumiko-framework#1627).
- Updated dependencies [cf5302a]
- Updated dependencies [e75d079]
- Updated dependencies [cf5302a]
  - @cosmicdrift/kumiko-bundled-features@0.167.1
  - @cosmicdrift/kumiko-framework@0.167.1

## 0.167.0

### Patch Changes

- Updated dependencies [57c1da2]
- Updated dependencies [ce30a2c]
- Updated dependencies [6ed2e5d]
  - @cosmicdrift/kumiko-framework@0.167.0
  - @cosmicdrift/kumiko-bundled-features@0.167.0

## 0.166.0

### Patch Changes

- Updated dependencies [8b20a77]
- Updated dependencies [760b2eb]
- Updated dependencies [6679e45]
  - @cosmicdrift/kumiko-framework@0.166.0
  - @cosmicdrift/kumiko-bundled-features@0.166.0

## 0.165.4

### Patch Changes

- Updated dependencies [9bc5823]
  - @cosmicdrift/kumiko-bundled-features@0.165.4
  - @cosmicdrift/kumiko-framework@0.165.4

## 0.165.3

### Patch Changes

- Updated dependencies [e4a0b9b]
  - @cosmicdrift/kumiko-framework@0.165.3
  - @cosmicdrift/kumiko-bundled-features@0.165.3

## 0.165.2

### Patch Changes

- Updated dependencies [ed36555]
  - @cosmicdrift/kumiko-framework@0.165.2
  - @cosmicdrift/kumiko-bundled-features@0.165.2

## 0.165.1

### Patch Changes

- Updated dependencies [4193ec6]
- Updated dependencies [e92295d]
  - @cosmicdrift/kumiko-framework@0.165.1
  - @cosmicdrift/kumiko-bundled-features@0.165.1

## 2.0.0

### Patch Changes

- Updated dependencies [ea3b162]
- Updated dependencies [9b6e4ca]
- Updated dependencies [c58f20f]
- Updated dependencies [eb856c6]
  - @cosmicdrift/kumiko-bundled-features@2.0.0
  - @cosmicdrift/kumiko-framework@2.0.0

## 1.0.0

### Patch Changes

- Updated dependencies [53f83f5]
  - @cosmicdrift/kumiko-framework@1.0.0
  - @cosmicdrift/kumiko-bundled-features@1.0.0

## 0.165.0

### Patch Changes

- Updated dependencies [cf56745]
  - @cosmicdrift/kumiko-framework@0.165.0
  - @cosmicdrift/kumiko-bundled-features@0.165.0

## 0.164.0

### Patch Changes

- Updated dependencies [90b4221]
  - @cosmicdrift/kumiko-framework@0.164.0
  - @cosmicdrift/kumiko-bundled-features@0.164.0

## 0.163.3

### Patch Changes

- Updated dependencies [5c43259]
  - @cosmicdrift/kumiko-framework@0.163.3
  - @cosmicdrift/kumiko-bundled-features@0.163.3

## 0.163.2

### Patch Changes

- Updated dependencies [5dc5290]
  - @cosmicdrift/kumiko-framework@0.163.2
  - @cosmicdrift/kumiko-bundled-features@0.163.2

## 0.163.1

### Patch Changes

- 75174f6: `composeFeatures` now mounts `createAuthSelfRegistrationToggleFeature()` alongside `authOptions.signup`. The self-registration toggle shipped in a recent minor gates `signup-request` on `ctx.hasFeature("auth-self-registration")`, but `composeFeatures`'s `includeBundled` convenience wiring was never updated to mount it — any app relying on that wiring (rather than hand-mounting `createAuthEmailPasswordFeature` itself) got self-signup silently broken: the handler no-ops and returns its always-200 anti-enumeration success response, so no activation mail ever goes out and nothing looks wrong until a user notices the mail never arrives.
  - @cosmicdrift/kumiko-framework@0.163.1
  - @cosmicdrift/kumiko-bundled-features@0.163.1

## 0.163.0

### Patch Changes

- Updated dependencies [0ee7b33]
- Updated dependencies [dc76328]
- Updated dependencies [867e236]
- Updated dependencies [c8b05f0]
  - @cosmicdrift/kumiko-bundled-features@0.163.0
  - @cosmicdrift/kumiko-framework@0.163.0

## 0.162.0

### Patch Changes

- Updated dependencies [08abac2]
- Updated dependencies [5066725]
- Updated dependencies [6d2063c]
  - @cosmicdrift/kumiko-framework@0.162.0
  - @cosmicdrift/kumiko-bundled-features@0.162.0

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
