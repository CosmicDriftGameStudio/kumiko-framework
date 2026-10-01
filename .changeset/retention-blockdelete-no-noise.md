---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

Entities with `retention.strategy: "blockDelete"` and no anonymize fields no longer produce a `missing_anonymize_fields` skip in every retention cron run, and the boot warning about the EXT_USER_DATA delete hook for subjectRef-only entities is gone (hook existence is enforced when user-data-rights is mounted; no-op hooks are not detected at boot, with or without the old warning). `strategy: "anonymize"` without anonymize fields is still reported.

<!-- kumiko-changes
feature: data-retention
type: fix
title: blockDelete entities without anonymize fields no longer log skips or boot warnings
-->
