---
"@cosmicdrift/kumiko-bundled-features": patch
---

The email channel now matches explicit `data.headers` case-insensitively against the automatic unsubscribe headers. Overriding `List-Unsubscribe` or `List-Unsubscribe-Post` in any spelling drops the whole automatic pair, so a mail client no longer sends a one-click POST to a URL that cannot handle it.

<!-- kumiko-changes
feature: channel-email
type: fix
title: Explicit List-Unsubscribe headers replace the automatic pair case-insensitively
-->
