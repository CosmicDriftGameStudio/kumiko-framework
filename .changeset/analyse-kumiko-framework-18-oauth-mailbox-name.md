---
"@cosmicdrift/kumiko-bundled-features": patch
---

A mailbox connected through OAuth no longer stores its address as plaintext name.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: OAuth connect leaves the mailbox name empty instead of copying the address
detail: The OAuth callback passed the mailbox address as `displayName` to `connect-account`. The address is encrypted as personal data, but `displayName` is stored in plaintext in the mail-account events, so the address ended up readable in the event store, beyond crypto-shredding. The callback now connects with an empty name; users name the mailbox through the rename action. Accounts connected earlier keep their stored name.
-->
