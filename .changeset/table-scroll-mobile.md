---
"@cosmicdrift/kumiko-renderer-web": patch
---

Fixes two mobile/tablet layout overflow bugs.

`entityList`'s row-actions column was unconditionally `sticky right-0` — on narrow viewports (e.g. 390px phones), once the table was wider than its container, this pinned the actions cell on top of the natural position of a preceding data column, rendering that value invisible even though it was inside the visible viewport. The sticky pin is now scoped to `md:` and up: below md, actions scroll with the row like any other cell (reachable via the table's own `overflow-x-auto` container); at md+, they stay pinned to the right edge as intended for wide tables.

Separately, the sidebar-based app shells (`DefaultAppShell`, `WorkspaceShell`) rendered their content inset without `min-width: 0`, so a flex row child never shrinks below its content's intrinsic width. A screen with wide content (e.g. many table columns) grew the inset — and with it the whole sidebar row — past the viewport, making the whole page scroll horizontally instead of the screen's own scrollable container. Fixed by adding `min-w-0` to the shared inset classes.
