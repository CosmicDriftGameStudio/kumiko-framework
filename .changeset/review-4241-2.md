---
"@cosmicdrift/kumiko-bundled-features": patch
---

A WhatsApp inbound message is charged against the sender budget once per wamid.

<!-- kumiko-changes
feature: channel-whatsapp
type: fix
title: Inbound messages are charged to the sender budget once per wamid
detail: A one-token marker bucket per tenant and wamid is taken before the sender windows are charged. A delivery that fails after the charge, its redelivery, and concurrent deliveries of the same wamid no longer use up the sender's budget again, so a real message is not stored as throttled by retries.
-->
