// @runtime client
// Public exports for the browser side of the billing-foundation feature.
// Consumed via `@cosmicdrift/kumiko-bundled-features/billing-foundation/web` —
// the server side (createBillingFoundationFeature) lives under
// `@cosmicdrift/kumiko-bundled-features/billing-foundation` and has no React deps.

export { BillingPlansPanel } from "./billing-plans-panel";
export { type BillingFoundationClientOptions, billingFoundationClient } from "./client-plugin";
