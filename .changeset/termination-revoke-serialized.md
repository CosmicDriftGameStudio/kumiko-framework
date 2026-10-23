---
"@cosmicdrift/kumiko-bundled-features": patch
---

Revoking one termination no longer resumes a subscription another termination still cancels.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Revoking one termination no longer resumes a subscription another termination still cancels
detail: A revocation only resumes the subscription at the provider when no other recorded termination still cancels it. Recording and revoking a termination now run one at a time per tenant, so provider calls can no longer interleave with the event stream.
-->
