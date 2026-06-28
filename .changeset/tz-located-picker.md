---
"@cosmicdrift/kumiko-framework": minor
---

Timezones (#268, item 10): render `locatedTimestamp` fields as a proper located date-time picker.

A `{ type: "locatedTimestamp" }` entity field now renders a wall-clock date + time input plus an IANA time-zone selector (new `LocatedTimestampInput`, `Input` kind `"locatedTimestamp"`) instead of falling through to a plain text input. The picker is pure wall-clock — no UTC conversion and no `new Date()` in the UI; it emits `{ at, tz }` and the server computes `utc`. New default i18n keys `kumiko.field.timezone` + `kumiko.field.locatedTzHint`.

Apps that replace the default web primitives should add a `case "locatedTimestamp"` to their `Input` implementation; `DefaultInput` handles it out of the box.
