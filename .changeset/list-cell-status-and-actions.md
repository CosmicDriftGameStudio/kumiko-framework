---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

List cells now render what the rest of the UI already could: coloured status badges and collapsed row actions.

- A `select`-typed column whose raw value is a known status word (`active`, `pending`, `failed`, …) renders the toned status pill the projectionDetail header already used, instead of a grey outline badge. Values outside that vocabulary keep the neutral pill, and `text`/`multiSelect` columns are untouched.
- `entityList` and `projectionList` row actions where every action resolves an icon now render inline and collapse to icon-only buttons, the same rule the edit mask footer follows. Each button keeps its action label as `aria-label` and `title`.

Consumer note: a list with more than two row actions that all resolve an icon moves from the "More actions" kebab to a row of icon-only buttons. End-to-end tests that open the kebab (`[data-testid$="-actions-menu"]`) to reach such an action need to click the action button directly instead. A group with at least one icon-less action keeps the kebab. `RenderList` accepts a `rowActionMode` prop to pass the mode explicitly, and `statusToneForValue` is exported from `@cosmicdrift/kumiko-renderer` for apps that map their own status values.
