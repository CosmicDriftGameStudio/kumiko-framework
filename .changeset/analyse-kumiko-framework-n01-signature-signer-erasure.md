---
"@cosmicdrift/kumiko-bundled-features": minor
---

Signers of declined, expired, failed or cancelled requests are erased after a shorter retention, and an admin can forget a single signer.

<!-- kumiko-changes
feature: signature
type: breaking
title: Shorter retention for signers of unfinished requests and an admin write to forget a signer
detail: `retention` of `createSignatureFeature` requires `unfinishedKeepFor` (data-retention keepFor syntax). A daily job `signature:job:erase-unfinished-signers` anonymizes the signers of requests that ended declined, expired, failed or cancelled more than `unfinishedKeepFor` ago: name, email, signature image, IP address, user agent and refusal reason are removed and the signer's record key is erased; status and timestamps stay. Completed requests keep `keepFor`. `signature:write:forget-signer` lets a TenantAdmin or DataProtectionOfficer erase one signer who has no account (row, image and record key) and cancels the request while it is still open or all-signed.
migration: Add `unfinishedKeepFor` to `retention`, for example `retention: { keepFor: "10y", unfinishedKeepFor: "90d" }`.
affects: createSignatureFeature
-->
