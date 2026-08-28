---
"@cosmicdrift/kumiko-framework": patch
---

`buildAppSchema`'s client-schema projection now forwards `multiline` (text/longText), `min`/`max`/`locale` (number/date/timestamp/locatedTimestamp), `capture` (image), and the embedded-list renderer hints `minItems`/`maxItems`/`derived`/`totals`/`totalsMatch` — previously dropped by `projectField`'s per-property whitelist, leaving the renderer without hints it already reads from the client schema. The `default`-value JSON-safety check (defense-in-depth against smuggled function defaults) is widened to accept JSON-safe arrays/plain-objects instead of only literals, and now also gates the four newly-forwarded structured properties so a function value nested one level deep is still rejected.
