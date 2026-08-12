---
"@cosmicdrift/kumiko-renderer-web": minor
---

`Drawer` gets a new optional `backdrop` prop (`{ blurPx?, dimPercent? }`) to control the overlay behind the panel. **Breaking:** the backdrop is no longer blurred by default (`blurPx` defaults to `0`, `dimPercent` to `20`) — a drawer exists so the content behind it stays readable, and the previous fixed `2px` blur worked against that. Consumers that want the old look can pass `backdrop={{ blurPx: 2 }}`.

Also: the panel's default width grows from a fixed `420px` to `max(520px, 25vw)` (capped at `85vw`), so two-column forms fit without cramping. `resize.maxWidthPx` now defaults to `1000` (was `800`) to match; `resize.defaultWidthPx` still overrides the viewport-based default when set.
