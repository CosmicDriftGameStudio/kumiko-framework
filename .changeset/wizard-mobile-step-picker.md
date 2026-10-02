---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

On narrow viewports, a wizard that edits an existing record shows the step label as an expandable step list (same done and jump rules as the rail), so phones can jump between steps. Below `sm` the pinned form footer is always one fixed-height row: Back as an icon button, every other action in a "…" popover (shown only while one of them is enabled, with a dot when there are unsaved changes), and the primary action filling the rest with a one-line label. `@cosmicdrift/kumiko-renderer` exports `FOOTER_ACTION_ROLE_PROP` and `NARROW_LABEL_PROP` so custom footer buttons can mark themselves as Back or primary and give a short phone label.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Update-mode wizards get a step picker on narrow viewports; the pinned footer is a single fixed row on phones
detail: |
  `StepBar` with `onStepSelect` and `selectableSteps="all"` renders the compact label as a dropdown listing every step. Below `sm` the pinned footer is one row: Back as icon, other actions in a "…" popover that only shows while one of them is enabled, primary action filling the rest. New renderer markers `FOOTER_ACTION_ROLE_PROP` and `NARROW_LABEL_PROP` classify custom footer buttons.
migration: |
  No code change needed.
-->
