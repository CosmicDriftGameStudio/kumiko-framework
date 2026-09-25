---
"@cosmicdrift/kumiko-framework": minor
---

MultiStreamApplyContext gains a required registry field

<!-- kumiko-changes
feature: framework
type: breaking
title: MultiStreamApplyContext gains a required registry field
migration: |
  Any hand-built MultiStreamApplyContext (e.g. in an MSP test that constructs the context object literal instead of using createMultiStreamApplyContext/setupTestStack) must add registry: <the app Registry instance>, the same instance HandlerContext/JobContext already expose. Lets an apply resolve extension-point usages (registry.getExtensionUsages) to pick behavior by payload discriminant, e.g. a provider-routed MSP.
-->
