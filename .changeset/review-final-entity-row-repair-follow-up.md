---
"@cosmicdrift/kumiko-server-runtime": patch
---

The entity row repair runs once more after the boot run, so rows written by previous-release pods during a rolling deploy get repaired too.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Entity row repair gets a follow-up run
detail: `startEntityRowRepairsOnBoot` runs the version alignment and the user-email normalization once at boot and once more 30 minutes after the boot run ended (`followUpDelayMs`), under the same advisory lock. Pods of the previous release keep writing the old row shape while a rolling deploy runs; what they wrote after the last new pod booted stayed wrong until the next deploy. Shutdown cancels a pending follow-up and waits for a running one. It is no recurring job.
-->
