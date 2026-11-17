---
"@cosmicdrift/kumiko-renderer": patch
---

`AccentScope` tints a subtree with a tenant accent color from runtime data.

<!-- kumiko-changes
feature: renderer
type: improvement
title: AccentScope applies a tenant accent color
detail: `<AccentScope color={accent} className testId>` from `@cosmicdrift/kumiko-renderer/web` renders a div that sets `--color-primary`, `--color-ring` and a readable `--color-primary-foreground` (white or near-black, whichever contrasts more with the accent) for its children. Only hex colors (`#rgb`, `#rrggbb`, `#rrggbbaa`) apply; any other value keeps the theme colors. `accentColorVars(color)` returns the same variables as data. Apps no longer need an inline `style` with a lint suppression for branding colors.
-->
