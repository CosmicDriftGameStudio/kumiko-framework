---
"@cosmicdrift/kumiko-bundled-features": patch
---

User unsubscribe links no longer expire.

<!-- kumiko-changes
feature: delivery
type: fix
title: Unsubscribe links in older mails keep working
detail: `signUnsubscribeToken` no longer sets a 7-day expiry, matching the address unsubscribe tokens. List-Unsubscribe links and footer links in mails older than a week now still opt the user out. Tokens signed before this change keep their old expiry. Resubscribe tokens still expire after one hour.
-->
