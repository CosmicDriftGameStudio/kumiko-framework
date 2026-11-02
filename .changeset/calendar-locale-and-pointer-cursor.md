---
"@cosmicdrift/kumiko-renderer": patch
---

The date picker follows the app locale and its navigation no longer overlaps the year select; buttons, tabs and menu items show the hand cursor.

<!-- kumiko-changes
feature: renderer
type: fix
title: calendar uses the app locale and a non-overlapping header, interactive controls get a pointer cursor
detail: `CalendarDayPicker` takes month and weekday names and the week start (de starts on Monday) from the renderer locale (de, en, es, fr, it; other languages fall back to en-US). Prev/next buttons sit beside the dropdowns via `navLayout="around"` instead of absolute positioning, and the chevrons use `fill-current` with token colors. A base rule in `styles.css` sets `cursor: pointer` on enabled `button`, `[role=button]`, `[role=tab]` and `[role=menuitem]`, because Tailwind v4 preflight resets it to default.
-->
