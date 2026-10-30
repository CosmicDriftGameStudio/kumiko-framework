---
"@cosmicdrift/kumiko-bundled-features": minor
---

The agent manifest carries labels as one string in the requested locale and shows only the first sentence of a feature description.

<!-- kumiko-changes
feature: agent-tools
type: breaking
title: Agent manifest labels are one string in the requested locale
detail: `buildAgentManifest` used to emit every label in every locale (`labels: { de, en, es }`, often `{}`), although the caller names one `locale`. Entities, fields, navs and workspaces now carry `label?: string`, screens `title?: string`, picked in the requested locale, then English, then the first other locale, and left out when untranslated. Empty `params` and `workspaces` on screens, empty `workspaces` on navs and an empty handler `description` are left out as well (`description`, `params` and `workspaces` are optional in the types). `buildToolCatalog` reads the new fields.
migration: Read `entity.label`, `field.label`, `nav.label`, `workspace.label` and `screen.title` instead of the `labels`/`titles` maps. Code that only passes the manifest to `buildToolCatalog` or serialises it needs no change.
-->

<!-- kumiko-changes
feature: agent-tools
type: improvement
title: Agent manifest shows only the first sentence of a feature description
detail: `buildAgentManifest` emits the first sentence of `FeatureDefinition.description` (a `. ` before a capital letter ends it, so "e.g." and "Art. 15" stay whole), at most 300 characters. The full text stays on the definition for the docs generators. In an app with 77 features the descriptions drop from about 46.6k to 12.2k characters.
-->
