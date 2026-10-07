---
"@cosmicdrift/kumiko-server-runtime": patch
---

runProdApp validates Key-Manager-decrypted env slots against their schema

A `kms` slot delivered only as `_CIPHERTEXT` skipped its own `.regex`/`.min`/`.refine` because the first parse relaxes it. After decryption the env is now parsed again, so a malformed plaintext aborts the boot with a `KumikoBootError` naming the slot.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Boot rejects decrypted kms env slots that violate their schema validators
-->
