---
"@cosmicdrift/kumiko-headless": patch
---

Fix the apex dropdown nav menu (`kind: "menu"`) in the dark theme: panel titles and the
footer link inherited the dark-chrome nav-link color (white) and became invisible on the
light popover. They are now pinned to readable colors (`--fg` / `--primary`) with matching
specificity, so the panel stays legible in both themes.
