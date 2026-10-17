---
"@cosmicdrift/kumiko-bundled-features": patch
---

Waitlist invite is serialized per entry, sends the mail in the entry's locale and refuses existing tenant members

<!-- kumiko-changes
feature: waitlist
type: fix
title: Waitlist invite no longer double-invites, uses the entry locale and refuses members
detail: Two parallel invite calls for one entry now queue on a per-entry advisory lock, so exactly one tenant and one invitation are created. The invitation mail is rendered in the entry's locale instead of the caller's. Inviting an email that already is a member of the target tenant fails with 422 waitlist_not_invitable, as reject already did.
-->
