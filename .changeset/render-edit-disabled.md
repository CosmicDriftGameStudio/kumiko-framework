---
"@cosmicdrift/kumiko-renderer": minor
---

Fix #1896: `RenderEdit` gains an optional `disabled?: boolean` prop that locks
the whole form — every rendered field and the submit/wizard-next button go
visibly inactive, and `handleSubmit` short-circuits so a native form submit
(e.g. Enter key) can't sneak a write past the disabled button. For cases
where input becomes moot, e.g. an editor pointing at an existing record
instead of creating a new one.

Extension sections are out of scope: RenderEdit has no way to force-disable
an arbitrary registered component. Omitting the prop keeps existing
behavior unchanged.
