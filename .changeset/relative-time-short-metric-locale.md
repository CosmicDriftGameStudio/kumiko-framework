---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

The relativeTime format takes style, withTime, absoluteAfterDays and timeZone, config keys can be shown read-only in the settings hub, projectionDetail metrics use the UI locale, and inline card meta wraps on phones.

<!-- kumiko-changes
feature: renderer
type: improvement
title: relativeTime options style, withTime, absoluteAfterDays, timeZone
detail: A column renderer or metric format { format: "relativeTime" } accepts style "short" (41 min. ago), withTime (yesterday, 10:18 and the absolute date with the clock time), absoluteAfterDays n (absolute date such as 29 Oct 2026 from n days on) and timeZone. Boot validation rejects a bad style, a non-integer absoluteAfterDays below 1 and a non-boolean withTime. Without options the text is unchanged.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: ConfigMask.readOnly shows a key without an input in the settings hub
detail: mask: { title, readOnly: true } keeps the key on the generated settings screen as a read-only field. A readOnly key that is also required fails at boot, since nobody could fill it.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: projectionDetail metrics format relativeTime in the UI locale
detail: A metric with format { format: "relativeTime" } fell back to the browser language ("42 minutes ago" in a German UI). The metric now passes the UI locale, unless the format sets its own locale.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Inline card meta wraps instead of truncating equal-width columns
detail: On phones, narrowInline list columns sit in a wrapping row with natural widths; only a single over-long element is truncated.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Banner actions wrap below the text on phones
detail: A banner with actions (such as the projectionDetail banner) squeezed its text into a narrow column next to the buttons on phone widths. Below sm the row now wraps: the text keeps the line and the actions take their own line. Desktop is unchanged.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: relativeTime counts calendar days and falls back to the browser language
detail: "Yesterday" and the day count now come from calendar days in the format's timeZone (default: the runtime zone) instead of rounded hours, so a value from the day before yesterday no longer reads "yesterday, 22:00" shortly after midnight. Without a locale the format used en-US instead of the browser language.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Read-only settings fields offer no reset button
detail: A configEdit field marked readOnly in the layout (including keys with mask.readOnly) no longer shows the "reset override" button in its cascade display.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Boot validation checks the relativeTime timeZone
detail: A relativeTime format with an unknown timeZone such as Europe/Berln fails at boot instead of throwing when the cell renders.
-->
