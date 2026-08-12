---
"@cosmicdrift/kumiko-renderer-web": minor
---

`Drawer`'s resize props are now grouped under one optional `resize` object instead of four separate props. **Breaking:** `resizable`/`defaultWidthPx`/`minWidthPx`/`maxWidthPx` are gone — pass `resize={{ defaultWidthPx, minWidthPx, maxWidthPx }}` (all fields optional) to opt in, or omit `resize` entirely for the old `resizable={false}` default. No app in this workspace passed these props, so no consumer migration was needed here.

Also fixed in this release:
- `DefaultDataTable`'s dead `env(safe-area-inset-bottom)` inline style (never had an effect in any supported browser) is replaced with the `max-sm:pb-4` utility class it was meant to express.
- `drawer.test.tsx` now covers the resize behavior added earlier: keyboard resize direction per `side`, clamping at `minWidthPx`/`maxWidthPx`, the maximize toggle, and that `side="top"`/`"bottom"` drawers never render a resize handle.
- `Form`'s sticky-actions test now also asserts the content container's `max-sm:pb-24` padding class, not just the footer's `max-sm:fixed`.
