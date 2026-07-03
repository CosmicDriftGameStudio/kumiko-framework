---
"@cosmicdrift/kumiko-bundled-features": minor
---

EXT_USER_DATA hooks for the events-only aggregates (deferred from #797, closes the export gap of #799): `delivery-attempt` (per-tenant, by recipientId — recipientAddress decrypts through the export runner's central sweep) and `job-run` (by triggeredById across tenants — job runs live on the SYSTEM tenant). Delete hooks are deliberate no-ops: erasure runs via crypto-shredding, a read-side UPDATE would be wiped on rebuild.
