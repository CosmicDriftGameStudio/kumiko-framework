---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

Follow-ups from the shim removal: typed hook events, a standalone EventDef factory and stricter escapeHatch checks

<!-- kumiko-changes
feature: types
type: breaking
title: SaveContext.event and DeleteContext.event are required
detail: postSave and postDelete hooks always receive the stored event, so event is no longer optional on SaveContext and DeleteContext. Hooks read the caller from event.createdBy instead of guarding for undefined.
migration: Code that builds a SaveContext or DeleteContext by hand, usually in tests, sets event, for example with createTestStoredEvent() from @cosmicdrift/kumiko-testing/helpers. Drop optional chaining on ctx.event in hooks.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: createTestStoredEvent builds a StoredEvent fixture
detail: createTestStoredEvent(overrides) from @cosmicdrift/kumiko-testing/helpers returns a complete StoredEvent with stable defaults, for hook tests that construct SaveContext or DeleteContext directly.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: createEventDef builds an EventDef without a registrar
detail: createEventDef({ feature, name, schema, version?, piiFields? }) from @cosmicdrift/kumiko-framework/engine returns the same EventDef that r.defineEvent returns, including the PII field validation, so shared event definitions can live outside a defineFeature callback.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: escapeHatch on a spread entity query handler requires SystemAdmin access
detail: A query handler that spreads defineEntityListHandler or defineEntityDetailHandler and adds escapeHatch afterwards skipped the SystemAdmin-only access check that the factory option enforces. Registration now applies the same check and throws for any other access.
migration: Pass escapeHatch as an option of defineEntityListHandler or defineEntityDetailHandler with access { roles: access.systemAdmin }, or write a plain r.queryHandler that does not reuse the entity convention handler when a tenant-scoped query needs a raw lookup.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: makeSeedCreateFileRef is exported
detail: makeSeedCreateFileRef and the SeedCreateFileRef type are exported from @cosmicdrift/kumiko-server-runtime, so app seed scripts can create file references the same way the bootstrap seeder does.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: Runtime-isolation guard resolves imports through the TypeScript resolver
detail: The runtime-isolation guard resolves import and re-export targets with ts.resolveModuleName, so path aliases and package exports are followed, and classifies e2e directories as test code. resolveImportTargetPath is exported for other guards.
-->
