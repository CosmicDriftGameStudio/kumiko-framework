---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-guards": minor
---

`billing-plans-panel` now surfaces a `past_due` subscription with its own warning banner, instead of looking the same as an active one. `switch-plan` now rejects switching a subscription that already has a scheduled cancellation (`cancelAt` set) with a `409 cancellationScheduled` conflict — the tenant must reactivate first; the billing-plans query and panel reflect this by marking every switch target `unavailable` and pointing at reactivation. A new `retrieveSubscription` provider-plugin method (implemented for Stripe) plus a `sync-subscription` write-handler and `sync-subscriptions` job backfill drift — like a `cancel_at` set on the provider's own dashboard — that never arrived as a webhook, appending it as a real `subscription.updated` event. `isBillingEnabled` no longer throws for an unregistered provider name, returning `false` instead. `kumiko-testing integration` now accepts positional test-file args, `kumiko-upgrade`/`kumiko-schema` gained a `--help`, and `pre-push.sh` now refuses to push a repo with a stale `.kumiko/upgrade-state.json`.

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: switch-plan rejects a subscription with a scheduled cancellation
detail: |
  `billing-foundation:write:switch-plan` now throws a `409 ConflictError`
  (`billing-foundation.errors.cancellationScheduled`) when the tenant's
  subscription already has `cancelAt` set — switching plans mid-cancellation
  previously silently proceeded and could leave the new plan itself
  scheduled to cancel. `billing-foundation:query:billing-plans` now resolves every
  non-current plan's `action` to `unavailable` (instead of `switch`) while a
  cancellation is scheduled, and the billing-plans panel shows a
  `switchRequiresReactivation` message alongside the existing
  `cancelScheduled` banner.
migration: |
  A tenant that switches plans while their subscription is scheduled to
  cancel now gets a 409 instead of a successful switch. Callers driving
  `switch-plan` directly (not through the bundled panel) must reactivate the
  subscription first (`create-portal-session` / the provider's own
  reactivation flow) before retrying the switch.
-->

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: past_due banner on the billing-plans panel; sync-subscription backfill for provider-side drift
detail: |
  `billing-plans-panel` renders a `past_due`-status warning banner
  (`billing-foundation.plans.pastDue`) alongside the existing
  payment-pending/cancel-scheduled ones. `SubscriptionProviderPlugin` gained
  an optional `retrieveSubscription(ctx, providerSubscriptionId)` method
  returning a `ProviderSubscriptionSnapshot`; the new
  `billing-foundation:write:sync-subscription` handler (`agent.expose:
  false`, `SYSTEM_ROLE`/`SystemAdmin`-only — the `sync-subscriptions` job's
  own systemUser only carries `SYSTEM_ROLE`) compares the live snapshot
  against `read_subscriptions` and appends a `subscription.updated` (or
  `subscription.canceled`, when the snapshot's own status is terminal)
  event with a deterministic `sync:<sha256>` providerEventId when it has
  drifted, a no-op otherwise. The `sync-subscriptions` job (manual-trigger +
  runOnBoot, perTenant) dispatches it and is registered unconditionally.
  `isBillingEnabled(ctx, providerName)` returns `false` instead of throwing
  when `providerName` isn't registered.
migration: |
  No action needed — every part is additive. Apps on `subscription-stripe`
  automatically get `retrieveSubscription` wired; a custom provider plugin
  without one makes `sync-subscription` report
  `{ synced: false, reason: "provider_cannot_retrieve" }` instead of syncing.
  On the next deploy, `sync-subscriptions`' `runOnBoot` fires once per Redis
  dataset (not once per replica) with one provider API call per tenant that
  has a live subscription. If that run is interrupted (deploy killed
  mid-fan-out, Redis restart), it is not re-run automatically on the next
  boot — trigger it manually via `billing-foundation:job:sync-subscriptions`
  (`jobs:write:trigger`) to catch up.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: kumiko-testing integration accepts positional test-file args
detail: |
  `kumiko-testing integration` now runs only the given files/globs when
  positional args are passed, instead of always discovering every
  `*.integration.test.ts` file.
migration: No action needed — omitting positional args keeps the previous full-discovery behavior.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: kumiko-upgrade gained --help/-h
detail: Prints usage and exits 0 without running the upgrade report.
migration: No action needed.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: kumiko-schema gained --help/-h/help
detail: Prints usage listing the available subcommands and exits 0.
migration: No action needed.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: pre-push.sh refuses to push a stale .kumiko/upgrade-state.json
detail: |
  When `.kumiko/upgrade-state.json` exists at the repo root, `pre-push.sh`
  now runs the upgrade-state guard before its main check and refuses the
  push if the guard fails, resolving `guard-upgrade-state.ts` next to the
  hook's real (symlink-resolved) script location.
migration: |
  A repo that has adopted `.kumiko/upgrade-state.json` and is currently
  stale now has its push blocked until the upgrade state is reconciled. A
  repo without that marker file is unaffected.
-->
