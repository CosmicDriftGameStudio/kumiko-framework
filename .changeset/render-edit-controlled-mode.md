---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Fix #1887: `RenderEdit` gains a controlled mode for callers that embed it
directly (e.g. Solon), without going through an Extension section:

- `onChange?: (state: { values, changes, dirty, valid }) => void` fires on
  every values-snapshot change. `changes` is the delta against the initial
  values (same semantics as `payloadMode: "changes"`), so a caller never
  overwrites unseen fields. `valid` is a dry-run `schema.safeParse`, so it
  never paints field errors into the UI.
- `onControlsReady?: (controls: { patch, validate, getValues }) => void`
  fires once after mount and hands the caller `patch(partial)` to set
  values from outside without a remount, `validate()` to check without a
  write (reports field errors on the field itself, not a summary banner),
  and `getValues()`.

Both props are optional and additive — without them, existing `RenderEdit`
behavior is unchanged.
