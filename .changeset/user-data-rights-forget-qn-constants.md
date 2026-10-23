---
"@cosmicdrift/kumiko-bundled-features": patch
---

user-data-rights exports the forget-cleanup job and the download-attempt list screen QN as constants.

<!-- kumiko-changes
feature: user-data-rights
type: improvement
title: QN constants for the forget-cleanup job and the download-attempt list screen
detail: UserDataRightsJobs.runForgetCleanup ("user-data-rights:job:run-forget-cleanup") and UserDataRightsScreens.downloadAttemptList ("user-data-rights:screen:download-attempt-list") are exported next to the existing QN constants, from the feature barrel and from user-data-rights/web. Use the screen constant in an app's r.nav instead of the literal string.
-->
