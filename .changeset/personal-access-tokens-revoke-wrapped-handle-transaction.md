---
"@cosmicdrift/kumiko-bundled-features": patch
---

Revoking all PATs of a user also runs atomically on wrapped pool handles

<!-- kumiko-changes
feature: personal-access-tokens
type: fix
title: revokeAllPatTokensForUser detects begin() the same way as the transaction helpers
detail: The transaction probe looked for begin() directly on the handle, so a pool wrapped by a legacy Drizzle connection fell back to a non-atomic update plus append. It now uses runnerCanBeginTransaction from bun-db, which unwraps the client first.
-->
