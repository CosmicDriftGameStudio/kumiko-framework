---
"@cosmicdrift/kumiko-framework": patch
---

Job triggers accept short handler and event names

r.job trigger.on now qualifies a short name against the job's own feature (write handler, then query handler, then defineEvent), like notification triggers, and the boot error lists every name it tried.

<!-- kumiko-changes
feature: framework
type: fix
title: Job triggers accept short handler and event names
-->
