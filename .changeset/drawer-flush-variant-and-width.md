---
"@cosmicdrift/kumiko-renderer-web": minor
---

`Drawer` gains two optional props, both additive with defaults matching today's behavior exactly: `variant?: "floating" | "flush"` (default `"floating"`) docks the panel flush against the viewport edge instead of the floating detached-panel treatment — full extent, no corner radius, and a border only on the edge facing the app content; `width?: number | string` (default: today's `max(600px, 37.5vw)`) sets the panel's base width for `side="left"|"right"`, superseded by `resize` when that's set. Lets consumers like the AI agent panel render a bounded, edge-docked chat drawer instead of the wide floating panel that overlaps the app header.
