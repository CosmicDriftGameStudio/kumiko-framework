---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-types": patch
---

Review round 3 for readiness, config, cap-counter, cap-overview and admin-shell: conditional secret readiness, encrypted keys closed to config validators, canonical stock-cap lock keys, visible overage on not-included caps, and batched cap limits for the tenant list.

<!-- kumiko-changes
feature: bundled-features
type: fix
title: Readiness, config, cap and admin-shell review fixes
detail: A secret can declare requiredWhenConfigSet (qualified config key name) and readiness:query:status then counts it as missing only while that key is non-empty; the SMTP password uses it with authUser. ConfigValidateContext.readCascade refuses encrypted, secrets-backed and piiEncrypted keys with an internal error so a validator cannot echo their plaintext. The stock-cap lock key sorts where-keys at every depth and serializes Temporal and Date values by their string form, so handlers counting the same rows share one lock. A cap with limit 0 and usage above zero shows the used amount with cap-overview.notIncludedButUsed instead of only "Not included" (bar, cap cards, tenant list). CapSpec gets an optional limitBatch that tenant-caps:list prefers over one limit() call per tenant and cap, and the limit comment no longer claims it is resolved once per tier. Admin-shell nav option types are split per workspace with required booleans. The forget-cleanup handler-name constant moved off the sanitizeReasonForLog comment, and the download-attempt comment now states why token-path rows stay on the tenant key. Test coverage added for a recently started run that was requested long ago staying active in run-probes.
-->
