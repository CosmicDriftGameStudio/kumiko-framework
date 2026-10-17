---
"@cosmicdrift/kumiko-framework": patch
---

Cron schedulers are restored after a failed seen stamp

<!-- kumiko-changes
feature: framework
type: fix
title: A failed scheduler seen stamp at start no longer lets an older runner remove fresh cron schedulers for good
detail: When the initial seen stamp failed, a concurrent older runner could delete the new runner's cron schedulers as orphans, and the periodic refresh only re-stamped them. The refresh now stamps and upserts the lane's cron schedulers again until both succeeded once.
-->
