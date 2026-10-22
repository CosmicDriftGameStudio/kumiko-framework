---
"@cosmicdrift/kumiko-bundled-features": patch
---

The unsubscribe link origin is resolved once per notify call and tenant, so the app's `tenantOrigin` callback no longer runs once per recipient and a bad value logs one warning per call instead of one per recipient. Tests cover the single lookup, the single warning without error text or addresses, and the form and JSON answers of a resubscribe at the generation limit.

<!-- kumiko-changes
feature: delivery
type: fix
title: Unsubscribe link origin is looked up once per notify call
detail: The tenantOrigin callback runs once per tenant for a notify call with many recipients, and a fallback warning is logged once. A callback that hangs is still not guarded by a timeout, so keep it fast.
-->
