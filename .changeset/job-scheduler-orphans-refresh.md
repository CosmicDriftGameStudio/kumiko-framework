---
"@cosmicdrift/kumiko-framework": patch
---

A cron job scheduler left behind by a previous app version is now removed by the running job runner once its grace period has passed, instead of firing "Unknown job" errors until the next restart. `stringifyJson` is now exported from `@cosmicdrift/kumiko-framework/utils`.

<!-- kumiko-changes
feature: jobs
type: fix
title: Orphan job schedulers are removed while the runner keeps running
detail: A cron job scheduler that no running app version registers any more is now removed by the running job runner once its grace period has passed, so a job dropped in a deploy stops logging "Unknown job" without waiting for the next restart. Schedulers another live runner still holds are left alone. Nothing to do for apps.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: stringifyJson on the utils subpath
detail: `stringifyJson` is now exported from `@cosmicdrift/kumiko-framework/utils`, next to `parseJsonSafe` and `parseJsonOrThrow`.
-->
