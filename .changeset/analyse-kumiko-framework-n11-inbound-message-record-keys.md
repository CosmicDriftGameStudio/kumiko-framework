---
"@cosmicdrift/kumiko-bundled-features": patch
---

Each inbound mail is encrypted under its own record key, which forget, retention and tenant destroy erase.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Forgotten and expired mails are unreadable in the event log
detail: from, to, cc, subject, snippet, bodyText and bodyHtml of an inbound message were encrypted under the tenant key, so after forget-message or the retention sweep the full text stayed readable in the archived `inbound-message` events until the tenant was destroyed. These fields are now encrypted under the record key `record:inbound-message:<messageId>`. forget-message and the retention sweep erase that key before they delete the row (a failed erase keeps the row for the next run), and the tenant-destroy hook erases the key of every message before it archives and deletes the rows. The `inbound-mail-retention` job declares `irreversibleWithoutEntryHandler: "high-risk-or-cron-pipeline"` for that erase. Reading is unchanged: decryption takes the subject from the ciphertext, so `INBOUND_MESSAGE_PII_FIELDS` with `decryptPiiFieldValues` keeps working, and mails stored before this change stay under the tenant key. The mailbox address stays under the tenant key.
-->
