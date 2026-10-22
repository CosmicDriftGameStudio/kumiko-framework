---
"@cosmicdrift/kumiko-bundled-features": patch
---

`UserDataRightsHandlers` and `UserDataRightsQueries` list every user-data-rights write and query handler and are exported from the feature and its `/web` entry.

<!-- kumiko-changes
feature: user-data-rights
type: improvement
title: Complete, exported handler name constants
detail: UserDataRightsHandlers now covers all eight write handlers and UserDataRightsQueries all five explicit query handlers, and both are exported from user-data-rights and user-data-rights/web. A test compares them with the feature's registered handlers.
-->
