---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-feature-ast": minor
---

An entity carries its name: `createEntity({ name, ... })`, and `r.entity`, `r.crud`, `createEntityExecutor`, `buildEntityTable` and `deriveEntityTableMeta` take the entity without a separate name.

<!-- kumiko-changes
feature: framework-core
type: breaking
title: Entities carry their name
detail: `createEntity` requires `name`, and `EntityDefinition` has `name`. `r.entity(entity)` or `r.entity({ ...entity, backingTable })`, `r.crud(entity, options?)`, `createEntityExecutor(entity)`, `buildEntityTable(entity, options?)` and `deriveEntityTableMeta(entity, options?)` read it from the entity, so the name given at registration and the one given to the executor can no longer differ.
migration: Run the codemod. It moves the name from `r.entity({ name, ...entity })`, `r.crud("name", entity)`, `createEntityExecutor("name", entity)`, `buildEntityTable("name", entity)` and `deriveEntityTableMeta("name", entity)` into the entity's `createEntity` call and drops the name argument. An entity used under a second name becomes `{ ...entity, name: "other" }` at that site. Entities it cannot resolve are listed as manual; add `name` there by hand.
affects: createEntity, r.entity, r.crud, buildEntityTable, deriveEntityTableMeta, EntityDefinition
codemod: scripts/codemod/entity-name.ts
manualAfterCodemod: true
-->
