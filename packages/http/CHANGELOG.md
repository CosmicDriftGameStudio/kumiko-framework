# @cosmicdrift/kumiko-http

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
