---
"@cosmicdrift/kumiko-bundled-features": patch
---

A test now covers the connector heartbeat for a device whose connector row is gone: it answers without a name and still hands over the retry signal once.

<!-- kumiko-changes
feature: connectors
type: fix
title: heartbeat without connector name is covered by a test
detail: The heartbeat answer omits `name` when the connector lookup finds nothing. A new integration test pins this and that the retry flag still rides on exactly one answer.
-->
