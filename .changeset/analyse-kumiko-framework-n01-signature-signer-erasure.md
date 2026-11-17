---
"@cosmicdrift/kumiko-bundled-features": minor
---

Signers of declined, expired, failed or cancelled requests can be erased after a shorter retention when the app sets `retention.unfinishedKeepFor`, and an admin can forget a single signer.

<!-- kumiko-changes
feature: signature
type: improvement
title: Opt-in retention for signers of unfinished requests and an admin write to forget a signer
detail: `retention` of `createSignatureFeature` accepts the optional `unfinishedKeepFor` (data-retention keepFor syntax); there is no default. Only when it is set, the daily job `signature:job:erase-unfinished-signers` is registered and anonymizes the signers of requests that ended declined, expired, failed or cancelled more than `unfinishedKeepFor` ago: name, email, signature image, IP address, user agent and refusal reason are removed and the signer's record key is erased; status and timestamps stay. Without it nothing is anonymized and signers keep `keepFor`. Completed requests always keep `keepFor`. `signature:write:forget-signer` lets a TenantAdmin or DataProtectionOfficer erase one signer who has no account (row, image and record key) and cancels the request while it is still open or all-signed.
migration: Nothing to do. To switch the job on add `unfinishedKeepFor` to `retention`, for example `retention: { keepFor: "10y", unfinishedKeepFor: "90d" }`.
affects: createSignatureFeature
-->
