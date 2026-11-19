---
"@cosmicdrift/kumiko-bundled-features": patch
---

The signature sweep reconciles an open request only when all of its signers have signed and reads the signature images in parallel.

<!-- kumiko-changes
feature: signature
type: improvement
title: Signature sweep skips open requests that still wait for a signer
detail: Every five minutes the sweep dispatched one reconcile write per open request, and each one loaded the signers only to find that someone had not signed yet. The sweep now counts the unsigned signers of each page of open requests in one grouped query and dispatches reconcile only for requests without any. Expired requests still expire as before. When the sweep builds the signature page, it reads the signature images in parallel instead of one after another.
-->
