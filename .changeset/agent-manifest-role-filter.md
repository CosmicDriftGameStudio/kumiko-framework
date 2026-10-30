---
"@cosmicdrift/kumiko-bundled-features": minor
---

The agent manifest lists only the features and entities the role reaches.

<!-- kumiko-changes
feature: agent-tools
type: improvement
title: Agent manifest features and entities follow the role
detail: `buildAgentManifest` now leaves out a feature when none of its handlers, screens or navs remain in the manifest for the role, and an entity when no remaining handler or screen refers to it, no `get_`/`list_` tool of the role reads it and no reachable entity points at it through a reference field (one hop). Before, `features` and `entities` were identical for every role, so a restricted role paid for schemas it could not use in every system prompt. A translation-only feature such as `locale-de` no longer appears in `features`.
-->
