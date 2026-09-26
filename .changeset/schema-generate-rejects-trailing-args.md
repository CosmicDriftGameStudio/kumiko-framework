---
"@cosmicdrift/kumiko-framework": patch
---

kumiko-schema generate rejects unrecognized trailing arguments instead of silently ignoring them

<!-- kumiko-changes
feature: framework
type: fix
title: schema generate rejects unrecognized trailing arguments
detail: |
  `kumiko-schema generate <name>` only ever read `argv[1]` as the migration
  name; any further argument (e.g. a typo'd `generate my-migration --dry-run`
  — there is no dry-run flag) was silently ignored and the migration was
  written anyway, with no indication the trailing argument did nothing.
  `generate` now exits 1 with "Unrecognized argument(s): ..." and writes
  nothing when called with more than a name.
-->
