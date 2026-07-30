---
"@cosmicdrift/kumiko-bundled-features": minor
---

`cap-counter` gains `createStockCapGuard`, `tier-engine` gains `createTierResolver`, and `billing-foundation` gains `createSubscriptionTierSync` — generic factories over an app-supplied `TCaps`/`TTier` for the stock-cap write-guard, tier-assignment resolution, and the subscription-webhook → tier-engine sync route. Extracted from the near-identical per-app copies of these three files in show-pony and publicstatus, flagged as cross-repo duplicate clusters in infra#446. The two apps migrate onto these factories in a follow-up PR once this version is published.
