---
"@cosmicdrift/kumiko-bundled-features": patch
---

`parseSenderAddress` splits the sender text of an inbound mail into display name and address.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Sender address parser for inbound mail
detail: `parseSenderAddress(from)` from `@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation` turns the `from` text of an inbound message, such as `"Max Mustermann <max@firma.de>"`, into `{ label, email }`. A bare address is its own label, surrounding quotes are dropped, and a value without `@`, such as the `(no sender)` placeholder, yields `undefined`.
-->
