---
"@cosmicdrift/kumiko-renderer": patch
---

A config edit screen keeps its form and the user's input when reloading the values after a save fails; the error shows above the form with a retry.

<!-- kumiko-changes
feature: renderer
type: fix
title: Config edit keeps the form when the refetch fails
detail: After a save the config edit screen reloads its values. When that reload failed, the screen replaced the whole form with an error banner, so input in other sections was lost after a short network drop. The full-screen banner now appears only when the first load has no data, as on list screens; a failed reload with values on screen shows the error with a retry button above the form, which stays mounted.
-->
