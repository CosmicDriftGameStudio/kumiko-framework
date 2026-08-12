---
"@cosmicdrift/kumiko-renderer": patch
---

Two `RenderEdit` fixes:

- `RenderEdit`'s wizard draft-save/restore feature (`layout.draft: true`) no longer assumes a dispatcher is present — it now reads the dispatcher via `useOptionalDispatcher()` instead of the throwing `useDispatcher()`, and simply stays off when no dispatcher is available instead of crashing. `RenderEdit` still requires a `DispatcherProvider` for submission itself (via the shared `useForm` hook), so mounting it in a fully provider-less tree — Storybook, consumer tests without a wrapper — is not yet supported; tracked separately in framework#1999.
- The wizard draft flow no longer calls bare `crypto.randomUUID()` to mint a draft id — that API is missing in non-secure contexts (`http://` on a LAN IP) and in React Native/Hermes without a polyfill, both of which `packages/renderer` must stay compatible with. A new local `mintDraftId()` helper guards for `crypto.randomUUID`'s availability and falls back to a `Math.random()`-based id, mirroring the existing `generateRequestId` guard in `packages/dispatcher-live`.
