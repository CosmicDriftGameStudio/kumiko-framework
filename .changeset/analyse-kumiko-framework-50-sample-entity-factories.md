---
"@cosmicdrift/kumiko-samples": patch
---

The ui-walkthrough, workspaces and showcase samples define their entities with `createEntity` and field factories.

<!-- kumiko-changes
feature: samples
type: improvement
title: Sample entities use createEntity instead of a cast literal
detail: `taskEntity` (ui-walkthrough), `orderEntity` (workspaces) and `itemEntity` (showcase) were object literals cast with `as unknown as EntityDefinition` and the internal `allowPlaintext` flag. They now use `createEntity` with `createTextField({ personal: false, reason })` and the other field factories from `@cosmicdrift/kumiko-framework/engine`, so the type checker sees the text-field stance. Their text fields take the factory default `maxLength: 200`.
-->
