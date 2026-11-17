---
"@cosmicdrift/kumiko-bundled-features": minor
---

forget-signer answers not found unless the caller can read the record the signature request belongs to.

<!-- kumiko-changes
feature: signature
type: breaking
title: forget-signer checks the host record
detail: signature:write:forget-signer loads the signer's request and its host record with the caller's rights, like revoke-link. A caller who cannot read the host (for example a data protection officer without read access to the lease) gets 404 and the signer stays.
migration: Code that calls createForgetSignerHandler directly passes the signature request executor. Erasing signers of records outside the caller's read rights runs through a role that can read the host or through forget-subject.
affects: createForgetSignerHandler
-->
