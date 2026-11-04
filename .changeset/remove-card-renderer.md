---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
---

The unused `cardRenderer` field is removed from list screens.

<!-- kumiko-changes
feature: renderer
type: breaking
title: cardRenderer removed from entityList and projectionList
detail: `cardRenderer` was declared and passed through but never rendered; the narrow layout always drew the default card from the column roles. The field is gone from `EntityListScreenDefinition` and `ProjectionListScreenDefinition`.
migration: Remove the field; cards follow the column roles `highlighted`, `hideOnNarrow` and `hint`.
-->
