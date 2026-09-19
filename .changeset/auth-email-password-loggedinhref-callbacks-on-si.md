---
"@cosmicdrift/kumiko-bundled-features": minor
---

loggedInHref callbacks on SignupCompleteScreen and InviteAcceptScreen now receive the roles granted by the flow

Apps can route a freshly activated user to a screen their role can actually open, instead of a fixed path that may render Access denied. The string form of loggedInHref is unchanged; the function form gains a roles field next to the existing tenantKey/tenantId.

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: loggedInHref callbacks on SignupCompleteScreen and InviteAcceptScreen now receive the roles granted by the flow
-->
