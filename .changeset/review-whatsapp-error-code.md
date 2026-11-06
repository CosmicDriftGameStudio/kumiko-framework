---
"@cosmicdrift/kumiko-bundled-features": patch
---

A WhatsApp status callback with a non-integer error code no longer fails the delivery.

<!-- kumiko-changes
feature: channel-whatsapp
type: fix
title: Non-integer status error codes are dropped instead of answering 500
detail: The webhook normalizer accepted any number as a status error code while the handler schema requires an integer, so a fractional code made the whole delivery answer 500 and Meta redeliver it. The code is now dropped to null like other invalid optional fields.
-->
