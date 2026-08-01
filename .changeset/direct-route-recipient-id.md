---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`NotifyOptions` gains an optional `recipientId` for the `route` (direct, no-user-account) delivery path. Previously `route:{email}` sends always logged `recipientId: null` in the delivery-attempt event, so `recipientAddress` (piiFields subject = recipientId) had no subject key to encrypt under and stayed plaintext. Callers without a user account (e.g. a share-token recipient) can now pass `recipientId` to tie the logged address to a crypto-shredding subject.
