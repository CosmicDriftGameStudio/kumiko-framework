---
"@cosmicdrift/kumiko-bundled-features": patch
---

notify() to several recipients loads their notification preferences in one query.

<!-- kumiko-changes
feature: delivery
type: improvement
title: Fewer database round trips when notifying many recipients
detail: For a notify() to a user list or a whole tenant, the preferences of all recipients load in one query instead of one per recipient and channel, the tenant kill switch is asked once per channel, and the queued attempt event skips the stream-version lookup. Preference rules are unchanged; the rate limit still counts each recipient and channel.
-->
