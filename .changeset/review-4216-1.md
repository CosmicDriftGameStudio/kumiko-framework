---
"@cosmicdrift/kumiko-bundled-features": patch
---

A keep link redeemed during the inactivity check can no longer end in a deletion request.

<!-- kumiko-changes
feature: tenant-inactivity
type: fix
title: Keep-link redemption and the destruction request are serialized
detail: The inactivity job checks the cycle and files the destruction request in one transaction under an advisory lock that the keep-account handler also takes. If the redemption wins, the job skips the request. If the request wins, the link is rejected as invalid instead of reporting a kept account for a tenant that is already in destroyRequested.
-->
