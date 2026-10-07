---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-framework": minor
---

Stat groups take a span, and a labeled group sizes its columns to its values

`stat-group` panels accept `span: "half" | "full"` like chart, list, feed and progress-list panels; without it a group still takes the full row. A labeled group lays out one column per value up to three, so a group with two values no longer leaves an empty third column and a single value takes the whole card width. To color a value and its icon chip by result (for example by sign), return a tone from `toneField` and leave `accentColor` unset; the chip then follows the tone.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Stat group span and column count
detail: Set span: "half" on a stat-group to place two groups side by side.
-->
