---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-types": minor
---

The key figures of an action form preview and success box now line up as a name-value list with the values in one column, and a figure marked `emphasize` (such as a total) is bold with a rule above it.

<!-- kumiko-changes
feature: renderer
type: breaking
title: Action form facts render as a name-value list
detail: Single-line `facts` of an actionForm preview or success box render through the new core primitive `KeyValueList` (label left, value right-aligned) instead of one text line "Label: Value". `ActionFormSuccessFact` gains `emphasize`. A fact row keeps its `...-fact-<n>` test id; its text is no longer "Label: Value".
migration: A custom primitive set adds `KeyValueList: ComponentType<KeyValueListProps>` (rows with key, label, value, optional emphasize and testId). Tests that read the old "Label: Value" text read the label and value cells instead.
affects: renderer, ActionFormSuccessFact, KeyValueList, CorePrimitives
-->
