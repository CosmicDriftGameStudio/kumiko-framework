---
"@cosmicdrift/kumiko-framework": patch
---

kms.eraseKey is now gated by the agent-risk floor for irreversible operations at configurePiiSubjectKms; the deferred-context exception is documented.

<!-- kumiko-changes
feature: framework
type: fix
title: kms.eraseKey is now gated by the agent-risk floor for irreversible operations
migration: |
  `configurePiiSubjectKms(adapter)` now stores a wrapper whose `eraseKey`
  runs `assertIrreversibleOperationAllowed("kms.eraseKey")` before
  delegating — the same agent-risk floor `executor.forget()`/`delete()`
  already enforce. A directly-dispatched write handler that calls
  `configuredPiiSubjectKms()!.eraseKey(...)` must resolve `agent.risk:
  "high"`, or the call is denied with `access_denied` /
  `irreversible_operation_requires_high_risk`.

  Cron-triggered jobs and pipelines started by a `risk: "high"` handler are
  unaffected — they run outside any entry handler or already resolve
  "high". `crypto-shredding:write:forget-subject`, the manual
  `run-forget-cleanup` operator trigger, and framework-internal cleanup
  hooks already satisfy this.
-->
