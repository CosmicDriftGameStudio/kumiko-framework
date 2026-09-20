---
status: reference
verified: 2026-09-20
---

# When a test goes red

A red or flaky test has a cause. Raising a timeout, adding a retry or adding
workers only hides it, and the hidden cause comes back as a slower, flakier
suite. Diagnose in this order and stop at the first step that explains it.

## Diagnosis order

1. **Reproduce a single run.** Run the one file (`bun test path/to/file.test.ts`,
   or `playwright test path/to/file.spec.ts --repeat-each=10`). A test that only
   fails inside the full suite points at shared state, not at the test itself.
2. **Check shared state and missing isolation.** Every flow gets its own tenant.
   Two flows writing to the same tenant, user or row race each other.
3. **Wait for a condition, not for time.** See below.
4. **Check the seed.** Missing or half-applied seed data looks exactly like a
   timing problem.
5. **Only then change the central template**, through an issue. Never adjust
   timeouts, retries or workers per app, and never as a reflex.

The `test-timeouts` guard enforces step 3 and points back here.

## Wait for a condition

Bun tests and integration tests use `waitFor`. It tries first, so an
already-true condition returns immediately, and retries with a backoff:

```ts
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";

await waitFor(() => {
  expect(events).toHaveLength(1);
});
```

Playwright specs use web-first assertions or `expect.poll`:

```ts
await expect(page.getByRole("status")).toHaveText("Saved");
await expect.poll(() => readRowCount(), { timeout: 10_000 }).toBe(3);
```

The guard flags `test.setTimeout`, `test.slow`, `page.waitForTimeout` and
loops that call `sleep()` or `new Promise(r => setTimeout(r, n))`. A single
`sleep()` outside a loop (simulating slow work) is fine.

## Exceptions

If a wait cannot be expressed as a condition, mark the line (or the loop
statement) directly above or on it:

```ts
// @timeout-exception: #1234 sidecar has no readiness signal, cold start takes 40s
test.setTimeout(60_000);
```

The marker needs an issue number and a technical reason. A marker without
either is ignored and the guard says so. "Flaky" or "slow CI" is not a reason.

## Real-provider tests

Tests that call a real external provider (LLM, mail, payment) are named
`*.real.test.ts` (Bun) or `*.real.spec.ts` (Playwright) and start with
`requireRealProviders()` from `@cosmicdrift/kumiko-framework/testing`.
They run only when `KUMIKO_REAL_PROVIDERS=1` is set, through the `test:real` /
`e2e:real` scripts, and never in CI: with `CI` set the call throws. A provider
API key in the environment never enables them on its own.
