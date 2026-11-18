---
"@cosmicdrift/kumiko-bundled-features": patch
---

channel-email skips placeholder addresses on the reserved `.invalid` TLD.

<!-- kumiko-changes
feature: channel-email
type: fix
title: No mail to .invalid placeholder addresses
detail: Addresses on the reserved `.invalid` TLD (RFC 2606), such as a guest account's `guest-<id>@guests.invalid` or an anonymized user's address, are never handed to the mail provider, which rejected them. The email channel resolves such a stored address to none and answers a send to one with `skipped` / `no_address`, so the delivery log records a skipped attempt instead of a failed one and the failed-mail alert stays quiet. The user-data-rights deletion-executed mail treats that skip as done instead of logging a send failure.
-->
