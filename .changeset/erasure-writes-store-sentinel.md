---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Erasure writes store the erased sentinel instead of failing on a deleted subject key

<!-- kumiko-changes
feature: framework
type: fix
title: Executor update and delete with writePurpose erasure, and forget, write the erased sentinel for subjects whose key is gone
detail: Re-encrypting a pre-KMS plaintext row after eraseKey threw subject-erased, so the erase flows could not finish their own follow-up writes. Update and delete with writePurpose erasure, and forget always, now replace the PII fields of an erased subject in changes and previous with the sentinel; fields of other subjects in the same row stay encrypted. Without writePurpose and for restore the subject-erased conflict stays. The forget-subject door close and the forget cleanup pass writePurpose erasure to the user lifecycle update.
-->
