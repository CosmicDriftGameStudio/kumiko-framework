---
"@cosmicdrift/kumiko-bundled-features": patch
---

Two concurrent deliveries of one WhatsApp message or status store one event.

<!-- kumiko-changes
feature: channel-whatsapp
type: fix
title: Concurrent webhook deliveries no longer store a message or status twice
detail: The receive-message and record-status handlers now take a per-stream advisory lock before their duplicate check. Before, a delivery that committed after the other one's load landed as a second event on the same stream.
-->
