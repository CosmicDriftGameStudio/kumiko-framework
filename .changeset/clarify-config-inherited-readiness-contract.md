---
"@cosmicdrift/kumiko-bundled-features": patch
---

Clarify the `inheritedToTenant` redaction contract. The read-redaction doc
overstated the guarantee: it claimed a tenant-side viewer learns neither the
inherited platform value "nor that it is set". That holds for the value-
returning queries (`config:query:cascade`, `config:query:values`), which mask
both the value and its presence — but `config:query:readiness` deliberately
reports an `inheritedToTenant:false` key set only at system-level as satisfied
rather than missing. Redaction is display-only (the resolver never consults
`inheritedToTenant`), so the tenant functionally inherits the value; flagging it
as missing would nag tenants to set already-working config. Documented the
boundary in `read-redaction.ts` and `readiness.query.ts`; no behaviour change.
