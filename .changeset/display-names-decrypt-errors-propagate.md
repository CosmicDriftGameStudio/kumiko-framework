---
"@cosmicdrift/kumiko-bundled-features": patch
---

resolveUserDisplayNames no longer swallows decrypt errors

<!-- kumiko-changes
feature: user
type: fix
title: resolveUserDisplayNames no longer swallows decrypt errors
detail: A misconfigured or unavailable KMS made the delivery log silently show addresses or ids instead of names. Decrypt errors now propagate like in the member directory; users that are missing or have no display name are still left out.
-->
