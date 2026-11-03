---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-types": patch
---

Review round 3 for readiness, config, cap-counter, cap-overview and admin-shell: conditional secret readiness, encrypted keys closed to config validators, canonical stock-cap lock keys, visible overage on not-included caps, and batched cap limits for the tenant list.

<!-- kumiko-changes
feature: readiness
type: fix
title: Conditional secret readiness
detail: A secret can declare requiredWhenConfigSet (qualified config key name) and readiness:query:status then counts it as missing only while that key is non-empty; the SMTP password uses it with authUser. Test coverage added for a recently started run that was requested long ago staying active in run-probes.
-->

<!-- kumiko-changes
feature: config
type: fix
title: Encrypted keys closed to config validators
detail: ConfigValidateContext.readCascade refuses encrypted, secrets-backed and piiEncrypted keys with an internal error so a validator cannot echo their plaintext.
-->

<!-- kumiko-changes
feature: cap-counter
type: fix
title: Canonical stock-cap lock keys
detail: The stock-cap lock key sorts where-keys at every depth and serializes Temporal and Date values by their string form, so handlers counting the same rows share one lock.
-->

<!-- kumiko-changes
feature: cap-overview
type: fix
title: Visible overage on not-included caps, batched limits
detail: A cap with limit 0 and usage above zero shows the used amount with cap-overview.notIncludedButUsed instead of only "Not included" (bar, cap cards, tenant list). CapSpec gets an optional limitBatch that tenant-caps:list prefers over one limit() call per tenant and cap, and the limit comment no longer claims it is resolved once per tier.
-->

<!-- kumiko-changes
feature: admin-shell
type: fix
title: Nav option types split per workspace
detail: Admin-shell nav option types are split per workspace with required booleans.
-->
