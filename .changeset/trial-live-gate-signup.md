---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
---

tier-engine: derive the trial from `tenant.inserted_at` and enforce it as a live gate

Real auth-signups create the tenant via `seedTenant` (event-store executor), which
bypasses the dispatcher `postSave` hook — so the auto-default `tier-assignment` row was
never written and the cached trial-clock never warmed. A freshly signed-up tenant got
neither a tier-assignment nor the 30-day trial on the server side.

The trial is now derived from `tenant.inserted_at` (which always exists for every tenant)
and checked live at the dispatcher feature-gate via a new optional `trialGate` on
`EffectiveFeaturesResolver`, consulted only on the already-disabled cold path. The sync
boot-cached resolver hot path is unchanged; `checkFeatureEnabled`/`ensureFeatureEnabled`
become async (both call sites were already async). Removes the cached `trialClock` and the
resolver trial-union. New exported type: `TrialGate`.
