---
"@cosmicdrift/kumiko-bundled-features": patch
---

Each inbound mail is encrypted under its own record key; forget-message and tenant destroy erase it, the retention sweep only when `eraseRecordKeys` is set.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Forgotten mails are unreadable in the event log; retention key erase is opt-in
detail: from, to, cc, subject, snippet, bodyText and bodyHtml of an inbound message were encrypted under the tenant key, so after forget-message the full text stayed readable in the archived `inbound-message` events until the tenant was destroyed. These fields are now encrypted under the record key `record:inbound-message:<messageId>`. forget-message erases that key before it deletes the row (a failed erase keeps the row for the next run), and the tenant-destroy hook erases the key of every message the tenant's event log names, including mails the retention sweep already removed, before it archives and deletes the rows. The retention sweep (`runInboundMailRetention`) erases the key of a purged mail only with the opt-in `eraseRecordKeys: true`; by default it behaves as before and leaves the archived stream readable. Reading is unchanged: decryption takes the subject from the ciphertext, so `INBOUND_MESSAGE_PII_FIELDS` with `decryptPiiFieldValues` keeps working, and mails stored before this change stay under the tenant key. The mailbox address stays under the tenant key.
-->
