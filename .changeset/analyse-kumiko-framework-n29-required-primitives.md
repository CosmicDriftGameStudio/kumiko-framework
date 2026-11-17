---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-document-designer": patch
---

All CorePrimitives are required; tests build their primitives with `createStubPrimitives` from `@cosmicdrift/kumiko-renderer/testing`.

<!-- kumiko-changes
feature: renderer
type: breaking
title: Every CorePrimitive is required, createStubPrimitives replaces partial test stubs
detail: The 25 primitives that were optional only so partial test mocks kept compiling (Drawer, Tabs, PageHeader, StatusBadge, Metric, FillContainer, StepBar, ActionOverflowMenu and others) are now required in `CorePrimitives`. The renderer no longer carries fallback branches or "primitive not registered" warnings for them; screens always render through the registered primitive. `createKumikoApp({ primitives })` still takes a partial override merged over `defaultPrimitives`, so apps that only use createKumikoApp change nothing. `createStubPrimitives(overrides)` from `@cosmicdrift/kumiko-renderer/testing` returns a complete registry whose entries render nothing, with the overrides on top; it needs no DOM.
migration: Replace hand-written `CorePrimitives` objects in tests (`const p: CorePrimitives = { ... }` or `{ ... } as unknown as CorePrimitives`) with `createStubPrimitives({ ... })`. Code that builds a full `CorePrimitives` value outside createKumikoApp must supply all 43 entries. Remove checks like `primitives.Drawer !== undefined`.
-->
