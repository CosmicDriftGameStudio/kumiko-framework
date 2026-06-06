# Sample: Error Contract

**I want to write a handler that handles errors cleanly — no HTTP codes, no JSON bodies, no try/catch chains.**

## What this sample shows

Every Kumiko error class in a real handler context. A single feature `orders-lite`, four handlers, 7 test cases each demonstrating a typical error situation.

## The recipe in 3 sentences

1. The handler throws or returns a `KumikoError` via `writeFailure(...)` or `failNotFound(...)` / `failUnprocessable(...)`.
2. The dispatcher translates it into HTTP status + wire format — always `{ code, i18nKey, message, details?, requestId?, timestamp }`.
3. The client reads `error.code` (stable category) or `error.details.reason` (feature-specific subtype).

## The classes — when do I use which?

| Class | HTTP | Use in handler |
|---|---|---|
| `ValidationError` | 400 | Automatic from Zod. Never throw manually, only for validation-hook errors. |
| `AccessDeniedError` | 403 | "You're not allowed" — ownership, role check, field lock. |
| `NotFoundError` | 404 | Entity doesn't exist. Automatic via `failNotFound(entity, id)`. |
| `ConflictError` | 409 | State collision without a version (e.g. "paid orders can't be cancelled"). |
| `VersionConflictError` | 409 | Optimistic lock — comes out of CrudExecutor automatically. You never throw it. |
| `UnprocessableError` | 422 | Business rule violated. The reason string describes what. |
| `InternalError` | 500 | You **don't throw it yourself**. The framework wraps unexpected throws automatically. |

## Convenience helpers

Instead of

```ts illustration
return { isSuccess: false, error: toWriteErrorInfo(new NotFoundError("order", id)) };
```

write

```ts illustration
return failNotFound("order", id);
```

Likewise: `failUnprocessable("reason", details?)` and `writeFailure(new AnyKumikoError(...))`.

## Reason codes — the convention

When your feature needs its own differentiation (e.g. `already_paid` vs. `already_cancelled`), use `UnprocessableError` or `ConflictError` and set `details.reason`:

```ts illustration
export const OrdersLiteReasons = {
  alreadyPaid: "already_paid",
  alreadyCancelled: "already_cancelled",
} as const;

return failUnprocessable(OrdersLiteReasons.alreadyPaid, { orderId });
```

**Rules:**
- `snake_case`, no spaces
- One `<Feature>Reasons` const-object per feature
- Framework reasons (`stale_state`, `invalid_transition`, `field_access_denied`, `delete_restricted`) come from `FrameworkReasons` — **reuse, don't duplicate**

## Throw vs. writeFailure

Both end up in the same wire format. Rule of thumb:

- **Handler top-level** → `return writeFailure(new X())` or the `failX(...)` helpers. The return type is explicit.
- **Deep inside a helper function** → `throw new KumikoError(...)`. Otherwise you'd have to thread `WriteResult` through every function signature.

## Cause chain

When you throw a KumikoError that has another error as its cause:

```ts illustration
try {
  await externalApi.call();
} catch (e) {
  throw new ConflictError({
    message: "upstream rejected the sync",
    i18nKey: "orders-lite.errors.upstreamReject",
    details: { reason: "upstream_reject" },
    cause: e instanceof Error ? e : undefined,
  });
}
```

The chain lands in the log (for forensics), but **not** in the response to the client. No manual filter required.

## What you should **not** do

- `throw new Error("string")` — becomes `InternalError` (500), the client sees no helpful error
- `return { isSuccess: false, error: "string" }` — not a valid `WriteErrorInfo`, TypeScript blocks it but it's a typical pre-v1 pattern
- Custom `class MyError extends Error` — also becomes `InternalError`. Use `UnprocessableError` + `details.reason` for feature subtypes
- Reason strings like `"userNotAllowedToEditRecord"` (camelCase) or with spaces — the convention is `snake_case`

## Further reading

- Full class definitions: `packages/framework/src/errors/classes.ts`
- Gold-standard integration test: `packages/framework/src/__tests__/error-contract.integration.ts`
- Architecture plan: [`docs/plans/architecture/error-contract.md`](../../docs/plans/architecture/error-contract.md)
