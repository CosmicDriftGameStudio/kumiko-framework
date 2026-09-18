---
"@cosmicdrift/kumiko-bundled-features": minor
---

Extracted shared implementations behind three near-identical internal duplicates (kumiko-framework#2999): `shared/lockout-counter.ts` (Redis INCR/NX failed-attempt counter, used by `auth-email-password/lockout-store.ts` and `auth-mfa/mfa-verify-attempts.ts`) and `shared/single-use-token-store.ts` (bidirectional token↔subject Redis store with burn/unburn, used by `auth-email-password/signup-token-store.ts` and `auth-email-password/invite-token-store.ts`). All existing exported function/type names and Redis key prefixes are unchanged.

Added `createBillingInfoQueryConfig` (exported from `billing-foundation`) — a factory for the billing-info query-handler config (tier + subscription status + configured Stripe prices), extracted from the near-identical app copies in show-pony and publicstatus. It returns a handler-config object rather than calling `defineQueryHandler` itself, so apps can pass it through their own wrapper.

Added the public subpath export `./shared/single-use-token-store`, for an upcoming external-repo migration (offlot-app#418) that needs the same token-store factory with byte-compatible Redis key prefixes.
