---
"@cosmicdrift/kumiko-renderer-web": patch
---

Fixes entityList tables overflowing off-screen on narrow viewports (e.g. 390px phones) with no way to reach the hidden columns: the shared `DataTable` row-actions column was `sticky right-0`, which — once the table is wider than its container (any narrow screen) — pinned the actions cell on top of the natural position of the preceding data column(s), rendering their value invisible even though it was inside the visible viewport. The actions column now scrolls in normal document flow along with every other column, so the table's existing `overflow-x-auto` container (from the vendored shadcn `Table`) makes every column reachable without any cell obscuring another.
