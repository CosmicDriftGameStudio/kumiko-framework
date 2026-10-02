---
"@cosmicdrift/kumiko-bundled-features": patch
---

Metric queries now reject offset time zones such as `+01:00` with a validation error. Postgres reads them with the opposite sign, so day buckets came back empty. Use IANA names like `Europe/Berlin`.

<!-- kumiko-changes
feature: metrics
type: fix
title: Metric queries reject offset time zones
-->
