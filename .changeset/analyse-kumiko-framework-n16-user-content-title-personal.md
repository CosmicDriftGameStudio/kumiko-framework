---
"@cosmicdrift/kumiko-bundled-features": minor
---

Titles and folders of user-owned collection entries are encrypted with the owner's key like the body.

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: User-owned entry titles and folders are personal data
detail: `user-content-entry.title` and `.folder` are now `personal: { of: "ownerId" }`. They are stored encrypted while a KMS is configured, decrypted by the collection list and item queries and by the user export, and read as erased after the owner's key is shredded. Before, a forget left signature and snippet names in plaintext.
migration: Apps with an `ownership: "user"` collection run the PII backfill (backfillEventPiiEncryption) and rebuild the user-content-entry projection; raw reads of read_user_content_entries.title and .folder now return ciphertext and must go through decryptStoredPii or the collection queries.
-->
