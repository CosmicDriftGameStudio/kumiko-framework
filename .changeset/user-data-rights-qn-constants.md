---
"@cosmicdrift/kumiko-bundled-features": patch
---

user-data-rights exports UserDataRightsJobs and UserDataRightsScreens, so apps no longer type the export job and screen QN strings.

<!-- kumiko-changes
feature: user-data-rights
type: improvement
title: QN constants for the export job and the export job list screen
detail: UserDataRightsJobs.runExportJobs ("user-data-rights:job:run-export-jobs") and UserDataRightsScreens.exportJobList ("user-data-rights:screen:export-job-list") are exported next to UserDataRightsQueries and UserDataRightsHandlers, from the feature barrel and from user-data-rights/web. Use the screen constant in an app's r.nav instead of the literal string.
-->
