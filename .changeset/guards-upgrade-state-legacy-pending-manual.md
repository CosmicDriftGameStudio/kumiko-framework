---
"@cosmicdrift/kumiko-guards": patch
---

guard-upgrade-state keeps legacy pendingManual steps and reports malformed ones

<!-- kumiko-changes
feature: guards
type: fix
title: guard-upgrade-state keeps legacy pendingManual steps and reports malformed ones
detail: Marker entries written before pendingManual carried an id were dropped silently, so a repo with open manual steps passed the guard. The guard now derives the id from version and title like kumiko-upgrade does, and a structurally broken pendingManual entry is reported instead of filtered out.
-->
