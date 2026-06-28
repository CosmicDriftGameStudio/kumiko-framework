---
"@cosmicdrift/kumiko-framework": minor
---

Timezones (#268, item 9): boot/write validations.

- `type:"tz"` and `locatedTimestamp` time-zone values are now validated against the IANA zone list at the write boundary — an invalid zone fails with a 4xx here instead of surfacing later in `ctx.tz.parse`/Temporal.
- The server warns at boot when its process time zone is not UTC (the framework assumes a UTC server clock).

New exports from `@cosmicdrift/kumiko-framework/time`: `isValidIanaTimeZone`, `warnIfNonUtcServerTimeZone`.
