---
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix the root cause behind fw#2703: any extension section that renders its own `<Form>` via `BareFormProvider` (not just the two `user-profile` sections fw#2703 patched) landed inside `RenderEdit`'s host `<form>`, producing invalid nested `<form>` elements. In a real browser this can make the section's submit fall back to a native GET of the *outer* form, putting the form's field values in the URL query string.

`DefaultForm` (`packages/renderer-web/src/primitives/index.tsx`) now checks whether it is already rendering inside another form (`InsideFormContext`) and degrades to a `<div>` instead of a second `<form>` in that case. A captured click on the degraded section's own submit button is intercepted and routed to its `onSubmit` directly, so the button still submits the *inner* section instead of activating the real ancestor `<form>`.

Closes #2705.
