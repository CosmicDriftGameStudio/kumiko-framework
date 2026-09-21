---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-headless": minor
---

entityEdit accepts `layout.mode: "tabs"` (fw#3134)

A long edit form no longer has to choose between one endless page
(`mode: "single"`) and a forced walk through every step (`mode: "wizard"`).
Tabs were rejected at boot because a required field on a hidden tab would block
submit with nothing on screen to explain it.

What resolves that is not scoping validation to the active tab — that would
skip the field instead of showing it — but the opposite: every tab stays
mounted, one submit validates across all of them, and a field error activates
the tab holding it. Values from a tab the user never opened travel with that
submit. The tab strip needs the same per-tab `id` and title projectionDetail
already requires, now checked by a shared validator for both.

`actionForm`, `configEdit` and `secretMint` still reject tabs: none of them has
a jump-to-erroring-tab path, so the silent-block failure would remain.

The tab is activated, not focused — focus would need a platform-specific call
this layer does not have. The error renders inline on the now-visible field.

Two side effects worth knowing before declaring a tabs layout: a section that
omits `columns` defaults to 2 under tabs (the existing projectionDetail rule now
also reaches entityEdit), and the section title is dropped from the panel
because the tab label already carries it.

<!-- kumiko-changes
feature: renderer
type: improvement
title: entityEdit accepts layout.mode "tabs" (fw#3134)
migration: |
  Nothing to change: `single` and `wizard` behave as before. A screen that
  switches to `mode: "tabs"` needs at least two sections, each with a title and
  a kebab-case `id` — the same shape projectionDetail already requires. Two
  defaults differ from `single` inside a tabs layout: a section that omits
  `columns` renders in 2 columns, and its title is dropped from the panel
  because the tab label carries it.
-->
