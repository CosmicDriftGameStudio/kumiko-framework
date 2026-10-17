---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Renaming a notification type keeps user preferences and address opt-outs

<!-- kumiko-changes
feature: delivery
type: improvement
title: Renaming a notification type keeps user preferences and address opt-outs
detail: r.notification accepts renamedFrom, a list of former qualified names. Preferences and address opt-outs stored under a former name keep applying to the renamed notification, and a stored choice under the current name wins over one under a former name. New writes via setPreference and the unsubscribe and resubscribe handlers are stored under the current name, resubscribeAddress also lifts opt-outs under former names. Boot fails if an alias is a current notification name, is the wildcard, or is claimed by two notifications.
-->
