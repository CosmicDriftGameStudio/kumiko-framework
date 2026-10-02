---
"@cosmicdrift/kumiko-bundled-features": patch
---

Session logout and PAT revoke now commit the revoke and its revoked-event in one transaction, so a failed append no longer leaves a revoked token whose SSE streams stay open. GDPR delete hooks now try every row of the subject and report all failures at once instead of stopping at the first. The notes mention-forget hook loads the mentioned notes with one query and resolves each host entity's retention policy once.

<!-- kumiko-changes
feature: sessions
type: fix
title: Session revoke and its revoked-event commit atomically
-->

<!-- kumiko-changes
feature: personal-access-tokens
type: fix
title: PAT revoke and its revoked-event commit atomically when called on a pool
-->

<!-- kumiko-changes
feature: user-data-rights-defaults
type: fix
title: Delete hooks erase every row and report all failures together
-->
