---
"@cosmicdrift/kumiko-framework": patch
---

The auto transition guard lets a write through that resends the unchanged state value, so an edit form that sends every field no longer fails with `Invalid transition: "active" → "active"`, also not from a terminal state.

<!-- kumiko-changes
feature: framework
type: fix
title: Transition guard ignores an unchanged state value
detail: An update whose `changes` carry the state field with the value the row already has is no transition, so the guard skips it instead of rejecting it as a self-transition that the map does not list. Before, a rename on a `sold` or `finished` row failed as soon as the client sent the current status along.
-->
