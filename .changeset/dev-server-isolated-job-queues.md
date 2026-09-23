---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

Dev-server boots now use a per-boot BullMQ queue-name prefix (stable per persistent dev DB, random per ephemeral boot) instead of the shared prod default, so parallel dev/e2e servers on the same Redis no longer steal each other's jobs.

<!-- kumiko-changes
feature: dev-server
type: fix
title: Dev-server job queues no longer collide across parallel boots
-->
