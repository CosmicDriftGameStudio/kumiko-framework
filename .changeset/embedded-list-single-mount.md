---
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix #1854: `EmbeddedListInput` mounted both the desktop table and the mobile card
layout at once, toggling visibility with `hidden`/`md:hidden`. Both mounts rendered
the same `data-cell-id`/`id` for every cell, so two live inputs (each with its own
draft state) shared one DOM id — automation could hit the hidden instance, and a
filled-in cell could appear empty while a derived total read the correct value.
Only the layout matching the current viewport (via `useIsMobile`) is mounted now.
