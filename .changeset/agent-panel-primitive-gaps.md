---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Three additive primitive gaps closed, surfaced while wiring an AI-agent panel and the Designer's file links:

- `ShellHeader` now exposes its rendered height as the `--shell-header-height` CSS variable (`0` when no `ShellHeader` is mounted). `Drawer` gets an optional `belowHeader?: boolean` (`variant="flush"` only) that docks the panel below the app header instead of covering it — default `false` keeps today's edge-to-edge behavior.
- `Card`, `Link`, `Button` and `Input` (`kind="text"`/`"textarea"`) get an optional `dataAttributes?: Readonly<Record<\`data-${string}\`, string>>` prop, forwarded to the rendered DOM node in the web renderer — an escape hatch for E2E selectors that don't warrant a dedicated typed prop, without dropping to a raw `<a>`/`<div>`.
- `Input` (`kind="text"`/`"textarea"`) gets an optional `onKeyDown` handler, forwarded in the web renderer, so a caller can build "Enter sends, Shift+Enter inserts a newline" at the field itself instead of the surrounding `Form`. Composes with the existing `onSubmitShortcut` (`kind="textarea"`) — both fire on the same keystroke when both are set.
