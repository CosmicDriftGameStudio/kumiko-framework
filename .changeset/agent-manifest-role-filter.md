---
"@cosmicdrift/kumiko-bundled-features": minor
---

The agent manifest lists only the features and entities the role reaches, and labels come as one string in the requested locale.

<!-- kumiko-changes
feature: agent-tools
type: improvement
title: Agent manifest features and entities follow the role
detail: `buildAgentManifest` now leaves out a feature when none of its handlers, screens or navs remain in the manifest for the role, and an entity when no remaining handler or screen refers to it, no `get_`/`list_` tool of the role reads it and no reachable entity points at it through a reference field (one hop). Before, `features` and `entities` were identical for every role, so a restricted role paid for schemas it could not use in every system prompt. A translation-only feature such as `locale-de` no longer appears in `features`.
-->

<!-- kumiko-changes
feature: agent-tools
type: breaking
title: Agent manifest labels are one string in the requested locale
detail: `buildAgentManifest` used to emit every label in every locale (`labels: { de, en, es }`, often `{}`), although the caller names one `locale`. Entities, fields, navs and workspaces now carry `label?: string`, screens `title?: string`, picked in the requested locale, then English, then the first other locale, and left out when untranslated. Empty `params` and `workspaces` on screens, empty `workspaces` on navs and an empty handler `description` are left out as well (`description`, `params` and `workspaces` are optional in the types). `buildToolCatalog` reads the new fields.
migration: Read `entity.label`, `field.label`, `nav.label`, `workspace.label` and `screen.title` instead of the `labels`/`titles` maps. Code that only passes the manifest to `buildToolCatalog` or serialises it needs no change.
-->
