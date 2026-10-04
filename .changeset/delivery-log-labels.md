---
"@cosmicdrift/kumiko-bundled-features": minor
---

The delivery log screen shows the time and the error of each attempt and translates type, channel, status and error. Error codes map to `delivery.error.<code>` (`http_<status>` to `delivery.error.http` with a `status` parameter), statuses to `delivery.status.<status>`, channels to `delivery.channel.<name>`. Every bundled channel feature registers its own channel label. Notification types are shown through `<scope>.notification.<name>` for a type `<scope>:notify:<name>`; apps register those labels, and the short name is shown when none exists. English, German and Spanish texts are included for the bundled keys.

`translateOrRaw` moved from the tenant web folder to `shared/web`; it is internal.

<!-- kumiko-changes
feature: delivery
type: improvement
title: Delivery log shows time and error and translates its values
-->
