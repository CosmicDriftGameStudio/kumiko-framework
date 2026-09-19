---
"@cosmicdrift/kumiko-renderer-web": patch
---

fix(renderer-web): timestamp input emits seconds

`inputValueToTimestamp` assembled the Z-instant from hours and minutes and
left the seconds off (`2026-09-01T10:00Z`). Write schemas validate
`timestamp` fields without `locatedBy` using `z.iso.datetime()`, which
requires `HH:mm:ssZ`.

Externally visible: a required `timestamp` field without `locatedBy` could
never be saved through the web UI — every save ended in `422 invalid_format`
on that field. The Bug-Bash-2 regression test (`timestamp-input.test.tsx`)
already covered the case and was red; back then the missing `Z` was added,
the seconds were not.

The emitted seconds are always `00` in practice, because
`timestampToInputValue` truncates inbound values to minutes. That truncation
is pre-existing and untouched here.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: timestamp input emits seconds
-->

