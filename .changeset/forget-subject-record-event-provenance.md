---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

forget-subject now accepts a record subject for a DPO when the owning tenant is proven by the event stream, not only by a projection row. A record whose row was already deleted, or a custom aggregate without a registered entity, can be shredded by the DPO of the tenant that owns it. A DPO of another tenant is still denied.

<!-- kumiko-changes
feature: crypto-shredding
type: fix
title: forget-subject tenant check falls back to event-store provenance
-->
