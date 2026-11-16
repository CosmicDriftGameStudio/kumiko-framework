---
"@cosmicdrift/kumiko-bundled-features": patch
---

Personal access token requests load membership and user in parallel.

<!-- kumiko-changes
feature: personal-access-tokens
type: improvement
title: PAT role resolution reads membership and user in parallel
detail: Every request authenticated with a personal access token resolves its live roles with the membership and user reads running concurrently instead of one after the other. Roles are still resolved fresh on every request; the outcomes for a removed membership or a blocked user are unchanged.
-->
