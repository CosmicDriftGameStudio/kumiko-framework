---
"@cosmicdrift/kumiko-bundled-features": minor
---

billing-plans now reports a scheduled cancellation and the panel offers reactivation

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: billing-plans now reports a scheduled cancellation and the panel offers reactivation
migration: |
  SubscriptionView and BillingPlansResult.subscription gain two REQUIRED
  fields: `currentPeriodEnd` (a `Temporal.Instant`, ISO string on
  BillingPlansResult) and `cancelAt` (`Temporal.Instant | null`, ISO
  string or null on BillingPlansResult). Any test fake that constructs a
  SubscriptionView object literal directly must add both fields.
  BillingPlansResult.currentTier also gains a `benefits` field
  (via `catalog.benefits(currentTier)`), computed even when currentTier is
  outside `catalog.plans` (e.g. a legacy/free tier).

  The Stripe provider now maps `subscription.cancel_at` (or
  `current_period_end` when only `cancel_at_period_end` is set) into a new
  `cancelAtIso` event payload field; process-event applies it with
  set/clear/leave-unchanged semantics, so an event without the field never
  wipes a previously recorded value.

  BillingPlansPanel shows an info banner ("Your subscription is scheduled
  to end on {date}") whenever `subscription.cancelAt` is set and the
  subscription isn't terminal, and swaps the manage-subscription button's
  label to "Reactivate subscription" in the same case. The synthetic
  current-tier card (a tier outside `catalog.plans`, e.g. a legacy/free
  tier) now also renders `catalog.benefits(currentTier)` and the same
  manage/reactivate action as a catalog card, via a shared helper — no
  action needed unless an app relied on that card being action-less.

  `read_subscriptions` gains a nullable `cancel_at` column. Every app that
  mounts billing-foundation — including a plain `billingFoundationFeature()`
  with no catalog (e.g. kumiko-studio) — must run
  `bun run schema:generate <name>` (wired to `bun kumiko-schema generate
  <name>`) and commit the resulting migration file. Skipping this leaves
  the app's own `read_subscriptions` table without the column, so the
  projection's `apply` fails at the next subscription webhook. The column
  is additive and nullable — no rebuild, existing rows keep it `null`
  until their next subscription webhook.
-->
