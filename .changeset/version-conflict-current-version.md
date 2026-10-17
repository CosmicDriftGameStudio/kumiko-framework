---
"@cosmicdrift/kumiko-framework": patch
---

version_conflict reports the real stream version

<!-- kumiko-changes
feature: framework
type: fix
title: version_conflict from delete, restore, forget and update reports the actual stream version
detail: After a lost append race, delete, restore and forget returned currentVersion -1 and update returned the version read before the race, so expectedVersion and currentVersion looked equal. They now look up the stream version after the conflict; -1 remains only when that lookup fails.
-->
