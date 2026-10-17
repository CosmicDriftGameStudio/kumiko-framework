---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-headless": patch
---

Timestamp format accepts a timeZone

<!-- kumiko-changes
feature: headless
type: improvement
title: The timestamp FormatSpec takes an IANA timeZone
detail: { format: "timestamp", timeZone: "Europe/Berlin" } formats the instant in that zone instead of the runtime's zone. Without timeZone nothing changes. The option is ignored for the date format, which has no time component.
-->
