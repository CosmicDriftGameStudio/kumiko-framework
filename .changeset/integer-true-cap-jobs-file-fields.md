---
"@cosmicdrift/kumiko-framework": patch
---

Fix `readCapCounters.value`, `readJobRuns.duration`, and `fileRefs.size` silently drifting to `double precision` DDL after #1085 flipped `createNumberField`'s default (previously "always integer", now "double precision unless integer: true"). `duration` (job-run milliseconds) gets `integer: true`. `value` (cap-counter, e.g. cumulative byte counters) and `size` (file bytes) switch to `createBigIntField` instead — `integer` (int4, ~2.1 GB ceiling) isn't enough headroom for real byte-valued fields. Consumers bumping past this version will see a schema-drift migration correcting all three columns.
