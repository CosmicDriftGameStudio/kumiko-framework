---
"@cosmicdrift/kumiko-renderer-web": patch
---

On narrow viewports, a wizard that edits an existing record shows the step label as an expandable step list (same done and jump rules as the rail), so phones can jump between steps. Every pinned form footer (wizards and screen forms alike) wraps below `sm`: its buttons grow to fill each row, every button stays fully visible, and a label that is too long wraps inside its button.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Update-mode wizards get a step picker on narrow viewports; the pinned footer no longer cuts off buttons on phones
detail: |
  `StepBar` with `onStepSelect` and `selectableSteps="all"` renders the compact label as a dropdown listing every step. The pinned footer wraps below `sm`: its buttons grow to fill each row (a lone save button spans the full width) and long labels wrap inside the button instead of overflowing.
migration: |
  No code change needed.
-->
